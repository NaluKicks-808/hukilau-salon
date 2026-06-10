# Hukilau Salon — Vapi Receptionist Tools

Two HTTP tools for a Vapi voice receptionist at **Hukilau Salon**:

- **`check_availability`** — live open appointment times across the 4 stylists (Marcus, Kelli, Patricia, Amanda) for a service + date, so the AI never double-books.
- **`book_appointment`** — confirms the slot is still open, then **captures** the request and returns it for the owner to enter in their system. It does **not** book on the salon website and never handles card/deposit data.

## How it works

The salon runs *Salon Scheduler* (AppHeaven/Clover) — no public API. Availability is computed
client-side in the salon's own `cbbe2.js`. This service **lifts that exact logic and runs it
server-side**, so our open-slot math is byte-for-byte what the website would show (the strongest
guard against double-booking).

```
booking page (tcbbe.php)  ──► src/salonClient.js ──► vendor/availability-core.js
  embedded employeeJSON/serviceJSON/jsonMerchant      (FillTimeArray lifted VERBATIM
getappt.php (booked appts) ─►  getBookedAppointments    from cbbe2.js + thin shims)
                                      │
        src/{services,stylists,datetime}.js  ──►  src/availabilityEngine.js
                                                          │
                                   hukilau-booking.js  (checkAvailability / bookAppointment)
                                                          │
                                                    server.js  (Vapi webhooks)
```

| File | Purpose |
|------|---------|
| `hukilau-booking.js` | Exports the two tool functions (`checkAvailability`, `bookAppointment`). |
| `server.js` | Express server exposing the tools as Vapi webhooks. |
| `src/salonClient.js` | Fetches + caches salon config; fetches booked appointments. |
| `vendor/availability-core.js` | The salon's **lifted** slot math (`FillTimeArray`, verbatim). |
| `vendor/cbbe2.snapshot.js`, `vendor/page.snapshot.html` | Pinned snapshots for diffing on refresh + offline fallback. |
| `src/services.js`, `src/stylists.js`, `src/datetime.js` | Resolve spoken service/stylist names and dates (HST). |
| `src/notify.js` | Owner notification adapter (return-to-Vapi now; Twilio SMS stub for later). |
| `test.js` | Read-only unit + live E2E checks. |
| `scripts/inspect.js` | Dump live stylists/services/config (use after a refresh). |

## Setup

Requires **Node ≥ 18** (uses built-in `fetch`).

```bash
npm install
cp .env.example .env      # set VAPI_SECRET; MERCHANT_ID is already SVEVNSQKF87J1
```

## Run & test

```bash
npm start            # starts the server on PORT (default 8787)
npm test             # unit + LIVE read-only checks against the real salon
npm test -- --no-live  # unit checks only (no network)
npm run inspect      # print live stylists/services/config + indexes
```

`npm test` proves end-to-end that availability is read correctly **and** that booking is
capture-only (a fetch spy asserts no request is ever sent to `bookcbbnew.php`).

> **Parity check (recommended):** run `npm test`, then open the salon's booking page for the
> same service/stylist/date and confirm the offered times match. Because we run the salon's own
> code, they should line up exactly.

## Connect to Vapi

Deploy the server somewhere with a public HTTPS URL (Railway, Render, Fly, a VM, etc.), set
`VAPI_SECRET` to a long random string, then add two **custom function tools** in the Vapi
dashboard. Point both at your server and set the tool's server **secret** to the same value
(Vapi sends it as the `x-vapi-secret` header, which the server verifies).

**Server URL:** `https://YOUR_HOST/vapi/tools` (one URL handles both tools; it dispatches by name).

### Tool 1 — `check_availability`
```json
{
  "type": "function",
  "function": {
    "name": "check_availability",
    "description": "Check open appointment times at Hukilau Salon across the stylists for a service and date.",
    "parameters": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "description": "Date to check as YYYY-MM-DD in Hawaii time. Resolve relative dates (e.g. 'tomorrow') to an absolute date first." },
        "service": { "type": "string", "description": "Requested service, e.g. \"Women's Cut & Style\", \"Men's Haircut\", \"Balayage\"." },
        "stylist": { "type": "string", "description": "Optional preferred stylist: Marcus, Kelli, Patricia, or Amanda. Empty = any (earliest)." }
      },
      "required": ["date", "service"]
    }
  }
}
```

