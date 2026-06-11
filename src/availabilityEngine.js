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
const { resolveServices } = require('./services');
const { resolveStylist, displayName, shortName } = require('./stylists');
const { getHolds } = require('./pendingHolds');

async function loadAndConfigure() {
  const data = await getSalonData();
  core.configure(data); // idempotent; refreshes if salonClient returned newer data
  return data;
}

// Build a {afterMin, beforeMin} time-of-day window from pre-parsed numeric minutes-into-day
// (the tool layer parses caller phrases like "after 2 PM" into numbers). Returns null if neither
// bound is set. Enforcing the window here — not in the model — is the whole point: the assistant
// cannot be trusted to filter times itself (it once offered 9 AM for an "after 2 PM" request).
function windowFromArgs(args) {
  const afterMin = Number.isFinite(args.afterMin) ? args.afterMin : null;
  const beforeMin = Number.isFinite(args.beforeMin) ? args.beforeMin : null;
  return afterMin != null || beforeMin != null ? { afterMin, beforeMin } : null;
}

// Build a {include, exclude} day-of-week filter from numeric weekday arrays (0=Sun..6=Sat),
// pre-parsed by the tool layer ("besides Thursdays", "weekends only"). Enforced in findEarliest's
// forward scan: a day whose weekday fails the filter is skipped, same as an out-of-window day.
function dayFilterFromArgs(args) {
  const clean = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []);
  const include = clean(args.includeDays);
  const exclude = clean(args.excludeDays);
  if (!include.length && !exclude.length) return null;
  return { include: include.length ? include : null, exclude: exclude.length ? exclude : null };
}

// Join service names for a spoken combined label: "A", "A and B", "A, B, and C".
function combineNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// Resolve the primary service plus any additional services (a combo appointment) into one
// descriptor the core treats as a single appointment (summed duration; only stylists who offer
// ALL of them qualify). Returns { ok:false, error, message, candidates } or { ok:true, indexes, info }.
function resolveServiceSelection(args, serviceJSON) {
  const wanted = [args.service, ...(Array.isArray(args.additionalServices) ? args.additionalServices : [])].filter(
    (x) => x && String(x).trim()
  );
  if (!wanted.length) {
    return { ok: false, error: 'unknown_service', message: 'Which service are you looking for?', candidates: [] };
  }
  const { matches, unresolved } = resolveServices(wanted, serviceJSON);
  if (unresolved.length || !matches.length) {
    const u = unresolved[0] || { input: wanted[0], candidates: [] };
    return {
      ok: false,
      error: 'unknown_service',
      message: `I'm not sure which service you mean by "${u.input}".`,
      candidates: u.candidates || [],
    };
  }
  const names = matches.map((m) => m.name);
  return {
    ok: true,
    indexes: matches.map((m) => m.index),
    info: {
      name: combineNames(names),
      index: matches[0].index, // back-compat: callers that read a single .index
      indexes: matches.map((m) => m.index),
      names,
      items: matches,
      varies: matches.some((m) => m.varies),
      priceCents: matches.reduce((sum, m) => sum + (m.priceCents || 0), 0),
    },
  };
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

  const sel = resolveServiceSelection(args, data.serviceJSON);
  if (!sel.ok) {
    return { ok: false, error: sel.error, message: sel.message, candidates: sel.candidates };
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
    selectedServiceIndexes: sel.indexes,
  });

  const cap = Number(args.maxPerStylist) > 0 ? Number(args.maxPerStylist) : 8;
  const holds = await getHolds(d.iso);
  const window = windowFromArgs(args);
  const { stylists, earliest } = shapeStylists(raw, cap, holds, window);

  return {
    ok: true,
    date: d.iso,
    weekday: d.weekday,
    timezone: tz,
    service: sel.info,
    requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
    anyStylist: employeeIndex == null,
    window,
    available: stylists.length > 0,
    earliest,
    stylists,
  };
}

