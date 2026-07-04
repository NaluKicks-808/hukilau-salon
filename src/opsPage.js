'use strict';

/**
 * opsPage.js — renders GET /ops: a phone-first status page for the operator.
 *
 * Pure renderer: server.js gathers the data (health booleans, live salon probe, recent events,
 * today's counts) and this turns it into one self-contained HTML string — no external assets,
 * no client JS, a meta-refresh keeps it live. EVERY dynamic string is HTML-escaped: call
 * summaries and error messages contain caller speech / upstream text and must never execute.
 */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TZ = () => process.env.SALON_TZ || 'Pacific/Honolulu';

function timeLabel(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: TZ(),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function light(ok) {
  return ok ? '<span class="ok">●</span>' : '<span class="bad">●</span>';
}

function statusCard(label, ok, detail) {
  return `<div class="card">${light(ok)} <b>${escapeHtml(label)}</b><div class="dim">${escapeHtml(detail || (ok ? 'OK' : 'DOWN'))}</div></div>`;
}

function eventRow(e) {
  const when = `<span class="dim">${escapeHtml(timeLabel(e.at))}</span>`;
  if (e.t === 'call') {
    const flag = e.bad ? '🚩' : '✅';
    const bits = [e.reason, e.dur, e.bad && e.why ? e.why : null].filter(Boolean).map(escapeHtml).join(' · ');
    const sum = e.summary ? `<div class="sum">${escapeHtml(String(e.summary).slice(0, 200))}</div>` : '';
    return `<li>${flag} <b>Call</b> ${when}<div class="dim">${bits}</div>${sum}</li>`;
  }
  if (e.t === 'capture') {
    const ok = e.delivered !== false;
    const what = [e.action || 'book', e.service, e.when].filter(Boolean).map(escapeHtml).join(' · ');
    return `<li>${ok ? '📅' : '🚨'} <b>${ok ? 'Capture' : 'Capture NOT delivered'}</b> ${when}<div class="dim">${what}</div></li>`;
  }
  if (e.t === 'tool_error') {
    return `<li>⚠️ <b>Tool error</b> ${when}<div class="dim">${escapeHtml(e.tool || '?')}: ${escapeHtml(String(e.error || '').slice(0, 160))}</div></li>`;
  }
  if (e.t === 'owner_fail') {
    return `<li>🚨 <b>Owner alert failed</b> ${when}<div class="dim">${escapeHtml(e.action || '')} — channels: ${escapeHtml(e.channels || '?')}</div></li>`;
  }
  return `<li>• ${escapeHtml(e.t)} ${when}</li>`;
}

/**
 * @param {object} m  model assembled by server.js
 *   { sha, now, health:{authEnabled,holdsStore,notifyConfigured,opsConfigured,opsLog},
 *     probe:{ok,ms,status,error}|null, today:digest, events:[], opsKeySet:boolean, digestHref }
 */
function renderOpsPage(m) {
  const h = m.health || {};
  const probe = m.probe;
  const today = m.today || { calls: 0, badCalls: 0, captures: 0, toolErrors: 0, ownerFails: 0, byAction: {} };
  const cards = [
    statusCard('Server', true, `up · ${escapeHtml(m.sha ? m.sha.slice(0, 7) : 'local')}`),
    probe
      ? statusCard('Salon site', probe.ok, probe.ok ? `reachable · ${probe.ms}ms` : `${probe.error || `HTTP ${probe.status}`}`)
      : statusCard('Salon site', true, 'probe skipped'),
    statusCard('Holds store', !!h.holdsStore, h.holdsStore ? 'Redis connected' : 'not configured'),
    statusCard('Owner alerts', !!h.notifyConfigured, h.notifyConfigured ? 'configured' : 'NOT configured'),
    statusCard('Ops alerts (Evan)', !!h.opsConfigured, h.opsConfigured ? 'configured' : 'set PUSHOVER_DEV_USER'),
    statusCard('Event log', !!h.opsLog, h.opsLog ? 'recording' : 'no Redis — history off'),
    statusCard('Call archive', !!h.archive, h.archive ? 'Notion Call Log' : 'set NOTION_CALLS_DB_ID — calls NOT retained'),
  ].join('');
  const actions = Object.entries(today.byAction || {})
    .map(([k, v]) => `${v} ${escapeHtml(k)}`)
    .join(', ');
  const rows = (m.events || []).map(eventRow).join('') || '<li class="dim">No events yet — they appear as calls come in.</li>';
  const keyHint = m.opsKeySet
    ? ''
    : '<p class="hint">This page is currently open to anyone with the URL. Set an <code>OPS_KEY</code> env var in Vercel to require <code>?key=…</code>.</p>';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<meta name="robots" content="noindex, nofollow">
<title>Hukilau Ops</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #0b1416; color: #e7edee; font: 15px/1.45 -apple-system, system-ui, sans-serif; }
  h1 { font-size: 19px; margin: 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #8fa6a9; margin: 22px 0 8px; }
  .brand { color: #17b3c1; }
  .meta { color: #8fa6a9; font-size: 12px; margin: 4px 0 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { background: #101d20; border: 1px solid #1c2f33; border-radius: 10px; padding: 10px 12px; }
  .card b { font-size: 13px; }
  .ok { color: #2ecc71; } .bad { color: #ff5d5d; }
  .dim { color: #8fa6a9; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
  .counts { display: flex; gap: 8px; flex-wrap: wrap; }
  .pill { background: #101d20; border: 1px solid #1c2f33; border-radius: 999px; padding: 6px 12px; font-size: 13px; }
  .pill b { color: #17b3c1; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { background: #101d20; border: 1px solid #1c2f33; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
  .sum { color: #b9c8ca; font-size: 12px; margin-top: 4px; border-left: 2px solid #17b3c1; padding-left: 8px; }
  .hint { color: #d9b96a; font-size: 12px; background: #17140a; border: 1px solid #3a3216; border-radius: 8px; padding: 8px 10px; }
  a { color: #17b3c1; }
  code { background: #101d20; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
</style>
</head><body>
<h1><span class="brand">Hukilau</span> Receptionist — Ops</h1>
<div class="meta">Generated ${escapeHtml(timeLabel(m.now))} HST · auto-refreshes every 60s</div>
${keyHint}
<h2>Status</h2>
<div class="grid">${cards}</div>
<h2>Today so far (HST)</h2>
<div class="counts">
  <span class="pill">📞 <b>${today.calls}</b> calls${today.badCalls ? ` · 🚩 <b>${today.badCalls}</b>` : ''}</span>
  <span class="pill">📅 <b>${today.captures}</b> captures${actions ? ` (${actions})` : ''}</span>
  <span class="pill">⚠️ <b>${today.toolErrors}</b> errors</span>
  ${today.ownerFails ? `<span class="pill">🚨 <b>${today.ownerFails}</b> owner-alert fails</span>` : ''}
</div>
<h2>Recent activity</h2>
<ul>${rows}</ul>
<div class="meta"><a href="${escapeHtml(m.digestHref || '/ops/digest?dry=1&day=today')}">Preview today's digest</a> · Webhook auth: ${h.authEnabled ? 'on' : 'off (by choice)'}</div>
</body></html>`;
}

module.exports = { renderOpsPage, escapeHtml };
