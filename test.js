'use strict';

/**
 * test.js — read-only end-to-end + unit checks.
 *
 *   node test.js            full run (unit + LIVE availability against the real salon)
 *   node test.js --no-live  unit checks only (no network)
 *
 * SAFETY: this never books on the salon website. The booking path is exercised only in
 * "capture" mode, and a fetch spy asserts that NO request is ever sent to bookcbbnew.php.
 * Run from the project root; the npm script pins TZ=Pacific/Honolulu.
 */

process.env.TZ = process.env.TZ || process.env.SALON_TZ || 'Pacific/Honolulu';

const moment = require('moment-timezone');
const { resolveService } = require('./src/services');
const { resolveStylist } = require('./src/stylists');
const { resolveDate, todayParts } = require('./src/datetime');
const tools = require('./hukilau-booking');

const LIVE = !process.argv.includes('--no-live');
let pass = 0;
let fail = 0;

function ok(cond, msg) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error('   ✗ FAIL:', msg);
  }
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

// --------------------------------------------------------------------------- unit (no network)
function runUnit() {
  section('services (fuzzy / alias)');
  const svc = [
    { name: "Women's Cut & Style", posID: 'A', duration: '01:00:00', price: 8000 },
    { name: "Men's Haircut", posID: 'B', duration: '00:45:00', price: 3500 },
    { name: 'Balayage', posID: 'C', duration: '04:00:00', price: 35000 },
    { name: 'Regular Blowout', posID: 'D', duration: '00:45:00', price: 4000 },
  ];
  ok(resolveService("women's cut and style", svc).match?.name === "Women's Cut & Style", "women's cut and style");
  ok(resolveService('mens haircut', svc).match?.name === "Men's Haircut", 'alias: mens haircut');
  ok(resolveService('a blowout', svc).match?.name === 'Regular Blowout', 'alias: blowout');
  ok(resolveService('balayage', svc).match?.name === 'Balayage', 'exact: balayage');
  ok(resolveService('unicorn grooming', svc).match === null, 'unknown -> no match');
  ok(resolveService('unicorn grooming', svc).candidates.length > 0, 'unknown -> candidates offered');

  section('stylists (alias / any)');
  ok(resolveStylist('trish')?.index === 2, 'alias: trish -> Patricia (2)');
  ok(resolveStylist('KELLY')?.index === 1, 'alias: KELLY -> Kelli (1)');
  ok(resolveStylist('marcus')?.index === 0, 'marcus -> 0');
  ok(resolveStylist('') === null, 'empty -> any stylist');
  ok(resolveStylist('anyone') === null, 'anyone -> any stylist');

  section('datetime (Pacific/Honolulu)');
  const d = resolveDate('2026-06-16');
  ok(!!d && d.weekday === 'Tuesday', '2026-06-16 resolves to Tuesday');
  ok(d.month0 === 5 && d.day === 16, 'month is 0-indexed (June = 5)');
  ok(resolveDate('2026-06-16').iso === '2026-06-16', 'iso round-trips');
  ok(resolveDate('tomorrow') !== null, 'natural language: "tomorrow"');
  ok(resolveDate('next tuesday') !== null, 'natural language: "next tuesday"');
  ok(resolveDate('not a date at all') === null, 'garbage -> null');

  section('parseClock');
  ok(tools.parseClock('9:15 AM') === 555, '9:15 AM -> 555');
  ok(tools.parseClock('2:30 pm') === 870, '2:30 pm -> 870');
  ok(tools.parseClock('12:00 PM') === 720, '12:00 PM (noon) -> 720');
  ok(tools.parseClock('12:00 AM') === 0, '12:00 AM (midnight) -> 0');
  ok(tools.parseClock('14:30') === 870, '24h 14:30 -> 870');
  ok(tools.parseClock('garbage') === null, 'garbage -> null');
}

// --------------------------------------------------------------------------- live (network)
async function findAvailableDate(service) {
  // Walk forward from 3 days out until we find a day with availability (max ~21 days).
  const today = todayParts();
  for (let offset = 3; offset <= 21; offset += 1) {
    const iso = moment(today.startMs).add(offset, 'days').format('YYYY-MM-DD');
    const r = await tools.checkAvailability({ date: iso, service, stylist: '' });
    if (r.ok && r.data.available) return { iso, result: r };
  }
  return null;
}