### Tool 2 — `book_appointment`
```json
{
  "type": "function",
  "function": {
    "name": "book_appointment",
    "description": "Capture a booking request after confirming the time is open. Does not finalize payment; the salon confirms and a deposit may be required.",
    "parameters": {
      "type": "object",
      "properties": {
        "firstName": { "type": "string" },
        "lastName": { "type": "string" },
        "phone": { "type": "string", "description": "Caller's mobile number." },
        "email": { "type": "string", "description": "Optional." },
        "service": { "type": "string" },
        "stylist": { "type": "string", "description": "Marcus, Kelli, Patricia, or Amanda. Optional; if omitted, the earliest-available stylist for the chosen time is used." },
        "date": { "type": "string", "description": "YYYY-MM-DD in Hawaii time." },
        "time": { "type": "string", "description": "Chosen start time exactly as offered, e.g. \"9:15 AM\"." },
        "note": { "type": "string", "description": "Optional note for the stylist." }
      },
      "required": ["firstName", "lastName", "phone", "service", "date", "time"]
    }
  }
}
```

### Suggested assistant instructions
> You are the receptionist for Hukilau Salon (Hawaii time). To check times, call
> `check_availability` with an absolute `date` (YYYY-MM-DD) — convert "tomorrow"/"Friday"
> yourself. Read back the tool's spoken result. To book, collect first name, last name, and
> mobile number, confirm the exact time offered, then call `book_appointment`. Tell the caller
> the salon will confirm and that a deposit may be required. Never invent times or services.

### Delivering the request to the owner
Today `book_appointment` returns the structured request to Vapi (`result.booking` and a
ready-to-send `result.ownerMessage`). Forward it to the owner from your Vapi workflow / an
end-of-call webhook / a Make/Zapier step. To send the owner a **text** directly instead, set
`NOTIFY_MODE=twilio` and the `TWILIO_*` + `OWNER_PHONE` env vars (adapter already wired in
`src/notify.js`).

## Why booking is capture-only (the deposit reality)

This merchant has `prepay = 1` / `deposit: true`: an online booking through the salon site
**cannot complete without a Clover-tokenized card**. Rather than route card data through a voice
AI, the receptionist captures the request and the owner enters it on their side (their path has
no deposit). If you later disable online prepay with the salon — or want full auto-booking — the
booking endpoint can be added; the availability engine already does the hard part.

## Refreshing when the salon changes things

The salon's data (services, stylists, schedules) is read **live** each run (cached ~6h). If they
change their site's `cbbe2.js`, refresh the lifted logic:

```bash
curl -s 'https://reports.appheaven.us/online/cbbe2.js' -o vendor/cbbe2.snapshot.js
curl -s 'https://reports.appheaven.us/online/tcbbe.php?merchantid=SVEVNSQKF87J1&force=1' -o vendor/page.snapshot.html
npm run inspect   # confirm stylists/services still extract; update alias maps if names/indexes changed
```
Then diff `FillTimeArray` in the new snapshot against `vendor/availability-core.js` and re-paste
if it changed. Keep the lift faithful — don't "improve" it.

## Notes

- **Timezone:** all date math is Pacific/Honolulu (UTC−10, no DST). The npm scripts pin
  `TZ=Pacific/Honolulu`; set it in your deploy environment too.
- **Booking window:** ~3 months out (`monthsx`). **Increments:** 15 minutes.
- **Safety:** this service only ever *reads* from the salon system. Bookings, cancels, and
  reschedules are **captured and handed to the owner** — it never writes to the salon or
  processes payments.

---

## Round 2 — speed pack + cancel/reschedule

