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
  findEarliestAvailability,
} = require('./hukilau-booking');
const { getSalonData, prefetchAppointments } = require('./src/salonClient');

const PORT = process.env.PORT || 8787;
const VAPI_SECRET = process.env.VAPI_SECRET || '';

const TOOLS = {
  check_availability: checkAvailability,
  book_appointment: bookAppointment,
  cancel_appointment: cancelAppointment,
  reschedule_appointment: rescheduleAppointment,
  find_earliest_availability: findEarliestAvailability,
};

const app = express();
app.use(express.json({ limit: '1mb' }));

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

// Capture tools hand the structured request back to Vapi (under its natural key) so a workflow
// can deliver it to the owner; everything else returns the spoken string.
const CAPTURE_KEYS = {
  book_appointment: 'booking',
  cancel_appointment: 'cancellation',
  reschedule_appointment: 'reschedule',
};

function toResult(toolName, out) {
  const key = CAPTURE_KEYS[toolName];
  if (key && out.ok) {
    return { message: out.message, ownerMessage: out.data.ownerMessage, [key]: out.data[key] };
  }
  return out.message; // spoken string (availability, or any error/clarification)
}

async function handleToolRequest(req, res, defaultTool) {
  if (!checkSecret(req, res)) return;
  const calls = extractToolCalls(req.body);

  if (!calls.length && defaultTool) {
    // Allow a bare {date,service,stylist} body for easy manual testing of a route.
    calls.push({ id: 'manual', name: defaultTool, args: req.body || {} });
  }

  const results = [];
  for (const call of calls) {
    const toolName = call.name || defaultTool;
    const fn = TOOLS[toolName];
    try {
      if (!fn) throw new Error(`unknown tool: ${toolName}`);
      const out = await fn(call.args);
      results.push({ toolCallId: call.id, result: toResult(toolName, out) });
    } catch (err) {
      console.error(`[tool ${toolName}] error:`, err.message);
      results.push({
        toolCallId: call.id,
        result: "Sorry, I hit a problem checking that just now. Could you try again in a moment?",
      });
    }
  }
  res.json({ results });
}

app.post('/vapi/tools', (req, res) => handleToolRequest(req, res, null));
app.post('/vapi/check-availability', (req, res) => handleToolRequest(req, res, 'check_availability'));
app.post('/vapi/book-appointment', (req, res) => handleToolRequest(req, res, 'book_appointment'));
app.post('/vapi/cancel-appointment', (req, res) => handleToolRequest(req, res, 'cancel_appointment'));
app.post('/vapi/reschedule-appointment', (req, res) => handleToolRequest(req, res, 'reschedule_appointment'));
app.post('/vapi/find-earliest', (req, res) => handleToolRequest(req, res, 'find_earliest_availability'));

// Warm the caches (salon config + today..+2 days of appointments) to avoid cold-start lag.
// Hit by the Vercel keep-warm cron; also usable as a manual ping.
app.get('/warm', async (req, res) => {
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
  }
  res.json({ ok: true });
});

app.get('/health', (req, res) =>
  res.json({
    ok: true,
    tz: process.env.TZ,
    authEnabled: !!VAPI_SECRET,
    holdsStore: require('./src/pendingHolds').isConfigured(),
  })
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`hukilau-receptionist listening on :${PORT} (tz=${process.env.TZ}, auth=${VAPI_SECRET ? 'on' : 'off'})`);
  });
}

module.exports = { app, extractToolCalls, toResult };
