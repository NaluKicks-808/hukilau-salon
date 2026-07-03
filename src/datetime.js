'use strict';

/**
 * Date resolution in the salon's timezone (Pacific/Honolulu, UTC-10, no DST).
 *
 * Accepts either an explicit "YYYY-MM-DD" (preferred — the Vapi assistant should resolve
 * relative dates and pass this) or natural language ("tomorrow", "next Tuesday") via chrono.
 *
 * For correct natural-language parsing the process should run with TZ set to the salon tz;
 * the entry points (server.js / test.js) set process.env.TZ = Pacific/Honolulu, and bare
 * moment is pinned with moment.tz.setDefault in availability-core.configure().
 */

const chrono = require('chrono-node');
const moment = require('moment-timezone');

const DEFAULT_TZ = process.env.SALON_TZ || 'Pacific/Honolulu';

function pad(n) {
  return String(n).padStart(2, '0');
}

function partsFromMoment(m, tz) {
  return {
    year: m.year(),
    month0: m.month(), // 0-indexed (moment/Date convention)
    day: m.date(),
    startMs: m.clone().startOf('day').valueOf(),
    iso: m.format('YYYY-MM-DD'),
    weekday: m.format('dddd'),
    tz,
  };
}

/**
 * @returns {{year:number,month0:number,day:number,startMs:number,iso:string,weekday:string,tz:string}|null}
 */
function resolveDate(input, tz = DEFAULT_TZ) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = +isoMatch[1];
    const m0 = +isoMatch[2] - 1;
    const d = +isoMatch[3];
    const m = moment.tz(`${y}-${pad(m0 + 1)}-${pad(d)} 00:00`, 'YYYY-MM-DD HH:mm', tz);
    if (!m.isValid()) return null;
    return partsFromMoment(m, tz);
  }

  // Natural language. Reference = "now" in the salon tz; prefer future dates.
  const refNow = moment.tz(tz).toDate();
  const parsed = chrono.parseDate(s, refNow, { forwardDate: true });
  if (!parsed) return null;
  const m = moment.tz(parsed, tz);
  if (!m.isValid()) return null;
  // Use the salon-local calendar date of the parsed instant, at start of day.
  const dayStart = moment.tz(`${m.year()}-${pad(m.month() + 1)}-${pad(m.date())} 00:00`, 'YYYY-MM-DD HH:mm', tz);
  return partsFromMoment(dayStart, tz);
}

/** Today's parts in the salon tz. */
function todayParts(tz = DEFAULT_TZ) {
  return partsFromMoment(moment.tz(tz).startOf('day'), tz);
}

/**
 * Resolve a date for BOOKING-FORWARD paths (availability checks, new bookings), where a past
 * date is always a caller/model mistake — voice models sometimes stamp the wrong YEAR on an
 * ISO date (live incident: model sent "2024-07-06" for "Monday, July 6", got rejected as past,
 * and looped). Rolls a past date to the NEXT future occurrence of that month/day: same
 * month/day this year if still ahead, otherwise next year. Never applied to cancel/reschedule
 * lookups, where a past date can be legitimate context.
 * @returns resolveDate() parts plus {rolled:boolean, originalIso?:string}, or null.
 */
function resolveFutureDate(input, tz = DEFAULT_TZ) {
  const d = resolveDate(input, tz);
  if (!d) return null;
  const today = todayParts(tz);
  if (d.startMs >= today.startMs) return { ...d, rolled: false };
  const originalIso = d.iso;
  let m = moment.tz(`${today.year}-${pad(d.month0 + 1)}-${pad(d.day)} 00:00`, 'YYYY-MM-DD HH:mm', tz);
  if (!m.isValid() || m.valueOf() < today.startMs) {
    m = moment.tz(`${today.year + 1}-${pad(d.month0 + 1)}-${pad(d.day)} 00:00`, 'YYYY-MM-DD HH:mm', tz);
  }
  if (!m.isValid()) return null; // e.g. Feb 29 with no near leap year
  return { ...partsFromMoment(m, tz), rolled: true, originalIso };
}

/** Last bookable instant (ms) given the salon's booking-window months. */
function maxBookingMs(monthsx, tz = DEFAULT_TZ) {
  const months = Number(monthsx) || 3;
  return moment.tz(tz).startOf('day').add(months, 'months').endOf('day').valueOf();
}

module.exports = { resolveDate, resolveFutureDate, todayParts, maxBookingMs, DEFAULT_TZ };
