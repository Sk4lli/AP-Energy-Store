// A server address must work whether the host speaks plain ws or wss.
// The public Archipelago hosts are wss-only, self-hosted ones are usually plain ws.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle' });

// 1. candidate order
const order = await p.evaluate(() => ({
  local: window.energylinkStore.store.constructor.candidateUrls('localhost:38281'),
  remote: window.energylinkStore.store.constructor.candidateUrls('archipelago.gg:38281'),
  explicitWs: window.energylinkStore.store.constructor.candidateUrls('ws://localhost:38281'),
}));
console.log('   ', JSON.stringify(order));
ck('local tries ws first', order.local[0] === 'ws://localhost:38281', JSON.stringify(order.local));
ck('remote tries wss first', order.remote[0] === 'wss://archipelago.gg:38281', JSON.stringify(order.remote));
ck('both protocols offered for remote', order.remote.length === 2, JSON.stringify(order.remote));
ck('explicit ws:// is not rewritten', order.explicitWs.length === 1 && order.explicitWs[0] === 'ws://localhost:38281');

// 2. a plain ws server still connects (the common self-hosted case)
await p.fill('#server-input', 'localhost:38281');
await p.fill('#slot-input', 'Tester');
await p.click('#connect-button');
await p.waitForFunction(() => window.energylinkStore.store.isConnected, null, { timeout: 12000 }).catch(() => {});
ck('plain ws server connects', await p.evaluate(() => window.energylinkStore.store.isConnected) === true);
console.log('    used url:', await p.evaluate(() => window.energylinkStore.store.url));

// 3. an unreachable host produces a message naming the address, not a bare code
await p.click('#disconnect-button');
await p.waitForTimeout(300);
await p.fill('#server-input', 'localhost:39999');
await p.click('#connect-button');
await p.waitForTimeout(3000);
const hint = await p.textContent('#connect-hint');
console.log('    hint:', hint);
ck('unreachable server is reported', (await p.evaluate(() => window.energylinkStore.store.isConnected)) === false);
ck('hint mentions the address', /39999/.test(hint ?? ''), hint);
ck('hint is not the raw socket text', !/^Login failed/.test((hint ?? '').trim()), hint);

const log = await p.textContent('[data-console-output]');
ck('protocol fallback was logged or ws used directly', /trying|versuche/.test(log) || (await p.evaluate(() => window.energylinkStore.store.url)) === 'ws://localhost:38281');

await b.close();
console.log(fail === 0 ? '\nPROTOCOL FALLBACK PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
