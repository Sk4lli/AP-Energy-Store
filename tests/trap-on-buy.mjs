// A trap must take effect when the location containing it is bought, no matter where the
// item itself was placed in the multiworld.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1200);

// The test owns the pool, so it does not depend on what earlier runs left behind.
await p.evaluate(async () => {
    const { store } = window.energylinkStore;
    await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
    await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

const cfg = await p.evaluate(() => window.energylinkStore.model.config);
console.log('    config:', JSON.stringify({ tax: cfg.taxPerTrap, inflation: cfg.inflationPerTrap }));

// What is in the first locations (from scouting)?
const plan = await p.evaluate(() => window.energylinkStore.model.currentPage.slots
    .map((s) => ({ n: s.index, kind: s.kind, name: window.energylinkStore.store.scoutedNames[s.id] })));
console.log('    page 1:', JSON.stringify(plan));

const start = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
}));
console.log('    start:', JSON.stringify(start));

// Buy the first location (an Inflation Trap in the mock) and check the pool really shrank.
const results = [];
for (let i = 0; i < 4; i += 1) {
    const before = await p.evaluate(() => ({
        energy: window.energylinkStore.store.energy,
        price: window.energylinkStore.model.priceOf(1),
        tax: window.energylinkStore.store.trapEffects.tax,
        inflation: window.energylinkStore.store.trapEffects.inflation,
        bought: window.energylinkStore.model.currentPage.bought,
        name: window.energylinkStore.store.scoutedNames[window.energylinkStore.model.currentPage.slots.find((s) => !s.bought)?.id],
    }));
    const result = await p.evaluate(() => window.energylinkStore.console().run('buy'));
    await p.waitForFunction((n) => window.energylinkStore.model.currentPage.bought > n, before.bought, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const after = await p.evaluate(() => ({
        energy: window.energylinkStore.store.energy,
        price: window.energylinkStore.model.priceOf(1),
        tax: window.energylinkStore.store.trapEffects.tax,
        inflation: window.energylinkStore.store.trapEffects.inflation,
    }));
    results.push({ before, after });
    console.log(`  buy ${i + 1} (${before.name}): energy ${before.energy}->${after.energy} ` +
        `price ${before.price}->${after.price} tax=${after.tax} inflation=${after.inflation}`);
}

const infl = results.filter((r) => r.before.name === 'Inflation Trap');
const tax = results.filter((r) => r.before.name === 'Tax Trap');

ck('inflation trap was bought', infl.length > 0, String(infl.length));
ck('inflation burned the pool', infl.every((r) => {
    const paid = r.before.price;
    const burned = r.before.energy - r.after.energy - paid;
    return Math.abs(burned - Math.round((r.before.energy - paid) * 0.2)) <= 2;
}), JSON.stringify(infl.map((r) => [r.before.energy, r.after.energy, r.before.price])));

ck('tax trap was bought', tax.length > 0, String(tax.length));
ck('tax raised the price', tax.every((r) => r.after.price > r.before.price),
    JSON.stringify(tax.map((r) => [r.before.price, r.after.price])));

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP ON BUY PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
