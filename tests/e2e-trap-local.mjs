// A trap must hurt the player who buys it, not someone else in the multiworld.
// Regression: the trap counted only when the item arrived at the own slot, so buying a location
// whose trap went to another player did nothing.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const SLOT = process.env.SLOT ?? 'Player1';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', SLOT);
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 15000 });
await p.waitForTimeout(800);
await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 20000000 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

const buys = [];
for (let i = 0; i < 6; i += 1) {
  const before = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    tax: window.energylinkStore.store.trapEffects.tax,
    inflation: window.energylinkStore.store.trapEffects.inflation,
    bought: window.energylinkStore.model.currentPage.bought,
    kind: window.energylinkStore.model.currentPage.slots.find((s) => !s.bought)?.kind,
  }));
  await p.click('#buy-button');
  await p.waitForFunction((n) => window.energylinkStore.model.currentPage.bought > n, before.bought, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    tax: window.energylinkStore.store.trapEffects.tax,
    inflation: window.energylinkStore.store.trapEffects.inflation,
    received: window.energylinkStore.store.received,
  }));
  buys.push({ before, after });
  console.log(`  buy ${i + 1}: kind=${before.kind} price ${before.price}->${after.price} ` +
    `energy ${before.energy}->${after.energy} traps(tax=${after.tax},infl=${after.inflation})`);
}

const gotInflation = buys.some((x) => x.after.inflation > x.before.inflation);
const gotTax = buys.some((x) => x.after.tax > x.before.tax);
console.log('   traps received by this slot:', await p.evaluate(() => window.energylinkStore.store.trapEffects));
ck('inflation trap reached the buyer', gotInflation, JSON.stringify(buys.map((x) => x.after.inflation)));
ck('tax trap reached the buyer', gotTax, JSON.stringify(buys.map((x) => x.after.tax)));
ck('inflation raised prices', buys.some((x) => x.after.price > x.before.price), JSON.stringify(buys.map((x) => [x.before.price, x.after.price])));
ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP LOCALITY PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
