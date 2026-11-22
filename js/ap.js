// Archipelago connection layer: login, EnergyLink balance and purchases.
//
// Notes on the protocol (checked against Archipelago 0.6.x and archipelago.js 2.1.0):
// - A client that connects without a game name is tagged "TextOnly" and the server sets
//   no_locations = true, so LocationChecks from such a client are rejected. Because the store
//   has to check locations, we first connect as TextOnly to learn the game name of the slot from
//   slot_info, then reconnect with that game name.
// - EnergyLink is a data storage key, "EnergyLink{team}", holding the shared joule amount.
//   The same key is used by the Factorio client (0-based team id).

import { Client, itemsHandlingFlags } from '../assets/vendor/archipelago.min.js';
import { parseConfig } from './config.js';
import { t } from './i18n.js';

export const CONNECTION_STATE = {
    disconnected: 'disconnected',
    connecting: 'connecting',
    connected: 'connected',
};

/** A refused login (bad slot, password, game) means the socket worked. */
function isServerRefusal(error) {
    return Array.isArray(error?.errors) && error.errors.length > 0;
}

function uuid() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export class EnergyLinkStore extends EventTarget {
    constructor() {
        super();
        // the data package must be there before the first login, otherwise received items
        // come in as "Unknown Item <id>"
        this.client = new Client({ autoFetchDataPackage: true });
        this.state = CONNECTION_STATE.disconnected;
        this.url = '';
        this.slotName = '';
        this.game = '';
        this.team = 0;
        this.slot = -1;
        this.config = null;
        this.energy = 0;
        this.energyKnown = false;
        this.energyKey = '';
        this.buying = false;
        // every item this slot received, newest last; the location id makes them distinct
        this.receivedItems = [];
        // Derived from the items this slot has received, so a reconnect recomputes the same numbers.
        this.trapEffects = { tax: 0, inflation: 0 };
        // How many Inflation Traps already took their joules out of the pool. Persisted, because
        // burning is a server write and must never happen twice for the same item.
        this.inflationBurned = 0;
        // locationId -> 'progression' | 'useful' | 'trap' | 'filler', filled by scouting
        this.scouted = {};
        this.scoutedNames = {};
        this._bind();
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    log(level, message) {
        this.emit('log', { level, message });
    }

    _bind() {
        const { socket } = this.client;
        socket.on('disconnected', () => {
            const wasConnected = this.state === CONNECTION_STATE.connected;
            this.state = CONNECTION_STATE.disconnected;
            this.energyKnown = false;
            this.emit('state', { state: this.state, wasConnected });
            if (wasConnected) {
                this.emit('disconnected', {});
            }
        });
        socket.on('setReply', (packet) => {
            if (this.energyKey && packet.key === this.energyKey) {
                this._setEnergy(packet.value);
            }
        });
        socket.on('roomUpdate', (packet) => {
            if (packet.checked_locations?.length) {
                this.emit('locations', { checked: packet.checked_locations });
            }
        });
        socket.on('invalidPacket', (packet) => {
            this.log('error', t('log.invalid_packet', {
                type: packet.type,
                text: packet.text ?? '',
            }));
        });
        this.client.room.on('locationsChecked', (locations) => {
            this.emit('locations', { checked: locations });
        });
        this.client.messages.on('message', (text) => {
            this.log('chat', text);
        });
        this.client.items.on('itemsReceived', (items, startingIndex) => {
            this._onItemsReceived(items, startingIndex);
        });
    }

    get isConnected() {
        return this.state === CONNECTION_STATE.connected;
    }

    /**
     * Counts the items of this slot and applies the traps among them.
     *
     * The received item list is the source of truth: the server sends the same list on every
     * login (starting at index 0), so counting it always gives the same numbers and a reconnect
     * changes nothing. Only what is *new* since the last look has an effect.
     *
     * Inflation is the exception that needs care, because burning joules is a write to the
     * server. `this.inflationBurned` holds the amount it already burnt; the difference between the
     * item count and that number is what still has to go, and it is burnt exactly once.
     *
     * A trap therefore fires when its item arrives, whichever store the location belongs to:
     * the item of a location you buy is delivered to whoever it belongs to, including yourself.
     */
    _onItemsReceived(items, startingIndex) {
        // Index 0 means "here is everything you ever got", which the server sends on every login.
        // Those items are not news, so they must not be reported as freshly received again.
        const replay = startingIndex === 0;
        if (replay) {
            this.receivedItems = [];
        }
        const fresh = [];
        for (const item of items) {
            this.receivedItems.push(item);
            if (!replay) {
                fresh.push(item.name ?? '');
            }
        }

        const taxCount = this._trapLocations('Tax Trap').size;
        const inflationCount = this._trapLocations('Inflation Trap').size;
        const previous = { ...this.trapEffects };
        this.trapEffects.tax = taxCount;
        this.trapEffects.inflation = inflationCount;

        if (this.trapEffects.tax > previous.tax) {
            this.emit('trap', {
                kind: 'tax',
                count: this.trapEffects.tax - previous.tax,
                percent: Math.round((this.config?.taxPerTrap ?? 0) * 100),
                factor: this.inflationFactor,
            });
        }

        const pending = inflationCount - this.inflationBurned;
        if (pending > 0) {
            void this._applyInflationTrap(pending);
        } else if (this.inflationBurned > inflationCount) {
            // The server knows fewer traps than we burnt (regenerated room, different slot data).
            // Trust the list and forget the surplus instead of keeping a debt.
            this.inflationBurned = inflationCount;
            this._saveTrapState();
        }

        this.emit('items', {
            mcguffins: this.countItem(this.config?.mcguffinItem ?? 'McGuffin'),
            traps: { ...this.trapEffects },
            unlockedPages: this.unlockedPages,
            last: fresh,
        });
    }

    /**
     * Pages that are open, derived from the items received so far.
     *
     * Page 1 is always open, it has no unlock item. For the rest:
     * "page" mode: the item "Store Page <n>" opens page n, nothing else.
     * "progressive" mode: the item is handed out once per page after the first, so the nth copy
     * opens page n+1.
     *
     * The list of received items is complete on every login, so this survives a reconnect without
     * any extra bookkeeping.
     */
    get unlockedPages() {
        const config = this.config;
        if (!config) {
            return [];
        }
        const total = Number(config.pages) || 0;
        const pages = new Set();
        if (total >= 1) {
            pages.add(1);
        }
        const names = this.receivedItems.map((item) => item.name ?? '');
        if (config.unlockMode === 'progressive') {
            const count = names.filter((name) => name === config.unlockItem).length;
            for (let page = 2; page <= Math.min(count + 1, total); page += 1) {
                pages.add(page);
            }
        } else {
            const prefix = config.unlockItemPrefix;
            for (const name of names) {
                if (!name.startsWith(prefix)) {
                    continue;
                }
                const number = Number.parseInt(name.slice(prefix.length).trim(), 10);
                if (Number.isFinite(number) && number >= 2 && number <= total) {
                    pages.add(number);
                }
            }
        }
        return [...pages].sort((a, b) => a - b);
    }

    /** True when the page's unlock item has arrived. */
    pageUnlocked(pageNumber) {
        return this.unlockedPages.includes(Number(pageNumber));
    }

    /**
     * Burns a share of the pool. The share is applied with "mul", so it always hits the current
     * amount even when another client added joules in the meantime.
     */
    async _applyInflationTrap(count) {
        const share = Number(this.config?.inflationPerTrap ?? 0);
        if (!(share > 0) || !this.isConnected) {
            return;
        }
        const key = this.energyKey || `EnergyLink${this.team}`;
        const percent = Math.min(100, share * 100 * count);
        // Count the traps as burnt before writing, so a second item event that arrives while the
        // request is in flight cannot burn the same trap again.
        this.inflationBurned += count;
        this._saveTrapState();
        try {
            const packet = await this._setStorage(key, [
                { operation: 'mul', value: Math.max(0, 1 - share * count) },
                { operation: 'floor', value: null },
                { operation: 'max', value: 0 },
            ]);
            const before = Math.round(Number(packet.original_value) || 0);
            const value = Math.round(Number(packet.value) || 0);
            this._setEnergy(value);
            this.emit('trap', {
                kind: 'inflation',
                count,
                percent: Math.round(percent),
                burned: before - value,
                energy: value,
            });
        } catch (error) {
            // Nothing was burnt, so let the next items event try again.
            this.inflationBurned = Math.max(0, this.inflationBurned - count);
            this._saveTrapState();
            this.log('warn', t('log.trap.failed', { error: error.message }));
        }
    }

    /**
     * Distinct locations among the received items of the given trap.
     *
     * An item of the multiworld is unique per location: one location yields exactly one item, no
     * matter how often the server sends the list. Counting locations instead of items keeps a
     * trap from being applied twice if the same entry is delivered again, and makes a reconnect
     * (which replays the whole list) harmless.
     */
    _trapLocations(name) {
        const locations = new Set();
        for (const item of this.receivedItems) {
            if ((item.name ?? '') !== name) {
                continue;
            }
            const locationId = item.locationId ?? item.location ?? null;
            locations.add(locationId === null ? `item:${locations.size}` : `loc:${locationId}`);
        }
        return locations;
    }

    countItem(name) {
        return this.receivedItems.filter((item) => (item.name ?? '') === name).length;
    }

    /** Number of tax traps received so far; the model turns it into prices. */
    get taxSteps() {
        return this.trapEffects?.tax ?? 0;
    }

    /** Price multiplier caused by all tax traps received so far. */
    get inflationFactor() {
        const step = Number(this.config?.taxPerTrap ?? 0);
        if (!(step > 0)) {
            return 1;
        }
        return 1 + this.taxSteps * step;
    }

    /**
     * How many Inflation Traps of this slot already burnt joules, per server and slot.
     *
     * The tax counter does not need this: it is a plain function of the received items and a
     * reconnect recomputes it. Burning is different, it writes to the shared pool. The item list
     * tells how many traps there are, this number tells how many of them are done, and only the
     * difference is still burnt.
     */
    _trapStorageKey() {
        return `ap-store.traps.${this.url}.${this.slotName}`;
    }

    _loadTrapState() {
        this.inflationBurned = 0;
        try {
            const raw = localStorage.getItem(this._trapStorageKey());
            if (!raw) {
                return;
            }
            const data = JSON.parse(raw);
            const burnt = Number(data.inflationBurned);
            this.inflationBurned = Number.isFinite(burnt) && burnt > 0 ? Math.floor(burnt) : 0;
        } catch {
            // a broken entry only means a trap could fire twice, not worth failing over
        }
    }

    _saveTrapState() {
        try {
            localStorage.setItem(this._trapStorageKey(), JSON.stringify({
                inflationBurned: this.inflationBurned,
            }));
        } catch {
            // storage may be blocked; the run still works, a reload just forgets the traps
        }
    }

    /* The game name per server+slot, so a reconnect does not need the TextOnly probe again. */
    _cacheKey() {
        return `ap-store.game.${this.url}.${this.slotName}`;
    }

    _cachedGame() {
        try {
            return localStorage.getItem(this._cacheKey()) || '';
        } catch {
            return '';
        }
    }

    _cacheGame(game) {
        try {
            localStorage.setItem(this._cacheKey(), game);
        } catch {
            // storage may be blocked; the probe then runs again next time
        }
    }

    _forgetGame() {
        try {
            localStorage.removeItem(this._cacheKey());
        } catch {
            // ignore
        }
    }

    _setEnergy(value) {
        const next = Math.max(0, Math.round(Number(value) || 0));
        const old = this.energy;
        const known = this.energyKnown;
        this.energy = next;
        this.energyKnown = true;
        this.emit('energy', { value: next, old, first: !known });
    }

    /** True for hosts that are certainly not reachable through TLS. */
    static isLocalHost(raw) {
        return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:|\/|$)/i.test(raw)
            || /^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(raw);
    }

    /**
     * Candidate URLs for a server address, most likely first.
     *
     * A public Archipelago host serves wss only, a local one usually plain ws. The order matters,
     * and both are needed: picking one protocol without the other fails half the time (wss is
     * required by archipelago.gg, ws is what a self-hosted server without a certificate offers).
     * On an https page ws:// is blocked as mixed content, so only wss is used there.
     */
    static candidateUrls(server) {
        const raw = String(server ?? '').trim();
        if (raw === '') {
            return [];
        }
        if (/^wss?:\/\//i.test(raw)) {
            return [raw];
        }
        if (/^https?:\/\//i.test(raw)) {
            return [raw.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')];
        }
        const host = raw.replace(/^\/+/, '');
        const secureOnly = globalThis.location?.protocol === 'https:';
        if (secureOnly) {
            return [`wss://${host}`];
        }
        if (EnergyLinkStore.isLocalHost(host)) {
            return [`ws://${host}`, `wss://${host}`];
        }
        return [`wss://${host}`, `ws://${host}`];
    }

    /** Kept for compatibility: the first candidate to try. */
    static normalizeServer(server) {
        return EnergyLinkStore.candidateUrls(server)[0] ?? '';
    }

    /**
     * Connects to a server. Resolves with { state, slot, game, slotData, config }.
     * Server, slot name and password are the only inputs: the game name comes from the world.
     */
    async connect({ server, slot, password }) {
        if (this.state === CONNECTION_STATE.connecting) {
            throw new Error('already connecting');
        }
        const candidates = EnergyLinkStore.candidateUrls(server);
        if (candidates.length === 0) {
            throw new Error(t('connect.need.server'));
        }
        this.slotName = String(slot ?? '').trim();
        this.state = CONNECTION_STATE.connecting;
        this.emit('state', { state: this.state });

        let lastError = null;
        try {
            for (let index = 0; index < candidates.length; index += 1) {
                const url = candidates[index];
                this.url = url;
                try {
                    return await this._connectToUrl(password);
                } catch (error) {
                    lastError = error;
                    // A refused login means the socket worked; another protocol will not help.
                    if (isServerRefusal(error)) {
                        throw error;
                    }
                    const next = candidates[index + 1];
                    if (!next) {
                        throw error;
                    }
                    this.log('warn', t('log.connect.protocol', { url, next }));
                }
            }
            throw lastError ?? new Error('connect failed');
        } catch (error) {
            if (error && typeof error === 'object') {
                error.url = this.url;
                error.triedUrls = candidates;
            }
            this.state = CONNECTION_STATE.disconnected;
            this.emit('state', { state: this.state, error });
            try {
                this.client.socket.disconnect();
            } catch {
                // ignore
            }
            throw error;
        }
    }

    /** One connect attempt against this.url: probe the game name, then log in for real. */
    async _connectToUrl(password) {
        // The game name of a slot is only known after connecting, and the server refuses
        // checks from a client without one. A cached name saves the extra join/part the probe
        // causes, but the cache can be stale: the room may have been regenerated with a
        // different game for this slot. So a refused login is retried once with a fresh probe.
        // The burnt counter has to be known before the login: the server replays the item list
        // right after it, and that replay must not burn the pool again.
        this._loadTrapState();

        let game = this._cachedGame();
        if (game) {
            this.log('debug', t('log.slot.game.cached', { slot: this.slotName, game }));
        } else {
            const probe = await this._probe(password);
            game = probe.game;
            this._cacheGame(game);
            this.log('info', t('log.slot.game', { slot: this.slotName, game }));
        }

        let slotData;
        try {
            slotData = await this._loginWithGame(game, password);
        } catch (error) {
            // Only a wrong game name can be fixed by probing again. A bad slot name or a
            // missing room cannot, and the probe would just fail the same way.
            if (!(error?.errors ?? []).includes('InvalidGame')) {
                throw error;
            }
            this.log('warn', t('log.slot.game.stale', { slot: this.slotName, game }));
            this._forgetGame();
            const probe = await this._probe(password);
            game = probe.game;
            this._cacheGame(game);
            this.log('info', t('log.slot.game', { slot: this.slotName, game }));
            slotData = await this._loginWithGame(game, password);
        }
        slotData = slotData ?? {};

        this.game = this.client.game || game;
        this.slot = this.client.players.self.slot;
        this.team = this.client.players.self.team ?? 0;
        this.state = CONNECTION_STATE.connected;

        const { config, warnings } = parseConfig(slotData, { game: this.game, team: this.team });
        this.config = config;
        this.energyKey = config.energyLinkKey ?? `EnergyLink${this.team}`;

        await this._loadPackage();
        await this.refreshEnergy(true);

        this.emit('state', {
            state: this.state,
            slot: this.slot,
            team: this.team,
            game: this.game,
            seed: this.client.room.seedName,
            warnings,
        });
        return {
            state: this.state,
            slot: this.slot,
            team: this.team,
            game: this.game,
            slotData,
            config,
            warnings,
        };
    }

    /** Real login with the game name, so the server accepts location checks. */
    _loginWithGame(game, password) {
        return this.client.login(this.url, this.slotName, game, {
            password: password || '',
            slotData: true,
            // the store needs its own items (McGuffins, traps) to show progress; own requires others
            items: itemsHandlingFlags.all,
        });
    }

    /**
     * Connects without a game name (TextOnly) to read the game of this slot from slot_info.
     * The password is passed along, the server needs it for the probe as well.
     */
    async _probe(password) {
        const slotData = await this.client.login(this.url, this.slotName, '', {
            password: password || '',
            slotData: true,
            // the TextOnly probe has no slot of its own, so it must not ask for own items
            items: itemsHandlingFlags.minimal,
        });
        const slotId = this.client.players.self.slot;
        const info = this.client.players.slots[slotId];
        const team = this.client.players.self.team;
        const game = info?.game;
        try {
            this.client.socket.disconnect();
        } catch {
            // ignore
        }
        if (!game) {
            throw new Error(`slot "${this.slotName}" has no game name on this server`);
        }
        return { game, team, probeSlotData: slotData };
    }

    /** Classification of an item, as the store shows it instead of the location name. */
    static classificationOf(item) {
        if (!item) {
            return 'unknown';
        }
        if (item.progression) {
            return 'progression';
        }
        if (item.trap) {
            return 'trap';
        }
        if (item.useful) {
            return 'useful';
        }
        return 'filler';
    }

    /**
     * Scouts the given locations so the store can show what is in them.
     * Returns { classification: {locationId: kind}, itemName: {locationId: name} }.
     * In race seeds the server refuses to reveal items, so this stays empty and the store
     * falls back to showing the location number.
     */
    async scoutLocations(locationIds) {
        const result = { classification: {}, itemName: {} };
        if (!this.isConnected || locationIds.length === 0) {
            return result;
        }
        try {
            const items = await this.client.scout([...locationIds], 0);
            for (const item of items) {
                result.classification[item.locationId] = EnergyLinkStore.classificationOf(item);
                result.itemName[item.locationId] = item.name;
            }
            this.scouted = result.classification;
            this.scoutedNames = result.itemName;
            this.emit('scouted', { ...result, count: items.length });
        } catch (error) {
            this.log('warn', t('log.scout.failed', { error: error.message ?? error }));
        }
        return result;
    }

    async _loadPackage() {
        try {
            await this.client.package.fetchPackage([this.game]);
            const pkg = this.client.package.findPackage(this.game);
            this.emit('datapackage', { game: this.game, locations: pkg ? Object.keys(pkg.locationTable).length : 0 });
        } catch (error) {
            this.log('warn', t('log.datapackage.failed', { error: error.message }));
        }
    }

    locationName(id) {
        const name = this.client.package.lookupLocationName(this.game, id, false);
        return name ?? `Location ${id}`;
    }

    allLocationIds() {
        if (!this.isConnected) {
            return [];
        }
        return [...this.client.room.allLocations].sort((a, b) => a - b);
    }

    checkedLocationIds() {
        if (!this.isConnected) {
            return new Set();
        }
        return new Set(this.client.room.checkedLocations);
    }

    /** Reads the EnergyLink balance. With monitor=true the server pushes updates from now on. */
    async refreshEnergy(monitor = false) {
        if (!this.isConnected) {
            throw new Error('not connected');
        }
        const key = this.energyKey || `EnergyLink${this.team}`;
        this.energyKey = key;
        try {
            const value = await this.client.storage.fetch(key, monitor);
            this._setEnergy(value ?? 0);
            return this.energy;
        } catch (error) {
            this.energyKnown = false;
            this.emit('energy', { value: null, error });
            throw error;
        }
    }

    /** Raw data storage write that returns the whole SetReply packet (value + original_value). */
    async _setStorage(key, operations, defaultValue = 0) {
        const id = uuid();
        this.client.socket.send({
            cmd: 'Set',
            default: defaultValue,
            key,
            operations,
            want_reply: true,
            uuid: id,
        });
        const [packet] = await this.client.socket.wait('setReply', (p) => p.uuid === id);
        return packet;
    }

    /** Buys one location. Kept for the console and for callers that buy a single row. */
    async buyLocation(locationId, price) {
        return this.buyLocations([locationId], price);
    }

    /**
     * Buys several locations at once: charges the sum once, then reports the locations as checked.
     *
     * The charge is a single storage operation, so either the whole sum is paid or nothing is. The
     * checks follow one by one; if one of them fails the rest is still checked, because the joules
     * are already gone. The result lists what went through, so the caller can show a partial
     * purchase instead of pretending it was all or nothing.
     *
     * Returns { ok, reason, energy, locations, price, charged, checked }.
     */
    async buyLocations(locationIds, price) {
        if (!this.isConnected) {
            return { ok: false, reason: 'not connected' };
        }
        const ids = [...new Set((locationIds ?? []).map(Number).filter((id) => Number.isFinite(id)))];
        if (ids.length === 0) {
            return { ok: false, reason: 'no selection' };
        }
        if (this.buying) {
            return { ok: false, reason: 'busy' };
        }
        const already = this.checkedLocationIds();
        const fresh = ids.filter((id) => !already.has(id));
        if (fresh.length === 0) {
            return { ok: false, reason: 'already checked' };
        }
        // A caller that only asks for part of the list should pay for part of the list.
        const cost = fresh.length === ids.length ? price : Math.round(price * (fresh.length / ids.length));

        this.buying = true;
        const key = this.energyKey || `EnergyLink${this.team}`;
        let charged = 0;
        try {
            let balance = this.energy;
            if (!this.energyKnown) {
                balance = await this.refreshEnergy(true);
            }
            if (balance < cost) {
                return { ok: false, reason: 'insufficient', energy: balance };
            }

            // Charge first, so two clients cannot buy the same joules at once.
            const packet = await this._setStorage(key, [
                { operation: 'add', value: -cost },
                { operation: 'max', value: 0 },
            ]);
            const before = Math.round(Number(packet.original_value) || 0);
            const after = Math.round(Number(packet.value) || 0);
            charged = before - after;
            this._setEnergy(after);

            if (charged !== cost) {
                // Someone else changed the value in between; do not keep a partial charge.
                if (charged > 0) {
                    await this._setStorage(key, [{ operation: 'add', value: charged }]).catch(() => {});
                    this._setEnergy(before);
                }
                return { ok: false, reason: 'race', energy: before, charged };
            }

            // Checking makes the server deliver each location's item to whoever it belongs to,
            // which is the only place traps are applied (see _onItemsReceived).
            const checked = [];
            let failure = null;
            for (const id of fresh) {
                try {
                    this.client.check(id);
                    checked.push(id);
                } catch (error) {
                    failure = error;
                }
            }
            if (checked.length > 0) {
                this.emit('locations', { checked });
            }
            if (checked.length === 0) {
                // Nothing was checked, so give the joules back.
                await this._setStorage(key, [{ operation: 'add', value: charged }]).catch(() => {});
                this._setEnergy(Math.round(Number(before)));
                return { ok: false, reason: 'error', error: failure?.message ?? 'check failed', charged: 0 };
            }
            return {
                ok: checked.length === fresh.length,
                reason: checked.length === fresh.length ? undefined : 'partial',
                energy: after,
                locations: checked,
                price: cost,
                charged,
            };
        } catch (error) {
            if (charged > 0) {
                try {
                    await this._setStorage(key, [{ operation: 'add', value: charged }]);
                    this._setEnergy(Math.round(Number(this.energy) + charged));
                } catch {
                    this.log('error', t('log.buy.revert.failed', { amount: charged }));
                }
            }
            return { ok: false, reason: 'error', error: error.message };
        } finally {
            this.buying = false;
        }
    }

    async say(text) {
        if (!this.isConnected) {
            throw new Error('not connected');
        }
        await this.client.messages.say(text);
    }

    disconnect() {
        try {
            this.client.socket.disconnect();
        } catch {
            // ignore
        }
        this.state = CONNECTION_STATE.disconnected;
        this.energyKnown = false;
        this.emit('state', { state: this.state });
    }
}
