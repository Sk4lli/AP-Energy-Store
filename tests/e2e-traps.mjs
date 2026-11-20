// Trap test against a real AP server: buys locations that contain traps and verifies the effects.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'TrapTester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 15000 });
await p.waitForTimeout(700);

await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(500);

const start = await p.evaluate(() => ({
  energy: window.energylinkStore.store.energy,
  price: window.energylinkStore.model.priceOf(1),
  traps: { ...window.energylinkStore.store.trapEffects },
}));
console.log('    start:', JSON.stringify(start));
ck('price is 100k', start.price === 100000, String(start.price));

// Buy several locations and track what each one costs and which trap it dropped.
const buys = [];
for (let i = 0; i < 4; i += 1) {
  const before = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    inflation: window.energylinkStore.store.trapEffects.inflation,
    tax: window.energylinkStore.store.trapEffects.tax,
    bought: window.energylinkStore.model.currentPage.bought,
  }));
  await p.click('#buy-button');
  await p.waitForFunction((n) => window.energylinkStore.model.currentPage.bought > n, before.bought, { timeout: 10000 });
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    inflation: window.energylinkStore.store.trapEffects.inflation,
    tax: window.energylinkStore.store.trapEffects.tax,
    received: window.energylinkStore.store.received,
  }));
  buys.push({ before, after });
  console.log(`    buy ${i + 1}: price ${before.price} -> ${after.price}, energy ${before.energy} -> ${after.energy}, ` +
    `traps tax ${after.tax} inflation ${after.inflation}, got ${after.received[after.received.length - 1]}`);
}

ck('some traps were received', buys.some((x) => x.after.tax + x.after.inflation > 0));
ck('inflation raised the price above 100k', buys.some((x) => x.after.price > 100000), JSON.stringify(buys.map(x => x.after.price)));
ck('inflation price is 25% per trap', buys.every((x) => x.after.price === 100000 * (1 + 0.25 * x.after.inflation)), JSON.stringify(buys.map(x => [x.after.price, x.after.inflation])));
ck('tax took 50k out of the pool', buys.every((x) => {
  const paidPrice = x.before.price;
  const trapCost = (x.after.tax - x.before.tax) * 50000;
  return x.before.energy - x.after.energy === paidPrice + trapCost;
}), JSON.stringify(buys.map(x => [x.before.energy - x.after.energy, x.before.price, x.after.tax - x.before.tax])));
ck('pool not negative', buys.every((x) => x.after.energy >= 0));

await p.screenshot({ path: 'tests/shot-traps.png' });
ck('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP E2E PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
