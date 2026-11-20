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
// Mit --push-traps <n> landen Traps dieses Slots bei Slot n (Multiworld-Fall: ein anderer
// Spieler kauft die Location, das Item kommt bei uns an).
const PUSH_TRAPS_TO = Number(opt('push-traps', 0)) || 0;
const NO_SLOT_DATA = Boolean(opt('no-slot-data', false));
const LOCATION_BASE = 1000;

const locationIds = Array.from({ length: PAGES * PER_PAGE }, (_, i) => LOCATION_BASE + i);
const locationNames = Object.fromEntries(locationIds.map((id, i) => [`Location ${i + 1}`, id]));

const storage = new Map([[`EnergyLink0`, ENERGY]]);
const checked = new Set();
const items = [];

// Deterministic item/classification per location so the tests can rely on it.
// Fixed layout per page of five: filler, Inflation Trap, Tax Trap, McGuffin, filler.
// Location 1 of a page is always a plain filler, so a single buy does not trigger a trap.
function itemForLocation(id) {
    const index = (id - LOCATION_BASE) % 5;
    if (index === 1) return 503;          // Inflation Trap
    if (index === 2) return 502;          // Tax Trap
    if (index === 3) return 500;          // McGuffin
    return 501;                           // Store Filler
}

function flagsForLocation(id) {
    const index = (id - LOCATION_BASE) % 5;
    if (index === 3) return 1;            // progression (McGuffin)
    if (index === 1 || index === 2) return 4;   // trap
    return 0;                             // filler
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
                const startItems = [{ item: 500, location: 0, player: 1, flags: 1 }];
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
                send([{ cmd: 'ReceivedItems', index: 0, items: startItems }]);
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
                        keys[key] = [];
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
                    // The item comes from the same table the scout answers use.
                    for (const id of newIds) {
                        items.push({
                            item: itemForLocation(id),
                            location: id,
                            player: 1,
                            flags: flagsForLocation(id),
                        });
                    }
                    send([{ cmd: 'ReceivedItems', index: items.length - newIds.length, items: items.slice(-newIds.length) }]);
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
                const id = Number(packet.location);
                const entry = {
                    item: itemForLocation(id),
                    location: id,
                    player: PUSH_TRAPS_TO || 2,
                    flags: 4,
                };
                items.push(entry);
                logLine(`pushed trap for location ${id} (from slot ${entry.player})`);
                send([{ cmd: 'ReceivedItems', index: items.length - 1, items: [entry] }]);
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
