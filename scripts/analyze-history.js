'use strict';

/**
 * One-off, READ-ONLY analytics pull: ~6 months of booked appointments from the salon backend,
 * aggregated to find the most popular services / stylists / times and to surface anything the
 * voice agent should handle better. Writes NO data anywhere and prints NO customer PII
 * (names/phones are deliberately never emitted — only counts and timing).
 */

const moment = require('moment-timezone');
const { getBookedAppointments, getSalonData } = require('../src/salonClient');

const TZ = process.env.SALON_TZ || 'Pacific/Honolulu';
const MONTHS_BACK = Number(process.env.MONTHS_BACK || 6);
const CHUNK_DAYS = 30;

// --- helpers -------------------------------------------------------------

function durToMin(d) {
  if (typeof d === 'number') return d;
  if (!d || typeof d !== 'string') return 0;
  const p = d.split(':').map((x) => parseInt(x, 10) || 0);
  if (p.length === 3) return p[0] * 60 + p[1] + Math.round(p[2] / 60);
  if (p.length === 2) return p[0] * 60 + p[1];
  return 0;
}

// Find a value on an object trying several candidate keys (handles POSID/posID/id variants).
function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return undefined;
}

function pct(n, total) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : '0%';
}

function bar(n, max, width = 28) {
  const len = max ? Math.round((n / max) * width) : 0;
  return '█'.repeat(len) + '·'.repeat(width - len);
}

function topTable(map, { limit = 100, total } = {}) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const max = rows.length ? rows[0][1] : 0;
  const grand = total != null ? total : [...map.values()].reduce((s, v) => s + v, 0);
  return rows
    .map(([k, v]) => `  ${String(k).padEnd(34)} ${String(v).padStart(5)}  ${pct(v, grand).padStart(6)}  ${bar(v, max)}`)
    .join('\n');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- main ----------------------------------------------------------------

