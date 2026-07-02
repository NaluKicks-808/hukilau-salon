# Hukilau Salon — AI Voice Receptionist (Vapi backend)

The webhook server behind the Hukilau Salon AI phone receptionist. Vapi (the voice platform)
calls this server for every tool the assistant uses: checking availability, booking, canceling,
rescheduling, price quotes, service-name resolution, and post-booking notes.

- **Live:** https://salon.pointy.help (Vercel project `hukilau-salon`, auto-deploys on push to `main`)
- **Health:** `GET /health` → shows timezone, holds store, and active notify channels
- **Tests:** `node test.js` (live read-only against the real salon calendar + unit tests; ~156 assertions)
- **Client:** Hukilau Salon, Polynesian Cultural Center / Hukilau Marketplace, Lā‘ie.
  Stylists: Marcus, Kelli, Patricia, Amanda. Timezone: Pacific/Honolulu everywhere (no DST).

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
  its env vars are set). New bookings = Pushover EMERGENCY priority (repeats until acknowledged).
- `src/pendingHolds.js` — Upstash Redis 36h slot holds so two callers can't capture the same slot.
- `src/salonClient.js` — fetches/caches salon config + booked appointments (`getappt.php`, unix-ms
  range POST). `scripts/analyze-history.js` can pull ~6 months of real appointment history.

## Env vars (set in Vercel, hukilau-salon project)

`NOTION_API_KEY` + `NOTION_DATABASE_ID` (Booking Requests DB) · `PUSHOVER_TOKEN` + `PUSHOVER_USER`
(owner alerts — ⚠️ as of 2026-07-02 PUSHOVER_USER is Evan's personal key for testing; swap to the
owner's key or a Pushover Delivery Group before/at signing) · `TELNYX_API_KEY`/`TELNYX_FROM`/
`OWNER_PHONE` (SMS; toll-free verification pending) · Upstash Redis pair · optional `VAPI_SECRET`.

## Gotchas learned the hard way

- Vapi dashboard config (tool schemas, system prompt) lives OUTSIDE this repo — code changes to
  tool params do nothing until the matching JSON schema is pasted into the Vapi tool.
- "No result returned" in Vapi test calls has ALWAYS been Vapi-side config (async tool toggle,
  wrong Server URL) — the server has never returned a bad shape. Check Vercel runtime logs first:
  every call logs `evt:tool_call` with delivery details.
- The salon deleted/renamed services before — `npm run audit` (scripts/) lists stylist/service gaps.
- Keep `moment.tz.setDefault('Pacific/Honolulu')` parity when touching vendor code.
