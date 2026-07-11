'use strict';

/**
 * Monthly owner report — the retention surface.
 *
 * Reads the month's calls from the Notion 📞 Call Log (written by callArchive) and the month's
 * captures from the Booking Requests DB (written by notify), renders a branded one-page PDF
 * ("NALU AGENCY ✕ Hukilau Salon"), uploads it to Notion, and files it as a child page under the
 * 📊 Monthly Reports page inside the Hukilau client brief.
 *
 * Wired to GET /ops/monthly-report (Vercel cron, 1st of the month, 8:00 AM HST). ?month=YYYY-MM
 * overrides the month (default: the month that just ended); ?dry=1 returns stats JSON, writes nothing.
 *
 * Pure math (computeStats) is exported for tests; network calls stay in thin wrappers.
 */

const PDFDocument = require('pdfkit');

const SALON_TZ = () => process.env.SALON_TZ || 'Pacific/Honolulu';
const NOTION_VERSION = () => process.env.NOTION_VERSION || '2022-06-28';
// The 📊 Monthly Reports page under the Hukilau client brief. A Notion page id is not a secret;
// the env var exists so a future client can point elsewhere without a code change.
const REPORTS_PAGE_ID = () => process.env.NOTION_REPORTS_PAGE_ID || '39af04089ae381d5a8eddc5d2479cd5f';

const BRAND = '#0E7C86'; // Nalu teal (site brand color)
const BRAND_DARK = '#0C4A5A'; // accent
const INK = '#17323A';
const MUTED = '#5B7A80';
const TILE_BG = '#EFF7F7';

function isConfigured() {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_CALLS_DB_ID && process.env.NOTION_DATABASE_ID);
}

// ---------------------------------------------------------------- month math (pure)

/** "2026-07" -> { start: "2026-07-01", nextStart: "2026-08-01", label: "July 2026" } */
function monthWindow(monthStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthStr || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  const label = new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, nextStart: next, label };
}

/** The month that just ended, in salon time (cron fires on the 1st). */
function previousMonthStr(now = new Date()) {
  const hst = new Date(now.toLocaleString('en-US', { timeZone: SALON_TZ() }));
  hst.setDate(1);
  hst.setMonth(hst.getMonth() - 1);
  return `${hst.getFullYear()}-${String(hst.getMonth() + 1).padStart(2, '0')}`;
}

function hourInSalonTz(iso) {
  return Number(new Date(iso).toLocaleString('en-US', { timeZone: SALON_TZ(), hour: 'numeric', hour12: false }));
}

function weekdayInSalonTz(iso) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: SALON_TZ(), weekday: 'long' });
}

/**
 * Pure: fold Notion pages into the report's numbers.
 * callPages: [{when, seconds}], bookingPages: [{action}] — pre-flattened by the fetchers.
 * After-hours = call started before 9 AM or 5 PM+ salon time (the salon can't pick up then anyway).
 */
