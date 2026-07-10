'use strict';

/**
 * server.js — Express transport that exposes the two Hukilau tools to Vapi.
 *
 * Vapi calls your server URL when the assistant invokes a tool. Request shape (current):
 *   { "message": { "type": "tool-calls", "toolCallList": [ { "id", "name", "arguments" } ] } }
 * (older shape: message.toolCalls[].function.name / .arguments). We accept both, and treat
 * `arguments` as either an object or a JSON string.
 *
 * Response shape Vapi expects:
 *   { "results": [ { "toolCallId": "<id>", "result": <string|object> } ] }
 *
 * Auth: if VAPI_SECRET is set, requests must include header `x-vapi-secret: <VAPI_SECRET>`
 * (configure this as a custom header / secret on the Vapi tool). If unset, auth is skipped
 * (fine for local testing; set it before exposing publicly).
 *
 * Endpoints (point your Vapi tools at any of these — they all dispatch by tool name):
 *   POST /vapi/tools                 (recommended: one URL for both tools)
 *   POST /vapi/check-availability    (defaults to check_availability if name missing)
 *   POST /vapi/book-appointment      (defaults to book_appointment if name missing)
 *   GET  /health
 */

// Pin to salon-local time before anything parses dates (override any host-set TZ).
process.env.TZ = process.env.SALON_TZ || 'Pacific/Honolulu';

const express = require('express');
const {
  checkAvailability,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  addAppointmentNote,
  findEarliestAvailability,
  getServiceInfo,
  resolveServicePhrase,
  lookupAppointment,
  takeMessage,
} = require('./hukilau-booking');
const { getSalonData, prefetchAppointments, PAGE_URL } = require('./src/salonClient');
const { alertOps, opsConfigured } = require('./src/opsAlert');
const { buildCallReviewAlert, callEndedBadly, durationLabel, callIdOf } = require('./src/callReview');
const opsLog = require('./src/opsLog');
const { renderOpsPage } = require('./src/opsPage');
const callArchive = require('./src/callArchive');

const PORT = process.env.PORT || 8787;
const VAPI_SECRET = process.env.VAPI_SECRET || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const OPS_KEY = process.env.OPS_KEY || '';

const TOOLS = {
  check_availability: checkAvailability,
  book_appointment: bookAppointment,
  cancel_appointment: cancelAppointment,
  reschedule_appointment: rescheduleAppointment,
  // Attach a note to a just-made booking WITHOUT re-booking (fixes the "note made the slot disappear"
  // bug: re-running book_appointment collided with the new booking's own hold).
  add_appointment_note: addAppointmentNote,
  find_earliest_availability: findEarliestAvailability,
  get_service_info: getServiceInfo,
  // Read-only: find the caller's own upcoming appointment by phone, so reschedule/cancel don't make
  // them recite details. Privacy-guarded (matches only the caller's number; never speaks a name).
  lookup_appointment: lookupAppointment,
  // Relay a general message to the salon (not tied to a booking) — so "I'll pass it along" is real,
  // captured + owner-notified, never a hallucinated promise.
  take_message: takeMessage,
  resolve_service: resolveServicePhrase,
  // Same handler — a dedicated tool whose schema makes `among` REQUIRED, so the model can't drop it
  // when answering a "did you mean …?" question (an optional param it kept omitting on fragments).
  resolve_service_among: resolveServicePhrase,
};

const app = express();
// Tool calls stay hard-capped at 128kb, but end-of-call reports legitimately carry a full
// transcript + message history and can exceed it — a 413 there would silently lose the call's
// alert AND its archive row. Exactly one parser runs per request.
const jsonSmall = express.json({ limit: '128kb' });
const jsonLarge = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/vapi/events' ? jsonLarge : jsonSmall)(req, res, next));

function checkSecret(req, res) {
  if (!VAPI_SECRET) return true; // auth disabled
  if (req.get('x-vapi-secret') === VAPI_SECRET) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}

