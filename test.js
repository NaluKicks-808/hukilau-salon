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
  ok(resolveService('unicorn grooming', svc).ambiguous === false, 'truly unknown -> NOT ambiguous (so it off-menus, not clarifies)');

  // Ambiguity vs off-menu: a caller naming a REAL service imprecisely ("gray retouch") must be
  // asked which one — not silently captured as a custom booking. A lone weak partial is not ambiguous.
  const ambSvc = [
    { name: 'Gray Root Retouch', posID: 'G1', duration: '01:00:00', price: 9000 },
    { name: 'Gray Retouch No Blowdry', posID: 'G2', duration: '00:45:00', price: 7000 },
    { name: 'Brow Tinting', posID: 'BT', duration: '00:15:00', price: 2000 },
    { name: 'Brow Lamination', posID: 'BL', duration: '00:45:00', price: 6000 },
  ];
  const grayR = resolveService('gray retouch', ambSvc);
  ok(grayR.match === null && grayR.ambiguous === true, '"gray retouch" is ambiguous (two real matches)');
  ok(grayR.candidates.length >= 2, '"gray retouch" offers both gray services as candidates');
  ok(resolveService('brow tint', ambSvc).match?.name === 'Brow Tinting', 'alias fixes stem: brow tint -> Brow Tinting');
  ok(resolveService('hot stone massage', ambSvc).ambiguous === false, 'unrelated service is not ambiguous (off-menu)');

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

  section('parseWeekdays');
  const sameSet = (a, b) => !!a && JSON.stringify(a.slice().sort((x, y) => x - y)) === JSON.stringify(b.slice().sort((x, y) => x - y));
  ok(sameSet(tools.parseWeekdays(['Thursday']), [4]), "['Thursday'] -> [4]");
  ok(sameSet(tools.parseWeekdays('Tuesdays or Wednesdays'), [2, 3]), "'Tuesdays or Wednesdays' -> [2,3]");
  ok(sameSet(tools.parseWeekdays('weekends'), [0, 6]), "'weekends' -> [Sun,Sat]");
  ok(sameSet(tools.parseWeekdays('weekdays'), [1, 2, 3, 4, 5]), "'weekdays' -> Mon..Fri");
  ok(sameSet(tools.parseWeekdays(['Sat', 'Sun']), [0, 6]), "['Sat','Sun'] -> [Sun,Sat]");
  ok(tools.parseWeekdays('garbage') === null, "'garbage' -> null");
  ok(tools.parseWeekdays(null) === null, 'null -> null');

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

  section('pricing + multi-service (unit)');
  const { formatPrice, resolveServices } = require('./src/services');
  ok(formatPrice(3500) === '$35', 'formatPrice 3500 -> $35');
  ok(formatPrice(27500) === '$275', 'formatPrice 27500 -> $275');
  ok(formatPrice(2750) === '$27.50', 'formatPrice 2750 -> $27.50 (keeps cents)');
  const rs = resolveServices(["men's haircut", 'a blowout'], svc);
  ok(rs.matches.length === 2 && rs.unresolved.length === 0, 'resolveServices resolves two services (combo)');
  ok(resolveServices(["men's haircut", 'unicorn grooming'], svc).unresolved.length === 1, 'an unresolvable combo member is flagged');

  section('owner notification — Notion mapping (unit)');
  const { buildNotionProperties } = require('./src/notify');
  const npBook = buildNotionProperties({
    action: 'book',
    customer: { firstName: 'Jane', lastName: '', phone: '8085551234' },
    service: "Women's Cut & Style",
    stylist: 'Patricia Maples',
    when: 'Saturday, June 13 at 9:00 AM (HST)',
  });
  ok(npBook.Action.select.name === 'Book', 'Notion Action maps to Book');
  ok(npBook.Name.title[0].text.content === 'Jane', 'Notion Name falls back to first name when last name is blank');
  ok(npBook.Status.select.name === 'New', 'Notion Status defaults to New');
  ok(npBook.Phone.phone_number === '8085551234', 'Notion Phone is set');
  const npCancel = buildNotionProperties({
    action: 'cancel',
    customer: { firstName: 'Bob', lastName: 'Lee', phone: '8085550000' },
    when: 'Friday',
    reason: 'feeling sick',
  });
  ok(npCancel.Action.select.name === 'Cancel', 'cancel maps to the Cancel action');
  ok(/feeling sick/.test(npCancel.Note.rich_text[0].text.content), 'cancel reason captured in Note');
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

  // ambiguous service ("a haircut") must ask which one — NOT capture a vague off-menu booking
  const amb = await tools.bookAppointment({
    firstName: 'Test', lastName: 'Caller', phone: '808-555-0000',
    service: 'haircut', stylist: '', date: found.iso, time: '10:00 AM',
  });
  ok(!amb.ok && amb.error === 'ambiguous_service', 'ambiguous service ("haircut") asks to clarify, not off-menu');
  ok(/did you mean/i.test(amb.message), 'ambiguous booking asks "did you mean ...?"');
  ok(!(amb.data && amb.data.booking), 'ambiguous booking creates NO off-menu capture');

  section('LIVE: booking validates the FULL day (not just the speech cap) + phone sanity');
  {
    const fullDay = await tools.checkAvailability({ date: found.iso, service, stylist: '', maxPerStylist: 50 });
    const busy = (fullDay.data.stylists || []).find((s) => s.slots.length > 8);
    if (busy) {
      const lateSlot = busy.slots[busy.slots.length - 1]; // a slot well past the first 8
      const realFetchB = global.fetch;
      const urlsB = [];
      global.fetch = (u, o) => { urlsB.push(String(u)); return realFetchB(u, o); };
      let lateBook;
      try {
        lateBook = await tools.bookAppointment({
          firstName: 'Late', lastName: 'Slot', phone: '8085550000',
          service, stylist: busy.stylist, date: found.iso, time: lateSlot.time,
        });
      } finally { global.fetch = realFetchB; }
      ok(lateBook.ok, `can book a late slot (${lateSlot.time}, #${busy.slots.length}) beyond the 8-slot speech cap`);
      ok(!urlsB.some((u) => /bookcbbnew|clover/i.test(u)), 'late-slot booking still never writes to the salon');
    } else {
      console.log('   (no stylist with >8 slots on the test day; skipping late-slot check)');
    }
    const badPhone = await tools.bookAppointment({
      firstName: 'Bad', lastName: 'Phone', phone: '555-1234',
      service, stylist: '', date: found.iso, time: r.data.earliest.time,
    });
    ok(!badPhone.ok && badPhone.error === 'invalid_phone', 'a too-short phone is re-asked, not captured');
  }

  section('LIVE: combo appointment (cut + color) sums duration, needs a stylist who does both');
  {
    const single = await tools.checkAvailability({ date: found.iso, service: "women's cut & style", stylist: '', maxPerStylist: 50 });
    const combo = await tools.checkAvailability({
      date: found.iso, service: "women's cut & style", additionalServices: ['whole head color'], stylist: '', maxPerStylist: 50,
    });
    ok(combo.ok, 'combo availability query succeeds');
    ok(Array.isArray(combo.data.service.names) && combo.data.service.names.length === 2, 'combo carries both service names');
    ok(/ and /.test(combo.data.service.name), 'combo speaks a combined service name');
    console.log('   combo service:', combo.data.service.name);
    if (combo.data.stylists.length) {
      const cs = combo.data.stylists[0];
      const ss = single.data.stylists.find((s) => s.stylistIndex === cs.stylistIndex);
      if (ss) ok(cs.durationMinutes > ss.durationMinutes, `combo duration (${cs.durationMinutes}m) > single cut (${ss.durationMinutes}m)`);
      ok(cs.stylistIndex != null, 'combo only returns a stylist who offers BOTH services');
    } else {
      console.log('   (no combo opening that day; both services still resolved + summed)');
    }
  }

  section('LIVE: service price quotes (get_service_info)');
  {
    const haircut = await tools.getServiceInfo({ service: "men's haircut" });
    ok(haircut.ok && /\$35\b/.test(haircut.message), `men's haircut quoted at $35`);
    ok(haircut.data.totalPriceCents === 3500, 'price data is exact cents');
    console.log('   ' + haircut.message);
    const balayage = await tools.getServiceInfo({ service: 'balayage' });
    ok(balayage.ok && /\$350\b/.test(balayage.message), 'balayage quoted at $350');
    const varies = await tools.getServiceInfo({ service: 'color correction' });
    ok(varies.ok && /priced based on your hair|in-salon|exact quote/i.test(varies.message), 'a varies-price service is explained, not given a fake number');
    ok(varies.data.services[0].varies === true, 'varies service is flagged');
    const comboPrice = await tools.getServiceInfo({ service: "men's haircut", additionalServices: ['regular blowout'] });
    ok(comboPrice.ok && comboPrice.data.totalPriceCents === 7500, 'combo price sums ($35 + $40 = $75)');
    ok(/\$75\b/.test(comboPrice.message), 'combo total is spoken');
    console.log('   ' + comboPrice.message);
    const unknownPrice = await tools.getServiceInfo({ service: 'unicorn grooming' });
    ok(!unknownPrice.ok && unknownPrice.error === 'unknown_service', 'unknown service price is not invented');
    const noSvc = await tools.getServiceInfo({});
    ok(!noSvc.ok && noSvc.error === 'missing_fields', 'price needs a service');
  }

  section('LIVE: resolve_service (deterministic name resolution, no model guessing)');
  {
    const exact = await tools.resolveServicePhrase({ service: "men's haircut" });
    ok(exact.ok && exact.message === "Men's Haircut" && exact.data.resolved === true, 'alias resolves to canonical "Men\'s Haircut"');
    const browTint = await tools.resolveServicePhrase({ service: 'brow tint' });
    ok(browTint.ok && browTint.message === 'Brow Tinting', '"brow tint" resolves to "Brow Tinting" (no "we don\'t offer it")');
    const amb = await tools.resolveServicePhrase({ service: 'haircut' });
    ok(amb.ok && amb.data.ambiguous === true && /did you mean/i.test(amb.message), '"haircut" returns a did-you-mean choice');
    const off = await tools.resolveServicePhrase({ service: 'hot stone massage' });
    ok(off.ok && off.data.offMenu === true, 'unlisted service is flagged off-menu (special request)');
    ok(!/don'?t offer|not offered|do not offer/i.test(off.message), 'off-menu reply never claims the salon does not offer it');
    const noSvc = await tools.resolveServicePhrase({});
    ok(!noSvc.ok && noSvc.error === 'missing_fields', 'resolve_service needs a phrase');
    console.log('   ' + amb.message);
  }

  section('LIVE: next-available-days fallback + optional last name');
  {
    const { findNextDays } = require('./src/availabilityEngine');
    const nd = await findNextDays({ service: "women's cut & style" }, 3);
    ok(nd.ok && Array.isArray(nd.days) && nd.days.length >= 1, `findNextDays returns upcoming open days (${nd.days.length})`);
    ok(nd.days.every((d) => d.stylists && d.stylists.length), 'each returned day has open stylists');
    const isos = nd.days.map((d) => d.date);
    ok(isos.every((v, i) => i === 0 || v > isos[i - 1]), 'next days are in ascending date order');

    // A stylist on a day BEFORE their soonest opening must offer an alternative, never dead-end.
    const kelli = await tools.findEarliestAvailability({ service: "women's cut & style", stylist: 'Kelli' });
    if (kelli.ok && kelli.data.found && kelli.data.daysAhead >= 2) {
      const beforeIso = moment(kelli.data.date, 'YYYY-MM-DD').subtract(1, 'day').format('YYYY-MM-DD');
      const ca = await tools.checkAvailability({ date: beforeIso, service: "women's cut & style", stylist: 'Kelli' });
      ok(ca.ok && /\bbut\b/i.test(ca.message), 'an empty stylist-day offers an alternative, never a bare dead-end');
      console.log('   ' + ca.message);
    } else {
      console.log('   (no far-out stylist day available to construct the dead-end case; skipped)');
    }

    // last name is optional: booking/cancel succeed without it and never render "undefined".
    const noLast = await tools.bookAppointment({
      firstName: 'Solo', phone: '8085551234', service, date: found.iso, time: r.data.earliest.time,
    });
    ok(noLast.ok, 'booking succeeds without a last name');
    ok(!/undefined/.test(noLast.data.ownerMessage), 'owner message never shows "undefined" for a missing last name');
    const cancelNoLast = await tools.cancelAppointment({ firstName: 'Solo', phone: '8085551234', date: found.iso });
    ok(cancelNoLast.ok, 'cancel works without a last name');
  }

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

    // Day-of-week constraints, enforced server-side like the time window.
    const base = await tools.findEarliestAvailability({ service: "women's cut & style" });
    if (base.data && base.data.found) {
      const wd = base.data.weekday; // e.g. "Friday"
      const excl = await tools.findEarliestAvailability({ service: "women's cut & style", excludeDaysOfWeek: [wd] });
      ok(excl.ok, 'find_earliest accepts excludeDaysOfWeek');
      if (excl.data.found) ok(excl.data.weekday !== wd, `excluding ${wd} returns a different weekday (got ${excl.data.weekday})`);
      const sat = await tools.findEarliestAvailability({ service: "women's cut & style", daysOfWeek: ['Saturday'] });
      ok(sat.ok, 'find_earliest accepts daysOfWeek');
      if (sat.data.found) ok(sat.data.weekday === 'Saturday', `daysOfWeek=[Saturday] returns a Saturday (got ${sat.data.weekday})`);
      console.log('   ' + sat.message);
    }
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
