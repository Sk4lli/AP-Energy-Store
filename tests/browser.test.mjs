// Browser smoke test: connects to the mock server, buys a location, checks the balance.
import { chromium } from 'playwright';

const URL = process.env.APP_URL ?? 'http://localhost:3000/index.html';
let failures = 0;

function check(name, condition, extra = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name} ${extra}`);
    }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
    if (message.type() === 'error') {
        errors.push(message.text());
    }
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('boot');
check('no page errors on load', errors.length === 0, errors.join(' | '));
check('language loaded (title translated)', (await page.textContent('.brand__title'))?.includes('Energylink'));
check('connect panel present', await page.isVisible('#connect-form'));
check('console output visible', await page.isVisible('[data-console-output]'));

// --- connect
console.log('connect');
await page.fill('#server-input', 'localhost:38281');
await page.fill('#slot-input', 'Tester');
await page.click('#connect-button');
await page.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 10000 });
await page.waitForTimeout(300);

check('state is connected', await page.evaluate(() => window.energylinkStore.store.state) === 'connected');
check('game name detected from server', await page.evaluate(() => window.energylinkStore.store.game) === 'Test World');
const startEnergy = Number(process.env.MOCK_ENERGY ?? 10000000);
check('energy read', await page.evaluate(() => window.energylinkStore.store.energy) === startEnergy,
    String(await page.evaluate(() => window.energylinkStore.store.energy)));
check('config from slot_data', await page.evaluate(() => window.energylinkStore.model.config.pages) === 3);
check('locations per page from slot_data', await page.evaluate(() => window.energylinkStore.model.config.locationsPerPage) === 5);
check('page 1 has 5 locations', await page.evaluate(() => window.energylinkStore.model.currentPage.total) === 5);
check('page 1 is open', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(1)) === true);
check('page 2 still locked without its unlock', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(2)) === false);
check('locked page reveals no category', await page.evaluate(() => window.energylinkStore.model.pages[1].slots[0].kind) === 'locked');
check('rows show a category label', /Progression|Useful|Trap|Filler|Unknown|Progress|Nützlich|Unbekannt/.test(await page.textContent('.location__name') ?? ''));
check('tooltip carries the location name', /Location 1/.test(await page.getAttribute('.location__name', 'title') ?? ''));
check('balance shown in status', /\d/.test(await page.textContent('#stat-energy') ?? ''), await page.textContent('#stat-energy'));
check('buy button disabled without a selection', await page.isDisabled('#buy-button'));
check('every open row has a tick', await page.locator('.location__check:not([disabled])').count() === 5);

// --- buy one ticked row
console.log('buy');
// The first row of a page is a plain filler, so the only cost is the price.
const balanceBefore = await page.evaluate(() => window.energylinkStore.store.energy);
const priceShown = await page.evaluate(() => window.energylinkStore.model.priceOf(1));
await page.locator('.location__check').first().check();
await page.waitForTimeout(200);
check('buy button shows the count', /1/.test(await page.textContent('#buy-button') ?? ''), await page.textContent('#buy-button'));
await page.click('#buy-button');
await page.waitForFunction(
    (expected) => window.energylinkStore.store.energy === expected,
    balanceBefore - priceShown,
    { timeout: 10000 },
);
await page.waitForTimeout(500);
check('energy reduced by page price',
    await page.evaluate(() => window.energylinkStore.store.energy) === balanceBefore - priceShown,
    `${balanceBefore} - ${priceShown}`);
check('location is checked server side', await page.evaluate(() => [...window.energylinkStore.store.checkedLocationIds()].length) === 1);
check('first row marked bought', await page.evaluate(() => window.energylinkStore.model.currentPage.bought) === 1);
check('summary updated', (await page.textContent('#page-summary'))?.includes('1'));
check('buying page 1 does not open page 2', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(2)) === false);

// --- buy several rows at once
console.log('multi buy');
const balanceMulti = await page.evaluate(() => window.energylinkStore.store.energy);
const priceMulti = await page.evaluate(() => window.energylinkStore.model.priceOf(1));
await page.locator('.location__check:not([disabled])').nth(0).check();
await page.locator('.location__check:not([disabled])').nth(1).check();
check('two rows selected', await page.evaluate(() => window.energylinkStore.model.selectedCount) === 2);
// The sum is formatted ("2 MJ"), so check the formatter instead of the raw number.
const { formatEnergy } = await import('../js/util.js');
check('message shows the sum', (await page.textContent('#store-message'))?.includes(formatEnergy(2 * priceMulti, 'de-DE')),
    await page.textContent('#store-message'));
await page.click('#buy-button');
await page.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 3, null, { timeout: 10000 });
await page.waitForTimeout(500);
check('both rows charged in one go',
    await page.evaluate(() => window.energylinkStore.store.energy) === balanceMulti - 2 * priceMulti,
    `${balanceMulti} - ${2 * priceMulti}`);
check('selection is cleared after buying', await page.evaluate(() => window.energylinkStore.model.selectedCount) === 0);

// --- unlock page 2 with its item
console.log('unlock');
await page.evaluate(() => window.energylinkStore.store.client.socket.send({ cmd: 'DebugPushUnlock', page: 2 }));
await page.waitForTimeout(800);
check('page 2 open after its unlock arrived', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(2)) === true);
check('page 3 still locked', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(3)) === false);

// --- console
console.log('console command');
await page.fill('[data-console-input]', 'buy 4');
await page.press('[data-console-input]', 'Enter');
await page.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 4, null, { timeout: 10000 });
check('console buy worked', await page.evaluate(() => window.energylinkStore.model.currentPage.bought) === 4);

await page.fill('[data-console-input]', 'status');
await page.press('[data-console-input]', 'Enter');
await page.waitForTimeout(300);
const consoleText = await page.textContent('[data-console-output]');
check('status command output', consoleText.includes('EnergyLink'));

await page.fill('[data-console-input]', 'pages');
await page.press('[data-console-input]', 'Enter');
await page.waitForTimeout(300);
check('pages command lists 3 pages', (await page.textContent('[data-console-output]')).includes('3: 0/5'));

// --- language switch
console.log('language');
await page.selectOption('#language-select', 'en_US');
await page.waitForTimeout(500);
check('english title', (await page.textContent('.brand__title')) === 'Energylink Store');
check('english buy button', (await page.textContent('#buy-button'))?.startsWith('Buy'));
await page.selectOption('#language-select', 'de_DE');
await page.waitForTimeout(500);
check('german back', (await page.textContent('#buy-button'))?.startsWith('Kaufen'));

// --- insufficient funds
console.log('insufficient funds');
await page.evaluate(() => {
    const { store, model } = window.energylinkStore;
    // tick a row first, otherwise there is nothing to price
    const free = model.currentPage.slots.find((slot) => !slot.bought);
    if (free) {
        model.setSelected(free.id, true, model.page);
    }
    store.energy = 10;
    model.emit('change', { reason: 'test' });
});
await page.waitForTimeout(300);
check('buy disabled without money', await page.isDisabled('#buy-button'));
check('message says not enough joules', (await page.textContent('#store-message'))?.includes('Joule'));

await page.screenshot({ path: 'tests/screenshot-store.png', fullPage: true });

// --- reconnect with defaults (no slot_data)
console.log('disconnect');
await page.click('#disconnect-button');
await page.waitForTimeout(400);
check('disconnected again', await page.evaluate(() => window.energylinkStore.store.isConnected) === false);
check('store cleared', await page.evaluate(() => window.energylinkStore.model.hasData) === false);

check('no page errors during run', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