### Two more tools (same Custom Tool setup, Server URL `…/vapi/tools`)
**`cancel_appointment`** — captures a cancellation request for the owner. Parameters:
```json
{
  "type": "object",
  "properties": {
    "firstName": { "type": "string" },
    "lastName": { "type": "string" },
    "phone": { "type": "string" },
    "date": { "type": "string", "description": "Date of the appointment to cancel (YYYY-MM-DD, Hawaii time)." },
    "time": { "type": "string", "description": "Approximate time of the appointment, if known (e.g. \"2:00 PM\")." },
    "service": { "type": "string", "description": "Service, if the caller mentions it." },
    "stylist": { "type": "string", "description": "Stylist, if known: Marcus, Kelli, Patricia, or Amanda." },
    "reason": { "type": "string", "description": "Optional reason for cancelling." }
  },
  "required": ["firstName", "lastName", "phone", "date"]
}
```
**`reschedule_appointment`** — confirms the new slot is open, then captures the change. Parameters:
```json
{
  "type": "object",
  "properties": {
    "firstName": { "type": "string" },
    "lastName": { "type": "string" },
    "phone": { "type": "string" },
    "currentDate": { "type": "string", "description": "Current appointment date (YYYY-MM-DD), if known." },
    "currentTime": { "type": "string", "description": "Current appointment time, if known." },
    "newDate": { "type": "string", "description": "Requested new date (YYYY-MM-DD, Hawaii time)." },
    "newTime": { "type": "string", "description": "Requested new start time, e.g. \"10:15 AM\"." },
    "service": { "type": "string", "description": "Service (needed to confirm the new slot is open)." },
    "stylist": { "type": "string", "description": "Preferred stylist: Marcus, Kelli, Patricia, or Amanda." }
  },
  "required": ["firstName", "lastName", "phone", "newDate", "newTime"]
}
```
**`find_earliest_availability`** — for "when's the soonest I can get a ___?" Scans forward from
today (one network fetch for the whole window) and returns the first day with an opening.
```json
{
  "type": "object",
  "properties": {
    "service": { "type": "string", "description": "The service the caller wants (required)." },
    "stylist": { "type": "string", "description": "Optional preferred stylist: Marcus, Kelli, Patricia, or Amanda." },
    "fromDate": { "type": "string", "description": "Optional earliest date to start from (YYYY-MM-DD); defaults to today." },
    "daysToSearch": { "type": "number", "description": "Optional days ahead to scan (default 14)." }
  },
  "required": ["service"]
}
```
Add the new tools to the assistant instructions, e.g.: *"For 'what's the soonest I can get a ___',
call `find_earliest_availability`. To cancel, collect name, mobile, and the appointment date, then
call `cancel_appointment`. To move an appointment, collect name, mobile, the service, and the new
date/time, then call `reschedule_appointment`."*

### Speed / no-lag
- **Spoken filler (biggest perceived win):** on each tool in Vapi, set **Messages →
  request-start** to e.g. *"Let me check our schedule, one moment."* Masks the lookup.
- **Short appointments cache:** `getBookedAppointments` is cached in-memory ~45s
  (`APPT_CACHE_TTL_MS`, default 45000). Repeat lookups in a call are instant; fresh enough that
  owner confirmation stays the final dedupe. We never write to the salon, so our captures don't
  invalidate it.
- **Keep-warm:** `GET /warm` warms the config + the next 14 days of appointments. A sub-daily
  Vercel Cron is intentionally **not** in `vercel.json` — it requires the **Pro plan** and breaks
  the build on Hobby. On Hobby, point a free external pinger (cron-job.org / UptimeRobot) at
  `https://salon.pointy.help/warm` every few minutes; on Pro, add
  `"crons": [{ "path": "/warm", "schedule": "*/5 * * * *" }]` to `vercel.json`. Fluid Compute +
  prefetch + the filler already cover most cold-start lag regardless.
- **Prefetch on call start:** `POST /vapi/events` warms today..+3 days when a call connects. Wire
  it by setting the assistant's **Server URL** to `https://salon.pointy.help/vapi/events` and
  limiting **Server Messages** to `status-update` (so you only get call-state pings, not every
  transcript).

### Why not a self-managed calendar / CSV
The salon's real calendar changes outside our control (walk-ins, their website, staff edits), so
a long-lived cache would re-introduce double-booking — the one thing this prevents. And Vercel's
serverless disk is ephemeral, so a CSV wouldn't persist. Short cache + prefetch + keep-warm gets
the speed safely.