(async () => {
  const salon = await getSalonData();
  const { serviceJSON, employeeJSON } = salon;

  // Build POSID -> name maps (defensive about exact key names).
  const svcKeys = ['servicePOSID', 'POSID', 'posID', 'posId', 'id', 'serviceId'];
  const empKeys = ['POSID', 'posID', 'posId', 'employeePOSID', 'id', 'employeeId'];
  const svcMap = new Map();
  for (const s of serviceJSON) {
    const id = pick(s, svcKeys);
    const name = pick(s, ['serviceName', 'name', 'title']);
    if (id != null) svcMap.set(String(id), { name: name || String(id), priceCents: pick(s, ['price', 'priceCents']) || 0 });
  }
  const empMap = new Map();
  for (const e of employeeJSON) {
    const id = pick(e, empKeys);
    const name = pick(e, ['employeeName', 'name', 'firstName', 'title', 'fullName']);
    if (id != null) empMap.set(String(id), name || String(id));
  }

  console.log(`Loaded ${serviceJSON.length} services, ${employeeJSON.length} employees.`);
  console.log(`Service sample keys: ${Object.keys(serviceJSON[0] || {}).join(', ')}`);
  console.log(`Employee sample keys: ${Object.keys(employeeJSON[0] || {}).join(', ')}`);

  // Pull the window in chunks, deduped by appointment id.
  const now = moment.tz(TZ);
  const windowStart = now.clone().subtract(MONTHS_BACK, 'months').startOf('day');
  console.log(`\nPulling ${windowStart.format('YYYY-MM-DD')} -> ${now.format('YYYY-MM-DD')} (${MONTHS_BACK} months)...`);

  const byId = new Map();
  let cursor = windowStart.clone();
  let chunks = 0;
  while (cursor.isBefore(now)) {
    const days = Math.min(CHUNK_DAYS, now.diff(cursor, 'days') + 1);
    let appts = [];
    try {
      appts = await getBookedAppointments(cursor.valueOf(), days, { force: true });
    } catch (e) {
      console.log(`  chunk ${cursor.format('YYYY-MM-DD')} (+${days}d) ERROR: ${e.message}`);
    }
    for (const a of appts) if (a && a.id != null) byId.set(String(a.id), a);
    chunks++;
    process.stdout.write(`  chunk ${cursor.format('YYYY-MM-DD')} (+${days}d): ${appts.length} raw, ${byId.size} unique\n`);
    cursor.add(days, 'days');
  }

  const all = [...byId.values()];
  console.log(`\nTotal unique records pulled: ${all.length} (from ${chunks} chunks)`);

  // Decode type/status distributions to understand the data.
  const typeDist = new Map();
  const statusDist = new Map();
  const custStatusDist = new Map();
  for (const a of all) {
    typeDist.set(a.type, (typeDist.get(a.type) || 0) + 1);
    statusDist.set(a.status, (statusDist.get(a.status) || 0) + 1);
    custStatusDist.set(a.customerStatus, (custStatusDist.get(a.customerStatus) || 0) + 1);
  }
  const fmtDist = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
  console.log(`type distribution:          ${fmtDist(typeDist)}`);
  console.log(`status distribution:        ${fmtDist(statusDist)}`);
  console.log(`customerStatus distribution:${fmtDist(custStatusDist)}`);

  // Classify each appointment. A "real booking" = at least one serviceBinding whose servicePOSID
  // is NOT a TIMEOFF/block marker. TIMEOFF blocks are the salon blocking out staff time.
  const isBlockPosid = (pid) => !pid || /TIMEOFF|BREAK|BLOCK/i.test(String(pid));

  const svcCount = new Map();        // service name -> # of service-bindings booked
  const svcUnknownPosids = new Map(); // unresolved servicePOSID -> count
  const empCount = new Map();         // stylist -> # of real appointments
  const dow = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  const monthCount = new Map();
  let realAppts = 0;
  let blockAppts = 0;
  let comboAppts = 0;
  let totalServiceMinutes = 0;
  let varpriceBindings = 0;
  const comboPairs = new Map();

  for (const a of all) {
    const bindings = Array.isArray(a.serviceBindings) ? a.serviceBindings : [];
    const realBindings = bindings.filter((b) => !isBlockPosid(pick(b, ['servicePOSID', 'serviceId', 'POSID'])));
    if (!realBindings.length) {
      blockAppts++;
      continue;
    }
    realAppts++;

    // Time bucketing from localStart ("6/1/2026 9:00 AM") parsed in salon tz.
    const m = moment.tz(a.localStart, ['M/D/YYYY h:mm A', 'M/D/YYYY H:mm'], TZ);
    if (m.isValid()) {
      dow[m.day()]++;
      hour[m.hour()]++;
      const mk = m.format('YYYY-MM');
      monthCount.set(mk, (monthCount.get(mk) || 0) + 1);
    }

    // Stylist: from the appointment's first real binding's employee, else customerPOSID owner.
    const empId = pick(realBindings[0], ['svcEmployeePOSID', 'employeePOSID', 'employeeId']);
    const empName = empMap.get(String(empId)) || `emp:${empId}`;
    empCount.set(empName, (empCount.get(empName) || 0) + 1);

    const namesThisAppt = [];
    for (const b of realBindings) {
      const pid = String(pick(b, ['servicePOSID', 'serviceId', 'POSID']));
      const svc = svcMap.get(pid);
      const name = svc ? svc.name : `unknown:${pid}`;
      if (!svc) svcUnknownPosids.set(pid, (svcUnknownPosids.get(pid) || 0) + 1);
      svcCount.set(name, (svcCount.get(name) || 0) + 1);
      namesThisAppt.push(name);
      totalServiceMinutes += durToMin(pick(b, ['duration']));
      if (pick(b, ['varprice'])) varpriceBindings++;
    }
    if (realBindings.length > 1) {
      comboAppts++;
      const key = [...new Set(namesThisAppt)].sort().join(' + ');
      comboPairs.set(key, (comboPairs.get(key) || 0) + 1);
    }
  }

  console.log(`\n=== CLASSIFICATION ===`);
  console.log(`Real customer appointments: ${realAppts}`);
  console.log(`Time-off / block entries:   ${blockAppts}`);
  console.log(`Combo appointments (2+ svc):${comboAppts} (${pct(comboAppts, realAppts)} of real)`);
  console.log(`Avg service minutes/appt:   ${realAppts ? Math.round(totalServiceMinutes / realAppts) : 0}`);
  console.log(`Bindings with varprice flag:${varpriceBindings}`);

  console.log(`\n=== TOP SERVICES (by # booked, ${MONTHS_BACK} mo) ===`);
  console.log(topTable(svcCount, { limit: 30 }));

  console.log(`\n=== BOOKINGS PER STYLIST ===`);
  console.log(topTable(empCount));

  console.log(`\n=== DAY OF WEEK ===`);
  const dowMap = new Map(WEEKDAYS.map((w, i) => [w, dow[i]]));
  console.log(topTableOrdered(dowMap, WEEKDAYS));

  console.log(`\n=== HOUR OF DAY (start time) ===`);
  const maxHour = Math.max(...hour);
  for (let h = 6; h <= 20; h++) {
    if (!hour[h]) continue;
    const label = moment().hour(h).minute(0).format('h A');
    console.log(`  ${label.padStart(5)}  ${String(hour[h]).padStart(5)}  ${bar(hour[h], maxHour)}`);
  }

  console.log(`\n=== BY MONTH ===`);
  console.log(topTableOrdered(monthCount, [...monthCount.keys()].sort()));

  if (comboPairs.size) {
    console.log(`\n=== TOP COMBOS ===`);
    console.log(topTable(comboPairs, { limit: 12 }));
  }

  if (svcUnknownPosids.size) {
    console.log(`\n=== UNRESOLVED service POSIDs (booked but not matched to serviceJSON) ===`);
    console.log(topTable(svcUnknownPosids, { limit: 20 }));
  }

  // Bookable-online cross check: which of the top services are actually online-bookable?
  console.log(`\nDone.`);

  function topTableOrdered(map, order) {
    const max = Math.max(0, ...[...map.values()]);
    const grand = [...map.values()].reduce((s, v) => s + v, 0);
    return order
      .map((k) => {
        const v = map.get(k) || 0;
        return `  ${String(k).padEnd(10)} ${String(v).padStart(5)}  ${pct(v, grand).padStart(6)}  ${bar(v, max)}`;
      })
      .join('\n');
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
