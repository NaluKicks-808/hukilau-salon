'use strict';

/**
 * troubleshoot-call.js — reconstruct the salon's REAL availability for a service on a given
 * day (and, for a past call, at the exact call time) so you can judge whether the AI voice
 * agent answered a call correctly.
 *
 * This is the read-only, ground-truth companion to `npm run calls`. It runs the salon's own
 * lifted slot math (vendor/availability-core) against the live calendar — the same code the
 * live phone agent uses — so its answer is what the agent SHOULD have said.
 *
 * Read-only. Never writes to the salon or anywhere else.
 *
 * Usage:
 *   npm run troubleshoot -- --service "men's haircut" --date 2026-07-20
 *   npm run troubleshoot -- --service "men's haircut" --date 2026-07-20 --at 11:34 --want 14:00-15:00
 *   npm run troubleshoot -- --service highlights --add "haircut" --date tomorrow --stylist Amanda
 *
 * Flags:
 *   --service <phrase>   spoken service ("men's haircut", "balayage"). Required.
 *   --add <phrase>       an additional service for a combo (repeatable).
 *   --date <d>           YYYY-MM-DD or today/tomorrow/yesterday. Required.
 *   --at <HH:mm>         simulate the clock at this salon-local time. For a PAST date this
 *                        reconstructs exactly what the agent saw at call time. Default: salon "now".
 *   --want <HH:mm-HH:mm> highlight the caller's desired time window in the output.
 *   --stylist <name>     restrict to one stylist (else all eligible).
 *   --days <n>           also list the earliest opening on the next n days (the fallback the agent
 *                        should have offered). Default 3.
 *
 * Why the clock matters: the salon's slot math blocks every time before "now" on the current day.
 * A PAST day is frozen, so any slot still open in it was open at call time too — but to see the
 * day exactly as the agent saw it (e.g. at 11:34 AM), pass --at.
 */

const moment = require('moment-timezone');
const { getSalonData, getBookedAppointments } = require('../src/salonClient');
const core = require('../vendor/availability-core');
const { resolveServices } = require('../src/services');
const { resolveStylist, byIndex, shortName } = require('../src/stylists');
const { ToMinutes } = core;

