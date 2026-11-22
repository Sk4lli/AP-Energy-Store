# Archipelago Energylink Store

A browser-only client for Archipelago. No build step, no framework: HTML, CSS and JavaScript
(ES modules), connected through [archipelago.js](https://github.com/ThePhar/archipelago.js).
The store sells locations for joules from the EnergyLink pool.

## Running it

The page **must be served over HTTP**. Opening `index.html` directly (`file://`) leaves the
language selector empty and the console silent, because browsers block JavaScript modules there.
The page shows a note in that case.

The easiest way is the start script:

```bash
./start.sh          # Linux/macOS, starts a server and opens the browser
start.cmd           # Windows
```

Or by hand:

```bash
python3 -m http.server 3000   # or: npm run serve
# browser: http://localhost:3000/index.html
```

Another port: `PORT=8080 ./start.sh`.

### GitHub Pages

The page works on GitHub Pages because every path is relative. Two things are different there:

- **HTTPS.** Pages serves over `https://`, so only `wss://` is possible. A self-hosted Archipelago
  server without a certificate is **not** reachable from there; you need a server with TLS
  (such as `archipelago.gg`) or your own reverse proxy in front of it.
- **Sub path.** The page lives under `/<repo>/`. That works as long as it is served as project
  pages, and the same way for user pages in the root directory.

To enable it: Settings → Pages → Source "Deploy from a branch", branch `main`, folder `/ (root)`.
The page is then reachable at `https://<user>.github.io/AP-Engery-Store/index.html`.

The address may be entered with or without a protocol. The client tries both, because public hosts
only speak `wss://` while a self-hosted server without a certificate only speaks `ws://`: locally
`ws` first, for remote hosts `wss` first. On an HTTPS page only `wss` is possible (otherwise the
browser blocks mixed content). An explicit `ws://` or `wss://` in the address is used as-is.

## Connecting

Only three fields: server (`host:port`), slot name, password (leave empty if none is set).
The game name is **not** asked for, it comes from the APWorld:

1. The client connects once as TextOnly and reads the game name of the slot from `slot_info`.
2. Then it connects with that game name. This is necessary because the server does not accept
   location checks from TextOnly clients (`no_locations`).
3. The game name is remembered per server and slot in `localStorage`, so a reconnect does not need
   the TextOnly probe again. If the server refuses the login with `InvalidGame` (for example after
   the room was regenerated), the cache is dropped and the client probes once more.
4. Other refusals are shown in plain text, for example `InvalidSlot` with a hint that the slot name
   does not exist in the room.

The first connection produces a join/part message in the room chat (TextOnly). That is a quirk of
the protocol, not an error.

## APWorld

The matching world lives in `apworld/energylink_store`. It creates locations, McGuffins, filler and
traps, and sends the store configuration as slot_data.

```bash
cd apworld && ./build.sh
cp energylink_store.apworld ~/.local/share/Archipelago/worlds/
```

Details on options, items and the goal: `apworld/energylink_store/docs/`.

Items the world creates:

| Item               | Class       | Effect in the store                                 |
| ------------------ | ----------- | --------------------------------------------------- |
| `McGuffin`         | progression | goal: collect `mcguffins_required` of them           |
| `Store Filler`     | filler      | nothing                                             |
| `Tax Trap`         | trap        | every price rises permanently by `tax_per_trap` %    |
| `Inflation Trap`   | trap        | `inflation_per_trap` % of the EnergyLink pool burns  |
| `Store Page <n>`   | progression | opens page n, n >= 2 (unlock mode `page`)            |
| `Progressive Store Unlock` | progression | the nth copy opens page n (mode `progressive`) |

Traps, McGuffins and unlocks are placed by Archipelago **like any other item**, so they can end up
anywhere in the multiworld. A trap always belongs to the store world that created it.

A trap takes effect **the moment its item arrives here**, not when the location is bought. That is
the same moment, because buying a location makes the server deliver that location's item to the
player it belongs to:

- The item is yours: it arrives here, the trap fires.
- The item belongs to another player: it arrives there, so the trap fires in *their* store. Your
  pool is not touched.
- Another player buys a location whose item is yours: it arrives here, the trap fires.

The effect is derived from the item list the server sends in full on every login, so a reconnect
only repeats what is already known. Burning is the one thing that writes to the server: how many
Inflation Traps already burnt is remembered in `localStorage`, and only the difference to the item
list is burnt. Reloading therefore burns nothing twice and does not forget the tax increase.

## Store configuration (slot_data)

The number of progress pages and locations per page come from the slot's `slot_data`, which is the
player YAML. Expected keys (all optional):

| Key (aliases)                            | Meaning                              | Default    |
| ---------------------------------------- | ------------------------------------ | ---------- |
| `progress_items`                         | number of progress pages             | 5          |
| `locations_per_page`                     | locations per page, 5–10             | 5          |
| `unlock_mode`                            | `page` or `progressive`              | `page`     |
| `unlock_item`                            | item name for the progressive mode   | `Progressive Store Unlock` |
| `unlock_item_prefix`                     | name prefix in `page` mode           | `Store Page ` |
| `base_price`                             | price of a page 1 location (J)       | 1 000 000  |
| `price_step`                             | added per page (J)                   | 1 000 000  |
| `filler_joules`                          | shown value of a filler item (J)     | 0          |
| `energylink_key`                         | override the EnergyLink key          | `EnergyLink{team}` |
| `mcguffins_required`                     | goal amount of McGuffins (display)   | 0          |
| `mcguffin_name`                          | item name used for the goal          | `McGuffin` |
| `tax_per_trap`                           | price increase per Tax Trap (share)  | 0          |
| `inflation_per_trap`                     | pool share burnt per Inflation Trap  | 0          |

Aliases: `progressItems`, `locations_per_progress`, `price_base`, `starting_price`,
`price_increase` and so on. A nested object `energylink_store`, `store` or `config` is detected too.
If nothing is there, the defaults apply and the console shows a warning.

### Opening pages

**Page 1 is always open.** Every further page opens once its **unlock item** has arrived. While a page
is locked the store shows neither the item name nor the category of its locations — the row only
carries a dash there — and nothing can be bought there. Those locations are not even scouted, so the
server is not asked what is in them either. Two modes, chosen with `unlock_mode`:

| Mode | Item(s) | Effect |
| --- | --- | --- |
| `page` (default) | `Store Page 2`, `Store Page 3`, … | Each item opens exactly its own page — not the ones before or after it. |
| `progressive` | `Progressive Store Unlock` | The first copy opens page 2, the second page 3, and so on. |

There is no item for page 1: it is open from the start, otherwise the store could never be used.

Page 1 is open from the start. Every further page has logic: page N only becomes reachable once the
unlock of page N-1 arrived. That way the fill cannot place an unlock behind the page it opens, which
would make the seed unbeatable. The unlocks for pages 2 and up are placed somewhere in the
multiworld, like every other item.

### Buying

Every row of an open page has a tick. The buy button buys **all ticked rows of the current page** in
one go: the sum is charged once, then the locations are reported. If the balance does not cover the
whole selection, nothing is bought at all.

The price of a location is `base_price + price_step * (page - 1)`. Every location on a page costs the
same, higher pages get more expensive.

Example for the world's YAML:

```yaml
EnergyLink Store:
  progress_items: 5
  locations_per_page: 8
  base_price: 750k
  price_step: 1.5m
  unlock_mode: page
```

### Short joule amounts

`base_price`, `price_step` and `filler_joules` understand the prefixes `k` (10^3), `m` (10^6),
`g` (10^9) and `t` (10^12):

| Input     | Value             |
| --------- | ----------------- |
| `750k`    | 750 000 J         |
| `1.5m`    | 1 500 000 J       |
| `1.5mj`   | 1 500 000 J       |
| `2g`      | 2 000 000 000 J   |
| `1t`      | 10^12 J           |
| `750000`  | 750 000 J         |

Case does not matter, a `j`/`joule`/`joules` may follow the prefix, a comma counts as decimal mark
(`1,5m`), spaces and `_` group thousands (`1 500 000`). A plain number stays a plain amount of
joules. In the spoiler log and the options overview the values are written back in the short form
(`750 kJ`, `1.5 MJ`). Range: `base_price` 10 kJ to 1 TJ, `price_step` and `filler_joules` 0 to 1 TJ.

The locations of a page are the slot's location ids, sorted ascending, in blocks of
`locations_per_page`. Page 2 only opens once its unlock item arrived.

On connect and after every purchase the store jumps to the **first page that still has something to
buy**. Sold out pages can still be viewed through the page tabs.

Instead of `Page 1 Location 1` every row of an **open** page shows the **category of the item** that
sits there: `Progression`, `Useful`, `Trap` or `Filler`. The client asks for that by scouting on
connect and again whenever a page opens. In race seeds the server refuses to scout, so the category
is taken from the slot's **hints** instead (`_read_hints_<team>_<slot>`), which exist in every seed.

What a row may reveal is deliberately narrow:

| Row | Category | Item name |
| --- | --- | --- |
| locked page | none (only `—`) | none, not even in the tooltip |
| open page, not hinted | yes | none, tooltip carries the location name only |
| open page, hinted | yes | yes, with a `Hinted` tag and the name in the tooltip |

The item name is public only once somebody hinted the location. Scouting answers the same question
but says nothing about what is already known to the players, so it is used for the category only.
Locations of locked pages are not scouted at all, and their tooltip says nothing beyond "page N is
locked".

## Purchase flow

A purchase is a transaction, so no balance gets lost:

1. Write to `EnergyLink{team}`: `add -price`, then `max 0`.

The client uses only the storage operations `add` and `max`. Some patched servers refuse others (a
0.6.3 build answers a `mul` with `AP_BLOCK_SET reason=operation_disabled`), so the Inflation Trap
computes the burn from the current balance and sends it as `add -burn`. A refused write is reported
in the console instead of being treated as done.
2. The server answers with `original_value` and `value`. If the difference is exactly the price (or,
   for a multi buy, exactly the sum), the locations are reported with `client.check(...)`.
3. On a mismatch (another client charged at the same time) the partial amount is booked back and the
   purchase is aborted. Nothing is charged when the balance shrank between display and purchase.

Pay first, then check — that way a second client cannot spend the same joules twice.

## Console

A text client below the store. Commands:

```
help                                  help
connect <server> <slot> [password]    connect
disconnect                            disconnect
status                                connection and store status
balance                               read the EnergyLink balance again
page <n>                              switch to page n
pages                                 all pages with their purchase state
select <n|all|none>                   tick location n, every row, or nothing
unlock                                which pages are open and which are locked
buy [n]                               buy the selection, with n also tick location n
locations                             locations of the current page
lang <code>                           switch language (de_DE, en_US)
say <text>                            write into the AP chat
refresh                               read the EnergyLink balance again
clear                                 clear the console
```

Filter `all` / `log` / `chat` at the top right of the console. Errors appear as `ERROR`, server chat
as `CHAT`. Arrow up/down walks through the command history.

## Languages

The user interface ships with `lang/de_DE.lang` and `lang/en_US.lang`, format `key=value`, `#` starts
a comment. The selection in the page header is remembered in `localStorage`. If a key is missing in
the chosen language, `en_US` is used. A new language: create the file and add it to `LANGUAGES` in
`js/i18n.js`. The source code and all documentation are English only.

## Files

```
index.html                  page markup
css/style.css               styles (dark theme, responsive)
js/main.js                  UI wiring
js/ap.js                    connection, EnergyLink, purchase transaction, traps, unlocks
js/config.js                slot_data -> store configuration
js/store.js                 page/location model incl. selection
js/console.js               console with commands and log
js/i18n.js, js/util.js      language files, helpers
lang/*.lang                 UI texts
assets/vendor/              archipelago.js 2.1.0 (MIT)
apworld/energylink_store/   the Archipelago world (Python), build.sh packs it
examples/player.yaml        example YAML
tests/                      mock server, browser, unit and E2E tests
```

## Tests

Trying it out and running the page needs no dependencies: `start.sh` and the page itself run with any
HTTP server. Only the automated tests need `ws` and `playwright`:

```bash
npm install                     # once: ws + playwright (+ browser: npx playwright install chromium)
npm run mock                    # terminal 1: mock on ws://localhost:38281
npm run serve                   # terminal 2: page on :3000
npm test                        # terminal 3: browser test
npm run test:edge               # without slot_data, defaults, console commands
npm run test:connect            # stale game name cache, wrong slot name
npm run test:file               # hint on file:// instead of an empty page
npm run test:protocol           # ws/wss fallback of the server address
npm run test:pages              # automatic page choice and category display
```

Tested: connecting with game name detection, EnergyLink display, buying with a charge and a location
check, page locks, not enough joules, wrong password, language switching (UI and console), console
commands, a race during purchase (nothing charged), disconnecting.

Additional suites for the traps and the newer features:

```bash
npm run test:real             # needs a running AP server with the world
npm run test:trapOnBuy        # a trap fires on purchase (a mock server is enough)
npm run test:trapBothWays     # a trap on your own purchase and on arrival from another world
npm run test:trapOtherPlayer  # purchase, item belongs to someone else: nothing happens here
npm run test:restricted      # server refuses storage operations: traps still work, refusals are reported
npm run test:unlock           # pages stay locked until their unlock item arrived
npm run test:hints            # only hinted locations show the real item name
npm run test:multiBuy         # buy several rows in one go
npm run test:apworld          # parser and formatting of the joule amounts (Python)
npm run test:dryrun           # 100 random seeds through ArchipelagoGenerate, every result checked
npm run test:all              # every mock suite, each against a fresh mock server
```

`tools/dryrun.py` writes a random player YAML per run, generates a single-slot multiworld and checks
the output: the generator exits cleanly, the playthrough reaches the goal, the unlock items match the
configured pages (none for page 1), the item count equals the location count, and the slot_data
carries the options unchanged. Options to know:

```bash
python3 tools/dryrun.py --runs 20 --seed-base 500   # fewer runs, other seeds
python3 tools/dryrun.py --report report.json        # JSON with every case
python3 tools/dryrun.py --keep                      # keep the YAMLs and archives
```

Tested against Archipelago 0.6.8: generating the world, slot_data, location names, buying, McGuffin
progress, tax and inflation traps.

The tests write screenshots under `tests/`; like `node_modules` they are not checked in.

## License

The client is MIT licensed, see `LICENSE`.

Bundled in `assets/vendor/`:

- [archipelago.js](https://github.com/ThePhar/archipelago.js) 2.1.0, MIT — license text in
  `assets/vendor/archipelago.LICENSE`

## Notes

- The EnergyLink booking acts on the team's shared pool, so it affects Factorio as well.
- The client connects with `items_handling = all`, otherwise its own items (McGuffins, traps,
  unlocks) would never arrive. The short TextOnly probe connects with `minimal` instead, because the
  server does not allow own items for TextOnly slots.
- The client checks locations itself; it does not play the game. Items that come out of it go to
  their receiver in the multiworld as usual.
- The store is only as accurate as the EnergyLink balance. Another client can book between display
  and purchase; that case is caught, but the display can be briefly out of date.
