// Opening index.html directly (file://) must not leave a silent page: it has to explain the problem.
import { chromium } from 'playwright';
let fail = 0;
const ck = (n, c, x = '') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!c) fail++; };
const path = new URL('../index.html', import.meta.url).pathname;

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`file://${path}`);
await p.waitForTimeout(1500);

const visible = await p.isVisible('#boot-error');
const title = await p.textContent('#boot-error-title');
const text = await p.textContent('#boot-error-text');
console.log('    title:', title);
console.log('    text :', (text || '').slice(0, 120));
ck('error box is shown on file://', visible === true);
ck('it names the cause', /file:\/\//.test(text ?? ''), text);
ck('it says how to fix it', /start\.sh|localhost|Webserver|server/i.test(text ?? ''), text);

await b.close();
console.log(fail === 0 ? '\nFILE PROTOCOL TEST PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
