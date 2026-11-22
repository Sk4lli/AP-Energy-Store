// Store model: pages ("progress items") with a fixed number of locations each.
//
// Locations are the location ids of the slot, sorted by id. Page N owns the chunk
// [N * perPage, (N + 1) * perPage). A page is open once its unlock item arrived, not because the
// previous page is sold out: how the unlocks work is decided by the slot_data (see store.js use).

import { priceFor } from './config.js';
import { formatEnergy, formatNumber, localeFromLang } from './util.js';

export class StoreModel extends EventTarget {
    constructor(language = 'en_US') {
        super();
        this.language = language;
        this.config = null;
        this.locationIds = [];
        this.checked = new Set();
        this.page = 1;
        this.pages = [];
        this.taxSteps = 0;
        // pages whose unlock item has arrived
        this.unlocked = new Set();
        // location ids the player ticked for the next purchase
        this.selected = new Set();
        // locationId -> item classification, filled by scouting
        this.classification = {};
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    get locale() {
        return localeFromLang(this.language);
    }

    setLanguage(language) {
        this.language = language;
        this.emit('change', { reason: 'language' });
    }

    /**
     * Rebuilds pages from the configuration and the location list of the slot.
     * locations: sorted array of location ids.
     */
    setData({ config, locationIds, checked, taxSteps = 0, classification = null, unlocked = null }) {
        this.config = config;
        this.taxSteps = Math.max(0, Number(taxSteps) || 0);
        this.classification = classification ?? {};
        if (unlocked) {
            this.setUnlocked(unlocked, { silent: true });
        }
        this.locationIds = [...locationIds].sort((a, b) => a - b);
        this.checked = new Set(checked ?? []);
        this.pages = this._buildPages();
        this._dropStaleSelection();
        this.page = Math.max(1, Math.min(this.pages.length || 1, this.page));
        this.emit('change', { reason: 'data' });
    }

    setChecked(checkedIds) {
        for (const id of checkedIds) {
            this.checked.add(id);
        }
        this.pages = this._buildPages();
        this._dropStaleSelection();
        this.emit('change', { reason: 'checked' });
    }

    /** Pages whose unlock item arrived. Accepts a list of page numbers. */
    setUnlocked(pages, { silent = false } = {}) {
        const next = new Set((pages ?? []).map((page) => Number(page)).filter((page) => page >= 1));
        const same = next.size === this.unlocked.size && [...next].every((page) => this.unlocked.has(page));
        if (same) {
            return false;
        }
        this.unlocked = next;
        if (this.config) {
            this.pages = this._buildPages();
            this._dropStaleSelection();
        }
        if (!silent) {
            this.emit('change', { reason: 'unlock' });
        }
        return true;
    }

    /** Forgets ids that are checked or no longer part of the store. */
    _dropStaleSelection() {
        if (this.selected.size === 0) {
            return;
        }
        const known = new Set(this.pages.flatMap((page) => page.slots.filter((slot) => !slot.bought).map((slot) => slot.id)));
        for (const id of [...this.selected]) {
            if (!known.has(id)) {
                this.selected.delete(id);
            }
        }
    }

    /** Item classifications per location id, from scouting. Triggers a rebuild of the pages. */
    setClassification(classification) {
        this.classification = classification ?? {};
        this.pages = this._buildPages();
        this.emit('change', { reason: 'scouted' });
    }

    clear() {
        this.config = null;
        this.locationIds = [];
        this.checked = new Set();
        this.selected = new Set();
        this.unlocked = new Set();
        this.pages = [];
        this.page = 1;
        this.emit('change', { reason: 'clear' });
    }

    get hasData() {
        return this.pages.length > 0;
    }

    get currentPage() {
        return this.pages[this.page - 1] ?? null;
    }

    _buildPages() {
        if (!this.config) {
            return [];
        }
        const perPage = this.config.locationsPerPage;
        const pages = [];
        for (let index = 0; index < this.config.pages; index += 1) {
            const start = index * perPage;
            const ids = this.locationIds.slice(start, start + perPage);
            const price = this.priceOf(index + 1);
            // Page 1 is always open, it has no unlock item.
            const unlocked = index === 0 || this.unlocked.has(index + 1);
            pages.push({
                number: index + 1,
                price,
                unlocked,
                slots: ids.map((id, slotIndex) => ({
                    index: slotIndex + 1,
                    id,
                    bought: this.checked.has(id),
                    selected: this.selected.has(id),
                    // A locked page reveals nothing about what is in its locations.
                    kind: unlocked ? (this.classification[id] ?? 'unknown') : 'locked',
                })),
                bought: ids.filter((id) => this.checked.has(id)).length,
                total: ids.length,
            });
        }
        return pages;
    }

    /** Price of a page, including the tax traps received so far (they stay for the whole run). */
    priceOf(pageNumber) {
        const base = priceFor(this.config ?? { basePrice: 0, priceStep: 0 }, pageNumber);
        const step = Number(this.config?.taxPerTrap ?? 0);
        if (!(step > 0) || !(this.taxSteps > 0)) {
            return base;
        }
        return Math.round(base * (1 + step * this.taxSteps));
    }

    /** Rebuilds page prices after a tax trap arrived. */
    setTaxSteps(steps) {
        const next = Math.max(0, Number(steps) || 0);
        if (next === this.taxSteps) {
            return;
        }
        this.taxSteps = next;
        this.pages = this._buildPages();
        this.emit('change', { reason: 'tax' });
    }

    /**
     * The page a player should look at: the first open page that still has something to buy.
     * Pages that are sold out or not created (the slot has fewer locations than configured) are
     * skipped. When every open page is sold out, or none is open yet, the first open page is
     * chosen, so the reason (waiting for an unlock) is visible. When several pages wait for an
     * unlock the first one is picked, so the hint names a page.
     */
    firstOpenPage() {
        if (this.pages.length === 0) {
            return 1;
        }
        const open = this.pages.filter((page) => this.pageUnlocked(page.number));
        const buyable = open.find((page) => page.total > 0 && page.bought < page.total);
        if (buyable) {
            return buyable.number;
        }
        if (open.length > 0) {
            return open[0].number;
        }
        return this.pages[0].number;
    }

    /** Selects the first open page. Returns true when the page changed. */
    showFirstOpenPage() {
        return this.setPage(this.firstOpenPage());
    }

    /** Page 1 is always open; every other page opens once its unlock item has arrived. */
    pageUnlocked(pageNumber) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return false;
        }
        const number = Number(pageNumber);
        return number === 1 || this.unlocked.has(number);
    }

    /** Page numbers that are still waiting for their unlock item (page 1 never is). */
    get lockedPages() {
        return this.pages.filter((page) => !this.pageUnlocked(page.number)).map((page) => page.number);
    }

    /* ------------------------------------------------------------ selection */

    /** Ticks or unticks a location. Only affordable, open and unbought locations can be selected. */
    setSelected(locationId, selected, pageNumber = this.page) {
        const id = Number(locationId);
        const page = this.pages[pageNumber - 1];
        const slot = page?.slots.find((entry) => entry.id === id);
        if (!slot || slot.bought) {
            return false;
        }
        if (selected && !this.pageUnlocked(page.number)) {
            return false;
        }
        const changed = selected ? !this.selected.has(id) : this.selected.has(id);
        if (!changed) {
            return false;
        }
        if (selected) {
            this.selected.add(id);
        } else {
            this.selected.delete(id);
        }
        this.pages = this._buildPages();
        this.emit('change', { reason: 'selection' });
        return true;
    }

    toggleSelected(locationId, pageNumber = this.page) {
        return this.setSelected(locationId, !this.selected.has(Number(locationId)), pageNumber);
    }

    clearSelection() {
        if (this.selected.size === 0) {
            return false;
        }
        this.selected.clear();
        this.pages = this._buildPages();
        this.emit('change', { reason: 'selection' });
        return true;
    }

    /** Location ids of the current page that are ticked, in page order. */
    get selectedIds() {
        const page = this.currentPage;
        if (!page) {
            return [];
        }
        return page.slots.filter((slot) => this.selected.has(slot.id) && !slot.bought).map((slot) => slot.id);
    }

    get selectedCount() {
        return this.selectedIds.length;
    }

    /** What buying the current selection costs: every location of a page has the same price. */
    selectionCost(pageNumber = this.page) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return 0;
        }
        const count = page.slots.filter((slot) => this.selected.has(slot.id) && !slot.bought).length;
        return count * page.price;
    }

    /** Checks the selection: at least one ticket, enough joules, page open. */
    canBuySelection(balance, pageNumber = this.page) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return { ok: false, reason: 'missing' };
        }
        if (!this.pageUnlocked(page.number)) {
            return { ok: false, reason: 'locked', page: page.number };
        }
        const ids = page.slots.filter((slot) => this.selected.has(slot.id) && !slot.bought).map((slot) => slot.id);
        if (ids.length === 0) {
            return { ok: false, reason: 'no selection' };
        }
        const cost = ids.length * page.price;
        if (Number(balance) < cost) {
            return { ok: false, reason: 'insufficient', price: cost, count: ids.length };
        }
        return { ok: true, ids, cost, price: cost, count: ids.length, page: page.number };
    }

    /** A page is purchasable if it is unlocked and has at least one free slot. */
    canBuy(pageNumber, balance) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return { ok: false, reason: 'missing' };
        }
        if (!this.pageUnlocked(pageNumber)) {
            return { ok: false, reason: 'locked', page: Number(pageNumber) };
        }
        if (page.bought >= page.total) {
            return { ok: false, reason: 'soldout' };
        }
        if (Number(balance) < page.price) {
            return { ok: false, reason: 'insufficient', price: page.price };
        }
        return { ok: true, price: page.price };
    }

    /** First free location of the current page, or null. */
    nextFreeSlot(pageNumber = this.page) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return null;
        }
        return page.slots.find((slot) => !slot.bought) ?? null;
    }

    /** Location id at a 1-based position on the current page. */
    locationAt(position, pageNumber = this.page) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return null;
        }
        return page.slots[position - 1] ?? null;
    }

    get totalBought() {
        return this.pages.reduce((sum, page) => sum + page.bought, 0);
    }

    get totalLocations() {
        return this.pages.reduce((sum, page) => sum + page.total, 0);
    }

    get allDone() {
        return this.pages.length > 0 && this.pages.every((page) => page.bought >= page.total);
    }

    setPage(number) {
        const next = Math.max(1, Math.min(this.pages.length || 1, Number(number) || 1));
        if (next === this.page) {
            return false;
        }
        this.page = next;
        this.emit('change', { reason: 'page' });
        return true;
    }

    nextPage() {
        return this.setPage(this.page + 1);
    }

    previousPage() {
        return this.setPage(this.page - 1);
    }

    formatPrice(price) {
        return formatEnergy(price, this.locale);
    }

    formatAmount(amount) {
        return formatNumber(amount, this.locale);
    }
}
