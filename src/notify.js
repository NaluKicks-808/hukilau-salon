'use strict';

/**
 * Owner notification adapter.
 *
 * CURRENT MODE ('return'): we do NOT send anything ourselves. The booking request is returned
 * to Vapi in the tool result, and your Vapi workflow delivers it to the owner. This is what the
 * salon asked for today — the owner re-enters confirmed bookings in Salon Scheduler (which, on
 * their side, doesn't require the online deposit).
 *
 * SMS MODE ('telnyx'): auto-enabled once TELNYX_API_KEY / TELNYX_FROM / OWNER_PHONE are set —
 * texts the owner on each captured request (the tool still returns the request to Vapi too).
 * A legacy Twilio adapter remains available via NOTIFY_MODE=twilio.
 */

function telnyxConfigured() {
  return !!(
    process.env.TELNYX_API_KEY &&
    process.env.OWNER_PHONE &&
    (process.env.TELNYX_FROM || process.env.TELNYX_MESSAGING_PROFILE_ID)
  );
}

// Use Telnyx SMS as soon as it's configured; otherwise return-to-Vapi. Override with NOTIFY_MODE.
const MODE = process.env.NOTIFY_MODE || (telnyxConfigured() ? 'telnyx' : 'return');

function formatOwnerMessage(b) {
  const action = b.action || 'book';
  const who = `${b.customer.firstName} ${b.customer.lastName} — ${b.customer.phone}`;
  const svcStylist = [b.service, b.stylist].filter(Boolean).join(' with ');
  let lines;

  if (action === 'cancel') {
    lines = [
      'CANCELLATION REQUEST (not yet changed in Salon Scheduler):',
      who,
      `Appointment to cancel: ${svcStylist || '(see time)'}`,
      b.when,
      b.reason ? `Reason: ${b.reason}` : null,
      b.note ? `Note: ${b.note}` : null,
      'Please cancel it in Salon Scheduler.',
    ];
  } else if (action === 'reschedule') {
    lines = [
      'RESCHEDULE REQUEST (not yet changed in Salon Scheduler):',
      who,
      svcStylist || null,
      `From: ${b.fromWhen || '(time not given)'}`,
      `To:   ${b.when}`,
      b.note ? `Note: ${b.note}` : null,
      'Please move it in Salon Scheduler to confirm (deposit may apply).',
    ];
  } else {
    lines = [
      b.offMenu
        ? 'NEW BOOKING REQUEST — OFF-MENU / CUSTOM (confirm service & price):'
        : 'NEW BOOKING REQUEST (not yet in Salon Scheduler):',
      who,
      b.stylist ? `${b.service} with ${b.stylist}` : b.service,
      b.when,
      b.note ? `Note: ${b.note}` : null,
      'Please enter it in Salon Scheduler to confirm.',
    ];
  }
  return lines.filter(Boolean).join('\n');
}

async function sendTwilio(b) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, OWNER_PHONE } = process.env;
  if (!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM && OWNER_PHONE)) {
    return { delivered: false, channel: 'twilio', detail: 'Twilio env vars not configured.' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: TWILIO_FROM, To: OWNER_PHONE, Body: formatOwnerMessage(b) }),
  });
  return { delivered: res.ok, channel: 'twilio', detail: res.ok ? 'sent' : `HTTP ${res.status}` };
}

async function sendTelnyx(b) {
  const { TELNYX_API_KEY, TELNYX_FROM, OWNER_PHONE, TELNYX_MESSAGING_PROFILE_ID } = process.env;
  if (!TELNYX_API_KEY || !OWNER_PHONE || !(TELNYX_FROM || TELNYX_MESSAGING_PROFILE_ID)) {
    return { delivered: false, channel: 'telnyx', detail: 'Telnyx env vars not configured.' };
  }
  const payload = { to: OWNER_PHONE, text: formatOwnerMessage(b) };
  if (TELNYX_FROM) payload.from = TELNYX_FROM;
  else payload.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { delivered: true, channel: 'telnyx', detail: 'sent' };
    const err = await res.text().catch(() => '');
    return { delivered: false, channel: 'telnyx', detail: `HTTP ${res.status} ${err.slice(0, 200)}` };
  } catch (e) {
    return { delivered: false, channel: 'telnyx', detail: e.message };
  }
}

/**
 * @param {object} booking
 * @returns {Promise<{delivered:boolean, channel:string, detail:string}>}
 */
async function notifyOwner(booking) {
  if (MODE === 'telnyx') return sendTelnyx(booking);
  if (MODE === 'twilio') return sendTwilio(booking);
  // 'return' mode: nothing sent here; the tool returns the request to Vapi for delivery.
  return { delivered: false, channel: 'vapi-return', detail: 'Returned to Vapi for delivery to owner.' };
}

module.exports = { notifyOwner, formatOwnerMessage, MODE };
