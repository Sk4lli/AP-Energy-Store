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
check('energy read', await page.evaluate(() => window.energylinkStore.store.energy) === 5000000);
check('config from slot_data', await page.evaluate(() => window.energylinkStore.model.config.pages) === 3);
check('locations per page from slot_data', await page.evaluate(() => window.energylinkStore.model.config.locationsPerPage) === 5);
check('page 1 has 5 locations', await page.evaluate(() => window.energylinkStore.model.currentPage.total) === 5);
check('rows show a category label', /Progression|Useful|Trap|Filler|Unknown|Progress|Nützlich|Unbekannt/.test(await page.textContent('.location__name') ?? ''));
check('tooltip carries the location name', /Location 1/.test(await page.getAttribute('.location__name', 'title') ?? ''));
check('balance shown in status', (await page.textContent('#stat-energy'))?.includes('5'));
check('buy button enabled', !(await page.isDisabled('#buy-button')));

// --- buy
console.log('buy');
await page.click('#buy-button');
await page.waitForFunction(() => window.energylinkStore.store.energy === 4000000, null, { timeout: 10000 });
await page.waitForTimeout(400);
check('energy reduced by page price', await page.evaluate(() => window.energylinkStore.store.energy) === 4000000);
check('location is checked server side', await page.evaluate(() => [...window.energylinkStore.store.checkedLocationIds()].length) === 1);
check('first row marked bought', await page.evaluate(() => window.energylinkStore.model.currentPage.bought) === 1);
check('summary updated', (await page.textContent('#page-summary'))?.includes('1'));
check('next page still locked', await page.evaluate(() => window.energylinkStore.model.pageUnlocked(2)) === false);

// --- buy whole page via console
console.log('console command');
await page.fill('[data-console-input]', 'buy');
await page.press('[data-console-input]', 'Enter');
await page.waitForFunction(() => window.energylinkStore.model.currentPage.bought === 2, null, { timeout: 10000 });
check('console buy worked', await page.evaluate(() => window.energylinkStore.model.currentPage.bought) === 2);

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