// Normalize Vapi's payload into [{ id, name, args }], tolerating both request shapes.
function extractToolCalls(body) {
  const msg = (body && body.message) || {};
  const list = msg.toolCallList || msg.toolCalls || body.toolCallList || body.toolCalls || [];
  return list.map((c) => {
    const name = c.name || (c.function && c.function.name);
    let args = c.arguments != null ? c.arguments : c.function && c.function.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch (_) {
        args = {};
      }
    }
    return { id: c.id || c.toolCallId, name, args: args || {} };
  });
}

// Vapi includes the inbound caller's number in the call metadata. Pull it so capture/lookup tools
// can DEFAULT `phone` to the caller's own number when the model doesn't pass one. A caller booking
// for someone else still overrides it by stating a different number (we only fill when it's missing).
// Checks the known Vapi payload shapes; returns null if none carry a number.
function extractCallerNumber(body) {
  const msg = (body && body.message) || {};
  const candidates = [
    msg.call && msg.call.customer && msg.call.customer.number,
    msg.customer && msg.customer.number,
    body && body.call && body.call.customer && body.call.customer.number,
    msg.call && msg.call.customerNumber,
  ];
  const n = candidates.find((x) => x && /\d{7,}/.test(String(x)));
  return n ? String(n) : null;
}

// A 555-exchange number is fiction / directory-assistance — never a real customer. Weaker models
// sometimes read back or pass the "808-555-1234" example from the prompt instead of the real caller.
// Anything with fewer than 10 digits is equally undialable — "XXX-XXX-XXXX" (live incident
// 2026-07-10: a cancellation reached the salon with a literal X placeholder), "N/A", truncated
// numbers — so treat those as fake too and let the caller-ID default take over.
function looksFakePhone(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
  return d.length < 10 || d.slice(3, 6) === '555';
}

// Always return a plain SPEAKABLE STRING to Vapi. Some Vapi versions reject object results with
// "No result returned", and owner delivery now happens out-of-band via SMS (Telnyx) — so Vapi
// only needs the line for the assistant to say.
function toResult(toolName, out) {
  return out.message;
}

// Mask a phone number to its last 4 digits for logs.
function maskPhone(args) {
  if (!args || typeof args !== 'object' || !args.phone) return args;
  return { ...args, phone: String(args.phone).replace(/.(?=.{4})/g, '*') };
}

async function handleToolRequest(req, res, defaultTool) {
  if (!checkSecret(req, res)) return;
  const callId = req.body && req.body.message && req.body.message.call && req.body.message.call.id;
  const callerNumber = extractCallerNumber(req.body);
  // Cap fan-out: one request can carry many tool calls, each of which may fire Pushover/Telnyx/
  // Notion. Process at most the first 10 so a crafted request can't amplify into thousands of sends.
  const calls = extractToolCalls(req.body).slice(0, 10);

  if (!calls.length && defaultTool) {
    // Allow a bare {date,service,stylist} body for easy manual testing of a route.
    calls.push({ id: 'manual', name: defaultTool, args: req.body || {} });
  }
  if (!calls.length) {
    console.log(JSON.stringify({ evt: 'tool_call', callId, warn: 'no tool calls parsed', bodyKeys: Object.keys(req.body || {}) }));
  }

  const results = [];
  const errored = [];
  for (const call of calls) {
    const toolName = call.name || defaultTool;
    const fn = TOOLS[toolName];
    // Default the phone to the caller's own number when the model passed NONE, or passed an obviously
    // FAKE/INVALID one — a 555 number ("808-555-1234" prompt example) or under 10 digits
    // ("XXX-XXX-XXXX"). A caller giving a real different number still overrides. Keeps
    // callbacks/lookups on the real caller ID.
    if (callerNumber && call.args) {
      const passed = call.args.phone || call.args.customerPhone || call.args.number;
      if (!passed || looksFakePhone(passed)) call.args.phone = callerNumber;
    }
    try {
      if (!fn) throw new Error(`unknown tool: ${toolName}`);
      const out = await fn(call.args);
      const result = toResult(toolName, out);
      results.push({ toolCallId: call.id, result });
      console.log(
        JSON.stringify({
          evt: 'tool_call',
          callId,
          toolCallId: call.id,
          tool: toolName,
          ok: out.ok,
          error: out.error || null,
          callerId: callerNumber ? 'present' : 'absent',
          delivery: out.data && out.data.delivery ? out.data.delivery : undefined,
          args: maskPhone(call.args),
          resultPreview: String(result).slice(0, 180),
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: 'tool_error',
          callId,
          toolCallId: call.id,
          tool: toolName,
          error: err.message,
          stack: (err.stack || '').split('\n').slice(0, 3),
        })
      );
      errored.push({ tool: toolName, error: err.message });
      opsLog.logEvent('tool_error', { tool: toolName, error: String(err.message).slice(0, 200), callId }).catch(() => {});
      results.push({
        toolCallId: call.id,
        result: "Sorry, I hit a snag just now — could you try again in a moment? I can also have the salon follow up with you.",
      });
    }
  }
  if (errored.length) {
    // A tool crashed mid-call — the caller got an apology, but the operator should hear about it now.
    // Awaited so the push actually goes out on serverless; only runs on the (rare) error path.
    try {
      const lines = errored.map((e) => `• ${e.tool}: ${e.error}`).join('\n');
      await alertOps(
        '⚠️ Hukilau tool error',
        `${errored.length} tool call(s) errored on a live call${callId ? ` (call ${callId})` : ''}:\n${lines}`,
        { level: 'high' }
      );
    } catch (_) {
      /* ops alerting must never break the tool path */
    }
  }
  res.json({ results });
}

