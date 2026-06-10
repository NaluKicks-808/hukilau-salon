'use strict';

/**
 * Pending-hold overlay — closes the gap between "the AI captured a booking" and "the owner
 * entered it into Salon Scheduler."
 *
 * Every slot the AI books/reschedules is recorded in Upstash Redis. Availability then subtracts
 * these holds for the NEXT caller, so the same slot can't be offered twice during that window.
 *
 * Safety properties:
 *  - Holds only ADD blocks; they never free a slot. So a hold can never hide real availability —
 *    worst case it keeps a genuinely-taken slot blocked (correct).
 *  - Each hold auto-expires (~36h). By then the owner has entered it and the salon's own calendar
 *    blocks the slot, so we hand blocking back to the source of truth.
 *  - If Redis isn't configured (e.g., local dev), every call is a graceful no-op.
 */

const HOLD_TTL_SEC = Number(process.env.HOLD_TTL_SECONDS) || 36 * 3600;
const HOLD_TTL_MS = HOLD_TTL_SEC * 1000;

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
  // Auto-detect the Upstash REST credentials regardless of the integration's env-var prefix
  // (e.g. UPSTASH_REDIS_REST_URL, KV_REST_API_URL, or <prefix>_KV_REST_API_URL).
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

const dayKey = (dateIso) => `holds:${dateIso}`;

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/** Record a hold for an appointment slot. dateIso = "YYYY-MM-DD" (salon tz). Best-effort. */
async function addHold({ dateIso, stylistIndex, startMinutes, durationMinutes, meta }) {
  const c = getClient();
  if (!c || !dateIso || stylistIndex == null || startMinutes == null) return false;
  const entry = JSON.stringify({
    stylistIndex,
    startMinutes,
    durationMinutes: durationMinutes || 60,
    at: Date.now(),
    meta: meta || null,
  });
  try {
    const key = dayKey(dateIso);
    await c.rpush(key, entry);
    await c.expire(key, HOLD_TTL_SEC);
    return true;
  } catch (_) {
    return false;
  }
}

/** Get non-expired holds for a date as [{stylistIndex, startMinutes, durationMinutes}]. */
async function getHolds(dateIso) {
  const c = getClient();
  if (!c || !dateIso) return [];
  try {
    const items = await c.lrange(dayKey(dateIso), 0, -1);
    const now = Date.now();
    return (items || [])
      .map((x) => (typeof x === 'string' ? safeParse(x) : x))
      .filter((h) => h && now - (h.at || 0) < HOLD_TTL_MS);
  } catch (_) {
    return [];
  }
}

module.exports = { addHold, getHolds, isConfigured, HOLD_TTL_SEC };
