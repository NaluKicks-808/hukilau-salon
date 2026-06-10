'use strict';

/**
 * Diagnostic: fetch the live booking page and dump the extracted merchant config,
 * stylists (with their index), and services (with index/duration/price).
 *
 * Run after re-snapshotting the page to confirm extraction still works and to update
 * the alias maps in src/stylists.js / src/services.js if names or indexes changed.
 *
 *   npm run inspect
 */

const { getSalonData } = require('../src/salonClient');

(async () => {
  const d = await getSalonData({ force: true });
  console.log('merchantId :', d.merchantId);
  console.log(
    'config     : timezone=%s prepay=%s monthsx=%s advance=%s',
    d.jsonMerchant.timezone,
    d.prepay,
    d.monthsx,
    d.advance
  );
  console.log(
    'increments : hour=%s online=%s',
    d.jsonMerchant.hourIncrements,
    d.jsonMerchant.onlineIncrements
  );

  console.log(`\nSTYLISTS (${d.employeeJSON.length}):`);
  d.employeeJSON.forEach((e, i) => {
    console.log(
      `  [${i}] ${e.name}  posID=${e.posID}  online=${e.performsOnlineServices}  type=${
        e.type ?? 0
      }  serviceCfgs=${(e.serviceCfgs || []).length}`
    );
  });

  console.log(`\nSERVICES (${d.serviceJSON.length}):`);
  d.serviceJSON.forEach((s, i) => {
    console.log(`  [${i}] ${s.name}  posID=${s.posID}  dur=${s.duration}  price=${s.price}`);
  });
})().catch((err) => {
  console.error('inspect failed:', err.message);
  process.exit(1);
});
