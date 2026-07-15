# Hukilau Salon — AI Voice Receptionist (Vapi backend)

The webhook server behind the Hukilau Salon AI phone receptionist. Vapi (the voice platform)
calls this server for every tool the assistant uses: checking availability, booking, canceling,
rescheduling, price quotes, service-name resolution, and post-booking notes.

- **Live:** https://salon.pointy.help (Vercel project `hukilau-salon`, auto-deploys on push to `main`)
- **Health:** `GET /health` → tz + holds/notify/archive booleans · **`GET /ops`** → operator status
  page (health lights incl. live salon-site probe, today's counts, recent-call feed)
- **Tests:** `node test.js` (live read-only against the real salon calendar + unit tests; 241 assertions)
- **Client:** Hukilau Salon, Polynesian Cultural Center / Hukilau Marketplace, Lā‘ie.
  Stylists: Marcus, Kelli, Patricia, Amanda. Timezone: Pacific/Honolulu everywhere (no DST).

## Change recipes (start here — edit exactly this file, nothing else)
| To do this… | Edit exactly | Notes |
|---|---|---|
| Change a tool's behavior (availability, booking, cancel, notes, quotes) | `hukilau-booking.js` | every tool function lives here |
| Fix service-name matching / add an alias | `src/services.js` | exact → alias → token-overlap scoring |
| Change owner alerts (who / when) | `src/notify.js` | Notion + Pushover + Telnyx, each auto-on when its env vars are set |
| Add a new Vapi tool | add to the `TOOLS` map in `server.js` **and** implement it in `hukilau-booking.js` | result must be a plain speakable string |
| Change availability math | don't hand-edit — it's lifted verbatim into `vendor/availability-core.js` for parity with the salon's own site | |
| Run tests | `node test.js` | 241 asserts, live read-only against the real calendar |
| Check it's healthy | `GET /health` or `GET /ops` | operator status page |

## Non-negotiables (do not break these)

1. **Capture-only.** We NEVER write to the salon's booking system (Salon Scheduler / AppHeaven).
   Bookings/cancels/reschedules are captured, the owner enters them manually. Never call
   `bookcbbnew.php`. Never touch card/deposit data.
2. **Vapi tool results must be plain SPEAKABLE STRINGS** (`toResult` returns `out.message`).
   Object results cause Vapi's "No result returned". Every handler returns `{ok, message, data}`;
   only `message` reaches the caller's ear.
3. **A note is never a re-book.** `add_appointment_note` exists because re-running
   `book_appointment` to attach a note collides with the booking's own 36h hold. Notes do NOT
   check availability or create holds.
4. **The server filters, not the model.** Time-of-day (`afterTime`/`beforeTime`), day-of-week
   (`daysOfWeek`/`excludeDaysOfWeek`), and combos (`additionalServices`) are enforced here because
   the LLM can't be trusted to filter times.
5. **Secrets live in Vercel env vars only** — never in code, never in chat, never in Notion.

## Architecture map

- `server.js` — Express transport. `TOOLS` map (tool name → function), `/vapi/tools` dispatches by
  name (all Vapi tools point here), per-tool routes exist too. `/warm` + `/vapi/events` prefetch
  caches. Wraps every tool in try/catch → graceful string fallback.
- `hukilau-booking.js` — all tool functions: `checkAvailability`, `bookAppointment` (holds slot via
  `addHold`), `cancelAppointment`, `rescheduleAppointment` (re-checks new slot only when `service`
  passed), `addAppointmentNote`, `findEarliestAvailability`, `getServiceInfo`, `resolveServicePhrase`.
- `src/availabilityEngine.js` — runs the salon's OWN availability code (lifted verbatim into
  `vendor/availability-core.js`) for exact parity with their site. Don't re-implement slot math.
- `src/services.js` — service-name resolution: exact → alias → token-overlap scoring with STOPWORDS
  (filler words like "up"/"just" don't score). `resolveAmong()` handles did-you-mean answers
  including ordinals ("the first one") via the `among` param / `resolve_service_among` tool.
- `src/notify.js` — owner alert fan-out: Notion row + Pushover push + Telnyx SMS (each auto-on when
  its env vars are set). Pushover EMERGENCY priority (repeats every 60s until acknowledged) fires
  ONLY when the appointment is for TODAY in salon time (`isSameDayAppointment`, `SALON_TZ` default
  Pacific/Honolulu); everything else is a single normal-priority ring (owner's request, 2026-07-02).
  Every owner message carries the full handoff: service, stylist (falls back to "Any available
  stylist"), 📅 date/time, 👤 name, 📞 phone, 📝 note.
- `src/pendingHolds.js` — Upstash Redis 36h slot holds so two callers can't capture the same slot.
- `src/salonClient.js` — fetches/caches salon config + booked appointments (`getappt.php`, unix-ms
  range POST). `scripts/analyze-history.js` can pull ~6 months of real appointment history.
- `src/opsAlert.js` + `src/callReview.js` + `src/opsLog.js` + `src/opsPage.js` — OPERATOR monitoring
  (pages Evan via `PUSHOVER_DEV_USER`, NEVER the owner): ⚠️ tool errors, 📞 bad calls (end-of-call
  report with abnormal endedReason OR negative successEvaluation; normal hang-ups silent), 🚨 capture
  that reached zero owner channels (emergency + full handoff). Rolling Redis event feed (no customer
  PII) powers `GET /ops` and the daily 7:00 AM HST digest (`/ops/digest`, vercel.json cron 17:00 UTC).
- `src/callArchive.js` — permanent archive: every end-of-call report → one page in the Notion
  "📞 Call Log" DB (outcome properties + transcript chunked in the body, Redis SET NX dedupe on
  retries). Vapi purges call data in days; this copy is forever and feeds the monthly client report.

## Env vars (set in Vercel, hukilau-salon project)

`NOTION_API_KEY` + `NOTION_DATABASE_ID` (Booking Requests DB) + `NOTION_CALLS_DB_ID` (Call Log
archive) · `PUSHOVER_TOKEN` + `PUSHOVER_USER` (✅ the OWNER's delivery-group key since 2026-07-03) ·
`PUSHOVER_DEV_USER` (Evan's ops-alert key; optional `PUSHOVER_DEV_TOKEN`) · `TELNYX_API_KEY`/
`TELNYX_FROM`/`OWNER_PHONE` (SMS) · Upstash Redis pair (slot holds + ops events) · optional:
`VAPI_SECRET` (user declined for now — webhook open by choice), `OPS_KEY` + `CRON_SECRET`
(set BOTH together or the digest cron starts 401ing).

## Gotchas learned the hard way

- Vapi dashboard config (tool schemas, system prompt) lives OUTSIDE this repo — code changes to
  tool params do nothing until the matching JSON schema is pasted into the Vapi tool.
- "No result returned" in Vapi test calls has ALWAYS been Vapi-side config (async tool toggle,
  wrong Server URL) — the server has never returned a bad shape. Check Vercel runtime logs first:
  every call logs `evt:tool_call` with delivery details.
- The salon deleted/renamed services before — `npm run audit` (scripts/) lists stylist/service gaps.
- Keep `moment.tz.setDefault('Pacific/Honolulu')` parity when touching vendor code.
- `/vapi/events` accepts 1mb bodies (full-transcript end-of-call reports 413'd at the global 128kb
  cap and silently lost alert + archive); every other route stays hard-capped at 128kb.
- Vapi runs a successEvaluation on EVERY call — a "hi" + hang-up rates unsuccessful and pages Evan
  BY DESIGN during watch-week. If it gets noisy: digest-only for eval-flags, or a ~20s duration floor.
