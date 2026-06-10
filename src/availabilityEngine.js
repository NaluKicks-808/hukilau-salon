'use strict';

/**
 * availabilityEngine — the high-level read API used by the Vapi tools.
 *
 * Ties together: salonClient (live config + booked appts) -> availability-core (the salon's
 * own lifted slot math) -> resolvers (date/service/stylist). Returns a structured result the
 * tool layer turns into a spoken reply.
 */

const { getSalonData, getBookedAppointments } = require('./salonClient');
const core = require('../vendor/availability-core');
const { resolveDate, todayParts, maxBookingMs } = require('./datetime');
const { resolveService } = require('./services');
const { resolveStylist, displayName, shortName } = require('./stylists');

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
  const stylists = raw
    .map((r) => ({
      stylist: displayName(r.employeeIndex),
      stylistShort: shortName(r.employeeIndex),
      stylistIndex: r.employeeIndex,
      durationMinutes: r.durationMin,
      slots: r.slots.slice(0, cap).map((s) => ({
        time: s.label,
        minutesIntoDay: s.minutesIntoDay,
        iso: s.iso,
      })),
      totalOpenSlots: r.slots.length,
      firstSlotMinutes: r.slots.length ? r.slots[0].minutesIntoDay : null,
    }))
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

module.exports = { getAvailability, loadAndConfigure };
