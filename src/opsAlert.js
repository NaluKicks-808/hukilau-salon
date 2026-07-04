'use strict';

/**
 * opsAlert.js — pushes to the OPERATOR (Evan / Nalu Agency), NOT the salon owner.
 *
 * This is the "something went wrong, look now" channel. It is deliberately kept separate from the
 * owner's booking alerts (src/notify.js) so the salon owner is never paged with technical noise,
 * and so the operator hears about problems the owner would never notice (a captured booking that
 * silently failed to deliver, a tool crash mid-call, a call that ended badly).
 *
 *   Recipient : PUSHOVER_DEV_USER   — the operator's Pushover user OR delivery-group key
 *   App token : PUSHOVER_DEV_TOKEN  — optional; falls back to PUSHOVER_TOKEN (same Pushover app,
 *               a different recipient is fine). Set this only if you made a separate Pushover app.
 *
 * If PUSHOVER_DEV_USER is unset this is a safe no-op: it logs a breadcrumb and returns without
 * throwing. That means the code can ship to production before the env var exists — ops alerts
 * simply begin the moment the key is added in Vercel. Ops alerting must NEVER break the tool path,
 * so every send is wrapped and time-boxed; callers should still guard the call in a try/catch.
 */

const cap = (s, n) => String(s == null ? '' : s).slice(0, n);

function opsConfigured() {
  return !!(process.env.PUSHOVER_DEV_USER && (process.env.PUSHOVER_DEV_TOKEN || process.env.PUSHOVER_TOKEN));
}

/**
 * Send an operator alert.
 * @param {string} title   short push title
 * @param {string} message body (will be capped to Pushover's ~1KB limit)
 * @param {object} [opts]
 *   @param {'emergency'|'high'|'normal'} [opts.level='high'] emergency repeats until acknowledged
 *   @param {string} [opts.url]       optional deep link (e.g. the Vapi call)
 *   @param {string} [opts.urlTitle]  label for the link
 * @returns {Promise<{delivered:boolean, detail:string}>}
 */
async function alertOps(title, message, opts = {}) {
  const token = process.env.PUSHOVER_DEV_TOKEN || process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_DEV_USER;
  if (!user || !token) {
    // Not configured — leave a breadcrumb in the logs but never throw into the caller's path.
    console.error('OPS ALERT (undelivered — set PUSHOVER_DEV_USER)', JSON.stringify({ title: cap(title, 120), message: cap(message, 300) }));
    return { delivered: false, detail: 'ops channel not configured' };
  }
  const level = opts.level || 'high';
  const priority = level === 'emergency' ? '2' : level === 'normal' ? '0' : '1';
  const params = { token, user, title: cap(title, 250), message: cap(message, 1024), priority };
  if (level === 'emergency') {
    params.retry = '60'; // re-alert every 60s…
    params.expire = '3600'; // …for up to an hour, until acknowledged
  }
  if (opts.url) {
    params.url = cap(opts.url, 512);
    if (opts.urlTitle) params.url_title = cap(opts.urlTitle, 100);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000); // never let a slow push hang the tool response
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    if (!res.ok) console.error('OPS ALERT send failed', res.status);
    return { delivered: res.ok, detail: res.ok ? 'sent' : `HTTP ${res.status}` };
  } catch (e) {
    console.error('OPS ALERT send error', e.message);
    return { delivered: false, detail: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { alertOps, opsConfigured };