function parseArgs(argv) {
  const a = { service: null, add: [], date: null, at: null, want: null, stylist: null, days: 3 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--service') a.service = argv[++i];
    else if (k === '--add') a.add.push(argv[++i]);
    else if (k === '--date') a.date = argv[++i];
    else if (k === '--at') a.at = argv[++i];
    else if (k === '--want') a.want = argv[++i];
    else if (k === '--stylist') a.stylist = argv[++i];
    else if (k === '--days') a.days = Number(argv[++i]) || 3;
  }
  return a;
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const label12 = (min) => moment.tz('2000-01-01', 'YYYY-MM-DD', 'UTC').add(min, 'm').format('h:mm A');

// Resolve --date into a salon-local moment (explicit ISO, or today/tomorrow/yesterday).
function resolveDay(input, tz, nowMs) {
  const s = String(input || '').trim().toLowerCase();
  const now = moment.tz(nowMs, tz);
  if (s === 'today') return now.clone().startOf('day');
  if (s === 'tomorrow') return now.clone().add(1, 'day').startOf('day');
  if (s === 'yesterday') return now.clone().subtract(1, 'day').startOf('day');
  const m = moment.tz(input, 'YYYY-MM-DD', tz);
  return m.isValid() ? m.startOf('day') : null;
}

// Parse "HH:mm-HH:mm" into {start,end} minutes.
function parseWindow(w) {
  if (!w) return null;
  const [a, b] = String(w).split('-');
  const toMin = (t) => {
    const mm = moment(t.trim(), ['H:mm', 'HH:mm', 'h:mmA', 'h A']);
    return mm.isValid() ? mm.hour() * 60 + mm.minute() : null;
  };
  const start = toMin(a);
  const end = b != null ? toMin(b) : null;
  return start == null ? null : { start, end };
}

// Approximate a stylist's booked blocks on the day, from serviceBindings (illustrative — the
// authoritative open-slot list comes from core.computeAvailability below).
function bookedBlocks(appts, y, m0, d, posIDs) {
  const svcbreak = false; // display only
  const out = [];
  for (const a of appts) {
    const mm = moment(a.localStart, 'M/DD/YYYY hh:mm A');
    if (!(mm.year() === y && mm.month() === m0 && mm.date() === d)) continue;
    let cur = mm.hour() * 60 + mm.minute();
    for (const b of a.serviceBindings || []) {
      const dur = ToMinutes(b.duration) + (b.breakDuration ? ToMinutes(b.breakDuration) : 0);
      const who = b.svcEmployeePOSID || b.assigned;
      if (posIDs.has(who)) out.push({ who, start: cur, end: cur + dur, name: b.name || 'service' });
      cur += dur;
    }
  }
  return out.sort((x, y2) => x.start - y2.start);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.service || !args.date) {
    console.error('Need at least --service and --date. See the header of scripts/troubleshoot-call.js for usage.');
    process.exit(1);
  }

  const data = await getSalonData({ force: true });
  core.configure(data);
  const tz = data.jsonMerchant.timezone;
  const realNow = moment.now;
  const salonNow = moment.tz(tz);
  console.log(`Salon time now: ${salonNow.format('YYYY-MM-DD HH:mm dddd')} (${tz}) | advance=${data.advance}h | booking window ${data.monthsx}mo`);

  // Resolve the service(s).
  const wanted = [args.service, ...args.add].filter(Boolean);
  const { matches, unresolved } = resolveServices(wanted, data.serviceJSON);
  if (unresolved.length || !matches.length) {
    const u = unresolved[0] || { input: wanted[0], candidates: [] };
    console.log(`\n❌ Could not resolve "${u.input}" to a menu service.` +
      (u.candidates && u.candidates.length ? ` Closest: ${u.candidates.map((c) => c.name).join(', ')}` : ' (would be handled as an off-menu special request on a real call.)'));
    return;
  }
  const svcIdxs = matches.map((m) => m.index);
  const svcLabel = matches.map((m) => m.name).join(' + ');
  console.log(`\nResolved "${wanted.join(' + ')}" -> ${svcLabel}`);

  // Which stylists actually offer ALL requested services online (offered && offeredOnline)?
  const posSet = matches.map((m) => data.serviceJSON[m.index].posID);
  const eligible = data.employeeJSON
    .map((e, i) => ({ i, name: e.name, posID: e.posID, emp: e }))
    .filter((x) => posSet.every((pid) => {
      const cfg = (x.emp.serviceCfgs || []).find((c) => c.posID === pid);
      return cfg && cfg.offered && cfg.offeredOnline;
    }));
  console.log(`Stylists who offer ${svcLabel} online: ${eligible.length ? eligible.map((x) => `${shortName(x.i)}`).join(', ') : 'NONE'}`);
  data.employeeJSON.forEach((e, i) => {
    const bits = posSet.map((pid) => {
      const cfg = (e.serviceCfgs || []).find((c) => c.posID === pid);
      return cfg ? `offered=${cfg.offered}/online=${cfg.offeredOnline}` : 'no-cfg';
    });
    console.log(`   ${shortName(i)}: ${bits.join(' | ')}`);
  });

  // The requested day.
  const day = resolveDay(args.date, tz, salonNow.valueOf());
  if (!day) { console.log(`\n❌ Could not parse --date "${args.date}" (use YYYY-MM-DD or today/tomorrow).`); return; }
  const y = day.year(), m0 = day.month(), d = day.date();
  const dow = new Date(day.format()).getDay();
  const isPast = day.clone().endOf('day').valueOf() < salonNow.valueOf();
  const stylistRec = resolveStylist(args.stylist);
  const empIndex = stylistRec ? stylistRec.index : null;
  const want = parseWindow(args.want);

  console.log(`\n================ ${day.format('dddd, MMMM D, YYYY')} ${isPast ? '(past — frozen calendar)' : ''} ================`);

  // Shifts + booked blocks for eligible stylists.
  const relMin = (v) => ((v - 1440 * dow) / 5) * 5;
  console.log('Shifts:');
  eligible.forEach((x) => {
    const sh = x.emp.shift[dow];
    console.log(`   ${shortName(x.i)}: ${sh.workOn ? `${hhmm(relMin(sh.workStart))}-${hhmm(relMin(sh.workEnd))}` : 'OFF'}` +
      (sh.workOn && sh.breakOn ? ` (break ${hhmm(relMin(sh.breakStart))}-${hhmm(relMin(sh.breakEnd))})` : ''));
  });

  const startMs = day.clone().startOf('day').valueOf();
  const appts = await getBookedAppointments(startMs, 1, { force: true });
  const posIDs = new Set(eligible.map((x) => x.posID));
  const posToShort = Object.fromEntries(eligible.map((x) => [x.posID, shortName(x.i)]));
  const blocks = bookedBlocks(appts, y, m0, d, posIDs);
  console.log(`\nBooked blocks touching eligible stylists (${appts.length} appts on calendar this day):`);
  if (!blocks.length) console.log('   (none)');
  blocks.forEach((b) => console.log(`   ${posToShort[b.who] || b.who}: ${hhmm(b.start)}-${hhmm(b.end)}  ${b.name}`));

  // Compute open slots — simulate the clock at --at if given (crucial for past-call reconstruction).
  let atNote = 'salon now';
  if (args.at) {
    const at = moment.tz(`${day.format('YYYY-MM-DD')} ${args.at}`, 'YYYY-MM-DD HH:mm', tz);
    if (at.isValid()) { moment.now = () => at.valueOf(); atNote = `clock simulated @ ${at.format('h:mm A')}`; }
  }
  const raw = core.computeAvailability({ apptJSON: appts, year: y, month0: m0, day: d, employeeIndex: empIndex, selectedServiceIndexes: svcIdxs });
  moment.now = realNow;

  console.log(`\nOpen ${svcLabel} slots on ${day.format('MMM D')} (${atNote}):`);
  if (!raw.length) console.log('   NONE — no eligible stylist has an opening.');
  raw.forEach((r) => console.log(`   ${shortName(r.employeeIndex)} (${r.durationMin}m): ${r.slots.map((s) => s.label).join(', ')}`));

  // Verdict for the requested window.
  if (want) {
    const inWin = raw.some((r) => r.slots.some((s) => s.minutesIntoDay >= want.start && (want.end == null || s.minutesIntoDay <= want.end)));
    console.log(`\nRequested window ${label12(want.start)}${want.end != null ? '-' + label12(want.end) : ''}: ${inWin ? '✅ HAD an opening' : '❌ NO opening'}`);
  }
  const anyThatDay = raw.length > 0;
  console.log(`\nVERDICT for ${day.format('MMM D')}: ${anyThatDay ? '✅ openings existed' : '❌ genuinely no openings'} for ${svcLabel}${stylistRec ? ' with ' + stylistRec.full : ''}.`);

  // The forward fallback the agent should have offered.
  if (args.days > 0) {
    console.log(`\nEarliest openings over the next ${args.days} day(s) (the fallback to offer):`);
    for (let k = 1; k <= args.days; k++) {
      const nd = day.clone().add(k, 'days');
      const nAppts = await getBookedAppointments(nd.clone().startOf('day').valueOf(), 1, { force: true });
      const nRaw = core.computeAvailability({ apptJSON: nAppts, year: nd.year(), month0: nd.month(), day: nd.date(), employeeIndex: empIndex, selectedServiceIndexes: svcIdxs });
      const first = nRaw.map((r) => ({ who: shortName(r.employeeIndex), t: r.slots[0] })).filter((x) => x.t).sort((a, b) => a.t.minutesIntoDay - b.t.minutesIntoDay)[0];
      console.log(`   ${nd.format('ddd MMM D')}: ${first ? `${first.who} at ${first.t.label}` : 'no openings'}`);
    }
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