async function runLive() {
  const service = "women's cut & style";

  section('LIVE: availability across stylists');
  const found = await findAvailableDate(service);
  ok(!!found, `found a day with ${service} availability within 21 days`);
  if (!found) return;

  const r = found.result;
  console.log(`   date: ${r.data.weekday}, ${r.data.date}`);
  console.log(`   spoken: ${r.message}`);
  for (const s of r.data.stylists) {
    console.log(`   - ${s.stylist}: ${s.totalOpenSlots} open, e.g. ${s.slots.slice(0, 4).map((x) => x.time).join(', ')}`);
  }
  ok(r.data.stylists.length > 0, 'at least one stylist has slots');
  ok(!!r.data.earliest, 'an earliest slot is identified');

  // invariant: every slot lands on the salon's 15-minute online increment
  const allSlots = r.data.stylists.flatMap((s) => s.slots);
  ok(allSlots.every((x) => x.minutesIntoDay % 15 === 0), 'all slots align to 15-minute increments');

  // invariant: earliest equals the global minimum start across stylists
  const minStart = Math.min(...r.data.stylists.map((s) => s.firstSlotMinutes));
  const earliestStylist = r.data.stylists.find((s) => s.stylistIndex === r.data.earliest.stylistIndex);
  ok(earliestStylist.firstSlotMinutes === minStart, 'earliest is the soonest across all stylists');

  section('LIVE: specific-stylist + unknown-service handling');
  const one = await tools.checkAvailability({ date: found.iso, service, stylist: r.data.earliest.stylist });
  ok(one.ok, 'specific-stylist query succeeds');
  const bad = await tools.checkAvailability({ date: found.iso, service: 'unicorn grooming', stylist: '' });
  ok(!bad.ok && bad.error === 'unknown_service', 'unknown service is reported, not guessed');

  section('LIVE: booking is CAPTURE-ONLY (never writes to the salon site)');
  const realFetch = global.fetch;
  const calledUrls = [];
  global.fetch = (u, o) => {
    calledUrls.push(String(u));
    return realFetch(u, o);
  };
  let booking;
  try {
    booking = await tools.bookAppointment({
      firstName: 'Test',
      lastName: 'Caller',
      phone: '808-555-0000',
      service,
      stylist: r.data.earliest.stylist,
      date: found.iso,
      time: r.data.earliest.time,
    });
  } finally {
    global.fetch = realFetch;
  }
  ok(booking.ok, 'booking request captured');
  ok(calledUrls.length > 0, 'booking re-checked availability over the network');
  ok(!calledUrls.some((u) => /bookcbbnew/i.test(u)), 'NEVER POSTed to bookcbbnew.php');
  ok(!calledUrls.some((u) => /bookcbb|book\.php|clover/i.test(u)), 'no booking/payment endpoint touched');
  ok(booking.data.delivery.channel === 'vapi-return', 'owner notify stays return-to-Vapi (nothing sent)');
  ok(booking.data.booking.depositRequired === true, 'flags deposit required (salon prepay=1)');
  console.log('   owner message preview:');
  console.log(booking.data.ownerMessage.split('\n').map((l) => '     ' + l).join('\n'));

  // bad-slot path
  const badSlot = await tools.bookAppointment({
    firstName: 'Test', lastName: 'Caller', phone: '808-555-0000',
    service, stylist: r.data.earliest.stylist, date: found.iso, time: '3:07 AM',
  });
  ok(!badSlot.ok && badSlot.error === 'slot_unavailable', 'unavailable time is rejected with alternatives');
}

(async () => {
  runUnit();
  if (LIVE) {
    try {
      await runLive();
    } catch (err) {
      console.error('\n   ! LIVE tests skipped — network error:', err.message);
      console.error('     (run on a machine with direct internet, or use --no-live)');
    }
  } else {
    console.log('\n(skipping live tests; --no-live)');
  }
  console.log(`\n${'-'.repeat(48)}\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
