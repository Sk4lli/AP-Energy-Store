// Buying several ticked rows at once: one charge for the sum, every row checked, and a clear
// result when the balance is not enough for the whole selection.
//
// Needs the mock with --pages 3.
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

const price = () => p.evaluate(() => window.energylinkStore.model.priceOf(1));
const energy = () => p.evaluate(() => window.energylinkStore.store.energy);
const bought = () => p.evaluate(() => window.energylinkStore.model.currentPage.bought);

// --- three rows in one go
const price1 = await price();
const before1 = await energy();
for (let i = 0; i < 3; i += 1) {
    await p.locator('.location__check:not([disabled])').nth(i).check();
}
await p.waitForTimeout(200);
ck('three rows selected', await p.evaluate(() => window.energylinkStore.model.selectedCount) === 3);
// The store formats the sum ("3 MJ"), so compare against the same formatter.
const { formatEnergy } = await import('../js/util.js');
ck('summary names the sum',
    (await p.textContent('#store-message'))?.includes(formatEnergy(3 * price1, 'de-DE')),
    await p.textContent('#store-message'));

await p.click('#buy-button');
await p.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 3, null, { timeout: 12000 });
await p.waitForTimeout(600);
ck('one charge for all three', await energy() === before1 - 3 * price1, `${before1} - ${3 * price1} -> ${await energy()}`);
ck('three locations checked server side',
    await p.evaluate(() => [...window.energylinkStore.store.checkedLocationIds()].length) === 3);
ck('all three rows show as bought', await bought() === 3, String(await bought()));
ck('selection is empty afterwards', await p.evaluate(() => window.energylinkStore.model.selectedCount) === 0);

// --- a selection the balance cannot cover is refused, and nothing is charged
console.log('too expensive');
const left = await p.evaluate(() => window.energylinkStore.model.currentPage.total
    - window.energylinkStore.model.currentPage.bought);
for (let i = 0; i < left; i += 1) {
    await p.locator('.location__check:not([disabled])').nth(i).check();
}
await p.evaluate(async () => {
    const { store } = window.energylinkStore;
    const price = window.energylinkStore.model.priceOf(1);
    // Just below what the selection costs.
    await store._setStorage(store.energyKey, [{ operation: 'replace', value: price }], 0);
    await store.refreshEnergy(true);
});
await p.waitForTimeout(400);
ck('buy button disabled when the sum does not fit', await p.isDisabled('#buy-button'));
ck('message explains the missing joules', /Joule|joule/i.test(await p.textContent('#store-message') ?? ''),
    await p.textContent('#store-message'));
ck('balance untouched', await energy() === price1, String(await energy()));
ck('nothing bought', await bought() === 3, String(await bought()));

// --- enough for one row, so exactly one row goes through
console.log('enough for one');
await p.evaluate(async () => {
    const { store } = window.energylinkStore;
    await store._setStorage(store.energyKey, [{ operation: 'replace', value: 10000000 }], 0);
    await store.refreshEnergy(true);
});
await p.waitForTimeout(300);
await p.evaluate(() => window.energylinkStore.model.clearSelection());
await p.waitForTimeout(200);
await p.locator('.location__check:not([disabled])').first().check();
await p.waitForTimeout(200);
const before3 = await energy();
await p.click('#buy-button');
await p.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 4, null, { timeout: 12000 });
await p.waitForTimeout(500);
ck('exactly one price charged', await energy() === before3 - price1, `${before3} - ${price1} -> ${await energy()}`);

// --- select all via the console, buy via the console
console.log('console');
await p.evaluate(() => window.energylinkStore.model.clearSelection());
await p.fill('[data-console-input]', 'select all');
await p.press('[data-console-input]', 'Enter');
await p.waitForTimeout(400);
ck('select all ticks the open rows',
    await p.evaluate(() => window.energylinkStore.model.selectedCount) === 1,
    String(await p.evaluate(() => window.energylinkStore.model.selectedCount)));
await p.fill('[data-console-input]', 'buy');
await p.press('[data-console-input]', 'Enter');
await p.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 5, null, { timeout: 12000 });
ck('console buy bought the selection', await bought() === 5, String(await bought()));

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nMULTI BUY PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
