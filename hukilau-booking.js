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
process.env.TZ = process.env.SALON_TZ || 'Pacific/Honolulu';

const moment = require('moment-timezone');
const { getAvailability, findEarliest, findNextDays } = require('./src/availabilityEngine');
const { getSalonData } = require('./src/salonClient');
const { notifyOwner, formatOwnerMessage } = require('./src/notify');
const { resolveStylist } = require('./src/stylists');
const { resolveServices, resolveAmong, formatPrice } = require('./src/services');
const { resolveDate } = require('./src/datetime');
const { addHold } = require('./src/pendingHolds');

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

// Like speakList but joins with "or" — for offering the caller a choice ("X, Y, or Z?").
function speakOr(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

// Normalize the optional `among` arg (previously-offered options) to a string[]. Accepts an array
// or a single string the assistant might pass verbatim ("Women's Cut or Women's Cut & Style").
function parseAmong(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/\bor\b|,|\//gi);
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

function prettyDate(iso) {
  // Month + day only; the weekday is prepended separately as `${r.weekday}, ${prettyDate()}`.
  return moment(iso, 'YYYY-MM-DD').format('MMMM D');
}

// Build a "that time isn't open" message whose alternatives never contradict the request:
// show the REQUESTED stylist's own next times, or explicitly name a DIFFERENT stylist's times.
function slotUnavailableMessage(r, requested, requestedTime, whenLabel) {
  let alt = '';
  if (requested) {
    const mine = r.stylists.find((s) => s.stylistIndex === requested.index);
    if (mine && mine.slots.length) {
      alt = ` ${requested.full}'s closest open times are ${speakSlots(mine.slots, 3)}.`;
    } else {
      const other = r.stylists[0];
      if (other) alt = ` ${requested.full} doesn't have any openings that day, but ${other.stylistShort} has ${speakSlots(other.slots, 3)}.`;
    }
  } else {
    const other = r.stylists[0];
    if (other) alt = ` The closest open times are ${speakSlots(other.slots, 3)}.`;
  }
  return `Sorry, ${requestedTime} isn't available${requested ? ` with ${requested.full}` : ''} on ${whenLabel}.${alt}`;
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

// Voice transcription often drops/mangles phone digits, and a wrong number means the owner can't
// confirm the booking. We don't reformat (keep what the caller said for the owner) — we just flag
// when it's clearly incomplete so the assistant re-asks. Lenient: US 10/11-digit or intl up to 15.
function phoneLooksValid(input) {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

// Format minutes-into-day for speech: 840 -> "2 PM", 855 -> "2:15 PM".
function clockLabel(mins) {
  const m = moment().startOf('day').add(mins, 'minutes');
  return m.minute() === 0 ? m.format('h A') : m.format('h:mm A');
}

// Spoken phrase for a time-of-day constraint, or '' if none.
// e.g. "after 2 PM", "before 12 PM", "between 2 PM and 5 PM".
function windowPhrase(afterMin, beforeMin) {
  if (afterMin != null && beforeMin != null) return `between ${clockLabel(afterMin)} and ${clockLabel(beforeMin)}`;
  if (afterMin != null) return `after ${clockLabel(afterMin)}`;
  if (beforeMin != null) return `before ${clockLabel(beforeMin)}`;
  return '';
}

const WEEKDAY_INDEX = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Parse caller weekday references into unique day indices (0=Sun..6=Sat), or null.
// Accepts an array (["Thursday"]) or a string ("Tuesdays or Wednesdays", "weekends", "weekdays").
function parseWeekdays(input) {
  if (input == null) return null;
  const items = Array.isArray(input) ? input : String(input).split(/\s*(?:,|\/|&|\bor\b|\band\b)\s*/i);
  const out = [];
  for (const raw of items) {
    const key = String(raw).trim().toLowerCase().replace(/s$/, ''); // "tuesdays" -> "tuesday"
    if (key === 'weekend') out.push(0, 6);
    else if (key === 'weekday') out.push(1, 2, 3, 4, 5);
    else if (WEEKDAY_INDEX[key] != null) out.push(WEEKDAY_INDEX[key]);
  }
  return out.length ? [...new Set(out)] : null;
}

function speakDays(indices) {
  return speakList(indices.slice().sort((a, b) => a - b).map((i) => `${DAY_NAMES[i]}s`));
}

// Spoken phrase for a day-of-week constraint, or '': "on Saturdays and Sundays", "excluding Thursdays".
function dayPhrase(includeDays, excludeDays) {
  if (includeDays && includeDays.length) return `on ${speakDays(includeDays)}`;
  if (excludeDays && excludeDays.length) return `excluding ${speakDays(excludeDays)}`;
  return '';
}

// Spoken approximate duration: 45 -> "45 minutes", 60 -> "an hour", 150 -> "2 and a half hours".
function durationPhrase(min) {
  if (!min || min < 1) return 'a few minutes';
  if (min < 60) return `${min} minutes`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hp = h === 1 ? 'an hour' : `${h} hours`;
  if (m === 0) return hp;
  if (m === 30) return h === 1 ? 'an hour and a half' : `${h} and a half hours`;
  return `${hp} and ${m} minutes`;
}

// The requested service names (primary + any additional, for a combo) as trimmed strings.
function requestedServiceNames(args) {
  return [args.service, ...(Array.isArray(args.additionalServices) ? args.additionalServices : [])]
    .filter((x) => x && String(x).trim())
    .map((x) => String(x).trim());
}

// Build the customer record. lastName is OPTIONAL — we push for it in the prompt but never block a
// booking on it; a caller who won't give a last name still gets captured (firstName + phone).
function customerFrom(args) {
  return {
    firstName: args.firstName ? String(args.firstName).trim() : '',
    lastName: args.lastName ? String(args.lastName).trim() : '',
    phone: args.phone ? String(args.phone).trim() : '',
    email: args.email ? String(args.email).trim() : null,
  };
}

function fullName(c) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.firstName || 'the caller';
}

// "Saturday has 2:15 PM and 2:30 PM, and Sunday has 9:00 AM and 9:15 AM" — alternative days to offer
// when the caller's requested day is full (from findNextDays).
function speakNextDays(days) {
  return speakList(days.map((d) => `${d.weekday} has ${speakSlots(d.stylists[0].slots, 2)}`));
}

// ---------- Tool 1: check_availability ----------

async function checkAvailability(args = {}) {
  const requested = resolveStylist(args.stylist);
  // Time-of-day constraint ("after 2 PM"), parsed to minutes and enforced server-side.
  const afterMin = parseClock(args.afterTime);
  const beforeMin = parseClock(args.beforeTime);
  const win = windowPhrase(afterMin, beforeMin);
  const winSuffix = win ? ` ${win}` : '';

  // One live read across ALL stylists, then highlight/partition by the requested stylist.
  const r = await getAvailability({
    date: args.date,
    service: args.service,
    additionalServices: args.additionalServices,
    stylist: '',
    afterMin,
    beforeMin,
    maxPerStylist: args.maxPerStylist,
  });

  if (!r.ok) {
    let message = r.message;
    if (r.error === 'unknown_service' && r.candidates && r.candidates.length) {
      message += ` Did you mean ${speakList(r.candidates.map((c) => c.name))}?`;
    }
    return { ok: false, error: r.error, message, data: r };
  }

  const when = `${r.weekday}, ${prettyDate(r.date)}`;

  // When a requested day is full, proactively scan forward and offer the next open days, so the
  // assistant never dead-ends with "what other day?" — it hands over real alternatives instead.
  const nextDaysSuffix = async () => {
    try {
      const alt = await findNextDays(
        {
          service: args.service,
          additionalServices: args.additionalServices,
          stylist: args.stylist,
          afterMin,
          beforeMin,
          fromDate: r.date,
        },
        2
      );
      if (alt.ok && alt.days && alt.days.length) return `, but ${speakNextDays(alt.days)}`;
    } catch (_) {
      /* alternatives are best-effort */
    }
    return '';
  };

  if (requested) {
    const mine = r.stylists.find((s) => s.stylistIndex === requested.index);
    const others = r.stylists.filter((s) => s.stylistIndex !== requested.index);
    let message;
    if (mine) {
      message = `Yes — ${requested.full} can do a ${r.service.name}${winSuffix} on ${when}. Open times: ${speakSlots(
        mine.slots
      )}.`;
    } else if (others.length) {
      message =
        `${requested.full} doesn't have any ${r.service.name} openings${winSuffix} on ${when}, ` +
        `but ${others[0].stylistShort} does at ${speakSlots(others[0].slots, 3)}.`;
    } else {
      message = `${requested.full} doesn't have any ${r.service.name} openings${winSuffix} on ${when}${await nextDaysSuffix()}.`;
    }
    return {
      ok: true,
      message,
      data: { ...r, requestedStylist: requested.full, mine: mine || null, others },
    };
  }

  // Any stylist.
  if (!r.available) {
    return {
      ok: true,
      message: `I don't see any ${r.service.name} openings${winSuffix} on ${when}${await nextDaysSuffix()}.`,
      data: r,
    };
  }
  const e = r.earliest;
  let message = `For a ${r.service.name}${winSuffix} on ${when}, the soonest is ${e.stylistShort} at ${e.time}.`;
  const extras = r.stylists
    .filter((s) => s.stylistIndex !== e.stylistIndex)
    .slice(0, 2)
    .map((s) => `${s.stylistShort} at ${speakSlots(s.slots, 2)}`);
  if (extras.length) message += ` ${speakList(extras)} also have openings.`;
  return { ok: true, message, data: r };
}

// ---------- Tool 2: book_appointment (capture + hand off to owner) ----------

async function bookAppointment(args = {}) {
  // lastName is intentionally NOT required — we encourage it in the prompt but never block on it.
  const required = ['firstName', 'phone', 'service', 'date', 'time'];
  const missing = required.filter((f) => !args[f] || !String(args[f]).trim());
  if (missing.length) {
    return {
      ok: false,
      error: 'missing_fields',
      message: `Before I can hold that, I still need: ${speakList(missing)}.`,
      data: { missing },
    };
  }
  if (!phoneLooksValid(args.phone)) {
    return {
      ok: false,
      error: 'invalid_phone',
      message: "I want to make sure the salon can reach you — could you say your phone number again, including the area code?",
      data: { phone: args.phone },
    };
  }

  const requested = resolveStylist(args.stylist);

  // Re-check availability right now (light double-book guard), across all stylists.
  // Validate against the FULL day's slots (high cap), not the 8-slot speech cap — otherwise a
  // genuinely-open later slot (e.g. 4 PM on a light day) gets wrongly rejected as unavailable.
  const r = await getAvailability({
    date: args.date,
    service: args.service,
    additionalServices: args.additionalServices,
    stylist: '',
    maxPerStylist: 500,
  });
  if (!r.ok) {
    // Ambiguous service ("a haircut", "gray retouch", "highlights"): the caller named a REAL menu
    // service imprecisely and there are two+ plausible matches. Ask which one — do NOT silently
    // capture it as an off-menu/custom booking, which would skip the price and the slot re-check.
    if (r.error === 'unknown_service' && r.ambiguous && r.candidates && r.candidates.length) {
      return {
        ok: false,
        error: 'ambiguous_service',
        message: `I want to book exactly the right thing — did you mean ${speakOr(
          r.candidates.map((c) => c.name)
        )}?`,
        data: { candidates: r.candidates },
      };
    }
    // Off-menu / custom service: don't turn callers away. Capture the request with a note and
    // let the salon confirm service, price, and time. (The date was already validated above.)
    if (r.error === 'unknown_service') {
      const reqStylist = resolveStylist(args.stylist);
      const when = describeWhen(args.date, args.time);
      const booking = {
        action: 'book',
        status: 'pending_owner_confirmation',
        offMenu: true,
        customer: customerFrom(args),
        service: requestedServiceNames(args).join(' + ') || String(args.service).trim(),
        stylist: reqStylist ? reqStylist.full : args.stylist ? String(args.stylist).trim() : null,
        date: when.iso,
        when: when.text,
        note: [args.note ? String(args.note).trim() : null, 'OFF-MENU / custom service — please confirm service, price, and time with the customer.']
          .filter(Boolean)
          .join(' | '),
        source: 'vapi-ai-receptionist',
        capturedAt: new Date().toISOString(),
      };
      const delivery = await notifyOwner(booking);
      // Block the slot for the next caller too (best-effort). Off-menu has no known duration, so
      // assume 60 min; holds only ever ADD a block, so over-blocking is safe.
      const offMin = parseClock(args.time);
      if (reqStylist && offMin != null && when.iso) {
        await addHold({
          dateIso: when.iso,
          stylistIndex: reqStylist.index,
          startMinutes: offMin,
          durationMinutes: 60,
          meta: { name: fullName(booking.customer), service: booking.service, offMenu: true },
        }).catch(() => {});
      }
      return {
        ok: true,
        message: `Okay — I've sent your request for ${booking.service} on ${when.text} to the salon, and they'll confirm with you shortly.`,
        data: { booking, delivery, ownerMessage: formatOwnerMessage(booking) },
      };
    }
    return { ok: false, error: r.error, message: r.message, data: r };
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
    return {
      ok: false,
      error: 'slot_unavailable',
      message: slotUnavailableMessage(r, requested, args.time, when),
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
    customer: customerFrom(args),
    service: r.service.name,
    services: r.service.names,
    serviceIndex: r.service.index,
    serviceIndexes: r.service.indexes,
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
  // Hold this slot so the next caller can't be offered it before the owner enters it.
  await addHold({
    dateIso: r.date,
    stylistIndex: chosen.stylist.stylistIndex,
    startMinutes: chosen.slot.minutesIntoDay,
    durationMinutes: chosen.stylist.durationMinutes,
    meta: { name: fullName(booking.customer), service: booking.service },
  }).catch(() => {});

  return {
    ok: true,
    message:
      `Got it — I've put in a request for a ${booking.service} with ${booking.stylist} on ${booking.when}. ` +
      `The salon will confirm with you shortly.`,
    data: { booking, delivery, ownerMessage: formatOwnerMessage(booking) },
  };
}

// ---------- Tools 3 & 4: cancel / reschedule (capture + notify owner) ----------

// Build a readable "when" from a caller-stated date (+ optional time). Falls back to the raw
// text if the date can't be parsed, so a vague request still gets captured for the owner.
function describeWhen(dateInput, timeInput) {
  const d = resolveDate(dateInput);
  const datePart = d ? `${d.weekday}, ${prettyDate(d.iso)}` : String(dateInput || '').trim();
  const t = timeInput ? String(timeInput).trim() : '';
  return { iso: d ? d.iso : null, text: t ? `${datePart} at ${t}` : datePart };
}

async function cancelAppointment(args = {}) {
  const required = ['firstName', 'phone', 'date'];
  const missing = required.filter((f) => !args[f] || !String(args[f]).trim());
  if (missing.length) {
    return {
      ok: false,
      error: 'missing_fields',
      message: `To cancel, I still need: ${speakList(missing)}.`,
      data: { missing },
    };
  }

  const when = describeWhen(args.date, args.time);
  const requested = resolveStylist(args.stylist);
  const cancellation = {
    action: 'cancel',
    status: 'pending_owner_action',
    customer: customerFrom(args),
    service: args.service ? String(args.service).trim() : null,
    stylist: requested ? requested.full : args.stylist ? String(args.stylist).trim() : null,
    date: when.iso,
    when: when.text,
    reason: args.reason ? String(args.reason).trim() : null,
    note: args.note ? String(args.note).trim() : null,
    source: 'vapi-ai-receptionist',
    capturedAt: new Date().toISOString(),
  };

  const delivery = await notifyOwner(cancellation);
  return {
    ok: true,
    message: `Okay — I've sent a cancellation request for ${when.text} to the salon, and they'll take care of it.`,
    data: { cancellation, delivery, ownerMessage: formatOwnerMessage(cancellation) },
  };
}

// Tool: add_appointment_note — attach a note/preference to a booking the caller JUST made
// ("leave a note that I want a buzz cut"). This is the fix for the re-booking bug: a note must NEVER
// re-run book_appointment (which re-checks availability and collides with the new booking's own hold,
// making the slot look "taken"). We only forward the note to the owner — no availability, no hold.
async function addAppointmentNote(args = {}) {
  const note = args.note ? String(args.note).trim() : '';
  if (!note) {
    return {
      ok: false,
      error: 'missing_fields',
      message: 'Sure — what would you like the note to say?',
      data: { missing: ['note'] },
    };
  }
  const when = describeWhen(args.date, args.time);
  const requested = resolveStylist(args.stylist);
  const noteRequest = {
    action: 'note',
    status: 'pending_owner_action',
    customer: customerFrom(args),
    service: args.service ? String(args.service).trim() : null,
    stylist: requested ? requested.full : args.stylist ? String(args.stylist).trim() : null,
    date: when.iso,
    when: when.text,
    note,
    source: 'vapi-ai-receptionist',
    capturedAt: new Date().toISOString(),
  };
  const delivery = await notifyOwner(noteRequest);
  const forWhom = when.text ? ` to your ${when.text} appointment` : ' to your appointment';
  return {
    ok: true,
    message: `Got it — I've added that note${forWhom}, and the salon will see it. Anything else?`,
    data: { note: noteRequest, delivery, ownerMessage: formatOwnerMessage(noteRequest) },
  };
}

async function rescheduleAppointment(args = {}) {
  const required = ['firstName', 'phone', 'newDate', 'newTime'];
  const missing = required.filter((f) => !args[f] || !String(args[f]).trim());
  if (missing.length) {
    return {
      ok: false,
      error: 'missing_fields',
      message: `To reschedule, I still need: ${speakList(missing)}.`,
      data: { missing },
    };
  }

  const requested = resolveStylist(args.stylist);
  const fromWhen = describeWhen(args.currentDate, args.currentTime).text;
  let serviceName = args.service ? String(args.service).trim() : null;
  let stylistName = requested ? requested.full : args.stylist ? String(args.stylist).trim() : null;
  let newWhen;
  let newHold = null;

  // If we know the service, verify the NEW slot is actually open (same guard as booking).
  if (serviceName) {
    // Full day's slots (high cap), not the speech cap — so a valid later slot isn't wrongly rejected.
    const r = await getAvailability({
      date: args.newDate,
      service: args.service,
      additionalServices: args.additionalServices,
      stylist: '',
      maxPerStylist: 500,
    });
    if (!r.ok) {
      let message = r.message;
      if (r.error === 'unknown_service' && r.candidates && r.candidates.length) {
        message += ` Did you mean ${speakList(r.candidates.map((c) => c.name))}?`;
      }
      return { ok: false, error: r.error, message, data: r };
    }
    const wantMin = parseClock(args.newTime);
    const pool = requested ? r.stylists.filter((s) => s.stylistIndex === requested.index) : r.stylists;
    let chosen = null;
    for (const s of pool) {
      const slot = s.slots.find(
        (x) => x.minutesIntoDay === wantMin || x.time.toLowerCase() === String(args.newTime).trim().toLowerCase()
      );
      if (slot) {
        chosen = { stylist: s, slot };
        break;
      }
    }
    const whenLabel = `${r.weekday}, ${prettyDate(r.date)}`;
    if (!chosen) {
      return {
        ok: false,
        error: 'slot_unavailable',
        message: slotUnavailableMessage(r, requested, args.newTime, whenLabel),
        data: r,
      };
    }
    serviceName = r.service.name;
    stylistName = chosen.stylist.stylist;
    newWhen = `${whenLabel} at ${chosen.slot.time} (HST)`;
    newHold = {
      dateIso: r.date,
      stylistIndex: chosen.stylist.stylistIndex,
      startMinutes: chosen.slot.minutesIntoDay,
      durationMinutes: chosen.stylist.durationMinutes,
    };
  } else {
    // No service stated — capture without the open-slot check; the owner validates.
    newWhen = describeWhen(args.newDate, args.newTime).text;
  }

  const reschedule = {
    action: 'reschedule',
    status: 'pending_owner_action',
    customer: customerFrom(args),
    service: serviceName,
    stylist: stylistName,
    fromWhen,
    when: newWhen,
    note: args.note ? String(args.note).trim() : null,
    source: 'vapi-ai-receptionist',
    capturedAt: new Date().toISOString(),
  };

  const delivery = await notifyOwner(reschedule);
  if (newHold) {
    await addHold({
      ...newHold,
      meta: { name: fullName(reschedule.customer), action: 'reschedule' },
    }).catch(() => {});
  }

  return {
    ok: true,
    message: `Done — I've asked the salon to move your appointment to ${newWhen}. They'll confirm shortly.`,
    data: { reschedule, delivery, ownerMessage: formatOwnerMessage(reschedule) },
  };
}

// ---------- Tool 5: find_earliest_availability ----------

async function findEarliestAvailability(args = {}) {
  if (!args.service || !String(args.service).trim()) {
    return {
      ok: false,
      error: 'missing_fields',
      message: 'Which service are you looking for?',
      data: { missing: ['service'] },
    };
  }
  // Time-of-day constraint ("after 2 PM"), parsed to minutes and enforced server-side. The
  // engine scans forward day by day and returns the first slot that actually satisfies it.
  const afterMin = parseClock(args.afterTime);
  const beforeMin = parseClock(args.beforeTime);
  const includeDays = parseWeekdays(args.daysOfWeek);
  const excludeDays = parseWeekdays(args.excludeDaysOfWeek);
  // Combined spoken phrase for any time + day constraints, e.g. " after 2 PM excluding Thursdays".
  const cSuffix = [windowPhrase(afterMin, beforeMin), dayPhrase(includeDays, excludeDays)]
    .filter(Boolean)
    .map((p) => ` ${p}`)
    .join('');

  const r = await findEarliest({
    service: args.service,
    additionalServices: args.additionalServices,
    stylist: args.stylist,
    fromDate: args.fromDate,
    daysToSearch: args.daysToSearch,
    afterMin,
    beforeMin,
    includeDays,
    excludeDays,
  });
  if (!r.ok) {
    let message = r.message;
    if (r.error === 'unknown_service' && r.candidates && r.candidates.length) {
      message += ` Did you mean ${speakList(r.candidates.map((c) => c.name))}?`;
    }
    return { ok: false, error: r.error, message, data: r };
  }
  if (!r.found) {
    const message = `I don't see any ${r.service.name} openings${cSuffix}${
      r.requestedStylist ? ` with ${r.requestedStylist}` : ''
    } in the next ${r.daysSearched} days.`;
    return { ok: true, message, data: r };
  }

  const when = `${r.weekday}, ${prettyDate(r.date)}`;
  const e = r.earliest;
  let message;
  if (r.requestedStylist) {
    message = `The soonest ${r.service.name}${cSuffix} with ${e.stylist} is ${when} at ${e.time}.`;
  } else {
    message = `The soonest ${r.service.name}${cSuffix} is ${when} at ${e.time} with ${e.stylistShort}.`;
    const others = r.stylists
      .filter((s) => s.stylistIndex !== e.stylistIndex)
      .slice(0, 2)
      .map((s) => `${s.stylistShort} at ${speakSlots(s.slots, 2)}`);
    if (others.length) message += ` That same day, ${speakList(others)} also have openings.`;
  }
  return { ok: true, message, data: r };
}

// ---------- Tool 6: get_service_info (price + duration quote) ----------

// Build a spoken price/time answer for one or more services (a combo sums them).
function priceMessage(items) {
  const totalDur = items.reduce((s, m) => s + (m.durationMinutes || 0), 0);
  const durText = durationPhrase(totalDur);
  if (items.length === 1) {
    const m = items[0];
    if (m.varies) {
      return `${m.name} is priced based on your hair, so your stylist gives you an exact quote at the appointment. It takes about ${durText}.`;
    }
    return `A ${m.name} is ${formatPrice(m.priceCents)} and takes about ${durText}.`;
  }
  // Combo: list each service's price, sum the fixed ones, and flag any that are priced in-salon.
  const parts = items.map((m) =>
    m.varies ? `${m.name}, which is priced in-salon` : `${m.name} at ${formatPrice(m.priceCents)}`
  );
  const fixedTotal = items.filter((m) => !m.varies).reduce((s, m) => s + m.priceCents, 0);
  const totalText = items.some((m) => m.varies)
    ? `that's ${formatPrice(fixedTotal)} plus the in-salon-priced part`
    : `that's ${formatPrice(fixedTotal)} total`;
  return `For ${speakList(parts)} — ${totalText}, about ${durText} altogether.`;
}

async function getServiceInfo(args = {}) {
  const wanted = requestedServiceNames(args);
  if (!wanted.length) {
    return {
      ok: false,
      error: 'missing_fields',
      message: 'Which service would you like the price for?',
      data: { missing: ['service'] },
    };
  }
  let data;
  try {
    data = await getSalonData();
  } catch (_) {
    return {
      ok: false,
      error: 'unavailable',
      message: "I can't pull up pricing right this second — the salon can give you an exact quote.",
      data: {},
    };
  }
  const { matches, unresolved } = resolveServices(wanted, data.serviceJSON);
  if (unresolved.length || !matches.length) {
    const u = unresolved[0] || { input: wanted[0], candidates: [] };
    let message = `I'm not sure which service you mean by "${u.input}".`;
    if (u.candidates && u.candidates.length) message += ` Did you mean ${speakList(u.candidates.map((c) => c.name))}?`;
    return { ok: false, error: 'unknown_service', message, data: { unresolved } };
  }
  return {
    ok: true,
    message: priceMessage(matches),
    data: {
      services: matches.map((m) => ({
        name: m.name,
        price: formatPrice(m.priceCents),
        priceCents: m.priceCents,
        durationMinutes: m.durationMinutes,
        varies: m.varies,
      })),
      totalPriceCents: matches.filter((m) => !m.varies).reduce((s, m) => s + m.priceCents, 0),
      totalDurationMinutes: matches.reduce((s, m) => s + (m.durationMinutes || 0), 0),
      anyVaries: matches.some((m) => m.varies),
    },
  };
}

// ---------- Tool 7: resolve_service (deterministic service-name resolution) ----------

// A lightweight, side-effect-free tool the assistant calls EARLY — the moment a caller names a
// service, before any booking — to turn fuzzy/non-canonical phrasing ("brow tint", "gray retouch",
// "highlights") into either the exact menu name, a "did you mean ...?" choice, or an off-menu
// acknowledgment. This keeps the model from inventing menu facts (e.g. wrongly claiming a service
// isn't offered) or guessing categories conversationally — resolution is 100% server-side.
async function resolveServicePhrase(args = {}) {
  const phrase = [args.service, args.phrase, args.query].find((x) => x && String(x).trim());
  if (!phrase) {
    return { ok: false, error: 'missing_fields', message: 'What service are you asking about?', data: { missing: ['service'] } };
  }
  let data;
  try {
    data = await getSalonData();
  } catch (_) {
    return { ok: false, error: 'unavailable', message: "I can't pull up our service list right this second — the salon can confirm the exact service.", data: {} };
  }

  // Dialog-state narrowing: when the assistant has already offered a choice and the caller answers
  // with a fragment ("just a cut", "the one with style", "women's"), it re-calls with `among` set to
  // the options it just offered. We pick deterministically so the flow never restarts. A non-match
  // (caller changed their mind) falls through to normal full-menu resolution below.
  const among = parseAmong(args.among || args.options || args.choices || args.narrowTo);
  if (among.length >= 2) {
    const a = resolveAmong(phrase, among, data.serviceJSON);
    if (a.narrowed && a.match) {
      return { ok: true, message: a.match.name, data: { resolved: true, canonical: a.match.name, narrowed: true } };
    }
    if (a.narrowed && a.ambiguous && a.candidates.length) {
      return {
        ok: true,
        message: `Did you mean ${speakOr(a.candidates.map((c) => c.name))}?`,
        data: { resolved: false, ambiguous: true, narrowed: true, candidates: a.candidates },
      };
    }
  }

  const { matches, unresolved } = resolveServices([phrase], data.serviceJSON);
  if (matches.length) {
    // Exact/aliased match — hand back the canonical menu name for the assistant to use as-is.
    return { ok: true, message: matches[0].name, data: { resolved: true, canonical: matches[0].name } };
  }
  const u = unresolved[0] || { candidates: [], ambiguous: false };
  if (u.ambiguous && u.candidates && u.candidates.length) {
    // Two+ real menu matches — ask the caller to choose (same wording the booking tool uses).
    return {
      ok: true,
      message: `Did you mean ${speakOr(u.candidates.map((c) => c.name))}?`,
      data: { resolved: false, ambiguous: true, candidates: u.candidates },
    };
  }
  // Not a listed service. Tell the assistant it's a special request to CAPTURE — never to deny.
  return {
    ok: true,
    message: `"${String(phrase).trim()}" isn't one of our standard listed services, but I can still take it as a special request for the salon to confirm.`,
    data: { resolved: false, offMenu: true },
  };
}

// parseClock is exported for unit tests.
module.exports = {
  checkAvailability,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  addAppointmentNote,
  findEarliestAvailability,
  getServiceInfo,
  resolveServicePhrase,
  parseClock,
  parseWeekdays,
};
