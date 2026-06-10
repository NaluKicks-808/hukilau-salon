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
  const res = await fetch(PAGE_URL, {
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
  try {
    html = await fetchPageHtml();
  } catch (err) {
    if (fs.existsSync(SNAPSHOT)) {
      html = fs.readFileSync(SNAPSHOT, 'utf8');
    } else {
      throw err;
    }
  }
  const data = extractPageData(html);
  cache = { fetchedAt: Date.now(), data };
  return data;
}

/**
 * POST getappt.php and parse the response into an array of appointment objects.
 * Mirrors cbbe2.js `getappointments(startdateSecs, numdays)` (start/end are unix ms).
 */
async function getBookedAppointments(startMs, numDays) {
  const body = new URLSearchParams({
    start: String(startMs),
    end: String(startMs + 86400000 * numDays),
    merchantid: MERCHANT_ID,
  });
  const res = await fetch(APPT_URL, {
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
  return appts;
}

module.exports = {
  getSalonData,
  getBookedAppointments,
  MERCHANT_ID,
  PAGE_URL,
  APPT_URL,
};
