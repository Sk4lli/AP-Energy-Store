// Store model: pages ("progress items") with a fixed number of locations each.
//
// Locations are the location ids of the slot, sorted by id. Page N owns the chunk
// [N * perPage, (N + 1) * perPage). A page unlocks once the previous page is sold out.

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
        this.inflationSteps = 0;
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
    setData({ config, locationIds, checked, inflation = 0, classification = null }) {
        this.config = config;
        this.inflationSteps = Math.max(0, Number(inflation) || 0);
        this.classification = classification ?? {};
        this.locationIds = [...locationIds].sort((a, b) => a - b);
        this.checked = new Set(checked ?? []);
        this.pages = this._buildPages();
        this.page = Math.max(1, Math.min(this.pages.length || 1, this.page));
        this.emit('change', { reason: 'data' });
    }

    setChecked(checkedIds) {
        for (const id of checkedIds) {
            this.checked.add(id);
        }
        this.pages = this._buildPages();
        this.emit('change', { reason: 'checked' });
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
            pages.push({
                number: index + 1,
                price,
                slots: ids.map((id, slotIndex) => ({
                    index: slotIndex + 1,
                    id,
                    bought: this.checked.has(id),
                    kind: this.classification[id] ?? 'unknown',
                })),
                bought: ids.filter((id) => this.checked.has(id)).length,
                total: ids.length,
            });
        }
        return pages;
    }

    /** Price of a page, including the inflation traps received so far. */
    priceOf(pageNumber) {
        const base = priceFor(this.config ?? { basePrice: 0, priceStep: 0 }, pageNumber);
        const perTrap = Number(this.config?.inflationPerTrap ?? 0);
        if (!(perTrap > 0) || !(this.inflationSteps > 0)) {
            return base;
        }
        return Math.round(base * (1 + perTrap * this.inflationSteps));
    }

    /** Rebuilds page prices after a trap arrived. */
    setInflation(steps) {
        const next = Math.max(0, Number(steps) || 0);
        if (next === this.inflationSteps) {
            return;
        }
        this.inflationSteps = next;
        this.pages = this._buildPages();
        this.emit('change', { reason: 'inflation' });
    }

    /**
     * The page a player should look at: the first one that still has something to buy.
     * Pages that are sold out or not created (the slot has fewer locations than configured)
     * are skipped. When everything is sold out the last page stays selected.
     */
    firstOpenPage() {
        if (this.pages.length === 0) {
            return 1;
        }
        const open = this.pages.find((page) => page.total > 0 && page.bought < page.total);
        return open ? open.number : this.pages.length;
    }

    /** Selects the first open page. Returns true when the page changed. */
    showFirstOpenPage() {
        return this.setPage(this.firstOpenPage());
    }

    pageUnlocked(pageNumber) {
        if (pageNumber <= 1) {
            return true;
        }
        const previous = this.pages[pageNumber - 2];
        if (!previous) {
            return false;
        }
        // An empty page (slot has fewer locations than configured) does not block anything.
        return previous.bought >= previous.total;
    }

    /** A page is purchasable if it is unlocked and has at least one free slot. */
    canBuy(pageNumber, balance) {
        const page = this.pages[pageNumber - 1];
        if (!page) {
            return { ok: false, reason: 'missing' };
        }
        if (!this.pageUnlocked(pageNumber)) {
            return { ok: false, reason: 'locked', needs: pageNumber - 1 };
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
