import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x='') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if(!c) fail++; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 10000 });
await p.waitForTimeout(400);
ck('defaults used without slot_data', await p.evaluate(() => window.energylinkStore.model.config.source) === 'default');
ck('5 pages default', await p.evaluate(() => window.energylinkStore.model.pages.length) === 5);
ck('5 per page default', await p.evaluate(() => window.energylinkStore.model.pages[0].total) === 5);
const log = await p.textContent('[data-console-output]');
ck('warning about missing config', log.includes('slot_data'));

// buy when it is too expensive for page 2 later: page1 price 1MJ, balance 2.5MJ
await p.evaluate(() => window.energylinkStore.console().run('buy'));
await p.waitForTimeout(700);
ck('buy works with defaults', await p.evaluate(() => window.energylinkStore.model.currentPage.bought) === 1);

// unknown command
await p.fill('[data-console-input]', 'nonsense');
await p.press('[data-console-input]', 'Enter');
await p.waitForTimeout(200);
ck('unknown command warned', (await p.textContent('[data-console-output]')).includes('nonsense'));

// help
await p.fill('[data-console-input]', 'help');
await p.press('[data-console-input]', 'Enter');
await p.waitForTimeout(200);
ck('help lists buy', (await p.textContent('[data-console-output]')).includes('buy <n>'));

// lang via console
await p.evaluate(() => window.energylinkStore.console().run('lang en_US'));
await p.waitForTimeout(500);
ck('console lang switch', (await p.textContent('#stat-connection')).includes('Connected'));
await p.evaluate(() => window.energylinkStore.console().run('lang de_DE'));
await p.waitForTimeout(400);

// page jump
await p.evaluate(() => window.energylinkStore.console().run('page 3'));
await p.waitForTimeout(300);
ck('page jump', await p.evaluate(() => window.energylinkStore.model.page) === 3);
ck('locked page 3 shows nothing buyable', await p.isDisabled('#buy-button'));

// balance command
await p.evaluate(() => window.energylinkStore.console().run('balance'));
await p.waitForTimeout(800);
const balLog = await p.textContent('[data-console-output]');
ck('balance command prints value', balLog.includes('MJ') || balLog.includes(' J'));

await p.screenshot({ path: 'tests/shot-defaults.png' });
ck('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fail === 0 ? '\nEDGE TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail?1:0);
