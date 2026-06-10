'use strict';

/**
 * hukilau-booking — the two Vapi tool functions for Hukilau Salon.
 *
 *   checkAvailability(args) -> live open slots across the 4 stylists (read-only)
 *   bookAppointment(args)   -> validates the slot then CAPTURES the request and returns it
 *                              for the owner to confirm. It does NOT write to the salon's
 *                              booking system and never touches card/deposit data.
 *
 * Both return { ok, message, data }:
 *   - `message` is a short, speakable string for the assistant to read back.
 *   - `data` is the structured detail (slots, or the captured booking) for your Vapi workflow.
 *
 * server.js adapts these to Vapi's tool webhook envelope.
 */

// Pin the process to salon-local time so chrono date parsing and native Date are HST.
process.env.TZ = process.env.TZ || process.env.SALON_TZ || 'Pacific/Honolulu';

const moment = require('moment-timezone');
const { getAvailability } = require('./src/availabilityEngine');
const { getSalonData } = require('./src/salonClient');
const { notifyOwner, formatOwnerMessage } = require('./src/notify');
const { resolveStylist } = require('./src/stylists');

// ---------- small speech/format helpers ----------

function speakList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function speakSlots(slots, n = 5) {
  return speakList(slots.slice(0, n).map((s) => s.time));
}

function prettyDate(iso) {
  // Month + day only; the weekday is prepended separately as `${r.weekday}, ${prettyDate()}`.
  return moment(iso, 'YYYY-MM-DD').format('MMMM D');
}

// "9:15 am" / "9 am" / "2:30pm" / "14:30" -> minutes since midnight, or null.
function parseClock(input) {
  if (input == null) return null;
  if (typeof input === 'number' && input >= 0 && input < 1440) return input;
  const m = String(input)
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3] ? m[3].replace(/\./g, '') : null;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// ---------- Tool 1: check_availability ----------

async function checkAvailability(args = {}) {
  const requested = resolveStylist(args.stylist);

  // One live read across ALL stylists, then highlight/partition by the requested stylist.
  const r = await getAvailability({ date: args.date, service: args.service, stylist: '' });

  if (!r.ok) {
    let message = r.message;
    if (r.error === 'unknown_service' && r.candidates && r.candidates.length) {
      message += ` Did you mean ${speakList(r.candidates.map((c) => c.name))}?`;
    }
    return { ok: false, error: r.error, message, data: r };
  }

  const when = `${r.weekday}, ${prettyDate(r.date)}`;

  if (requested) {
    const mine = r.stylists.find((s) => s.stylistIndex === requested.index);
    const others = r.stylists.filter((s) => s.stylistIndex !== requested.index);
    let message;
    if (mine) {
      message = `Yes — ${requested.full} can do a ${r.service.name} on ${when}. Open times: ${speakSlots(
        mine.slots
      )}.`;
    } else if (others.length) {
      message =
        `${requested.full} doesn't have any ${r.service.name} openings on ${when}, ` +
        `but ${others[0].stylistShort} does at ${speakSlots(others[0].slots, 3)}.`;
    } else {
      message = `I don't see any ${r.service.name} openings on ${when}.`;
    }
    return {
      ok: true,
      message,
      data: { ...r, requestedStylist: requested.full, mine: mine || null, others },
    };
  }

  // Any stylist.
  if (!r.available) {
    return { ok: true, message: `Sorry, I don't see any ${r.service.name} openings on ${when}.`, data: r };
  }
  const e = r.earliest;
  let message = `For a ${r.service.name} on ${when}, the soonest is ${e.stylistShort} at ${e.time}.`;
  const extras = r.stylists
    .filter((s) => s.stylistIndex !== e.stylistIndex)
    .slice(0, 2)
    .map((s) => `${s.stylistShort} at ${speakSlots(s.slots, 2)}`);
  if (extras.length) message += ` ${speakList(extras)} also have openings.`;
  return { ok: true, message, data: r };
}

// ---------- Tool 2: book_appointment (capture + hand off to owner) ----------

async function bookAppointment(args = {}) {
  const required = ['firstName', 'lastName', 'phone', 'service', 'date', 'time'];
  const missing = required.filter((f) => !args[f] || !String(args[f]).trim());
  if (missing.length) {
    return {
      ok: false,
      error: 'missing_fields',
      message: `Before I can hold that, I still need: ${speakList(missing)}.`,
      data: { missing },
    };
  }

  const requested = resolveStylist(args.stylist);

  // Re-check availability right now (light double-book guard), across all stylists.
  const r = await getAvailability({ date: args.date, service: args.service, stylist: '' });
  if (!r.ok) {
    let message = r.message;
    if (r.error === 'unknown_service' && r.candidates && r.candidates.length) {
      message += ` Did you mean ${speakList(r.candidates.map((c) => c.name))}?`;
    }
    return { ok: false, error: r.error, message, data: r };
  }

  const wantMin = parseClock(args.time);
  const pool = requested ? r.stylists.filter((s) => s.stylistIndex === requested.index) : r.stylists;

  let chosen = null;
  for (const s of pool) {
    const slot = s.slots.find((x) => x.minutesIntoDay === wantMin || x.time.toLowerCase() === String(args.time).trim().toLowerCase());
    if (slot) {
      chosen = { stylist: s, slot };
      break;
    }
  }

  const when = `${r.weekday}, ${prettyDate(r.date)}`;
  if (!chosen) {
    const fallback = pool[0] || r.stylists[0];
    const alt = fallback ? ` The closest open times are ${speakSlots(fallback.slots, 3)}.` : '';
    return {
      ok: false,
      error: 'slot_unavailable',
      message: `Sorry, ${args.time} isn't available${requested ? ` with ${requested.full}` : ''} on ${when}.${alt}`,
      data: r,
    };
  }

  let depositRequired = true;
  try {
    const salon = await getSalonData();
    depositRequired = !!salon.prepay;
  } catch (_) {
    /* default to true; this salon uses prepay=1 */
  }

  const booking = {
    status: 'pending_owner_confirmation',
    customer: {
      firstName: String(args.firstName).trim(),
      lastName: String(args.lastName).trim(),
      phone: String(args.phone).trim(),
      email: args.email ? String(args.email).trim() : null,
    },
    service: r.service.name,
    serviceIndex: r.service.index,
    stylist: chosen.stylist.stylist,
    stylistIndex: chosen.stylist.stylistIndex,
    date: r.date,
    weekday: r.weekday,
    time: chosen.slot.time,
    startIso: chosen.slot.iso,
    durationMinutes: chosen.stylist.durationMinutes,
    when: `${when} at ${chosen.slot.time} (HST)`,
    note: args.note ? String(args.note).trim() : null,
    depositRequired,
    source: 'vapi-ai-receptionist',
    capturedAt: new Date().toISOString(),
  };

  const delivery = await notifyOwner(booking);

  const depositLine = depositRequired ? ' A deposit may be required to finalize.' : '';
  return {
    ok: true,
    message:
      `Got it — I've put in a request for a ${booking.service} with ${booking.stylist} on ${booking.when}. ` +
      `The salon will confirm with you shortly.${depositLine}`,
    data: { booking, delivery, ownerMessage: formatOwnerMessage(booking) },
  };
}

// parseClock is exported for unit tests.
module.exports = { checkAvailability, bookAppointment, parseClock };
