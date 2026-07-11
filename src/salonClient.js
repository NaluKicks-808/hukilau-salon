'use strict';

/**
 * salonClient — talks to the live Salon Scheduler (AppHeaven) backend.
 *
 *  1. getSalonData()           -> fetches the booking page and extracts the embedded
 *                                 jsonMerchant / employeeJSON / serviceJSON config.
 *  2. getBookedAppointments()  -> POSTs getappt.php and parses the "||"-delimited JSON,
 *                                 exactly mirroring cbbe2.js `getappointments()`.
 *
 * The page embeds its data as minified `employeeJSON.push(JSON.parse('...'))` /
 * `serviceJSON.push(JSON.parse('...'))` / `var jsonMerchant = JSON.parse('...')`
 * statements. Rather than regex that (fragile with escaped quotes), we run the page's
 * inline data <script> blocks inside a Node `vm` sandbox and read the populated globals
 * back out — the JS engine handles all the escaping for us.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const MERCHANT_ID = process.env.MERCHANT_ID || 'SVEVNSQKF87J1';
const PAGE_URL = `https://reports.appheaven.us/online/tcbbe.php?merchantid=${MERCHANT_ID}&force=1`;
const APPT_URL = 'https://reports.appheaven.us/online/getappt.php';
const SNAPSHOT = path.join(__dirname, '..', 'vendor', 'page.snapshot.html');
const TTL_MS = 6 * 60 * 60 * 1000; // re-fetch salon config at most every 6h

// Hard timeout on every salon-backend fetch so a stalled backend can never hang a live phone
// call (Vercel would otherwise let it run to the 30s function max — dead air for the caller).
const FETCH_TIMEOUT_MS = Number(process.env.SALON_FETCH_TIMEOUT_MS) || 9000;
async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

let cache = null; // { fetchedAt, data }

function extractPageData(html) {
  const sandbox = {
    JSON,
    console: { log() {}, error() {}, warn() {} },
    // Minimal DOM/window stubs so the jQuery-fallback inline script doesn't throw.
    document: {
      write() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    window: {},
    // Predeclare the arrays the page pushes into, in case a push runs in a
    // different <script> block than the `var` declaration.
    holidays: [],
    employeeJSON: [],
    serviceJSON: [],
    serviceCat: [],
    apptJSON: [],
  };
  vm.createContext(sandbox);

  const scriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const code = match[1];
    if (!/employeeJSON|serviceJSON|jsonMerchant|merchantId/.test(code)) continue;
    try {
      vm.runInContext(code, sandbox, { timeout: 5000 });
    } catch (_) {
      // Inline data scripts can contain trailing DOM logic that throws under our stubs;
      // the data assignments run before that, so we ignore the error and read what stuck.
    }
  }

  if (!sandbox.jsonMerchant || !sandbox.employeeJSON.length || !sandbox.serviceJSON.length) {
    throw new Error(
      'Failed to extract salon data from the booking page — the page structure may have changed. ' +
        'Re-snapshot vendor/page.snapshot.html and review the extractor.'
    );
  }

  return {
    merchantId: sandbox.merchantId || MERCHANT_ID,
    jsonMerchant: sandbox.jsonMerchant,
    employeeJSON: sandbox.employeeJSON,
    serviceJSON: sandbox.serviceJSON,
    prepay: typeof sandbox.prepay !== 'undefined' ? sandbox.prepay : null,
    monthsx: typeof sandbox.monthsx !== 'undefined' ? sandbox.monthsx : 3,
    advance: typeof sandbox.advance !== 'undefined' ? sandbox.advance : 0,
  };
}

async function fetchPageHtml() {
  const res = await fetchWithTimeout(PAGE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (hukilau-receptionist availability bot)' },
  });
  if (!res.ok) throw new Error(`Booking page fetch failed: HTTP ${res.status}`);
  return res.text();
}

/**
 * Returns the salon's static config { merchantId, jsonMerchant, employeeJSON, serviceJSON,
 * prepay, monthsx, advance }, cached for TTL_MS. Falls back to the vendored snapshot if the
 * live site is briefly unreachable.
 */
