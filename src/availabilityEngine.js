'use strict';

/**
 * availabilityEngine — the high-level read API used by the Vapi tools.
 *
 * Ties together: salonClient (live config + booked appts) -> availability-core (the salon's
 * own lifted slot math) -> resolvers (date/service/stylist). Returns a structured result the
 * tool layer turns into a spoken reply.
 */

const moment = require('moment-timezone');
const { getSalonData, getBookedAppointments } = require('./salonClient');
const core = require('../vendor/availability-core');
const { resolveDate, todayParts, maxBookingMs } = require('./datetime');
const { resolveService } = require('./services');
const { resolveStylist, displayName, shortName } = require('./stylists');
const { getHolds } = require('./pendingHolds');

async function loadAndConfigure() {
  const data = await getSalonData();
  core.configure(data); // idempotent; refreshes if salonClient returned newer data
  return data;
}

/**
 * @param {object} args
 * @param {string} args.date     "YYYY-MM-DD" or natural language ("tomorrow")
 * @param {string} args.service  spoken service name
 * @param {string} [args.stylist] spoken stylist name, or empty/"any" for any stylist
 * @param {number} [args.maxPerStylist] cap slots returned per stylist (default 8)
 */
async function getAvailability(args) {
  const data = await loadAndConfigure();
  const tz = data.jsonMerchant.timezone;

  const d = resolveDate(args.date, tz);
  if (!d) {
    return { ok: false, error: 'bad_date', message: `I couldn't understand the date "${args.date}".` };
  }

  const today = todayParts(tz);
  if (d.startMs < today.startMs) {
    return { ok: false, error: 'past_date', message: `${d.iso} is in the past.` };
  }
  if (d.startMs > maxBookingMs(data.monthsx, tz)) {
    return {
      ok: false,
      error: 'out_of_window',
      message: `We only book about ${data.monthsx} months ahead, so I can't check ${d.iso} yet.`,
    };
  }

  const svc = resolveService(args.service, data.serviceJSON);
  if (!svc.match) {
    return {
      ok: false,
      error: 'unknown_service',
      message: `I'm not sure which service you mean by "${args.service}".`,
      candidates: svc.candidates,
    };
  }

  const stylistRec = resolveStylist(args.stylist);
  const employeeIndex = stylistRec ? stylistRec.index : null;

  // Single live read of booked appointments for that day, then the salon's own slot math.
  const appts = await getBookedAppointments(d.startMs, 1);
  const raw = core.computeAvailability({
    apptJSON: appts,
    year: d.year,
    month0: d.month0,
    day: d.day,
    employeeIndex,
    selectedServiceIndexes: [svc.match.index],
  });

  const cap = Number(args.maxPerStylist) > 0 ? Number(args.maxPerStylist) : 8;
  const holds = await getHolds(d.iso);
  const { stylists, earliest } = shapeStylists(raw, cap, holds);

  return {
    ok: true,
    date: d.iso,
    weekday: d.weekday,
    timezone: tz,
    service: { name: svc.match.name, index: svc.match.index, varies: svc.match.varies },
    requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
    anyStylist: employeeIndex == null,
    available: stylists.length > 0,
    earliest,
    stylists,
  };
}

// Shape raw per-employee results into the sorted stylist list + the earliest slot.
// `holds` (pending bookings not yet in the salon calendar) are subtracted so the next caller
// can't see a slot the AI just booked. A candidate slot is dropped if the service's footprint
// [start, start+duration) overlaps any hold for that stylist.
function shapeStylists(raw, cap = 8, holds = []) {
  const stylists = raw
    .map((r) => {
      let open = r.slots;
      const myHolds = (holds || []).filter((h) => h.stylistIndex === r.employeeIndex);
      if (myHolds.length) {
        const dur = r.durationMin || 0;
        open = open.filter((slot) => {
          const start = slot.minutesIntoDay;
          const end = start + dur;
          return !myHolds.some((h) => start < h.startMinutes + h.durationMinutes && h.startMinutes < end);
        });
      }
      return {
        stylist: displayName(r.employeeIndex),
        stylistShort: shortName(r.employeeIndex),
        stylistIndex: r.employeeIndex,
        durationMinutes: r.durationMin,
        slots: open.slice(0, cap).map((s) => ({
          time: s.label,
          minutesIntoDay: s.minutesIntoDay,
          iso: s.iso,
        })),
        totalOpenSlots: open.length,
        firstSlotMinutes: open.length ? open[0].minutesIntoDay : null,
      };
    })
    .filter((s) => s.slots.length > 0)
    .sort((a, b) => (a.firstSlotMinutes ?? 1e9) - (b.firstSlotMinutes ?? 1e9));

  let earliest = null;
  if (stylists.length) {
    const top = stylists[0];
    earliest = {
      stylist: top.stylist,
      stylistShort: top.stylistShort,
      stylistIndex: top.stylistIndex,
      time: top.slots[0].time,
      iso: top.slots[0].iso,
    };
  }
  return { stylists, earliest };
}

