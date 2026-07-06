'use strict';

/**
 * callArchive.js — permanent call archive in the "📞 Call Log" NOTION database.
 *
 * Vapi retains call data only briefly; the agency needs every call FOREVER — for the salon's
 * monthly report, for debugging weeks later, and because transcripts are the raw material for
 * future analytics. Notion was chosen deliberately over a SQL warehouse: the owner already pays
 * for it, the server already writes to it (Booking Requests uses the same integration token),
 * and the data stays visible/shareable in the agency's brain. Tradeoff accepted: we archive the
 * human-valuable material (transcript, summary, outcome, cost) and NOT the raw report JSON — if
 * a future client needs heavy analytics, export from Notion and graduate to Postgres then.
 *
 * One call = one page: outcome fields as properties, full transcript chunked into the page body
 * (Notion caps rich-text items at 2000 chars). Webhook retries are deduped via a Redis SET NX
 * marker on the Vapi call id (best-effort — a rare duplicate row beats a lost call).
 *
 * Config (Vercel env): NOTION_API_KEY (already set for Booking Requests) + NOTION_CALLS_DB_ID.
 * The Call Log database must be shared with the same Notion integration. Unset = safe no-op, so
 * this ships before the env var exists and starts archiving the moment it's added.
 */

const { callEndedBadly, callIdOf } = require('./callReview');
const { onceOnly } = require('./opsLog');

const SALON_TZ = () => process.env.SALON_TZ || 'Pacific/Honolulu';
const CHUNK = 1900; // margin under Notion's 2000-char rich-text limit
const MAX_CHUNKS = 25; // ~47KB of transcript per page; beyond that we truncate with a note
const ARCHIVE_TIMEOUT_MS = 20000; // Notion page-create with many blocks can exceed 8s (a live call's
// report aborted at 8s and its transcript was lost); the /vapi/events function budget is 30s.

function isConfigured() {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_CALLS_DB_ID);
}

function durationSecondsOf(msg) {
  if (!msg) return null;
  if (msg.durationSeconds) return Math.round(msg.durationSeconds);
  if (msg.durationMs) return Math.round(msg.durationMs / 1000);
  const started = msg.startedAt && Date.parse(msg.startedAt);
  const ended = msg.endedAt && Date.parse(msg.endedAt);
  if (started && ended && ended >= started) return Math.round((ended - started) / 1000);
  return null;
}

function chunkText(s, size = CHUNK) {
  const out = [];
  const str = String(s || '');
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

const rt = (s, cap = 1900) => [{ text: { content: String(s).slice(0, cap) } }];
const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(s) } });

/**
 * Pure: map a Vapi end-of-call report (any recent shape) to the Notion page payload.
 * Exported for tests. @returns {{title:string, properties:object, children:object[]}}
 */
function buildCallMeta(msg) {
  const m = msg || {};
  const artifact = m.artifact || {};
  const analysis = m.analysis || {};
  const verdict = callEndedBadly(m);
  const seconds = durationSecondsOf(m);
  const startedIso = m.startedAt || new Date().toISOString();
  const label = new Date(startedIso).toLocaleString('en-US', {
    timeZone: SALON_TZ(),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const title = `${label}${seconds != null ? ` · ${seconds}s` : ''}${verdict.bad ? ' · 🚩' : ''}`;

  const recording =
    m.recordingUrl || m.stereoRecordingUrl || artifact.recordingUrl || artifact.stereoRecordingUrl || null;
  const summary = analysis.summary || m.summary || '';
  const callId = callIdOf(m);

  const properties = {
    Name: { title: rt(title) },
    When: { date: { start: startedIso } },
    Flagged: { checkbox: !!verdict.bad },
    Client: { select: { name: process.env.CLIENT_NAME || 'Hukilau Salon' } },
  };
  if (seconds != null) properties['Duration (s)'] = { number: seconds };
  if (m.endedReason) properties['Ended Reason'] = { select: { name: String(m.endedReason).slice(0, 100) } };
  if (verdict.why) properties.Why = { rich_text: rt(verdict.why) };
  if (analysis.successEvaluation != null) properties.Eval = { rich_text: rt(String(analysis.successEvaluation)) };
  if (summary) properties.Summary = { rich_text: rt(summary) };
  if (callId) properties['Call ID'] = { rich_text: rt(callId) };
  if (typeof m.cost === 'number') properties.Cost = { number: m.cost };
  if (recording) properties.Recording = { url: String(recording).slice(0, 1900) };

  const transcript = m.transcript || artifact.transcript || '';
  const chunks = chunkText(transcript).slice(0, MAX_CHUNKS);
  const children = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: rt('Transcript') } },
    ...(chunks.length ? chunks.map(para) : [para('(no transcript included in the end-of-call report)')]),
  ];
  if (transcript.length > MAX_CHUNKS * CHUNK) children.push(para(`[transcript truncated at ${MAX_CHUNKS * CHUNK} chars]`));
  return { title, properties, children };
}

/** Archive one end-of-call report as a Notion page. Best-effort; never throws into the webhook. */
async function archiveCall(msg) {
  if (!isConfigured()) return { archived: false, detail: 'not configured' };
  try {
    // Vapi retries webhooks; only the first delivery per call id writes a page. Fail-open: if
    // Redis is unavailable we archive anyway (a rare duplicate row beats a lost call).
    const callId = callIdOf(msg);
    if (callId && !(await onceOnly(`ops:arch:${callId}`, 3 * 24 * 3600))) {
      return { archived: false, detail: 'duplicate delivery (already archived)' };
    }
    const { properties, children } = buildCallMeta(msg);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ARCHIVE_TIMEOUT_MS); // never hang the webhook on the archive
    try {
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: process.env.NOTION_CALLS_DB_ID }, properties, children }),
        signal: ctrl.signal,
      });
      if (res.ok) return { archived: true };
      const err = await res.text().catch(() => '');
      console.error('CALL ARCHIVE FAILED', `HTTP ${res.status} ${err.slice(0, 300)}`);
      return { archived: false, detail: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error('CALL ARCHIVE FAILED', e.message);
    return { archived: false, detail: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

module.exports = { archiveCall, buildCallMeta, isConfigured, durationSecondsOf, chunkText };