function computeStats(callPages, bookingPages, monthLabel) {
  const calls = callPages.filter((c) => c.when);
  const totalSeconds = calls.reduce((s, c) => s + (c.seconds || 0), 0);
  const afterHours = calls.filter((c) => {
    const h = hourInSalonTz(c.when);
    return h < 9 || h >= 17;
  }).length;
  const byDay = {};
  for (const c of calls) {
    const d = weekdayInSalonTz(c.when);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const busiestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
  const longest = calls.reduce((mx, c) => Math.max(mx, c.seconds || 0), 0);

  const actions = { Book: 0, Cancel: 0, Reschedule: 0, Note: 0, Message: 0 };
  for (const b of bookingPages) if (actions[b.action] != null) actions[b.action] += 1;

  return {
    monthLabel,
    calls: calls.length,
    minutes: Math.round(totalSeconds / 60),
    avgSeconds: calls.length ? Math.round(totalSeconds / calls.length) : 0,
    longestSeconds: longest,
    afterHours,
    busiestDay: busiestDay ? `${busiestDay[0]}s` : '—',
    bookings: actions.Book,
    reschedules: actions.Reschedule,
    cancels: actions.Cancel,
    messages: actions.Message + actions.Note,
  };
}

// ---------------------------------------------------------------- Notion reads

async function notionFetch(path, body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function queryAll(dbId, filter) {
  const pages = [];
  let cursor;
  do {
    const out = await notionFetch(`databases/${dbId}/query`, {
      filter,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...out.results);
    cursor = out.has_more ? out.next_cursor : null;
  } while (cursor);
  return pages;
}

/** The month's archived calls -> [{when, seconds}] */
async function fetchMonthCalls(win) {
  const pages = await queryAll(process.env.NOTION_CALLS_DB_ID, {
    and: [
      { property: 'When', date: { on_or_after: win.start } },
      { property: 'When', date: { before: win.nextStart } },
    ],
  });
  return pages.map((p) => ({
    when: p.properties?.When?.date?.start || null,
    seconds: p.properties?.['Duration (s)']?.number || 0,
  }));
}

/** The month's captures -> [{action}] (created_time is when the capture landed) */
async function fetchMonthBookings(win) {
  const pages = await queryAll(process.env.NOTION_DATABASE_ID, {
    and: [
      { timestamp: 'created_time', created_time: { on_or_after: `${win.start}T00:00:00.000Z` } },
      { timestamp: 'created_time', created_time: { before: `${win.nextStart}T00:00:00.000Z` } },
    ],
  });
  return pages.map((p) => ({ action: p.properties?.Action?.select?.name || null }));
}

// ---------------------------------------------------------------- the one-pager (pdfkit)

function fmtDur(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Render the branded one-page PDF. Returns a Promise<Buffer>. */
function renderReportPdf(stats) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 612;

    // Header band + wave
    doc.rect(0, 0, W, 130).fill(BRAND_DARK);
    doc.rect(0, 0, W, 4).fill(BRAND);
    doc
      .moveTo(0, 130)
      .bezierCurveTo(W * 0.25, 108, W * 0.45, 152, W * 0.7, 128)
      .bezierCurveTo(W * 0.85, 114, W * 0.95, 132, W, 124)
      .lineTo(W, 160)
      .lineTo(0, 160)
      .closePath()
      .fill(BRAND);
    doc.fillColor('#BFE3E6').font('Helvetica-Bold').fontSize(10).text('N A L U   A G E N C Y', 48, 30, { characterSpacing: 2 });
    doc.fillColor('white').font('Helvetica-Bold').fontSize(26).text('Hukilau Salon', 48, 48);
    doc.fillColor('#D9F0F2').font('Helvetica').fontSize(13).text(`Monthly Receptionist Report — ${stats.monthLabel}`, 48, 82);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(11).text('Every call answered. 24/7.', 48, 104);

    // Stat tiles — 2 rows x 3
    const tiles = [
      { n: String(stats.calls), l: 'CALLS ANSWERED' },
      { n: String(stats.minutes), l: 'MINUTES ON THE LINE' },
      { n: String(stats.bookings), l: 'BOOKING REQUESTS CAPTURED' },
      { n: String(stats.reschedules + stats.cancels), l: 'RESCHEDULES & CANCELS HANDLED' },
      { n: String(stats.messages), l: 'MESSAGES TAKEN' },
      { n: String(stats.afterHours), l: 'AFTER-HOURS CALLS ANSWERED' },
    ];
    const pad = 48;
    const gap = 14;
    const tw = (W - pad * 2 - gap * 2) / 3;
    const th = 110;
    tiles.forEach((t, i) => {
      const x = pad + (i % 3) * (tw + gap);
      const y = 200 + Math.floor(i / 3) * (th + gap);
      doc.roundedRect(x, y, tw, th, 10).fill(TILE_BG);
      doc.roundedRect(x, y, tw, 5, 2).fill(i % 3 === 1 ? BRAND_DARK : BRAND);
      doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(40).text(t.n, x, y + 24, { width: tw, align: 'center' });
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text(t.l, x + 10, y + 78, { width: tw - 20, align: 'center', characterSpacing: 0.5 });
    });

    // Detail strip
    const sy = 200 + 2 * th + gap + 26;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('The month at a glance', pad, sy);
    doc.moveTo(pad, sy + 20).lineTo(W - pad, sy + 20).lineWidth(1).stroke(BRAND);
    const facts = [
      `Busiest day: ${stats.busiestDay}`,
      `Average call: ${fmtDur(stats.avgSeconds)}`,
      `Longest call handled: ${fmtDur(stats.longestSeconds)}`,
      `Calls the salon never had to pick up: all ${stats.calls} of them`,
    ];
    doc.fillColor(INK).font('Helvetica').fontSize(11.5);
    facts.forEach((f, i) => {
      doc.circle(pad + 4, sy + 40 + i * 22 + 5, 2.5).fill(BRAND);
      doc.fillColor(INK).text(f, pad + 16, sy + 40 + i * 22);
    });

    // Note + footer band
    const ny = sy + 40 + facts.length * 22 + 18;
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9.5).text(
      'Booking, reschedule, and cancel requests are captured by your receptionist and confirmed by the salon — exactly as configured. Full call-by-call detail lives in your Call Log.',
      pad, ny, { width: W - pad * 2 }
    );
    doc.rect(0, 792 - 64, W, 64).fill(BRAND_DARK);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text('NALU AGENCY', pad, 792 - 42);
    doc.fillColor('#BFE3E6').font('Helvetica').fontSize(9.5).text('aloha@evannalu.com  ·  (808) 751-0081  ·  evannalu.com', pad + 110, 792 - 41);
    doc.fillColor('#BFE3E6').font('Helvetica').fontSize(9.5).text(stats.monthLabel, 0, 792 - 41, { width: W - pad, align: 'right' });

    doc.end();
  });
}