async function getSalonData({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data;
  let html;
  let fromSnapshot = false;
  try {
    html = await fetchPageHtml();
  } catch (err) {
    if (fs.existsSync(SNAPSHOT)) {
      html = fs.readFileSync(SNAPSHOT, 'utf8');
      fromSnapshot = true;
    } else {
      throw err;
    }
  }
  let data;
  try {
    data = extractPageData(html);
  } catch (err) {
    // 2026-07 longevity audit #1: a REDESIGNED page fetches fine (HTTP 200) but fails extraction —
    // that used to hard-down every booking tool with no fallback. Now we limp on the vendored
    // snapshot (last-known-good config) and page the operator, instead of failing every call.
    if (!fromSnapshot && fs.existsSync(SNAPSHOT)) {
      console.error(JSON.stringify({ evt: 'salon_extract_fallback', error: String(err.message).slice(0, 200) }));
      try {
        const { alertOps } = require('./opsAlert');
        const { onceOnly } = require('./opsLog');
        if (await onceOnly('ops:extract-fallback', 6 * 3600)) {
          await alertOps(
            '⚠️ Hukilau: salon page structure changed',
            'Live booking page fetched OK but data extraction FAILED — running on the vendored snapshot (stale config). Re-snapshot vendor/page.snapshot.html and review the extractor soon.',
            { level: 'high' }
          );
        }
      } catch (_) {
        /* alerting must never break the fallback itself */
      }
      data = extractPageData(fs.readFileSync(SNAPSHOT, 'utf8'));
    } else {
      throw err;
    }
  }
  // Longevity audit #2: the stylist roster is hardcoded by index elsewhere — a staff change at the
  // salon used to be COMPLETELY silent. Alert once a day when the live count drifts from expected.
  const expected = Number(process.env.EXPECTED_STYLISTS) || 4;
  if (Array.isArray(data.employeeJSON) && data.employeeJSON.length !== expected) {
    try {
      const { alertOps } = require('./opsAlert');
      const { onceOnly } = require('./opsLog');
      if (await onceOnly(`ops:roster:${data.employeeJSON.length}`, 24 * 3600)) {
        await alertOps(
          '⚠️ Hukilau: stylist roster changed',
          `The salon's site now lists ${data.employeeJSON.length} stylists (expected ${expected}). The index→name map in src/stylists.js may be wrong — verify before bookings go to the wrong stylist. Run: npm run audit`,
          { level: 'high' }
        );
      }
    } catch (_) {
      /* best-effort */
    }
  }
  cache = { fetchedAt: Date.now(), data };
  return data;
}

// Short-lived cache of booked-appointment pulls. Keeps repeated lookups within one call
// instant without risking staleness: a ~45s window is fresh enough that the owner-confirmation
// step remains the real dedupe. We never write to the salon, so our captures don't change it.
const APPT_CACHE_TTL_MS = Number(process.env.APPT_CACHE_TTL_MS) || 45000;
const apptCache = new Map(); // `${startMs}:${numDays}` -> { fetchedAt, appts }

/**
 * POST getappt.php and parse the response into an array of appointment objects.
 * Mirrors cbbe2.js `getappointments(startdateSecs, numdays)` (start/end are unix ms).
 * Cached for APPT_CACHE_TTL_MS; pass { force: true } to bypass.
 */
async function getBookedAppointments(startMs, numDays, { force = false } = {}) {
  const key = `${startMs}:${numDays}`;
  if (!force) {
    const hit = apptCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < APPT_CACHE_TTL_MS) return hit.appts;
  }

  const body = new URLSearchParams({
    start: String(startMs),
    end: String(startMs + 86400000 * numDays),
    merchantid: MERCHANT_ID,
  });
  const res = await fetchWithTimeout(APPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`getappt.php failed: HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim() === 'ERROR') throw new Error('getappt.php returned ERROR');

  const appts = [];
  for (const chunk of text.split('||')) {
    if (!chunk.length) continue;
    let raw = chunk;
    if (MERCHANT_ID === 'B29AMCHM83W6G') raw = raw.replace(/\\/g, '\\\\'); // mirrors cbbe2 quirk
    try {
      appts.push(JSON.parse(raw));
    } catch (_) {
      // Skip malformed chunks; the browser client is similarly lenient.
    }
  }
  apptCache.set(key, { fetchedAt: Date.now(), appts });
  return appts;
}

/**
 * Warm the cache for today..+daysAhead (salon tz) with fresh pulls, so the first real lookup
 * during a call is instant. Each day is a 1-day window, matching getAvailability's call shape.
 */
async function prefetchAppointments(daysAhead = 14, tz) {
  const moment = require('moment-timezone'); // local require avoids load-order coupling
  const zone = tz || process.env.SALON_TZ || 'Pacific/Honolulu';
  const startMs = moment.tz(zone).startOf('day').valueOf();
  // One range fetch warms the window used by find-earliest (cache key `${startMs}:${daysAhead}`).
  await getBookedAppointments(startMs, daysAhead, { force: true }).catch(() => null);
  return { warmedDays: daysAhead };
}

module.exports = {
  getSalonData,
  getBookedAppointments,
  prefetchAppointments,
  MERCHANT_ID,
  PAGE_URL,
  APPT_URL,
};
