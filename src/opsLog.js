'use strict';

/**
 * opsLog.js — rolling operational event log in Upstash Redis, powering GET /ops and the daily
 * digest. Serverless has no memory between requests, so "the last 20 calls" must live in the
 * same durable store the pending-holds overlay already uses (auto-detected Upstash REST creds).
 *
 * Events are small JSON blobs LPUSHed to one list, trimmed to the newest OPS_MAX, expiring after
 * OPS_RETENTION_DAYS of total inactivity. Types:
 *   call       — one per end-of-call report: { callId, reason, bad, why, dur, summary }
 *   capture    — a booking/cancel/reschedule/note reached (or failed) the owner: { action, delivered, service, when }
 *   tool_error — a tool crashed mid-call: { tool, error, callId }
 *   owner_fail — every owner channel failed for a capture: { action, channels }
 *
 * PRIVACY: capture events NEVER include the customer's name or phone — the owner's channels carry
 * the handoff; this log only needs shape and outcome. Call summaries (Vapi's own recap of the
 * conversation) are capped and shown on the keyed /ops page only.
 *
 * Every function is best-effort: if Redis is missing or slow the caller's path is never broken.
 */

const OPS_KEY_LIST = 'ops:events';
const OPS_MAX = 400;
const OPS_RETENTION_SEC = 14 * 24 * 3600;
const SALON_TZ = () => process.env.SALON_TZ || 'Pacific/Honolulu';

let client;
let initialized = false;

function getClient() {
  if (initialized) return client;
  initialized = true;
  client = null;
  const env = process.env;
  const pick = (re) => {
    const key = Object.keys(env).find((k) => re.test(k) && env[k]);
    return key ? env[key] : undefined;
  };
  // Same auto-detect as pendingHolds: match the Upstash/Vercel-Marketplace REST vars any prefix.
  const url =
    env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || pick(/REST_API_URL$/i) || pick(/REDIS_REST_URL$/i);
  const token =
    env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || pick(/REST_API_TOKEN$/i) || pick(/REDIS_REST_TOKEN$/i);
  if (!url || !token) return null;
  try {
    const { Redis } = require('@upstash/redis');
    client = new Redis({ url, token });
  } catch (_) {
    client = null;
  }
  return client;
}

function isConfigured() {
  return !!getClient();
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/** Append one event. Never throws; returns whether the write happened. */
async function logEvent(type, data) {
  const c = getClient();
  if (!c || !type) return false;
  try {
    const entry = JSON.stringify({ t: type, at: Date.now(), ...(data || {}) });
    await c.lpush(OPS_KEY_LIST, entry);
    await c.ltrim(OPS_KEY_LIST, 0, OPS_MAX - 1);
    await c.expire(OPS_KEY_LIST, OPS_RETENTION_SEC);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * True the FIRST time `key` is seen within ttlSec (Redis SET NX EX) — used to dedupe webhook
 * retries. Fail-open: returns true when Redis is unconfigured or erroring, because the callers
 * prefer a rare duplicate over silently dropping work.
 */
async function onceOnly(key, ttlSec) {
  const c = getClient();
  if (!c || !key) return true;
  try {
    const r = await c.set(key, '1', { nx: true, ex: ttlSec });
    return r === 'OK' || r === true;
  } catch (_) {
    return true;
  }
}

/** Newest-first events, parsed. Empty array when unconfigured or on any error. */
async function recentEvents(limit = 100) {
  const c = getClient();
  if (!c) return [];
  try {
    const items = await c.lrange(OPS_KEY_LIST, 0, Math.max(0, limit - 1));
    return (items || [])
      .map((x) => (typeof x === 'string' ? safeParse(x) : x))
      .filter((e) => e && e.t && e.at);
  } catch (_) {
    return [];
  }
}

/** Salon-local calendar day ("YYYY-MM-DD") of a ms timestamp. Hawaii has no DST. */
function hstDayOf(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: SALON_TZ() });
}

function todayHst() {
  return hstDayOf(Date.now());
}

function yesterdayHst() {
  return hstDayOf(Date.now() - 24 * 3600 * 1000);
}

/**
 * Pure: fold events down to one HST calendar day's counts.
 * @returns {{calls:number,badCalls:number,captures:number,byAction:object,captureFails:number,toolErrors:number,ownerFails:number}}
 */
function computeDigest(events, dayIso) {
  const d = { calls: 0, badCalls: 0, captures: 0, byAction: {}, captureFails: 0, toolErrors: 0, ownerFails: 0 };
  for (const e of events || []) {
    if (!e || hstDayOf(e.at) !== dayIso) continue;
    if (e.t === 'call') {
      d.calls += 1;
      if (e.bad) d.badCalls += 1;
    } else if (e.t === 'capture') {
      d.captures += 1;
      const a = e.action || 'book';
      d.byAction[a] = (d.byAction[a] || 0) + 1;
      if (!e.delivered) d.captureFails += 1;
    } else if (e.t === 'tool_error') {
      d.toolErrors += 1;
    } else if (e.t === 'owner_fail') {
      d.ownerFails += 1;
    }
  }
  return d;
}

/** Pure: the digest push body. `extra.statusLine` appends live health (built by the caller). */
function formatDigest(digest, dayIso, extra = {}) {
  const label = new Date(`${dayIso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const actions = Object.entries(digest.byAction)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  const lines = [
    `📞 ${digest.calls} call${digest.calls === 1 ? '' : 's'}${digest.badCalls ? ` (${digest.badCalls} flagged)` : digest.calls ? ' (none flagged)' : ''}`,
    `📅 ${digest.captures} capture${digest.captures === 1 ? '' : 's'}${actions ? ` — ${actions}` : ''}${
      digest.captureFails ? ` — ⚠️ ${digest.captureFails} did NOT reach the owner` : digest.captures ? ' — all reached the owner' : ''
    }`,
    digest.toolErrors ? `⚠️ ${digest.toolErrors} tool error${digest.toolErrors === 1 ? '' : 's'}` : '✅ 0 tool errors',
    digest.ownerFails ? `🚨 ${digest.ownerFails} owner-alert failure${digest.ownerFails === 1 ? '' : 's'}` : null,
    extra.statusLine || null,
  ].filter(Boolean);
  return { title: `Hukilau daily digest — ${label}`, body: lines.join('\n') };
}

module.exports = {
  logEvent,
  recentEvents,
  onceOnly,
  isConfigured,
  hstDayOf,
  todayHst,
  yesterdayHst,
  computeDigest,
  formatDigest,
  OPS_MAX,
};