// ---------------------------------------------------------------- Notion write (upload + page)

async function uploadPdfToNotion(buffer, filename) {
  const created = await notionFetch('file_uploads', { filename, content_type: 'application/pdf' });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  const res = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION() },
    body: form,
  });
  if (!res.ok) throw new Error(`Notion file upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return created.id;
}

const rt = (s) => [{ text: { content: String(s).slice(0, 1900) } }];

async function createReportPage(stats, fileUploadId) {
  const title = `${stats.monthLabel} — Receptionist Report`;
  const line = (label, value) => ({
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ text: { content: `${label}: ` }, annotations: { bold: true } }, { text: { content: String(value) } }] },
  });
  const children = reportChildren(stats, fileUploadId, line);
  try {
    return await notionFetch('pages', {
      parent: { page_id: REPORTS_PAGE_ID() },
      properties: { title: { title: rt(title) } },
      children,
    });
  } catch (err) {
    // The 📊 Monthly Reports page lives under the client brief; if it hasn't been shared with
    // this integration yet, NEVER fail silently on the unattended cron — file the report into
    // the Call Log DB (always writable) flagged for a one-drag move.
    if (!/404/.test(String(err.message))) throw err;
    return notionFetch('pages', {
      parent: { database_id: process.env.NOTION_CALLS_DB_ID },
      properties: {
        Name: { title: rt(`📊 ${title} (needs move → 📊 Monthly Reports)`) },
        Client: { select: { name: process.env.CLIENT_NAME || 'Hukilau Salon' } },
        When: { date: { start: new Date().toISOString() } },
      },
      children,
    });
  }
}

function reportChildren(stats, fileUploadId, line) {
  return [
      { object: 'block', type: 'pdf', pdf: { type: 'file_upload', file_upload: { id: fileUploadId } } },
      { object: 'block', type: 'divider', divider: {} },
      { object: 'block', type: 'heading_3', heading_3: { rich_text: rt('The numbers') } },
      line('Calls answered', stats.calls),
      line('Minutes on the line', stats.minutes),
      line('Booking requests captured', stats.bookings),
      line('Reschedules / cancels handled', `${stats.reschedules} / ${stats.cancels}`),
      line('Messages taken', stats.messages),
      line('After-hours calls answered', stats.afterHours),
      line('Busiest day', stats.busiestDay),
      line('Average call', fmtDur(stats.avgSeconds)),
      { object: 'block', type: 'paragraph', paragraph: { rich_text: rt('Generated automatically from the Call Log + Booking Requests archives.') } },
  ];
}

// ---------------------------------------------------------------- entry point

/** Build + publish the report for monthStr ("YYYY-MM"). Returns {stats, pageUrl}. */
async function publishMonthlyReport(monthStr) {
  const win = monthWindow(monthStr);
  if (!win) throw new Error(`bad month "${monthStr}" — expected YYYY-MM`);
  const [callPages, bookingPages] = await Promise.all([fetchMonthCalls(win), fetchMonthBookings(win)]);
  const stats = computeStats(callPages, bookingPages, win.label);
  const pdf = await renderReportPdf(stats);
  const uploadId = await uploadPdfToNotion(pdf, `hukilau-report-${monthStr}.pdf`);
  const page = await createReportPage(stats, uploadId);
  return { stats, pageUrl: page.url };
}

/** Stats only (dry run) — no PDF, no writes. */
async function dryRunStats(monthStr) {
  const win = monthWindow(monthStr);
  if (!win) throw new Error(`bad month "${monthStr}" — expected YYYY-MM`);
  const [callPages, bookingPages] = await Promise.all([fetchMonthCalls(win), fetchMonthBookings(win)]);
  return computeStats(callPages, bookingPages, win.label);
}

module.exports = {
  isConfigured,
  monthWindow,
  previousMonthStr,
  computeStats,
  renderReportPdf,
  publishMonthlyReport,
  dryRunStats,
};
