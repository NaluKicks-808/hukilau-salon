'use strict';

/**
 * Config audit: for every service, show each stylist's bookability and flag inconsistencies.
 *
 * The receptionist mirrors the salon's ONLINE booking rules exactly: a stylist is offered for a
 * service only when their per-service config has BOTH `offered` AND `offeredOnline` true (this is
 * the salon's own cbbe2.js rule). When those two flags disagree, the stylist silently disappears
 * for that service online — even if they're free and actually perform it (e.g. Amanda + Men's
 * Haircut). Those mismatches are almost always accidental toggles worth fixing in Salon Scheduler.
 *
 *   npm run audit
 */

process.env.TZ = process.env.SALON_TZ || 'Pacific/Honolulu';
const { getSalonData } = require('../src/salonClient');

function classify(cfg) {
  if (!cfg) return { sym: '—', bad: false };
  const offered = !!cfg.offered;
  const online = !!cfg.offeredOnline;
  if (offered && online) return { sym: '✓', bad: false };
  if (!offered && !online) return { sym: '·', bad: false };
  return { sym: '⚠', bad: true, note: `offered=${offered} offeredOnline=${online}` };
}

const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);

(async () => {
  const d = await getSalonData({ force: true });
  const emps = d.employeeJSON;
  const cols = emps.map((e) => e.name.split(' ')[0]);

  const inconsistencies = [];
  const deadServices = [];
  const rows = [];

  d.serviceJSON.forEach((svc) => {
    const cells = emps.map((e) => {
      const cfg = (e.serviceCfgs || []).find((c) => c.posID === svc.posID);
      const r = classify(cfg);
      if (r.bad) inconsistencies.push(`${e.name} — ${svc.name}: ${r.note}`);
      return r.sym;
    });
    const bookable = cells.filter((c) => c === '✓').length;
    if (bookable === 0) deadServices.push(svc.name);
    rows.push({ name: svc.name, cells });
  });

  console.log('\nLEGEND:  ✓ bookable online   · not offered   ⚠ INCONSISTENT (one flag on, one off)   — no entry\n');
  console.log(pad('SERVICE', 32) + cols.map((c) => pad(c, 10)).join(''));
  console.log('-'.repeat(32 + cols.length * 10));
  rows.forEach((r) => {
    const flag = r.cells.includes('⚠') ? '  <- review' : '';
    console.log(pad(r.name, 32) + r.cells.map((c) => pad(c, 10)).join('') + flag);
  });

  console.log(`\n⚠ INCONSISTENCIES (${inconsistencies.length}) — likely accidental toggles to fix in Salon Scheduler:`);
  inconsistencies.length ? inconsistencies.forEach((s) => console.log('   ⚠ ' + s)) : console.log('   (none)');

  console.log(`\n✗ SERVICES NO STYLIST IS ONLINE-BOOKABLE FOR (${deadServices.length}):`);
  deadServices.length ? deadServices.forEach((s) => console.log('   ✗ ' + s)) : console.log('   (none)');
  console.log('');
})().catch((e) => {
  console.error('audit failed:', e.message);
  process.exit(1);
});
