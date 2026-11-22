// The store must open on the first page that still has something to buy,
// not blindly on page 1.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const SERVER = process.env.SERVER ?? 'localhost:38281';
const SLOT = process.env.SLOT ?? 'Tester';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', SERVER);
await p.fill('#slot-input', SLOT);
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(800);
ck('starts on page 1 when nothing is bought', await p.evaluate(() => window.energylinkStore.model.page) === 1);

// Give the client money and buy page 1 empty via the console.
await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 90000000 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(400);

// Page 2 needs its unlock; without it the store stays on page 1 and says so.
await p.evaluate(() => window.energylinkStore.store.client.socket.send({ cmd: 'DebugPushUnlock', page: 2 }));
await p.waitForTimeout(700);

// Select every row of page 1 and buy them in one go.
await p.evaluate(() => window.energylinkStore.console().run('select all'));
await p.waitForTimeout(300);
await p.evaluate(() => window.energylinkStore.console().run('buy'));
await p.waitForTimeout(1600);
const afterPage1 = await p.evaluate(() => ({
  bought: window.energylinkStore.model.pages[0].bought,
  page: window.energylinkStore.model.page,
}));
console.log('   ', JSON.stringify(afterPage1));
ck('page 1 is sold out', afterPage1.bought === 5, String(afterPage1.bought));
ck('moved to page 2 automatically', afterPage1.page === 2, String(afterPage1.page));

// A reload must land on the first open page, not on page 1.
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', SERVER);
await p.fill('#slot-input', SLOT);
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1200);
const afterReload = await p.evaluate(() => ({
  page: window.energylinkStore.model.page,
  first: window.energylinkStore.model.firstOpenPage(),
  p1bought: window.energylinkStore.model.pages[0].bought,
}));
console.log('   ', JSON.stringify(afterReload));
ck('reconnect opens the first open page', afterReload.page === 2, JSON.stringify(afterReload));
ck('firstOpenPage agrees', afterReload.first === 2, String(afterReload.first));
ck('page 1 still marked sold out', afterReload.p1bought === 5);

// Manual page choice must survive a purchase that does not empty the page.
await p.evaluate(() => window.energylinkStore.model.setPage(1));
await p.waitForTimeout(200);
ck('sold out page can still be viewed', await p.evaluate(() => window.energylinkStore.model.page) === 1);

// Labels must be categories, not "Page 1 Location 1".
const labels = await p.evaluate(() => [...document.querySelectorAll('.location__kind')].map((n) => n.textContent));
console.log('    labels:', labels.join(', '));
ck('rows show categories', labels.length === 5 && !labels.some((l) => /Page \d+ Location/i.test(l)), labels.join(','));
ck('known category names used', labels.every((l) => ['Progression', 'Useful', 'Trap', 'Filler', 'Unknown'].includes(l)), labels.join(','));
const tooltip = await p.evaluate(() => document.querySelector('.location__name')?.title ?? '');
ck('tooltip keeps the detail', /Location \d+/.test(tooltip), tooltip);

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nAUTO PAGE / CATEGORY PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
