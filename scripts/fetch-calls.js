/**
 * fetch-calls.js — pull recent Vapi calls (transcripts, outcomes, cost) without
 * the copy-paste-from-dashboard dance.
 *
 * Read-only against the Vapi API. Never writes anything anywhere.
 *
 * Usage:
 *   npm run calls                     # last 5 calls, transcript tails
 *   npm run calls -- --limit 10      # more calls
 *   npm run calls -- --full          # full transcripts
 *   npm run calls -- --id <callId>   # one specific call, full detail
 *   npm run calls -- --assistant <assistantId>   # filter to one assistant
 *
 * Auth: VAPI_API_KEY from the environment. If unset, falls back to reading it
 * out of ../reception-hq/.env.local (same key the cost sync uses), so on
 * Evan's Mac it works with zero setup.
 */

const fs = require('fs');
const path = require('path');

const TZ = process.env.SALON_TZ || 'Pacific/Honolulu';
const API = 'https://api.vapi.ai';

function resolveApiKey() {
  if (process.env.VAPI_API_KEY) return process.env.VAPI_API_KEY;
  const envPath = path.join(__dirname, '..', '..', 'reception-hq', '.env.local');
  try {
    const line = fs.readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('VAPI_API_KEY='));
    if (line) return line.slice('VAPI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }
  return null;
}

function parseArgs(argv) {
  const args = { limit: 5, full: false, id: null, assistant: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]) || 5;
    else if (argv[i] === '--full') args.full = true;
    else if (argv[i] === '--id') args.id = argv[++i];
    else if (argv[i] === '--assistant') args.assistant = argv[++i];
  }
  return args;
}

function hst(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function durationOf(call) {
  if (!call.startedAt || !call.endedAt) return '—';
  const s = Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function printCall(call, { full }) {
  const a = call.analysis || {};
  console.log('─'.repeat(72));
  console.log(`📞 ${hst(call.startedAt || call.createdAt)}  ·  ${durationOf(call)}  ·  ${call.id}`);
  console.log(`   ended: ${call.endedReason || '—'}   eval: ${a.successEvaluation ?? '—'}   cost: $${(call.cost ?? 0).toFixed(2)}`);
  if (call.customer && call.customer.number) console.log(`   caller: ${call.customer.number}`);
  if (a.summary) console.log(`   summary: ${a.summary}`);
  const transcript = call.transcript || '';
  if (!transcript) { console.log('   (no transcript on this call)'); return; }
  const lines = transcript.trim().split('\n');
  const shown = full ? lines : lines.slice(-25);
  if (!full && lines.length > shown.length) console.log(`   … transcript tail (${shown.length}/${lines.length} lines — use --full):`);
  console.log(shown.map(l => '   │ ' + l).join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = resolveApiKey();
  if (!key) {
    console.error('No VAPI_API_KEY in env and could not read ../reception-hq/.env.local');
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${key}` };

  if (args.id) {
    const res = await fetch(`${API}/call/${args.id}`, { headers });
    if (!res.ok) { console.error(`Vapi ${res.status}: ${await res.text()}`); process.exit(1); }
    printCall(await res.json(), { full: true });
    return;
  }

  const qs = new URLSearchParams({ limit: String(args.limit) });
  if (args.assistant) qs.set('assistantId', args.assistant);
  const res = await fetch(`${API}/call?${qs}`, { headers });
  if (!res.ok) { console.error(`Vapi ${res.status}: ${await res.text()}`); process.exit(1); }
  const calls = await res.json();
  if (!Array.isArray(calls) || calls.length === 0) { console.log('No calls returned.'); return; }
  console.log(`Latest ${calls.length} call(s), newest first:`);
  for (const call of calls) printCall(call, { full: args.full });
  console.log('─'.repeat(72));
  console.log('Note: Vapi retains calls ~14 days — anything older is gone from the API.');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
