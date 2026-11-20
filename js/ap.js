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

/** True for the two trap items of this world. */
function isTrapItem(name) {
    return name === 'Tax Trap' || name === 'Inflation Trap';
}

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
        this.received = [];
        this.trapEffects = { tax: 0, inflation: 0 };
        // locationId -> 'progression' | 'useful' | 'trap' | 'filler', filled by scouting
        this.scouted = {};
        this.scoutedNames = {};
        // locationId -> true once its trap was applied. A trap can arrive twice (bought here and
        // placed elsewhere), the location id is what keeps it from counting double.
        this.trapFired = new Map();
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
            // startingIndex 0 means "here is everything you ever got", which happens on connect:
            // those traps were applied in an earlier session and must not fire again.
            this._onItemsReceived(items, startingIndex, startingIndex === 0);
        });
    }

    get isConnected() {
        return this.state === CONNECTION_STATE.connected;
    }

    /**
     * Counts the items of this slot and fires traps that arrive from other worlds.
     *
     * A reconnect replays every item with startingIndex 0. Those are already applied, so the
     * replay only restores the counters. The location-id map in applyTrapFromLocation would
     * catch it too, but it is per session and the replay must not burn the pool again.
     */
    _onItemsReceived(items, startingIndex, replay = false) {
        if (startingIndex === 0) {
            this.received = [];
        }
        const fresh = [];
        for (const item of items) {
            const name = item.name ?? '';
            this.received.push(name);
            fresh.push(name);
        }

        // A trap can be placed in another player's world. Buying that location sends the item
        // here, and that is the moment it has to take effect. On a replay they already fired.
        const incoming = items.filter((item) => isTrapItem(item.name ?? ''));
        if (incoming.length > 0) {
            if (replay) {
                this._restoreTrapCounters(incoming);
            } else {
                void this._applyIncomingTraps(incoming);
            }
        }

        this.emit('items', {
            mcguffins: this.countItem(this.config?.mcguffinItem ?? 'McGuffin'),
            traps: { ...this.trapEffects },
            last: fresh,
        });
    }

    /** Counters for traps that were already applied before (reconnect replay). */
    _restoreTrapCounters(items) {
        for (const item of items) {
            const locationId = item.locationId ?? item.location ?? null;
            if (locationId !== null) {
                this.trapFired.set(locationId, item.name === 'Tax Trap' ? 'tax' : 'inflation');
            }
        }
        this._syncTrapCounters();
        this._saveTrapState();
    }

    /** Traps that arrived from other worlds, deduplicated by their location id. */
    async _applyIncomingTraps(items) {
        for (const item of items) {
            const locationId = item.locationId ?? item.location ?? null;
            if (locationId === null) {
                continue;
            }
            // The effect is decided by the item that really arrived, not by our scout data:
            // in another player's world the same location holds a different item.
            const name = item.name ?? '';
            this.scoutedNames = this.scoutedNames ?? {};
            this.scoutedNames[locationId] = name;
            await this.applyTrapFromLocation(locationId);
        }
        this.emit('items', {
            mcguffins: this.countItem(this.config?.mcguffinItem ?? 'McGuffin'),
            traps: { ...this.trapEffects },
            last: [],
        });
    }

    /**
     * Applies the trap that sits in a location and returns what happened, or null.
     *
     * There are two ways a trap of this store reaches the player:
     *   1. you buy the location in this store  -> buyLocation calls this
     *   2. another player buys it in their world and the item is sent here -> item event
     * Both go through this method, and the location id makes sure the effect happens only once,
     * because the item and the purchase describe the same location.
     */
    async applyTrapFromLocation(locationId) {
        const name = this.scoutedNames?.[locationId];
        if (!name || !isTrapItem(name)) {
            return null;
        }
        const already = this.trapFired.get(locationId);
        if (already) {
            return { kind: already, count: 0, duplicate: true };
        }
        this.trapFired.set(locationId, name === 'Tax Trap' ? 'tax' : 'inflation');
        this._saveTrapState();
        if (name === 'Tax Trap') {
            this.trapEffects.tax += 1;
            const detail = {
                kind: 'tax',
                count: 1,
                percent: Math.round((this.config?.taxPerTrap ?? 0) * 100),
                factor: this.inflationFactor,
            };
            this.emit('trap', detail);
            return detail;
        }
        if (name === 'Inflation Trap') {
            this.trapEffects.inflation += 1;
            await this._applyInflationTrap(1);
            return { kind: 'inflation', count: 1 };
        }
        return null;
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
            this.log('warn', t('log.trap.failed', { error: error.message }));
        }
    }

    countItem(name) {
        return this.received.filter((item) => item === name).length;
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
     * Traps that already took effect, per server and slot. The server does not resend items on a
     * reconnect, so without this every reload would forget the tax factor and could burn the pool
     * a second time for a trap that was already applied.
     */
    _trapStorageKey() {
        return `ap-store.traps.${this.url}.${this.slotName}`;
    }

    _loadTrapState() {
        try {
            const raw = localStorage.getItem(this._trapStorageKey());
            if (!raw) {
                return;
            }
            const data = JSON.parse(raw);
            for (const [locationId, kind] of Object.entries(data.fired ?? {})) {
                this.trapFired.set(Number(locationId), kind);
            }
        } catch {
            // a broken entry only means a trap could fire twice, not worth failing over
        }
    }

    _saveTrapState() {
        try {
            localStorage.setItem(this._trapStorageKey(), JSON.stringify({
                fired: Object.fromEntries(this.trapFired),
            }));
        } catch {
            // storage may be blocked; the run still works, a reload just forgets the traps
        }
    }

    _syncTrapCounters() {
        const kinds = [...this.trapFired.values()];
        this.trapEffects.tax = kinds.filter((k) => k === 'tax').length;
        this.trapEffects.inflation = kinds.filter((k) => k === 'inflation').length;
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
        this.trapFired = new Map();
        this._loadTrapState();
        this._syncTrapCounters();
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

    /**
     * Buys a location: pay the price via EnergyLink, then report the location as checked.
     * Returns { ok, reason, energy, location }.
     */
    async buyLocation(locationId, price) {
        if (!this.isConnected) {
            return { ok: false, reason: 'not connected' };
        }
        if (this.buying) {
            return { ok: false, reason: 'busy' };
        }
        if (this.checkedLocationIds().has(locationId)) {
            return { ok: false, reason: 'already checked' };
        }
        this.buying = true;
        const key = this.energyKey || `EnergyLink${this.team}`;
        let charged = 0;
        try {
            let balance = this.energy;
            if (!this.energyKnown) {
                balance = await this.refreshEnergy(true);
            }
            if (balance < price) {
                return { ok: false, reason: 'insufficient', energy: balance };
            }

            // Charge first, so two clients cannot buy the same joules at once.
            const packet = await this._setStorage(key, [
                { operation: 'add', value: -price },
                { operation: 'max', value: 0 },
            ]);
            const before = Math.round(Number(packet.original_value) || 0);
            const after = Math.round(Number(packet.value) || 0);
            charged = before - after;
            this._setEnergy(after);

            if (charged !== price) {
                // Someone else changed the value in between; do not keep a partial charge.
                if (charged > 0) {
                    await this._setStorage(key, [{ operation: 'add', value: charged }]).catch(() => {});
                    this._setEnergy(before);
                }
                return { ok: false, reason: 'race', energy: before, charged };
            }

            // Read the trap before checking: the scout data is there as soon as the page is shown.
            const trap = await this.applyTrapFromLocation(locationId);

            this.client.check(locationId);
            this.emit('locations', { checked: [locationId] });
            return { ok: true, energy: after, location: locationId, price, charged, trap };
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
