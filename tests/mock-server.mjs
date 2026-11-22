// Minimal Archipelago server mock for local testing of the store.
// Speaks just enough of the protocol: RoomInfo, Connect, Connected, Set/Get, LocationChecks,
// PrintJSON, DataPackage.
//
//   node tests/mock-server.mjs --port 38281 --slot Tester --game "Test World" \
//        --energy 5000000 --pages 3 --perpage 5 --password ""
//
// Flags: --fail-checks to reject location checks (TextOnly behaviour), --no-slot-data to send {}.

import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
function opt(name, fallback) {
    const i = args.indexOf(`--${name}`);
    if (i === -1) {
        return fallback;
    }
    const next = args[i + 1];
    return next === undefined || next.startsWith('--') ? true : next;
}

const PORT = Number(opt('port', 38281));
const SLOT = String(opt('slot', 'Tester'));
const GAME = String(opt('game', 'Test World'));
const PASSWORD = opt('password', '') === true ? '' : String(opt('password', ''));
const ENERGY = Number(opt('energy', 5000000));
const PAGES = Number(opt('pages', 3));
const PER_PAGE = Number(opt('perpage', 5));
const FAIL_CHECKS = Boolean(opt('fail-checks', false));
// With --push-traps <n> the traps of this slot are delivered to slot n (multiworld case: another
// player buys the location and its item arrives here).
const PUSH_TRAPS_TO = Number(opt('push-traps', 0)) || 0;
// With --items-to-other the items of bought locations go to another player instead of us. That is
// the case "I buy, the item belongs to someone else" -- the traps must not fire here then. In the
// protocol `player` is the *sending* slot, i.e. whoever bought the location.
const ITEMS_TO_OTHER = Boolean(opt('items-to-other', false));
const NO_SLOT_DATA = Boolean(opt('no-slot-data', false));
// With --no-traps the layout only has McGuffins and filler. Handy for tests that do arithmetic on
// prices and the balance: a trap would change prices or the pool in the middle of the test.
const NO_TRAPS = Boolean(opt('no-traps', false));
// With --block-ops mul,floor the mock refuses those storage operations, like a patched server that
// answers Set with AP_BLOCK_SET reason=operation_disabled. The client must then either avoid the
// operation or report the failure, never pretend the write worked.
const BLOCKED_OPS = String(opt('block-ops', '') || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
// Unlock mode: "page" (item "Store Page <n>" per page) or "progressive" (nth copy opens page n+1).
const UNLOCK_MODE = String(opt('unlock', 'page'));
// With --start-unlocked 2,3 these further pages are open from the start. Page 1 is always open,
// the client decides that itself, so it does not need an item here.
const START_UNLOCKED = String(opt('start-unlocked', '') || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 2);
const LOCATION_BASE = 1000;

const locationIds = Array.from({ length: PAGES * PER_PAGE }, (_, i) => LOCATION_BASE + i);
const locationNames = Object.fromEntries(locationIds.map((id, i) => [`Location ${i + 1}`, id]));

const PROGRESSIVE_UNLOCK_ITEM = 'Progressive Store Unlock';
const PAGE_UNLOCK_PREFIX = 'Store Page ';
const UNLOCK_BASE_ID = 600;

/** Item name that opens page n. */
function unlockItemName(page) {
    return UNLOCK_MODE === 'progressive' ? PROGRESSIVE_UNLOCK_ITEM : `${PAGE_UNLOCK_PREFIX}${page}`;
}

// Every unlock item the loaded data package knows, so the client can resolve the ids.
const unlockItemIds = {};
for (let page = 1; page <= PAGES; page += 1) {
    unlockItemIds[unlockItemName(page)] = UNLOCK_MODE === 'progressive' ? UNLOCK_BASE_ID : UNLOCK_BASE_ID + page;
}
// Page 1 has no unlock item in this world, so the client never gets one for it.
const unlockableFromPage = 2;

// The unlock items that arrived before the run, handed out with the start inventory.
const START_ITEMS = [
    { item: 500, location: 0, player: 1, flags: 1 },
    ...START_UNLOCKED.filter((page) => page >= unlockableFromPage).map((page, index) => ({
        item: unlockItemIds[unlockItemName(page)],
        location: 0,
        player: 1,
        flags: 1,
        // only used to keep the entries apart in the received list
        index,
    })),
];

const storage = new Map([[`EnergyLink0`, ENERGY]]);
// Hints of this slot, in the format the server keeps under _read_hints_<team>_<slot>.
const hints = [];
const checked = new Set();
const items = [];
// What this slot really received. The server keeps that per slot, so items a bought location sends
// to another player never show up here.
const receivedByUs = [];

// Deterministic item/classification per location so the tests can rely on it.
// Fixed layout per page of five: filler, Inflation Trap, Tax Trap, McGuffin, filler.
// Location 1 of a page is always a plain filler, so a single buy does not trigger a trap.
function itemForLocation(id) {
    const index = (id - LOCATION_BASE) % 5;
    if (index === 1) return NO_TRAPS ? 500 : 503;   // Inflation Trap (ohne Traps: McGuffin)
    if (index === 2) return NO_TRAPS ? 501 : 502;   // Tax Trap (ohne Traps: Filler)
    if (index === 3) return 500;                    // McGuffin
    return 501;                                     // Store Filler
}

function flagsForLocation(id) {
    const index = (id - LOCATION_BASE) % 5;
    if (index === 3 || (NO_TRAPS && index === 1)) return 1;   // progression (McGuffin)
    if (!NO_TRAPS && (index === 1 || index === 2)) return 4;  // trap
    return 0;                                                  // filler
}
const log = [];

function logLine(...parts) {
    const line = parts.join(' ');
    log.push(line);
    console.log(line);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
    logLine('client connected');
    let authed = false;
    let slotName = null;
    let noLocations = false;

    const send = (packets) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(packets));
        }
    };

    // RoomInfo is sent right after the connection opens.
    send([{
        cmd: 'RoomInfo',
        version: { major: 0, minor: 6, build: 3, class: 'Version' },
        generator_version: { major: 0, minor: 6, build: 3, class: 'Version' },
        tags: ['AP', 'WebHost'],
        password: PASSWORD !== '',
        permissions: { hint: 0, release: 0, collect: 0, cause_deathlink: 0, forfeit: 0 },
        hint_cost: 10,
        location_check_points: 1,
        games: [GAME],
        datapackage_checksums: { [GAME]: 'mock-checksum' },
        seed_name: 'MockSeed',
        time: Math.floor(Date.now() / 1000),
    }]);

    ws.on('message', (raw) => {
        let packets;
        try {
            packets = JSON.parse(raw.toString());
        } catch {
            return;
        }
        for (const packet of Array.isArray(packets) ? packets : [packets]) {
            handle(packet);
        }
    });

    function handle(packet) {
        switch (packet.cmd) {
            case 'Connect': {
                if (PASSWORD !== '' && packet.password !== PASSWORD) {
                    logLine('refused: InvalidPassword');
                    send([{ cmd: 'ConnectionRefused', errors: ['InvalidPassword'] }]);
                    return;
                }
                if (packet.name !== SLOT) {
                    logLine('refused: InvalidSlot', packet.name);
                    send([{ cmd: 'ConnectionRefused', errors: ['InvalidSlot'] }]);
                    return;
                }
                const textOnly = !packet.game;
                if (!textOnly && packet.game !== GAME) {
                    logLine('refused: InvalidGame', packet.game);
                    send([{ cmd: 'ConnectionRefused', errors: ['InvalidGame'] }]);
                    return;
                }
                slotName = packet.name;
                authed = true;
                noLocations = textOnly;
                logLine('auth ok', textOnly ? '(TextOnly)' : `(game ${packet.game})`);
                // Give the client its starting items, like the real server does.
                const startItems = START_ITEMS;
                send([{
                    cmd: 'Connected',
                    team: 0,
                    slot: 1,
                    players: [{ team: 0, slot: 1, alias: SLOT, name: SLOT }],
                    missing_locations: locationIds.filter((id) => !checked.has(id)),
                    checked_locations: [...checked],
                    slot_info: {
                        1: { name: SLOT, game: GAME, type: 1, group_members: [] },
                    },
                    hint_points: 0,
                    slot_data: NO_SLOT_DATA ? {} : {
                        progress_items: PAGES,
                        locations_per_page: PER_PAGE,
                        unlock_mode: UNLOCK_MODE,
                        unlock_item: PROGRESSIVE_UNLOCK_ITEM,
                        unlock_item_prefix: PAGE_UNLOCK_PREFIX,
                        base_price: 1000000,
                        price_step: 1000000,
                        mcguffins_required: 6,
                        mcguffin_name: 'McGuffin',
                        // fractions: Tax Trap = +10 % price, Inflation Trap = 20 % of the pool burned
                        tax_per_trap: 0.1,
                        inflation_per_trap: 0.2,
                        trap_percentage: 20,
                        store_version: 1,
                    },
                }]);
                // Like the real server: index 0 carries the start inventory and everything this
                // slot received so far in one list. Items addressed to another slot are not ours,
                // the server never delivers those to us.
                send([{ cmd: 'ReceivedItems', index: 0, items: [...startItems, ...receivedByUs] }]);
                return;
            }
            case 'GetDataPackage': {
                const games = packet.games?.length ? packet.games : [GAME];
                const data = { games: {} };
                for (const game of games) {
                    if (game === GAME) {
                        data.games[GAME] = {
                            checksum: 'mock-checksum',
                            item_name_to_id: {
                                McGuffin: 500,
                                'Store Filler': 501,
                                'Tax Trap': 502,
                                'Inflation Trap': 503,
                                ...unlockItemIds,
                            },
                            location_name_to_id: locationNames,
                        };
                    }
                }
                send([{ cmd: 'DataPackage', data }]);
                return;
            }
            case 'Get': {
                const keys = {};
                for (const key of packet.keys ?? []) {
                    if (key.startsWith('_read_hints_')) {
                        keys[key] = hints;
                    } else {
                        keys[key] = storage.has(key) ? storage.get(key) : null;
                    }
                }
                send([{ cmd: 'Retrieved', keys, uuid: packet.uuid }]);
                return;
            }
            case 'SetNotify':
                return;
            case 'Set': {
                // A patched server refuses single operations outright.
                const blocked = (packet.operations ?? [])
                    .find((op) => BLOCKED_OPS.includes(op.operation));
                if (blocked) {
                    logLine(`BLOCK_SET key=${packet.key} op=${blocked.operation}`);
                    if (!packet.want_reply) {
                        return;
                    }
                    send([{
                        cmd: 'InvalidPacket',
                        type: 'cmd',
                        text: `operation ${blocked.operation} disabled`,
                        original_cmd: 'Set',
                    }]);
                    return;
                }
                // Like the real server: default only applies when the key does not exist yet.
                let value = storage.has(packet.key) ? storage.get(packet.key) : (packet.default ?? 0);
                const original = value;
                for (const op of packet.operations ?? []) {
                    switch (op.operation) {
                        case 'add': value += op.value; break;
                        case 'mul': value *= op.value; break;
                        case 'pow': value **= op.value; break;
                        case 'mod': value %= op.value; break;
                        case 'max': value = Math.max(value, op.value); break;
                        case 'min': value = Math.min(value, op.value); break;
                        case 'replace': value = op.value; break;
                        case 'floor': value = Math.floor(value); break;
                        case 'ceiling': value = Math.ceil(value); break;
                        default: break;
                    }
                }
                storage.set(packet.key, value);
                logLine(`set ${packet.key}: ${original} -> ${value}`);
                const reply = {
                    cmd: 'SetReply',
                    key: packet.key,
                    value,
                    original_value: original,
                    slot: 1,
                    uuid: packet.uuid,
                };
                send([reply]);
                return;
            }
            case 'LocationChecks': {
                if (noLocations || FAIL_CHECKS) {
                    logLine('rejected LocationChecks (text only)');
                    send([{
                        cmd: 'InvalidPacket',
                        type: 'cmd',
                        text: "Trackers can't register new Location Checks",
                        original_cmd: 'LocationChecks',
                    }]);
                    return;
                }
                const newIds = (packet.locations ?? []).filter((id) => locationIds.includes(id) && !checked.has(id));
                for (const id of newIds) {
                    checked.add(id);
                }
                logLine('checked', newIds.join(','));
                if (newIds.length > 0) {
                    // The item comes from the same table the scout answers use. Items of another
                    // slot are not delivered to us, like on a real server.
                    const delivered = [];
                    for (const id of newIds) {
                        const entry = {
                            item: itemForLocation(id),
                            location: id,
                            // `player` is the slot that found the item, i.e. the buyer.
                            player: ITEMS_TO_OTHER ? 2 : 1,
                            flags: flagsForLocation(id),
                        };
                        items.push(entry);
                        // Items of another slot are not delivered to us, like on a real server.
                        if (!ITEMS_TO_OTHER) {
                            delivered.push(entry);
                        }
                    }
                    if (delivered.length > 0) {
                        // The index counts what this slot received, so it continues after it.
                        receivedByUs.push(...delivered);
                        send([{
                            cmd: 'ReceivedItems',
                            index: START_ITEMS.length + receivedByUs.length - delivered.length,
                            items: delivered,
                        }]);
                    }
                    send([{ cmd: 'RoomUpdate', checked_locations: newIds }]);
                    send([{
                        cmd: 'PrintJSON',
                        data: [{ type: 'text', text: `Checked ${newIds.length} location(s)` }],
                    }]);
                }
                return;
            }
            case 'LocationScouts': {
                // Like the real server: answer with item, location, player and classification flags.
                const locations = (packet.locations ?? [])
                    .filter((id) => locationIds.includes(id))
                    .map((id) => ({
                        item: itemForLocation(id),
                        location: id,
                        player: 1,
                        flags: flagsForLocation(id),
                    }));
                send([{ cmd: 'LocationInfo', locations }]);
                return;
            }
            case 'DebugPushTrap': {
                // Test hook: deliver a trap item as if another player had bought that location.
                // A location yields its item once, also here: a repeated push is a protocol
                // violation the real server cannot produce (see send_new_items), so it is ignored.
                const id = Number(packet.location);
                if (items.some((entry) => entry.location === id)) {
                    logLine(`ignored repeated push for location ${id}`);
                    return;
                }
                const entry = {
                    item: itemForLocation(id),
                    location: id,
                    player: PUSH_TRAPS_TO || 2,
                    flags: 4,
                };
                items.push(entry);
                receivedByUs.push(entry);
                logLine(`pushed trap for location ${id} (from slot ${entry.player})`);
                send([{ cmd: 'ReceivedItems', index: START_ITEMS.length + receivedByUs.length - 1, items: [entry] }]);
                return;
            }
            case 'DebugHint': {
                // Test hook: hint one location, like a player spending hint points on it.
                const locationId = Number(packet.location);
                const itemId = itemForLocation(locationId);
                hints.push({
                    receiving_player: 1,
                    finding_player: 1,
                    location: locationId,
                    item: itemId,
                    found: false,
                    entrance: '',
                    item_flags: flagsForLocation(locationId),
                    status: 0,
                });
                logLine(`hinted location ${locationId} (item ${itemId})`);
                // The library reads the list from storage, so a client that asked before gets the
                // new entry through this reply as well.
                send([{ cmd: 'SetReply', key: `_read_hints_0_1`, value: hints }]);
                return;
            }
            case 'DebugPushUnlock': {
                // Test hook: hand the client the unlock item of a page, as if that item had just
                // been found somewhere in the multiworld.
                const page = Number(packet.page);
                if (page < unlockableFromPage) {
                    logLine(`page ${page} has no unlock item`);
                    return;
                }
                const name = unlockItemName(page);
                const itemId = unlockItemIds[name];
                if (!itemId) {
                    logLine(`unknown unlock page ${packet.page}`);
                    return;
                }
                const entry = { item: itemId, location: 0, player: 2, flags: 1 };
                receivedByUs.push(entry);
                logLine(`pushed unlock for page ${page} (${name})`);
                send([{ cmd: 'ReceivedItems', index: START_ITEMS.length + receivedByUs.length - 1, items: [entry] }]);
                return;
            }
            case 'Say': {
                logLine('say', packet.text);
                return;
            }
            case 'StatusUpdate':
                return;
            default:
                logLine('unhandled', packet.cmd);
        }
    }

    ws.on('close', () => logLine('client gone', authed ? slotName : ''));
});

logLine(`mock server on ws://localhost:${PORT} slot=${SLOT} game=${GAME} energy=${ENERGY}`);
