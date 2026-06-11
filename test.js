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

  section('pending-holds overlay (unit)');
  const { shapeStylists } = require('./src/availabilityEngine');
  const fakeRaw = [
    {
      employeeIndex: 2,
      durationMin: 60,
      slots: [
        { label: '9:00 AM', minutesIntoDay: 540, iso: 'a' },
        { label: '10:00 AM', minutesIntoDay: 600, iso: 'b' },
        { label: '11:00 AM', minutesIntoDay: 660, iso: 'c' },
      ],
    },
  ];
  ok(shapeStylists(fakeRaw, 8, []).stylists[0].slots.length === 3, 'no holds -> all slots remain');
  const held = shapeStylists(fakeRaw, 8, [{ stylistIndex: 2, startMinutes: 540, durationMinutes: 60 }]);
  ok(held.stylists[0].slots.every((s) => s.minutesIntoDay !== 540), 'held 9:00 slot is removed');
  ok(held.stylists[0].slots.some((s) => s.minutesIntoDay === 600), 'adjacent 10:00 slot survives (no overlap)');
  ok(
    shapeStylists(fakeRaw, 8, [{ stylistIndex: 0, startMinutes: 540, durationMinutes: 60 }]).stylists[0].slots.length === 3,
    "a hold for a different stylist doesn't affect this one"
  );

  section('time-of-day window (unit)');
  ok(
    shapeStylists(fakeRaw, 8, [], { afterMin: 600 }).stylists[0].slots.every((s) => s.minutesIntoDay >= 600),
    'afterMin 600 keeps only slots at/after 10:00'
  );
  ok(shapeStylists(fakeRaw, 8, [], { afterMin: 600 }).stylists[0].slots.length === 2, 'afterMin 600 -> 2 slots (10:00, 11:00)');
  ok(
    shapeStylists(fakeRaw, 8, [], { beforeMin: 600 }).stylists[0].slots.every((s) => s.minutesIntoDay <= 600),
    'beforeMin 600 keeps only slots at/before 10:00'
  );
  ok(shapeStylists(fakeRaw, 8, [], { afterMin: 600, beforeMin: 600 }).stylists[0].slots.length === 1, 'after & before 600 -> just 10:00');
  ok(
    shapeStylists(fakeRaw, 8, [], { afterMin: 900 }).stylists.length === 0,
    'afterMin past all slots -> stylist drops out (so a forward scan rolls to the next day)'
  );
  const winHeld = shapeStylists(fakeRaw, 8, [{ stylistIndex: 2, startMinutes: 600, durationMinutes: 60 }], { afterMin: 600 });
  ok(winHeld.stylists[0].slots.every((s) => s.minutesIntoDay !== 600), 'window + hold combine: held 10:00 is removed');
  ok(winHeld.stylists[0].slots.some((s) => s.minutesIntoDay === 660), 'window + hold combine: in-window 11:00 (not held) survives');
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

  section('LIVE: time-of-day constraint is enforced server-side (the failed-call fix)');
  {
    const cutoff = 780; // 1:00 PM
    // Compare a windowed query against the full day's slots, manually filtered. High per-stylist
    // cap on both calls so the display cap can't skew the comparison.
    const full = await tools.checkAvailability({ date: found.iso, service, stylist: '', maxPerStylist: 50 });
    const win = await tools.checkAvailability({ date: found.iso, service, stylist: '', afterTime: '1:00 PM', maxPerStylist: 50 });
    const fullAfter = full.data.stylists
      .flatMap((s) => s.slots.map((x) => x.minutesIntoDay))
      .filter((m) => m >= cutoff)
      .sort((a, b) => a - b);
    const winSlots = win.data.stylists.flatMap((s) => s.slots.map((x) => x.minutesIntoDay)).sort((a, b) => a - b);
    ok(win.ok, 'check_availability accepts an afterTime constraint');
    ok(winSlots.every((m) => m >= cutoff), 'every returned slot is at/after 1:00 PM');
    ok(!winSlots.some((m) => m < cutoff), 'NEVER offers a time before the requested cutoff (the exact bug)');
    ok(JSON.stringify(winSlots) === JSON.stringify(fullAfter), `windowed slots equal the day's afternoon slots (${winSlots.length})`);
    console.log('   ' + win.message);
  }

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
  ok(!/deposit/i.test(booking.message), 'booking confirmation does not mention a deposit');

  // off-menu / custom service is captured, not rejected
  const offMenu = await tools.bookAppointment({
    firstName: 'Test', lastName: 'Caller', phone: '808-555-0000',
    service: 'hot stone massage', stylist: '', date: found.iso, time: '10:00 AM',
  });
  ok(offMenu.ok, 'off-menu service is captured, not rejected');
  ok(offMenu.data.booking.offMenu === true, 'off-menu booking is flagged');
  ok(/OFF-MENU/i.test(offMenu.data.ownerMessage), 'owner message flags off-menu / custom');

  section('LIVE: cancel & reschedule are CAPTURE-ONLY too');
  {
    const cancelMissing = await tools.cancelAppointment({ firstName: 'Test' });
    ok(!cancelMissing.ok && cancelMissing.error === 'missing_fields', 'cancel requires name/phone/date');
    const reschedMissing = await tools.rescheduleAppointment({ firstName: 'Test' });
    ok(!reschedMissing.ok && reschedMissing.error === 'missing_fields', 'reschedule requires name/phone/new date+time');

    const realFetch2 = global.fetch;
    const urls2 = [];
    global.fetch = (u, o) => {
      urls2.push(String(u));
      return realFetch2(u, o);
    };
    let cancel;
    let resched;
    try {
      cancel = await tools.cancelAppointment({
        firstName: 'Test', lastName: 'Caller', phone: '808-555-0000', date: found.iso, time: r.data.earliest.time,
      });
      resched = await tools.rescheduleAppointment({
        firstName: 'Test', lastName: 'Caller', phone: '808-555-0000',
        currentDate: found.iso, currentTime: r.data.earliest.time,
        newDate: found.iso, newTime: r.data.earliest.time, service, stylist: r.data.earliest.stylist,
      });
    } finally {
      global.fetch = realFetch2;
    }
    ok(cancel.ok, 'cancellation captured');
    ok(/CANCELLATION/i.test(cancel.data.ownerMessage), 'owner gets a cancellation notice');
    ok(resched.ok, 'reschedule captured');
    ok(/RESCHEDULE/i.test(resched.data.ownerMessage), 'owner gets a reschedule notice');
    ok(!urls2.some((u) => /bookcbbnew|clover/i.test(u)), 'cancel/reschedule NEVER write to the salon');
    ok(
      cancel.data.delivery.channel === 'vapi-return' && resched.data.delivery.channel === 'vapi-return',
      'cancel/reschedule notify stays return-to-Vapi'
    );
  }

  section('LIVE: appointments cache (repeat lookups hit cache, not network)');
  {
    const { getBookedAppointments } = require('./src/salonClient');
    const { todayParts } = require('./src/datetime');
    const startMs = todayParts().startMs;
    const realFetch3 = global.fetch;
    let networkCalls = 0;
    global.fetch = (u, o) => {
      if (/getappt\.php/i.test(String(u))) networkCalls += 1;
      return realFetch3(u, o);
    };
    try {
      await getBookedAppointments(startMs, 1, { force: true }); // prime (1 network call)
      await getBookedAppointments(startMs, 1); // cached
      await getBookedAppointments(startMs, 1); // cached
    } finally {
      global.fetch = realFetch3;
    }
    ok(networkCalls === 1, `3 lookups for the same day => 1 network call (got ${networkCalls})`);
  }

  section('LIVE: find earliest availability (one fetch scans the whole window)');
  {
    const earliestAny = await tools.findEarliestAvailability({ service: "women's cut & style", stylist: '' });
    ok(earliestAny.ok, 'find_earliest (any stylist) returns ok');
    ok(/soonest|don't see/i.test(earliestAny.message), 'find_earliest gives a sensible answer');
    console.log('   ' + earliestAny.message);

    const earliestKelli = await tools.findEarliestAvailability({ service: "women's cut & style", stylist: 'Kelli' });
    ok(earliestKelli.ok, 'find_earliest (specific stylist) returns ok');
    console.log('   ' + earliestKelli.message);

    const earliestBad = await tools.findEarliestAvailability({ service: 'unicorn grooming' });
    ok(!earliestBad.ok && earliestBad.error === 'unknown_service', 'find_earliest rejects unknown service');

    const missingSvc = await tools.findEarliestAvailability({});
    ok(!missingSvc.ok && missingSvc.error === 'missing_fields', 'find_earliest requires a service');

    // The exact failed call: "men's haircut, soonest, after 2 PM" must never return a morning slot.
    const afterPM = await tools.findEarliestAvailability({ service: "men's haircut", afterTime: '2:00 PM' });
    ok(afterPM.ok, 'find_earliest accepts an afterTime constraint');
    ok(/after 2 PM/i.test(afterPM.message), 'spoken answer states the constraint ("after 2 PM")');
    if (afterPM.data && afterPM.data.found) {
      const slots = (afterPM.data.stylists || []).flatMap((s) => s.slots.map((x) => x.minutesIntoDay));
      ok(slots.every((m) => m >= 840), 'every returned slot is at/after 2:00 PM');
      ok(tools.parseClock(afterPM.data.earliest.time) >= 840, 'the announced earliest time is itself at/after 2:00 PM');
    }
    console.log('   ' + afterPM.message);
  }
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
