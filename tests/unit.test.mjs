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

// model
const m = new StoreModel('de_DE');
const ids = Array.from({length: 12}, (_, i) => 2000 + i);
m.setData({ config: cfg, locationIds: ids, checked: [] });
ck('3 pages', m.pages.length === 3);
ck('page1 has 5', m.pages[0].total === 5);
ck('page3 has 2 (only 12 ids)', m.pages[2].total === 2);
ck('page2 locked', m.pageUnlocked(2) === false);
m.setChecked([2000, 2001, 2002, 2003, 2004]);
ck('page2 unlocked after page1', m.pageUnlocked(2) === true);
ck('next free slot is 6', m.nextFreeSlot(2)?.index === 1);
ck('allDone false', m.allDone === false);
m.setChecked(m.locationIds);
m.setData({ config: cfg, locationIds: ids, checked: ids });
ck('allDone true', m.allDone === true);
ck('canBuy soldout', m.canBuy(1, 1e9).reason === 'soldout');
m.setData({ config: cfg, locationIds: ids, checked: [] });
ck('canBuy insufficient', m.canBuy(1, 10).reason === 'insufficient');
ck('canBuy locked page', m.canBuy(3, 1e9).reason === 'locked');
ck('canBuy ok', m.canBuy(1, 1e9).ok === true);
ck('page clamp low', m.setPage(0) === false && m.page === 1);
ck('page clamp high', (m.setPage(99), m.page) === 3);

// locationAt
ck('locationAt 1', m.locationAt(1, 1)?.id === 2000);
ck('locationAt out of range', m.locationAt(99, 1) === null);
ck('empty config has no data', new StoreModel().hasData === false);

console.log(fail === 0 ? '\nUNIT TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