// Shape raw per-employee results into the sorted stylist list + the earliest slot.
// `holds` (pending bookings not yet in the salon calendar) are subtracted so the next caller
// can't see a slot the AI just booked. A candidate slot is dropped if the service's footprint
// [start, start+duration) overlaps any hold for that stylist.
function shapeStylists(raw, cap = 8, holds = [], window = null) {
  const afterMin = window && Number.isFinite(window.afterMin) ? window.afterMin : null;
  const beforeMin = window && Number.isFinite(window.beforeMin) ? window.beforeMin : null;
  const stylists = raw
    .map((r) => {
      let open = r.slots;
      // Time-of-day window (e.g. caller asked for "after 2 PM"). Drop slots whose start time
      // falls outside [afterMin, beforeMin]. Applied before holds; both are just filters.
      if (afterMin != null || beforeMin != null) {
        open = open.filter((slot) => {
          const t = slot.minutesIntoDay;
          if (afterMin != null && t < afterMin) return false;
          if (beforeMin != null && t > beforeMin) return false;
          return true;
        });
      }
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

  const sel = resolveServiceSelection(args, data.serviceJSON);
  if (!sel.ok) {
    return { ok: false, error: sel.error, message: sel.message, candidates: sel.candidates };
  }

  const stylistRec = resolveStylist(args.stylist);
  const employeeIndex = stylistRec ? stylistRec.index : null;
  const window = windowFromArgs(args);
  const dayFilter = dayFilterFromArgs(args);

  const today = todayParts(tz);
  let startMs = today.startMs;
  if (args.fromDate) {
    const fd = resolveDate(args.fromDate, tz);
    if (fd && fd.startMs > startMs) startMs = fd.startMs;
  }

  // Window of days to scan, clamped to the salon's booking window (monthsx). A time-of-day
  // constraint can push the first match well past the default 14 days (afternoons fill up), so
  // scan further by default when one is set — it's all in-memory off a single fetch.
  let daysToSearch = Number(args.daysToSearch) > 0 ? Number(args.daysToSearch) : window || dayFilter ? 30 : 14;
  daysToSearch = Math.min(daysToSearch, 45);
  const maxDays = Math.floor((maxBookingMs(data.monthsx, tz) - startMs) / 86400000) + 1;
  daysToSearch = Math.max(1, Math.min(daysToSearch, maxDays));

  // ONE network read for the whole window; FillTimeArray filters to each day internally.
  const appts = await getBookedAppointments(startMs, daysToSearch);
  const cap = Number(args.maxPerStylist) > 0 ? Number(args.maxPerStylist) : 6;

  for (let i = 0; i < daysToSearch; i += 1) {
    const m = moment.tz(startMs, tz).add(i, 'days');
    if (dayFilter) {
      const wd = m.day(); // 0=Sun..6=Sat
      if (dayFilter.include && !dayFilter.include.includes(wd)) continue;
      if (dayFilter.exclude && dayFilter.exclude.includes(wd)) continue;
    }
    const raw = core.computeAvailability({
      apptJSON: appts,
      year: m.year(),
      month0: m.month(),
      day: m.date(),
      employeeIndex,
      selectedServiceIndexes: sel.indexes,
    });
    const holds = await getHolds(m.format('YYYY-MM-DD'));
    const { stylists, earliest } = shapeStylists(raw, cap, holds, window);
    // A day with no in-window openings yields zero stylists, so the scan simply rolls to the
    // next day — that's the automatic "search forward to the first matching slot" behavior.
    if (stylists.length) {
      return {
        ok: true,
        found: true,
        daysAhead: i,
        date: m.format('YYYY-MM-DD'),
        weekday: m.format('dddd'),
        timezone: tz,
        service: sel.info,
        requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
        anyStylist: employeeIndex == null,
        window,
        dayFilter,
        earliest,
        stylists,
      };
    }
  }

  return {
    ok: true,
    found: false,
    daysSearched: daysToSearch,
    service: sel.info,
    requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
    window,
    dayFilter,
    message: `I don't see any ${sel.info.name} openings in the next ${daysToSearch} days${
      stylistRec ? ` with ${stylistRec.full}` : ''
    }.`,
  };
}

/**
 * Collect the next `count` days (from `fromDate`, default today) that have at least one opening
 * for the service under the given time/day constraints. Used to offer alternatives when a caller's
 * requested day is full ("Friday's out, but Saturday and Sunday have openings"). One fetch, scanned
 * in memory — same machinery as findEarliest, just gathering several days instead of the first.
 */
async function findNextDays(args, count = 2) {
  const data = await loadAndConfigure();
  const tz = data.jsonMerchant.timezone;

  const sel = resolveServiceSelection(args, data.serviceJSON);
  if (!sel.ok) return { ok: false, error: sel.error, message: sel.message, candidates: sel.candidates };

  const stylistRec = resolveStylist(args.stylist);
  const employeeIndex = stylistRec ? stylistRec.index : null;
  const window = windowFromArgs(args);
  const dayFilter = dayFilterFromArgs(args);

  const today = todayParts(tz);
  let startMs = today.startMs;
  if (args.fromDate) {
    const fd = resolveDate(args.fromDate, tz);
    if (fd && fd.startMs > startMs) startMs = fd.startMs;
  }

  let daysToSearch = Number(args.daysToSearch) > 0 ? Number(args.daysToSearch) : 30;
  daysToSearch = Math.min(daysToSearch, 45);
  const maxDays = Math.floor((maxBookingMs(data.monthsx, tz) - startMs) / 86400000) + 1;
  daysToSearch = Math.max(1, Math.min(daysToSearch, maxDays));

  const appts = await getBookedAppointments(startMs, daysToSearch);
  const cap = Number(args.maxPerStylist) > 0 ? Number(args.maxPerStylist) : 6;

  const days = [];
  for (let i = 0; i < daysToSearch && days.length < count; i += 1) {
    const m = moment.tz(startMs, tz).add(i, 'days');
    if (dayFilter) {
      const wd = m.day();
      if (dayFilter.include && !dayFilter.include.includes(wd)) continue;
      if (dayFilter.exclude && dayFilter.exclude.includes(wd)) continue;
    }
    const raw = core.computeAvailability({
      apptJSON: appts,
      year: m.year(),
      month0: m.month(),
      day: m.date(),
      employeeIndex,
      selectedServiceIndexes: sel.indexes,
    });
    const holds = await getHolds(m.format('YYYY-MM-DD'));
    const { stylists, earliest } = shapeStylists(raw, cap, holds, window);
    if (stylists.length) {
      days.push({ date: m.format('YYYY-MM-DD'), weekday: m.format('dddd'), earliest, stylists });
    }
  }

  return {
    ok: true,
    service: sel.info,
    requestedStylist: stylistRec ? displayName(stylistRec.index) : null,
    window,
    dayFilter,
    days,
  };
}

module.exports = { getAvailability, findEarliest, findNextDays, loadAndConfigure, shapeStylists };
