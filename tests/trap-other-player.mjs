// Buying a location whose item belongs to another player must not fire its trap.
//
// The trap fires when its item arrives here. If the item goes to someone else, the trap belongs
// to that player's store and the pool of this store stays untouched.
//
// Needs the mock with --items-to-other 2, so the bought items are addressed to slot 2.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1200);

await p.evaluate(async () => {
    const { store } = window.energylinkStore;
    await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
    await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

const layout = await p.evaluate(() => window.energylinkStore.model.currentPage.slots
    .map((s) => ({ n: s.index, id: s.id, name: window.energylinkStore.store.scoutedNames[s.id] })));
const inflationSlot = layout.find((s) => s.name === 'Inflation Trap');
const taxSlot = layout.find((s) => s.name === 'Tax Trap');
ck('layout has the traps', Boolean(inflationSlot && taxSlot), JSON.stringify(layout));

const before = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    inflation: window.energylinkStore.store.trapEffects.inflation,
    tax: window.energylinkStore.store.trapEffects.tax,
    burnt: window.energylinkStore.store.inflationDone.size,
}));

// Buy the Inflation Trap; its item belongs to slot 2, so it never arrives here.
await p.evaluate((n) => window.energylinkStore.console().run(`buy ${n}`), inflationSlot.n);
await p.waitForTimeout(1600);
const afterInflation = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    price: window.energylinkStore.model.priceOf(1),
    inflation: window.energylinkStore.store.trapEffects.inflation,
    tax: window.energylinkStore.store.trapEffects.tax,
    burnt: window.energylinkStore.store.inflationDone.size,
    received: window.energylinkStore.store.receivedItems.map((i) => i.name),
}));
console.log(`    bought inflation trap of another player: energy ${before.energy}->${afterInflation.energy}, ` +
    `inflation ${before.inflation}->${afterInflation.inflation}, received ${JSON.stringify(afterInflation.received)}`);

ck('the location was bought', afterInflation.energy === before.energy - before.price,
    `${before.energy} - ${before.price} -> ${afterInflation.energy}`);
ck('no inflation counter without the item', afterInflation.inflation === before.inflation,
    `${before.inflation} -> ${afterInflation.inflation}`);
ck('the pool was not burnt', afterInflation.burnt === before.burnt, `${before.burnt} -> ${afterInflation.burnt}`);
ck('the item did not arrive here', !afterInflation.received.includes('Inflation Trap'),
    JSON.stringify(afterInflation.received));

// Same for the Tax Trap: no item, so no price increase.
await p.evaluate((n) => window.energylinkStore.console().run(`buy ${n}`), taxSlot.n);
await p.waitForTimeout(1600);
const afterTax = await p.evaluate(() => ({
    tax: window.energylinkStore.store.trapEffects.tax,
    price: window.energylinkStore.model.priceOf(1),
}));
console.log(`    bought tax trap of another player: tax ${afterInflation.tax}->${afterTax.tax}, price ${afterInflation.price}->${afterTax.price}`);
ck('no tax without the item', afterTax.tax === afterInflation.tax, `${afterInflation.tax} -> ${afterTax.tax}`);
ck('prices stayed the same', afterTax.price === afterInflation.price, `${afterInflation.price} -> ${afterTax.price}`);

// A reconnect must not change any of this either.
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1500);
const afterReload = await p.evaluate(() => ({
    energy: window.energylinkStore.store.energy,
    inflation: window.energylinkStore.store.trapEffects.inflation,
    tax: window.energylinkStore.store.trapEffects.tax,
}));
console.log(`    after reconnect: energy ${afterReload.energy}, inflation ${afterReload.inflation}, tax ${afterReload.tax}`);
ck('reconnect keeps the pool', afterReload.energy >= afterTax.price, String(afterReload.energy));
ck('reconnect invents no traps', afterReload.inflation === 0 && afterReload.tax === 0,
    `inflation ${afterReload.inflation}, tax ${afterReload.tax}`);

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nTRAP OTHER PLAYER PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
