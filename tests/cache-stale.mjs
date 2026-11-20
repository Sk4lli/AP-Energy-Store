// Reproduces the reported case: a stale cached game name must not block the connection,
// and a wrong slot name must produce a message the player can act on.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

// SLOT / SERVER can be overridden, e.g. to run against a real server with another slot name.
const SERVER = process.env.SERVER ?? 'localhost:38281';
const SLOT = process.env.SLOT ?? 'Tester';
const CACHE_KEY = `ap-store.game.ws://${SERVER}.${SLOT}`;

const b = await chromium.launch();
const p = await b.newPage();

// --- case 1: stale cache, like after a room was regenerated with another game in that slot
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });
await p.evaluate(([key]) => localStorage.setItem(key, 'Wrong Game'), [CACHE_KEY]);
await p.reload({ waitUntil: 'networkidle' });

await p.fill('#server-input', SERVER);
await p.fill('#slot-input', SLOT);
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 15000 }).catch(() => {});
const connected = await p.evaluate(() => window.energylinkStore.store.isConnected);
const game = await p.evaluate(() => window.energylinkStore.store.game);
const cached = await p.evaluate(([key]) => localStorage.getItem(key), [CACHE_KEY]);
const log = await p.textContent('[data-console-output]');
console.log('    connected:', connected, 'game:', game, 'cache now:', cached);
ck('stale cache does not block the connection', connected === true);
ck('game is whatever the server reports', typeof game === 'string' && game.length > 0, String(game));
ck('cache was replaced by the real game', cached === game && cached !== 'Wrong Game', String(cached));
ck('stale cache is logged', /no longer valid|passt nicht mehr/.test(log));

// --- case 2: wrong slot name
if (await p.evaluate(() => window.energylinkStore.store.isConnected)) {
    await p.click('#disconnect-button');
    await p.waitForTimeout(400);
}
await p.fill('#slot-input', 'DoesNotExist');
await p.click('#connect-button');
await p.waitForTimeout(2500);
ck('wrong slot stays disconnected', await p.evaluate(() => window.energylinkStore.store.isConnected) === false);
const hint = await p.textContent('#connect-hint');
console.log('    hint:', hint);
ck('hint names the slot', hint.includes('DoesNotExist'), hint);
ck('hint is actionable, not a bare code', !/^.*InvalidSlot\s*$/.test(hint) && hint.length > 30, hint);

await b.close();
console.log(fail === 0 ? '\nCACHE/SLOT TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
