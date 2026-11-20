// A trap of this store must fire in both cases, but only once per location:
//   1. you buy the location in the store            -> trap fires
//   2. another player buys it, the item arrives here -> trap fires
// The same trap must not count twice, and a reconnect must not replay it.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
// start from a clean slate, the trap state is persisted across reloads
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1200);

// The test owns the pool.
await p.evaluate(async () => {
    const { store } = window.energylinkStore;
    await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
    await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

const layout = await p.evaluate(() => window.energylinkStore.model.currentPage.slots
    .map((s) => ({ n: s.index, id: s.id, name: window.energylinkStore.store.scoutedNames[s.id] })));
console.log('    layout:', JSON.stringify(layout));
const inflationSlot = layout.find((s) => s.name === 'Inflation Trap');
const taxSlot = layout.find((s) => s.name === 'Tax Trap');

// --- 1. buying an inflation trap in the store
const before1 = await p.evaluate(() => ({ energy: window.energylinkStore.store.energy, inflation: window.energylinkStore.store.trapEffects.inflation }));
await p.evaluate((n) => window.energylinkStore.console().run(`buy ${n}`), inflationSlot.n);
await p.waitForTimeout(1400);
const after1 = await p.evaluate(() => ({ energy: window.energylinkStore.store.energy, inflation: window.energylinkStore.store.trapEffects.inflation, fired: window.energylinkStore.store.trapFired.size }));
console.log(`    own inflation buy: energy ${before1.energy}->${after1.energy}, inflation ${before1.inflation}->${after1.inflation}`);
ck('own inflation trap fired', after1.inflation === before1.inflation + 1, String(after1.inflation));
ck('pool was burned', after1.energy < before1.energy - 1000000, `${before1.energy} -> ${after1.energy}`);

// --- 2. the same trap must not count twice when the item arrives as well
await p.evaluate((id) => window.energylinkStore.store.client.socket.send({ cmd: 'DebugPushTrap', location: id }), inflationSlot.id);
await p.waitForTimeout(1200);
const after2 = await p.evaluate(() => ({ inflation: window.energylinkStore.store.trapEffects.inflation, fired: window.energylinkStore.store.trapFired.size }));
console.log(`    after item replay of same location: inflation ${after2.inflation}`);
ck('same location is not counted twice', after2.inflation === after1.inflation, `${after1.inflation} -> ${after2.inflation}`);

// --- 3. a trap that only arrives from another world (not bought here)
const before3 = await p.evaluate(() => ({ tax: window.energylinkStore.store.trapEffects.tax, price: window.energylinkStore.model.priceOf(1) }));
await p.evaluate((id) => window.energylinkStore.store.client.socket.send({ cmd: 'DebugPushTrap', location: id }), taxSlot.id);
await p.waitForTimeout(1400);
const after3 = await p.evaluate(() => ({ tax: window.energylinkStore.store.trapEffects.tax, price: window.energylinkStore.model.priceOf(1), fired: window.energylinkStore.store.trapFired.size }));
console.log(`    incoming tax trap: tax ${before3.tax}->${after3.tax}, price ${before3.price}->${after3.price}`);
ck('incoming trap fired without buying', after3.tax === before3.tax + 1, String(after3.tax));
ck('incoming tax raised the price', after3.price > before3.price, `${before3.price} -> ${after3.price}`);

// --- 4. reconnect must not replay the traps
const before4 = await p.evaluate(() => ({ tax: window.energylinkStore.store.trapEffects.tax, inflation: window.energylinkStore.store.trapEffects.inflation, energy: window.energylinkStore.store.energy }));
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1500);
const after4 = await p.evaluate(() => ({ tax: window.energylinkStore.store.trapEffects.tax, inflation: window.energylinkStore.store.trapEffects.inflation, energy: window.energylinkStore.store.energy }));
console.log(`    after reconnect: tax ${after4.tax} inflation ${after4.inflation} energy ${after4.energy}`);
ck('reconnect does not burn the pool again', after4.energy >= before4.energy - 1000, `${before4.energy} -> ${after4.energy}`);
ck('reconnect restores the counters', after4.tax === before4.tax && after4.inflation === before4.inflation,
    `tax ${before4.tax}->${after4.tax}, inflation ${before4.inflation}->${after4.inflation}`);

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP BOTH WAYS PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
