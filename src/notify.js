'use strict';

/**
 * Owner notification adapter — fans a captured request out to every configured channel:
 *
 *  - NOTION  : adds a row to the "Booking Requests" database (set NOTION_API_KEY + NOTION_DATABASE_ID)
 *  - TELNYX  : texts the owner (set TELNYX_API_KEY + TELNYX_FROM + OWNER_PHONE)
 *  - return  : if neither is set, the request is just returned to Vapi in the tool result
 *
 * Run Notion now and add SMS later — both fire. The owner re-enters confirmed bookings in Salon
 * Scheduler (capture-only; we never write to the salon site). Legacy Twilio via NOTIFY_MODE=twilio.
 */

function telnyxConfigured() {
  return !!(
    process.env.TELNYX_API_KEY &&
    process.env.OWNER_PHONE &&
    (process.env.TELNYX_FROM || process.env.TELNYX_MESSAGING_PROFILE_ID)
  );
}

function notionConfigured() {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);
}

// Captured requests fan out to EVERY configured channel (Notion database + Telnyx SMS), so you can
// run Notion now and add SMS later and get both. Falls back to return-to-Vapi if none are set.
// NOTIFY_MODE=return forces return-only (used by tests); NOTIFY_MODE=twilio uses the legacy SMS.
function activeChannels() {
  if (process.env.NOTIFY_MODE === 'return') return ['return'];
  const ch = [];
  if (notionConfigured()) ch.push('notion');
  if (telnyxConfigured()) ch.push('telnyx');
  else if (process.env.NOTIFY_MODE === 'twilio') ch.push('twilio');
  return ch.length ? ch : ['return'];
}
const MODE = activeChannels().join('+');

function formatOwnerMessage(b) {
  const action = b.action || 'book';
  const name = [b.customer.firstName, b.customer.lastName].filter(Boolean).join(' ') || '(first name only)';
  const who = `${name} — ${b.customer.phone}`;
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // never let SMS hang the tool response
  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      return { delivered: true, channel: 'telnyx', detail: 'sent', id: j && j.data && j.data.id };
    }
    const err = await res.text().catch(() => '');
    return { delivered: false, channel: 'telnyx', detail: `HTTP ${res.status} ${err.slice(0, 200)}` };
  } catch (e) {
    return { delivered: false, channel: 'telnyx', detail: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Add one row to the "Booking Requests" Notion database. Auto-enabled when NOTION_API_KEY +
// NOTION_DATABASE_ID are set (and the database is shared with that integration).
async function sendNotion(b) {
  const { NOTION_API_KEY, NOTION_DATABASE_ID } = process.env;
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return { delivered: false, channel: 'notion', detail: 'Notion env vars not configured.' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // never let a slow write hang the tool response
  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: NOTION_DATABASE_ID }, properties: buildNotionProperties(b) }),
      signal: ctrl.signal,
    });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      return { delivered: true, channel: 'notion', detail: 'row added', id: j && j.id };
    }
    const err = await res.text().catch(() => '');
    return { delivered: false, channel: 'notion', detail: `HTTP ${res.status} ${err.slice(0, 200)}` };
  } catch (e) {
    return { delivered: false, channel: 'notion', detail: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Map a captured request to the "Booking Requests" database columns. Exported for tests.
function buildNotionProperties(b) {
  const action = b.action || 'book';
  const Action = action === 'cancel' ? 'Cancel' : action === 'reschedule' ? 'Reschedule' : 'Book';
  const name = [b.customer.firstName, b.customer.lastName].filter(Boolean).join(' ') || b.customer.firstName || '(no name)';
  const noteParts = [];
  if (b.offMenu) noteParts.push('OFF-MENU — confirm service & price');
  if (b.fromWhen) noteParts.push(`From: ${b.fromWhen}`);
  if (b.reason) noteParts.push(`Reason: ${b.reason}`);
  if (b.note) noteParts.push(b.note);
  const rt = (s) => (s ? [{ text: { content: String(s).slice(0, 1900) } }] : []);
  return {
    Name: { title: rt(name) },
    Phone: { phone_number: b.customer.phone ? String(b.customer.phone) : null },
    Action: { select: { name: Action } },
    Service: { rich_text: rt(b.service) },
    Stylist: { rich_text: rt(b.stylist) },
    When: { rich_text: rt(b.when) },
    Status: { select: { name: 'New' } },
    Note: { rich_text: rt(noteParts.join(' | ')) },
  };
}

/**
 * Deliver a captured request to every configured owner channel (Notion + SMS), best-effort.
 * @param {object} booking
 * @returns {Promise<{delivered:boolean, channel:string, channels?:object[], detail?:string}>}
 */
async function notifyOwner(booking) {
  const jobs = [];
  if (process.env.NOTIFY_MODE !== 'return') {
    if (notionConfigured()) jobs.push(sendNotion);
    if (telnyxConfigured()) jobs.push(sendTelnyx);
    else if (process.env.NOTIFY_MODE === 'twilio') jobs.push(sendTwilio);
  }
  if (!jobs.length) {
    // Nothing configured: the tool still returns the request to Vapi for delivery.
    return { delivered: false, channel: 'vapi-return', detail: 'Returned to Vapi for delivery to owner.' };
  }
  const channels = await Promise.all(
    jobs.map((fn) => fn(booking).catch((e) => ({ delivered: false, channel: 'unknown', detail: e.message })))
  );
  return { delivered: channels.some((c) => c.delivered), channel: channels.map((c) => c.channel).join('+'), channels };
}

module.exports = { notifyOwner, formatOwnerMessage, buildNotionProperties, notionConfigured, MODE };
