'use strict';

/**
 * Owner notification adapter — fans a captured request out to every configured channel:
 *
 *  - NOTION   : adds a row to the "Booking Requests" database (set NOTION_API_KEY + NOTION_DATABASE_ID)
 *  - PUSHOVER : instant push to the owner's phone (set PUSHOVER_TOKEN + PUSHOVER_USER); NEW bookings
 *               use emergency priority so an overnight booking keeps alerting until acknowledged
 *  - TELNYX   : texts the owner (set TELNYX_API_KEY + TELNYX_FROM + OWNER_PHONE)
 *  - return   : if none are set, the request is just returned to Vapi in the tool result
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

function pushoverConfigured() {
  return !!(process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER);
}

// Captured requests fan out to EVERY configured channel (Notion database + Telnyx SMS), so you can
// run Notion now and add SMS later and get both. Falls back to return-to-Vapi if none are set.
// NOTIFY_MODE=return forces return-only (used by tests); NOTIFY_MODE=twilio uses the legacy SMS.
function activeChannels() {
  if (process.env.NOTIFY_MODE === 'return') return ['return'];
  const ch = [];
  if (notionConfigured()) ch.push('notion');
  if (pushoverConfigured()) ch.push('pushover');
  if (telnyxConfigured()) ch.push('telnyx');
  else if (process.env.NOTIFY_MODE === 'twilio') ch.push('twilio');
  return ch.length ? ch : ['return'];
}
const MODE = activeChannels().join('+');

// The salon's local date ("YYYY-MM-DD"). Vercel runs in UTC; Hawaii has no DST.
function todayInSalonTz() {
  return new Date().toLocaleDateString('en-CA', { timeZone: process.env.SALON_TZ || 'Pacific/Honolulu' });
}

// A request is "same-day" when the appointment date is today in salon time. Unparseable/vague
// dates (b.date null) are NOT treated as same-day — the alert still arrives, it just doesn't nag.
function isSameDayAppointment(b) {
  return !!b.date && b.date === todayInSalonTz();
}

// Every owner message carries the full handoff: service, stylist, date+time, customer name,
// phone, and any notes — so the owner can act from the notification alone.
function formatOwnerMessage(b) {
  const action = b.action || 'book';
  const name = [b.customer.firstName, b.customer.lastName].filter(Boolean).join(' ') || '(first name only)';
  const stylist = b.stylist || 'Any available stylist';
  const svcStylist = b.service ? `${b.service} with ${stylist}` : `(service TBD) with ${stylist}`;
  const details = [
    `📅 ${b.when || '(time not given)'}`,
    `👤 ${name}`,
    `📞 ${b.customer.phone || '(no phone captured)'}`,
    b.note ? `📝 ${b.note}` : null,
  ];
  let lines;

  if (action === 'cancel') {
    lines = [
      'CANCELLATION REQUEST (not yet changed in Salon Scheduler):',
      `Appointment to cancel: ${svcStylist}`,
      ...details,
      b.reason ? `Reason: ${b.reason}` : null,
      'Please cancel it in Salon Scheduler.',
    ];
  } else if (action === 'reschedule') {
    lines = [
      'RESCHEDULE REQUEST (not yet changed in Salon Scheduler):',
      svcStylist,
      `From: ${b.fromWhen || '(time not given)'}`,
      `To:   ${b.when || '(time not given)'}`,
      `👤 ${name}`,
      `📞 ${b.customer.phone || '(no phone captured)'}`,
      b.note ? `📝 ${b.note}` : null,
      'Please move it in Salon Scheduler to confirm (deposit may apply).',
    ];
  } else if (action === 'note') {
    lines = [
      'NOTE FOR A BOOKING (add it to the appointment in Salon Scheduler):',
      svcStylist,
      b.when ? `📅 ${b.when}` : null,
      `👤 ${name}`,
      `📞 ${b.customer.phone || '(no phone captured)'}`,
      `📝 ${b.note}`,
    ];
  } else {
    lines = [
      b.offMenu
        ? 'NEW BOOKING REQUEST — OFF-MENU / CUSTOM (confirm service & price):'
        : 'NEW BOOKING REQUEST (not yet in Salon Scheduler):',
      svcStylist,
      ...details,
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

// Instant push to the owner's phone via Pushover. Emergency priority (repeat every minute until
// acknowledged) is reserved for SAME-DAY appointments only — those can't wait. Everything else is
// a normal one-time alert: it rings once and the owner can look when convenient (owner's request).
async function sendPushover(b) {
  const { PUSHOVER_TOKEN, PUSHOVER_USER } = process.env;
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) {
    return { delivered: false, channel: 'pushover', detail: 'Pushover env vars not configured.' };
  }
  const action = b.action || 'book';
  const baseTitle =
    action === 'cancel'
      ? '❌ Cancellation request'
      : action === 'reschedule'
        ? '🔁 Reschedule request'
        : action === 'note'
          ? '📝 Note for a booking'
          : '📅 New booking request';
  const emergency = isSameDayAppointment(b);
  const params = {
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title: emergency ? `🚨 TODAY — ${baseTitle}` : baseTitle,
    message: formatOwnerMessage(b),
    priority: String(emergency ? 2 : 0),
  };
  if (emergency) {
    params.retry = '60'; // re-alert every 60s…
    params.expire = '3600'; // …for up to an hour, until acknowledged
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // never let a slow push hang the tool response
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    return { delivered: res.ok, channel: 'pushover', detail: res.ok ? 'sent' : `HTTP ${res.status}` };
  } catch (e) {
    return { delivered: false, channel: 'pushover', detail: e.name === 'AbortError' ? 'timeout' : e.message };
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
  const Action =
    action === 'cancel' ? 'Cancel' : action === 'reschedule' ? 'Reschedule' : action === 'note' ? 'Note' : 'Book';
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
    if (pushoverConfigured()) jobs.push(sendPushover);
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

module.exports = {
  notifyOwner,
  formatOwnerMessage,
  buildNotionProperties,
  notionConfigured,
  pushoverConfigured,
  isSameDayAppointment,
  MODE,
};
