'use strict';
// READ-ONLY follow-up probe: identify the unknown service, test our resolver against the real
// top services, and quantify the online-bookability funnel per stylist. Prints no customer PII.

const moment = require('moment-timezone');
const { getBookedAppointments, getSalonData } = require('../src/salonClient');
const { resolveServices } = require('../src/services');
const TZ = process.env.SALON_TZ || 'Pacific/Honolulu';

(async () => {
  const salon = await getSalonData();
  const { serviceJSON, employeeJSON } = salon;

  // 1) Hunt the unknown POSID across EVERY field of every service (incl. invisible/deleted-ish).
  const UNKNOWN = 'X2MPQE0SQ4QP8';
  console.log('=== 1) Identify unknown service', UNKNOWN, '===');
  let found = null;
  for (const s of serviceJSON) {
    for (const [k, v] of Object.entries(s)) {
      if (String(v) === UNKNOWN) found = { matchedKey: k, name: s.name, invisible: s.invisible, price: s.price, duration: s.duration };
    }
  }
  console.log('  in current serviceJSON?', found ? JSON.stringify(found) : 'NO — not present at all (deleted/hidden service)');

  // Pull a 6-month window once to inspect the unknown service's bookings (durations only, no PII).
  const now = moment.tz(TZ);
  const byId = new Map();
  let cur = now.clone().subtract(6, 'months').startOf('day');
  while (cur.isBefore(now)) {
    const days = Math.min(30, now.diff(cur, 'days') + 1);
    let appts = [];
    try { appts = await getBookedAppointments(cur.valueOf(), days, { force: true }); } catch (_) {}
    for (const a of appts) if (a && a.id != null) byId.set(String(a.id), a);
    cur.add(days, 'days');
  }
  const all = [...byId.values()];
  const durs = new Map();
  const empOfUnknown = new Map();
  const empMap = new Map(employeeJSON.map((e) => [String(e.posID), e.name]));
  for (const a of all) {
    for (const b of a.serviceBindings || []) {
      if (String(b.servicePOSID) === UNKNOWN) {
        durs.set(b.duration, (durs.get(b.duration) || 0) + 1);
        const en = empMap.get(String(b.svcEmployeePOSID)) || b.svcEmployeePOSID;
        empOfUnknown.set(en, (empOfUnknown.get(en) || 0) + 1);
      }
    }
  }
  console.log('  durations seen:', [...durs.entries()].map(([d, n]) => `${d}×${n}`).join(', '));
  console.log('  performed by:  ', [...empOfUnknown.entries()].map(([e, n]) => `${e}×${n}`).join(', '));

  // 2) Resolver check against the real top services + likely caller phrasings.
  console.log('\n=== 2) Does our service resolver match what callers actually book? ===');
  const tests = [
    "Women's Cut", "haircut", "women's haircut", "men's haircut", "Missionary Cut", "missionary cut",
    "Gray Root Retouch", "gray retouch", "root touch up", "Half Head Highlights", "highlights",
    "Regular Blowout", "blowout", "Toner", "toner", "Up Do", "updo", "Whole Head Color", "color",
    "Cut & Style", "perm", "balayage", "brow tint",
  ];
  for (const t of tests) {
    const { matches, unresolved } = resolveServices([t], serviceJSON);
    if (matches.length) console.log(`  "${t}"`.padEnd(26), '->', matches.map((m) => m.name).join(' / '));
    else {
      const cand = (unresolved[0] && unresolved[0].candidates || []).map((c) => c.name).slice(0, 3).join(', ');
      console.log(`  "${t}"`.padEnd(26), '-> ❌ UNRESOLVED', cand ? `(suggests: ${cand})` : '');
    }
  }

  // 3) Online-bookability funnel for the top services (offered && offeredOnline per employee).
  console.log('\n=== 3) Online-bookable-by per top service ===');
  const tops = ["Women's Cut", "Men's Haircut", "Women's Cut & Style", "Gray Root Retouch",
    "Half Head Highlights", "Regular Blowout", "Missionary Cut", "Whole Head Color", "Up Do's", "Brows"];
  // employee serviceCfgs encode per-service offered/online flags; detect the shape defensively.
  const svcByName = new Map(serviceJSON.map((s) => [s.name, s]));
  for (const name of tops) {
    const svc = svcByName.get(name);
    if (!svc) { console.log(`  ${name.padEnd(24)} (not in serviceJSON)`); continue; }
    const who = [];
    for (const e of employeeJSON) {
      const cfgs = e.serviceCfgs || [];
      const cfg = cfgs.find((c) => String(c.servicePOSID || c.posID || c.id) === String(svc.posID));
      if (cfg && (cfg.offered ?? true) && (cfg.offeredOnline ?? cfg.online ?? false)) who.push(e.name.split(' ')[0]);
    }
    console.log(`  ${name.padEnd(24)} -> ${who.length ? who.join(', ') : '⚠ none online'}`);
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