/**
 * Find the SOONEST day with an opening for a service (optionally a specific stylist), scanning
 * forward from `fromDate` (default today). Fetches the whole window in ONE getappt.php call and
 * computes each day in memory — far better than the assistant looping check_availability per day.
 *
 * @param {object}  args
 * @param {string}  args.service
 * @param {string} [args.stylist]
 * @param {string} [args.fromDate]      YYYY-MM-DD or natural language (default: today)
 * @param {number} [args.daysToSearch]  default 14 (clamped to the booking window)
 */
async function findEarliest(args) {
  const data = await loadAndConfigure();
  const tz = data.jsonMerchant.timezone;

  const svc = resolveService(args.service, data.serviceJSON);
  if (!svc.match) {
    return {
      ok: false,
      error: 'unknown_service',
      message: `I'm not sure which service you mean by "${args.service}".`,
      candidates: svc.candidates,
    };
  }

  const stylistRec = resolveStylist(args.stylist);
  const employeeIndex = stylistRec ? stylistRec.index : null;

  const today = todayParts(tz);
  let startMs = today.startMs;
  if (args.fromDate) {
    const fd = resolveDate(args.fromDate, tz);
    if (fd && fd.startMs > startMs) startMs = fd.startMs;
  }

  // Window to scan, clamped to the salon's booking window (monthsx).
  let daysToSearch = Number(args.daysToSearch) > 0 ? Number(args.daysToSearch) : 14;
  daysToSearch = Math.min(daysToSearch, 45);
  const maxDays = Math.floor((maxBookingMs(data.monthsx, tz) - startMs) / 86400000) + 1;
  daysToSearch = Math.max(1, Math.min(daysToSearch, maxDays));

  // ONE network read for the whole window; FillTimeArray filters to each day internally.
  const appts = await getBookedAppointments(startMs, daysToSearch);
  const cap = Number(args.maxPerStylist) > 0 ? Number(args.maxPerStylist) : 6;

  for (let i = 0; i < daysToSearch; i += 1) {
    const m = moment.tz(startMs, tz).add(i, 'days');
    const raw = core.computeAvailability({
      apptJSON: appts,
      year: m.year(),
      month0: m.month(),
      day: m.date(),
      employeeIndex,
      selectedServiceIndexes: [svc.match.index],
    });
    const holds = await getHolds(m.format('YYYY-MM-DD'));
    const { stylists, earliest } = shapeStylists(raw, cap, holds);
    if (stylists.length) {
      return {
        ok: true,
        found: true,
        daysAhead: i,
        date: m.format('YYYY-MM-DD'),
        weekday: m.format('dddd'),
        timezone: tz,
        service: { name: svc.match.name, index: svc.match.index, varies: svc.match.varies },
        requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
        anyStylist: employeeIndex == null,
        earliest,
        stylists,
      };
    }
  }

  return {
    ok: true,
    found: false,
    daysSearched: daysToSearch,
    service: { name: svc.match.name, index: svc.match.index },
    requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
    message: `I don't see any ${svc.match.name} openings in the next ${daysToSearch} days${
      stylistRec ? ` with ${stylistRec.full}` : ''
    }.`,
  };
}

module.exports = { getAvailability, findEarliest, loadAndConfigure, shapeStylists };
