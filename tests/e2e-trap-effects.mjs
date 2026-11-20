// Both traps must do something visible on the EnergyLink pool:
//   Inflation Trap  burns a share of the pool (default 20 %)
//   Tax Trap        raises every price permanently (default +10 %)
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
await p.waitForTimeout(1000);

const cfg = await p.evaluate(() => window.energylinkStore.model.config);
console.log('    config tax/inflation:', cfg.taxPerTrap, cfg.inflationPerTrap);
ck('tax fraction read from slot_data', Math.abs(cfg.taxPerTrap - 0.1) < 0.001, String(cfg.taxPerTrap));
ck('inflation fraction read from slot_data', Math.abs(cfg.inflationPerTrap - 0.2) < 0.001, String(cfg.inflationPerTrap));

await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

const steps = [];
for (let i = 0; i < 4; i += 1) {
  const before = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    tax: window.energylinkStore.store.trapEffects.tax,
    inflation: window.energylinkStore.store.trapEffects.inflation,
    bought: window.energylinkStore.model.currentPage.bought,
    kind: window.energylinkStore.model.currentPage.slots.find((s) => !s.bought)?.kind,
  }));
  await p.click('#buy-button');
  await p.waitForFunction((n) => window.energylinkStore.model.currentPage.bought > n, before.bought, { timeout: 10000 });
  await p.waitForTimeout(1400);
  const after = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    tax: window.energylinkStore.store.trapEffects.tax,
    inflation: window.energylinkStore.store.trapEffects.inflation,
  }));
  steps.push({ before, after });
  console.log(`  buy ${i + 1} (${before.kind}): energy ${before.energy}->${after.energy} ` +
    `price ${before.price}->${after.price} tax=${after.tax} inflation=${after.inflation}`);
}

const inflationBuys = steps.filter((s) => s.after.inflation > s.before.inflation);
const taxBuys = steps.filter((s) => s.after.tax > s.before.tax);

ck('at least one inflation trap bought', inflationBuys.length > 0, String(inflationBuys.length));
ck('at least one tax trap bought', taxBuys.length > 0, String(taxBuys.length));

// Inflation: the price is paid first, then 20 % of the remaining pool burns.
for (const s of inflationBuys) {
  const paid = s.before.price;
  const burned = s.before.energy - s.after.energy - paid;
  const expected = Math.round((s.before.energy - paid) * 0.2);
  ck(`inflation burned ~20% of the remaining pool (buy ${s.before.bought + 1})`,
    Math.abs(burned - expected) <= 2, `burned=${burned} expected=${expected} paid=${paid}`);
}

// Tax: the price of the next location must be higher
for (const s of taxBuys) {
  ck(`tax raised the price (buy ${s.before.bought + 1})`, s.after.price > s.before.price,
    `${s.before.price} -> ${s.after.price}`);
}

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP EFFECTS PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
