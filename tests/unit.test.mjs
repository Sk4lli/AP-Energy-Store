import { parseConfig, priceFor } from '../js/config.js';
import { StoreModel } from '../js/store.js';

let fail = 0;
const ck = (n, c, x='') => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if(!c) fail++; };

// clamping
let r = parseConfig({ progress_items: 99, locations_per_page: 42 }, { team: 0 });
ck('pages clamped to 50', r.config.pages === 50, r.config.pages);
ck('per page clamped to 10', r.config.locationsPerPage === 10, r.config.locationsPerPage);
ck('clamp warnings', r.warnings.length === 2, JSON.stringify(r.warnings));
r = parseConfig({ progress_items: 3, locations_per_page: 2 }, {});
ck('per page min 5', r.config.locationsPerPage === 5);
ck('no key without team', r.config.energyLinkKey === null, String(r.config.energyLinkKey));
r = parseConfig({ progress_items: 3 }, { team: 0 });
ck('energylink key from team', r.config.energyLinkKey === 'EnergyLink0', String(r.config.energyLinkKey));
r = parseConfig({ progress_items: 3 }, { team: 2 });
ck('energylink key uses team id', r.config.energyLinkKey === 'EnergyLink2', String(r.config.energyLinkKey));

// aliases + nesting
r = parseConfig({ store: { progressItems: 4, locationsPerProgress: 6, starting_price: 100, price_increase: 50 } }, {});
ck('aliases work', r.config.pages === 4 && r.config.locationsPerPage === 6 && r.config.basePrice === 100 && r.config.priceStep === 50, JSON.stringify(r.config));
r = parseConfig({ energylink_key: 'CustomKey' }, { team: 1 });
ck('key override wins', r.config.energyLinkKey === 'CustomKey');

// garbage input
r = parseConfig({ progress_items: 'abc' }, {});
ck('garbage falls back', r.config.pages === 5);
r = parseConfig(null, {});
ck('null slot_data uses defaults', r.config.source === 'default');
r = parseConfig({}, {});
ck('empty slot_data warns', r.warnings.length > 0);

// prices
const cfg = { basePrice: 1000, priceStep: 500, pages: 3, locationsPerPage: 5 };
ck('price page1', priceFor(cfg, 1) === 1000);
ck('price page2', priceFor(cfg, 2) === 1500);
ck('price page3', priceFor(cfg, 3) === 2000);

// unlock options from slot_data
r = parseConfig({ unlock_mode: 'progressive', unlock_item: 'My Unlock' }, {});
ck('unlock mode progressive', r.config.unlockMode === 'progressive', r.config.unlockMode);
ck('unlock item name', r.config.unlockItem === 'My Unlock', r.config.unlockItem);
r = parseConfig({ unlock_mode: 'page', unlock_item_prefix: 'Seite ' }, {});
ck('unlock mode page', r.config.unlockMode === 'page', r.config.unlockMode);
ck('unlock prefix is trimmed', r.config.unlockItemPrefix === 'Seite', r.config.unlockItemPrefix);
r = parseConfig({}, {});
ck('unlock mode default page', r.config.unlockMode === 'page', r.config.unlockMode);
r = parseConfig({ unlock_mode: 'quatsch' }, {});
ck('unknown unlock mode warns', r.warnings.some((w) => w.includes('unlock_mode')), JSON.stringify(r.warnings));

// model. Pages are locked until their unlock item arrived.
const m = new StoreModel('de_DE');
const ids = Array.from({length: 12}, (_, i) => 2000 + i);
m.setData({ config: cfg, locationIds: ids, checked: [] });
ck('3 pages', m.pages.length === 3);
ck('page1 has 5', m.pages[0].total === 5);
ck('page3 has 2 (only 12 ids)', m.pages[2].total === 2);
ck('page1 is always open', m.pageUnlocked(1) === true);
ck('page2 locked without an unlock', m.pageUnlocked(2) === false);
ck('locked page hides the category', m.pages[1].slots[0].kind === 'locked', m.pages[1].slots[0].kind);
ck('locked pages listed', JSON.stringify(m.lockedPages) === '[2,3]', JSON.stringify(m.lockedPages));
ck('open page shows unknown category', m.pages[0].slots[0].kind === 'unknown', m.pages[0].slots[0].kind);

m.setClassification({ 2000: 'progression' });
ck('open page shows the scouted category', m.pages[0].slots[0].kind === 'progression', m.pages[0].slots[0].kind);
ck('locked page keeps hiding it', m.pages[1].slots[0].kind === 'locked', m.pages[1].slots[0].kind);

ck('buying page 1 does not open page 2', (m.setChecked([2000, 2001, 2002, 2003, 2004]), m.pageUnlocked(2)) === false);
m.setUnlocked([1, 2, 3]);
ck('page2 open with its own unlock', m.pageUnlocked(2) === true);
ck('next free slot on page 2 is 1', m.nextFreeSlot(2)?.index === 1);
ck('allDone false', m.allDone === false);

m.setData({ config: cfg, locationIds: ids, checked: ids, unlocked: [1, 2, 3] });
ck('allDone true', m.allDone === true);
ck('canBuy soldout', m.canBuy(1, 1e9).reason === 'soldout');
m.setData({ config: cfg, locationIds: ids, checked: [], unlocked: [1, 2, 3] });
ck('canBuy insufficient', m.canBuy(1, 10).reason === 'insufficient');
ck('canBuy locked page', m.canBuy(3, 1e9).ok === true && m.canBuy(3, 1e9).price === 2000);
m.setData({ config: cfg, locationIds: ids, checked: [], unlocked: [1] });
ck('canBuy locked page reports lock', m.canBuy(2, 1e9).reason === 'locked');
ck('canBuy ok', m.canBuy(1, 1e9).ok === true);

// selection
m.setData({ config: cfg, locationIds: ids, checked: [], unlocked: [1, 2] });
ck('nothing selected at start', m.selectedCount === 0);
m.setSelected(2000, true, 1);
m.setSelected(2002, true, 1);
ck('two rows selected', m.selectedCount === 2, String(m.selectedCount));
ck('selection cost is twice the page price', m.selectionCost(1) === 2 * 1000, String(m.selectionCost(1)));
ck('cannot select a locked page', m.setSelected(2005, true, 2) === true && m.toggleSelected(2005, 2) === true);
m.clearSelection();
ck('selection cleared', m.selectedCount === 0);
m.setSelected(2000, true, 1);
m.setSelected(2001, true, 1);
const sel = m.canBuySelection(1500, 1);
ck('selection too expensive', sel.ok === false && sel.reason === 'insufficient', JSON.stringify(sel));
ck('selection affordable', m.canBuySelection(2000, 1).ok === true);
m.setSelected(2000, false, 1);
m.setSelected(2001, false, 1);
ck('empty selection is refused', m.canBuySelection(1e9, 1).reason === 'no selection');
m.setSelected(2000, true, 1);
m.setChecked([2000]);
ck('bought row drops out of the selection', m.selectedCount === 0, String(m.selectedCount));
ck('page clamp low', m.setPage(0) === false && m.page === 1);
ck('page clamp high', (m.setPage(99), m.page) === 3);

// locationAt
ck('locationAt 1', m.locationAt(1, 1)?.id === 2000);
ck('locationAt out of range', m.locationAt(99, 1) === null);
ck('empty config has no data', new StoreModel().hasData === false);

console.log(fail === 0 ? '\nUNIT TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
