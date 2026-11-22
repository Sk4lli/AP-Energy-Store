// Page unlocks: a page is locked until its own unlock item arrived, and a locked page
// reveals nothing about the items in its locations.
//
// Page 1 is always open; pages 2 and up need their unlock item. Needs the mock with --pages 3.
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

const state = () => p.evaluate(() => {
    const { store, model } = window.energylinkStore;
    return {
        mode: store.config?.unlockMode,
        unlocked: store.unlockedPages,
        pages: model.pages.map((page) => ({
            number: page.number,
            unlocked: model.pageUnlocked(page.number),
            kinds: page.slots.map((slot) => slot.kind),
        })),
    };
});

const start = await state();
console.log('    start:', JSON.stringify({ mode: start.mode, unlocked: start.unlocked }));
ck('unlock mode from slot_data', start.mode === 'page', String(start.mode));
ck('page 1 open without any item', start.unlocked.includes(1), JSON.stringify(start.unlocked));
ck('page 2 locked', !start.unlocked.includes(2), JSON.stringify(start.unlocked));
ck('page 3 locked', !start.unlocked.includes(3), JSON.stringify(start.unlocked));
ck('page 1 shows its rows', start.pages[0].kinds.every((kind) => kind !== 'locked'), JSON.stringify(start.pages[0].kinds));

// A locked page must not tell what is in it.
ck('locked page 2 shows no category',
    start.pages[1].kinds.every((kind) => kind === 'locked'), JSON.stringify(start.pages[1].kinds));

// Go to the locked page: rows are not selectable and say so.
await p.evaluate(() => { window.energylinkStore.model.setPage(2); });
await p.waitForTimeout(300);
ck('locked page has no ticked rows', await p.locator('.location__check:not([disabled])').count() === 0);
const lockedText = await p.textContent('#location-list');
console.log('    locked page text:', JSON.stringify(lockedText?.slice(0, 80)));
ck('locked rows say locked', /gesperrt|locked/i.test(lockedText ?? ''), lockedText?.slice(0, 80));
ck('locked row reveals no item name', !/McGuffin|Trap|Filler|Progression/.test(lockedText ?? ''));

// The category must not appear at all, not even as a placeholder label.
const lockedKinds = await p.locator('.location__kind').count();
ck('locked rows show no category label', lockedKinds === 0, String(lockedKinds));
const kindNames = await p.evaluate(() => [...document.querySelectorAll('.location__name')]
    .map((n) => n.textContent.trim()));
console.log('    locked row names:', JSON.stringify(kindNames));
ck('no category word in a locked row',
    kindNames.every((text) => !/Progression|Useful|Trap|Filler|Unknown|Progress|Nützlich|Unbekannt/i.test(text)),
    JSON.stringify(kindNames));

// Nothing about a locked page may have been asked from the server either.
const scouted = await p.evaluate(() => {
    const { store, model } = window.energylinkStore;
    const locked = new Set(model.pages.find((page) => !model.pageUnlocked(page.number)).slots.map((s) => s.id));
    return [...locked].filter((id) => id in (store.scoutedNames ?? {}));
});
console.log('    scouted ids of locked pages:', JSON.stringify(scouted));
ck('locked pages are not scouted', scouted.length === 0, JSON.stringify(scouted));
ck('buy button disabled on a locked page', await p.isDisabled('#buy-button'));

// The unlock item arrives.
await p.evaluate(() => window.energylinkStore.store.client.socket.send({ cmd: 'DebugPushUnlock', page: 2 }));
await p.waitForTimeout(900);
const afterUnlock = await state();
console.log('    after unlock:', JSON.stringify({ unlocked: afterUnlock.unlocked, kinds: afterUnlock.pages[1].kinds }));
ck('page 2 open after its item', afterUnlock.unlocked.includes(2), JSON.stringify(afterUnlock.unlocked));
ck('page 3 stays locked', !afterUnlock.unlocked.includes(3), JSON.stringify(afterUnlock.unlocked));
ck('page 2 now shows categories',
    afterUnlock.pages[1].kinds.every((kind) => kind !== 'locked'), JSON.stringify(afterUnlock.pages[1].kinds));
// The newly opened page is scouted, so the categories are the real ones and not "unknown".
ck('the opened page was scouted',
    afterUnlock.pages[1].kinds.every((kind) => kind !== 'unknown'), JSON.stringify(afterUnlock.pages[1].kinds));
ck('rows on page 2 are selectable now', await p.locator('.location__check:not([disabled])').count() === 5);
ck('page 2 rows show categories now', await p.locator('.location__kind').count() === 5,
    String(await p.locator('.location__kind').count()));

// Page 1 stays open, and a page only ever opens its own page number.
ck('page 1 is still open', afterUnlock.unlocked.includes(1));

// A reconnect must remember the unlocks: they are derived from the item list.
await p.reload({ waitUntil: 'networkidle' });
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 });
await p.waitForTimeout(1400);
const afterReload = await state();
console.log('    after reconnect:', JSON.stringify(afterReload.unlocked));
ck('reconnect keeps page 2 open', afterReload.unlocked.includes(2), JSON.stringify(afterReload.unlocked));
ck('reconnect invents no page 3', !afterReload.unlocked.includes(3), JSON.stringify(afterReload.unlocked));

// The console tells which pages are open.
await p.fill('[data-console-input]', 'unlock');
await p.press('[data-console-input]', 'Enter');
await p.waitForTimeout(400);
const consoleText = await p.textContent('[data-console-output]');
ck('console shows the unlock state', /mode|offen|open/i.test(consoleText ?? ''), consoleText?.slice(-120));

ck('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(fail === 0 ? '\nUNLOCK PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
