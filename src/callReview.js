'use strict';

/**
 * callReview.js — decide whether a finished Vapi call is worth the operator's attention.
 *
 * Vapi posts an `end-of-call-report` to the server URL after every call. Most calls end normally
 * (the customer hangs up) and should stay silent. We only page the operator when a call ended
 * ABNORMALLY — a pipeline/assistant error, dead air / silence timeout, hitting the max-duration
 * cap, or an explicit "unsuccessful" evaluation from Vapi's analysis rubric.
 *
 * The bar is deliberately conservative: in the first weeks of a live client, alert fatigue is the
 * real enemy — one noisy channel and the operator mutes it and misses the call that mattered.
 * Pure functions, no I/O, so this is fully unit-testable.
 */

// Abnormal end reasons. Vapi's normal reasons ("customer-ended-call", "assistant-ended-call",
// "assistant-said-end-call-phrase", …) do NOT match. Errors/timeouts/dead-air/caps DO.
const BAD_ENDED_REASON = /error|failed|timed?-?out|silence|microphone|exceeded|no-answer|busy|abandon|rejected|voicemail|websocket|no-server|unavailable/i;

// Explicit negative outcomes from a configured successEvaluation rubric (pass/fail or boolean).
const NEGATIVE_EVAL = new Set(['false', 'fail', 'failed', 'unsuccessful', 'no', 'poor', 'negative', 'bad']);

function endedReasonOf(msg) {
  return String((msg && (msg.endedReason || msg.endedReasonDetail)) || '');
}

function successEvalOf(msg) {
  const a = msg && msg.analysis;
  const v = a && a.successEvaluation != null ? a.successEvaluation : msg && msg.successEvaluation;
  return v == null ? null : String(v).toLowerCase().trim();
}

/**
 * @returns {{bad:boolean, why?:string}}
 */
function callEndedBadly(msg) {
  const reason = endedReasonOf(msg);
  if (reason && BAD_ENDED_REASON.test(reason)) return { bad: true, why: `ended: ${reason}` };
  const evalv = successEvalOf(msg);
  if (evalv && NEGATIVE_EVAL.has(evalv)) return { bad: true, why: 'call rated unsuccessful' };
  return { bad: false };
}

function durationLabel(msg) {
  if (!msg) return '';
  if (msg.durationSeconds) return `${Math.round(msg.durationSeconds)}s`;
  if (msg.durationMs) return `${Math.round(msg.durationMs / 1000)}s`;
  const started = msg.startedAt && Date.parse(msg.startedAt);
  const ended = msg.endedAt && Date.parse(msg.endedAt);
  if (started && ended && ended >= started) return `${Math.round((ended - started) / 1000)}s`;
  return '';
}

function callIdOf(msg) {
  return (msg && ((msg.call && msg.call.id) || msg.callId)) || '';
}

/**
 * Build the operator alert for a finished call, or null if the call ended fine.
 * @returns {{title:string, message:string, opts:object}|null}
 */
function buildCallReviewAlert(msg) {
  const verdict = callEndedBadly(msg);
  if (!verdict.bad) return null;
  const callId = callIdOf(msg);
  const summary = (msg && msg.analysis && msg.analysis.summary) || (msg && msg.summary) || '';
  const dur = durationLabel(msg);
  const message = [
    `A Hukilau call may have gone poorly (${verdict.why}).`,
    dur ? `Duration: ${dur}` : null,
    summary ? `Summary: ${String(summary).slice(0, 400)}` : null,
    callId ? `Call: ${callId}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    title: '📞 Hukilau call needs review',
    message,
    opts: {
      level: 'normal',
      url: callId ? `https://dashboard.vapi.ai/calls/${callId}` : undefined,
      urlTitle: callId ? 'Open call in Vapi' : undefined,
    },
  };
}

module.exports = { callEndedBadly, buildCallReviewAlert, durationLabel, callIdOf };
