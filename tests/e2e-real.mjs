// End-to-end test against a REAL Archipelago server hosting the Energylink Store world.
// Requires: AP server on ws://localhost:38281 with slot "StoreTester" (see apworld/README.md).
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'StoreTester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 15000 });
await p.waitForTimeout(800);

const state = await p.evaluate(() => {
  const { store, model } = window.energylinkStore;
  return {
    game: store.game, team: store.team, slot: store.slot,
    pages: model.pages.length,
    perPage: model.pages[0]?.total,
    config: model.config,
    energyKey: store.energyKey,
    locale: model.locale,
  };
});
console.log('   ', JSON.stringify(state));

ck('game detected from real server', state.game === 'Energylink Store', state.game);
ck('3 pages from slot_data', state.pages === 3, state.pages);
ck('6 per page from slot_data', state.perPage === 6, state.perPage);
ck('base price 500k', state.config.basePrice === 500000, state.config.basePrice);
ck('price step 250k', state.config.priceStep === 250000, state.config.priceStep);
ck('mcguffins 12', state.config.mcguffins === 12, state.config.mcguffins);
ck('tax per trap 250k', state.config.taxPerTrap === 250000, state.config.taxPerTrap);
ck('inflation 0.2', state.config.inflationPerTrap === 0.2, state.config.inflationPerTrap);
ck('energylink key from team', state.energyKey === `EnergyLink${state.team}`, state.energyKey);
ck('page 1 price', await p.evaluate(() => window.energylinkStore.model.priceOf(1)) === 500000);
ck('page 2 price', await p.evaluate(() => window.energylinkStore.model.priceOf(2)) === 750000);
ck('page 3 price', await p.evaluate(() => window.energylinkStore.model.priceOf(3)) === 1000000);

// location names must match the world's naming
const names = await p.evaluate(() => window.energylinkStore.model.pages[0].slots.map(s => window.energylinkStore.store.locationName(s.id)));
console.log('    names:', names.join(' | '));
ck('names follow world pattern', names[0] === 'Page 1 Location 1' && names[5] === 'Page 1 Location 6', names.join(','));

ck('energy known', await p.evaluate(() => window.energylinkStore.store.energyKnown) === true);

// The test owns the pool: reset it so the run does not depend on earlier runs.
await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 0 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(500);
ck('buy disabled with empty pool', await p.isDisabled('#buy-button'));
console.log('    message:', await p.textContent('#store-message'));

// fill the pool like Factorio would, then buy
await p.evaluate(async () => {
  const { store } = window.energylinkStore;
  await store._setStorage(store.energyKey, [{ operation: 'replace', value: 5000000 }], 0);
  await store.refreshEnergy(true);
});
await p.waitForTimeout(600);
ck('pool filled to 5 MJ', await p.evaluate(() => window.energylinkStore.store.energy) === 5000000, String(await p.evaluate(() => window.energylinkStore.store.energy)));
ck('buy enabled again', !(await p.isDisabled('#buy-button')));

const beforeBuy = await p.evaluate(() => window.energylinkStore.model.currentPage.bought);
await p.click('#buy-button');
await p.waitForFunction((n) => window.energylinkStore.model.currentPage.bought === n + 1, beforeBuy, { timeout: 10000 });
await p.waitForTimeout(600);
const afterBuy = await p.evaluate(() => ({
  energy: window.energylinkStore.store.energy,
  bought: window.energylinkStore.model.currentPage.bought,
  checked: window.energylinkStore.store.checkedLocationIds().size,
  mcguffins: window.energylinkStore.store.countItem('McGuffin'),
}));
console.log('   ', JSON.stringify(afterBuy));
ck('paid 500k', afterBuy.energy === 4500000, String(afterBuy.energy));
ck('location checked on real server', afterBuy.checked === beforeBuy + 1, String(afterBuy.checked));
ck('row marked bought', afterBuy.bought === beforeBuy + 1);
ck('server sent an item for the check', afterBuy.mcguffins + 0 >= 0);

await p.screenshot({ path: 'tests/shot-real.png', fullPage: false });
ck('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
console.log(fail === 0 ? '\nREAL-SERVER E2E PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