app.post('/vapi/tools', (req, res) => handleToolRequest(req, res, null));
app.post('/vapi/check-availability', (req, res) => handleToolRequest(req, res, 'check_availability'));
app.post('/vapi/book-appointment', (req, res) => handleToolRequest(req, res, 'book_appointment'));
app.post('/vapi/cancel-appointment', (req, res) => handleToolRequest(req, res, 'cancel_appointment'));
app.post('/vapi/reschedule-appointment', (req, res) => handleToolRequest(req, res, 'reschedule_appointment'));
app.post('/vapi/add-note', (req, res) => handleToolRequest(req, res, 'add_appointment_note'));
app.post('/vapi/find-earliest', (req, res) => handleToolRequest(req, res, 'find_earliest_availability'));
app.post('/vapi/service-info', (req, res) => handleToolRequest(req, res, 'get_service_info'));
app.post('/vapi/resolve-service', (req, res) => handleToolRequest(req, res, 'resolve_service'));
app.post('/vapi/lookup-appointment', (req, res) => handleToolRequest(req, res, 'lookup_appointment'));
app.post('/vapi/take-message', (req, res) => handleToolRequest(req, res, 'take_message'));

// Warm the caches (salon config + today..+2 days of appointments) to avoid cold-start lag.
// Hit by the Vercel keep-warm cron; also usable as a manual ping. Authenticated: it force-pulls the
// salon backend, so require the Vapi secret OR the cron secret (when CRON_SECRET is set). If no
// secret is configured, checkSecret bypasses — behavior is unchanged until secrets are set.
app.get('/warm', async (req, res) => {
  const cronOk = !!CRON_SECRET && req.get('x-cron-secret') === CRON_SECRET;
  if (!cronOk && !checkSecret(req, res)) return;
  try {
    await getSalonData();
    const warmed = await prefetchAppointments();
    res.json({ ok: true, ...warmed });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

// Vapi call events. When a call connects, prefetch the next few days so the first availability
// lookup is instant. Responds 200 immediately; the prefetch runs fire-and-forget.
app.post('/vapi/events', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const msg = (req.body && req.body.message) || {};
  if (msg.type === 'status-update' && (msg.status === 'in-progress' || msg.status === 'started')) {
    // Await so the warm completes reliably on serverless (post-response work can be frozen).
    // This webhook is off the conversation's critical path — Vapi doesn't gate the call on it.
    try {
      await prefetchAppointments();
    } catch (_) {
      /* best effort */
    }
  } else if (msg.type === 'end-of-call-report') {
    // Vapi posts this after every call. Log EVERY call for /ops and the daily digest, then page
    // the operator ONLY if the call ended abnormally (error / dead-air / max-duration / rated
    // unsuccessful); normal hang-ups stay silent.
    try {
      const verdict = callEndedBadly(msg);
      const summary = (msg.analysis && msg.analysis.summary) || msg.summary || '';
      await opsLog.logEvent('call', {
        callId: callIdOf(msg),
        reason: String(msg.endedReason || ''),
        bad: verdict.bad,
        why: verdict.why,
        dur: durationLabel(msg),
        summary: String(summary).slice(0, 240),
      });
      const alert = buildCallReviewAlert(msg);
      if (alert) await alertOps(alert.title, alert.message, alert.opts);
      // Permanent archive (Notion Call Log) — Vapi purges call data in days; this copy is forever.
      await callArchive.archiveCall(msg);
    } catch (_) {
      /* best effort — never fail the webhook over an alert */
    }
  }
  res.json({ ok: true });
});

// ---------- operator status page + daily digest ----------

// /ops requires OPS_KEY only when one is configured; without it the page is open (owner's
// explicit posture — same as the webhook) and shows a hint to set one. Call summaries appear on
// this page, so setting OPS_KEY is recommended.
function opsKeyOk(req) {
  if (!OPS_KEY) return true;
  return req.query.key === OPS_KEY || req.get('x-ops-key') === OPS_KEY;
}

// Honest reachability probe: hits the salon's real booking page and times it. getSalonData()
// can't be used here — its snapshot fallback would report "ok" while the salon site is down.
// Bounded so a dead site can't hang the ops page.
async function probeSalonSite() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  const started = Date.now();
  try {
    const res = await fetch(PAGE_URL, { signal: ctrl.signal, headers: { 'User-Agent': 'hukilau-ops-probe' } });
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout (6s)' : e.message, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/ops', async (req, res) => {
  if (!opsKeyOk(req)) return res.status(401).send('unauthorized — append ?key=YOUR_OPS_KEY');
  const [probe, events] = await Promise.all([probeSalonSite(), opsLog.recentEvents(80)]);
  const html = renderOpsPage({
    sha: process.env.VERCEL_GIT_COMMIT_SHA || '',
    now: Date.now(),
    health: {
      authEnabled: !!VAPI_SECRET,
      holdsStore: require('./src/pendingHolds').isConfigured(),
      notifyConfigured: require('./src/notify').MODE !== 'return',
      opsConfigured: opsConfigured(),
      opsLog: opsLog.isConfigured(),
      archive: callArchive.isConfigured(),
    },
    probe,
    today: opsLog.computeDigest(events, opsLog.todayHst()),
    events,
    opsKeySet: !!OPS_KEY,
    digestHref: `/ops/digest?dry=1&day=today${OPS_KEY ? `&key=${encodeURIComponent(OPS_KEY)}` : ''}`,
  });
  res.type('html').send(html);
});

// Daily digest for one HST day — default yesterday (the 7 AM HST cron summarizes the prior day);
// ?day=today for a mid-day check; ?dry=1 returns the text without pushing. Auth: OPS_KEY or
// CRON_SECRET when configured (Vercel's cron sends `Authorization: Bearer $CRON_SECRET`
// automatically once that env var exists); open when neither is set. NOTE: if you set OPS_KEY,
// set CRON_SECRET too or the scheduled digest will start 401ing.
app.get('/ops/digest', async (req, res) => {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const cronOk = !!CRON_SECRET && (req.get('x-cron-secret') === CRON_SECRET || bearer === CRON_SECRET);
  const open = !OPS_KEY && !CRON_SECRET;
  if (!open && !cronOk && !opsKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const dayIso = req.query.day === 'today' ? opsLog.todayHst() : opsLog.yesterdayHst();
  const [events, probe] = await Promise.all([opsLog.recentEvents(opsLog.OPS_MAX), probeSalonSite()]);
  const digest = opsLog.computeDigest(events, dayIso);
  const holdsOk = require('./src/pendingHolds').isConfigured();
  const ownerOk = require('./src/notify').MODE !== 'return';
  const statusLine = `Server ✅ · Salon site ${probe.ok ? `✅ ${probe.ms}ms` : '❌ DOWN'} · Holds ${holdsOk ? '✅' : '—'} · Owner alerts ${ownerOk ? '✅' : '❌'}`;
  const { title, body } = opsLog.formatDigest(digest, dayIso, { statusLine });
  if (req.query.dry) return res.type('text/plain').send(`${title}\n${body}`);
  const sent = await alertOps(title, body, { level: 'normal', url: 'https://hukilau-salon.vercel.app/ops', urlTitle: 'Open ops page' });
  res.json({ ok: true, delivered: sent.delivered, day: dayIso });
});

// Preview any owner notification on the OPERATOR's phone (PUSHOVER_DEV_USER) WITHOUT alerting the
// salon group — so you can see exactly what a booking/cancel/reschedule/note/message alert looks
// like. Sample data only. GET /ops/preview?action=cancel|reschedule|book|note|message
const PREVIEW_TITLES = {
  book: '📅 New booking request',
  cancel: '❌ Cancellation request',
  reschedule: '🔁 Reschedule request',
  note: '📝 Note for a booking',
  message: '📩 New message for the salon',
};
function sampleNotification(action) {
  const customer = { firstName: 'Sample', lastName: 'Preview', phone: '8085550123' };
  if (action === 'cancel')
    return { action: 'cancel', customer, service: "Men's Haircut", stylist: 'Patricia', when: 'Thursday, July 10 at 3:00 PM', reason: 'Preview only — no action needed.' };
  if (action === 'reschedule')
    return { action: 'reschedule', customer, service: "Women's Cut", stylist: 'Amanda', fromWhen: 'Monday, July 7 at 10:00 AM', when: 'Friday, July 11 at 1:00 PM', note: 'Preview only — no action needed.' };
  if (action === 'note')
    return { action: 'note', customer, service: "Women's Cut", stylist: 'Amanda', when: 'Tuesday, July 14 at 2:00 PM', note: 'Please use the quiet room. (Preview only — no action needed.)' };
  if (action === 'message')
    return { action: 'message', customer, forWho: 'Trish', note: 'Please call me back about my color. (Preview only — no action needed.)' };
  return { action: 'book', customer, service: "Women's Cut & Style", stylist: 'Amanda', when: 'Tuesday, July 14 at 2:00 PM', note: 'Preview only — no action needed.' };
}
app.get('/ops/preview', async (req, res) => {
  if (!opsKeyOk(req)) return res.status(401).json({ error: 'unauthorized — append ?key=YOUR_OPS_KEY' });
  const { formatOwnerMessage } = require('./src/notify');
  const action = String(req.query.action || 'book').toLowerCase();
  const sample = sampleNotification(action);
  const title = `[DEMO] ${PREVIEW_TITLES[action] || PREVIEW_TITLES.book}`;
  const body = formatOwnerMessage(sample, { header: false });
  const sent = await alertOps(title, body, { level: 'normal' });
  res.json({ ok: true, action, sentToOperatorPhone: sent.delivered, detail: sent.detail, title, body });
});

app.get('/', (req, res) => res.json({ ok: true, service: 'hukilau-receptionist' }));
app.get('/health', (req, res) => {
  // Don't enumerate the notify channels here (e.g. "notion+pushover+telnyx") — that's recon for
  // which paid channels to abuse. A boolean is enough for the owner to verify setup. MODE is
  // 'return' only when NO owner channel is configured, so any real channel makes this true.
  const notifyConfigured = require('./src/notify').MODE !== 'return';
  res.json({
    ok: true,
    tz: process.env.TZ,
    authEnabled: !!VAPI_SECRET,
    holdsStore: require('./src/pendingHolds').isConfigured(),
    notifyConfigured,
    callArchive: callArchive.isConfigured(),
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`hukilau-receptionist listening on :${PORT} (tz=${process.env.TZ}, auth=${VAPI_SECRET ? 'on' : 'off'})`);
  });
}

module.exports = { app, extractToolCalls, toResult, extractCallerNumber, looksFakePhone };
