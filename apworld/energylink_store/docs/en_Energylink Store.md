# Energylink Store

A shop world for Archipelago. It has no gameplay of its own: the buying happens in the browser client
in this repository, which pays joules from the team's EnergyLink pool and then checks a location.
Every bought location sends its item to whoever it belongs to in the multiworld.

## Install

Build the `.apworld` and copy it into your Archipelago `custom_worlds` (or `worlds`) folder:

```bash
cd apworld
./build.sh
cp energylink_store.apworld ~/.local/share/Archipelago/worlds/
```

Or, for a source install, copy the `energylink_store` folder into `Archipelago/worlds/`.

Then create a player YAML with `game: Energylink Store` and generate as usual. Start
`ArchipelagoServer` with the output file and open the store at `index.html` in a browser, using the
slot name from the YAML.

## Options

| Option                      | Default    | Meaning                                                         |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| `progress_pages`            | 5          | number of store pages (1–20)                                     |
| `locations_per_page`        | 5          | locations per page (5–10), the client supports the same range    |
| `unlock_mode`               | `page`     | `page` = one item per page, `progressive` = one item for all; page 1's unlock is always precollected |
| `base_price`                | 1 000 000  | price of one location on page 1, in joules (short forms: `750k`) |
| `price_step`                | 1 000 000  | added to the price per page (short forms: `1.5m`)               |
| `mcguffins_required`        | 50         | McGuffins needed to win                                         |
| `filler_joules`             | 0          | informational value of a filler item (short forms: `500k`)      |
| `trap_percentage`           | 15         | share of the filler slots replaced by traps                     |
| `tax_trap`                  | on         | allow Tax Traps                                                 |
| `tax_per_trap`              | 10         | percent a Tax Trap adds to every price, permanently             |
| `inflation_trap`            | on         | allow Inflation Traps                                           |
| `inflation_per_trap`        | 20         | percent of the EnergyLink pool one Inflation Trap burns         |
| `team_energylink`           | on         | use the team key `EnergyLink<team>`, the same one Factorio uses |

### Short Joule amounts

`base_price`, `price_step` and `filler_joules` take the decimal prefixes `k` (kilo, 10^3),
`m` (mega, 10^6), `g` (giga, 10^9) and `t` (tera, 10^12), so nobody has to count zeros:

```yaml
base_price: 750k      # 750 000 J
price_step: 1.5m      # 1 500 000 J
filler_joules: 2g     # 2 000 000 000 J
```

Case does not matter, `1.5m`, `1.5M` and `1.5 m` are the same. A `j`, `joule` or `joules` may
follow the prefix (`1.5mj`, `750 kj`, `1.5 megaj`). A plain number is a plain amount of joules,
so older YAMLs keep working. A comma counts as decimal mark (`1,5m`), `_` and spaces group
thousands (`1_500_000`, `1 500 000`). In the spoiler log and the options pages the values are
written back in the short form (`750 kJ`, `1.5 MJ`).

Range: `base_price` accepts 10 kJ to 1 TJ, `price_step` and `filler_joules` 0 to 1 TJ.

The price of a location is `base_price + price_step * (page - 1)`. Every location on a page costs the
same.

Page 1 is always open. Every further page opens once its unlock item has arrived. While a page is
locked the client shows neither the item name nor the category of its locations, and nothing can be
bought there.

- `unlock_mode: page` (default): `Store Page 2`, `Store Page 3`, ... Each item opens exactly its own
  page, not the ones before or after it. Page 1 has no item and is open from the start.
- `unlock_mode: progressive`: `Progressive Store Unlock` is handed out `page_count - 1` times, the
  first copy opens page 2, the second page 3, and so on.

Page 1 is open from the start. Every further page has logic: page N is only reachable once the
unlock of page N-1 arrived, and so on back to page 1. That way the fill can never place an unlock
behind the page it opens, which would make the seed unbeatable.

In the client every row of an open page has a tick; the buy button buys all ticked rows of the
current page in one go and charges the sum once.

`mcguffins_required` is clamped to the number of locations the world creates, so the seed is always
beatable. A warning is logged when that happens.

## Items

| Item             | Class      | Effect                                                      |
| ---------------- | ---------- | ----------------------------------------------------------- |
| `McGuffin`       | progression| collect `mcguffins_required` of them to win                 |
| `Store Page <n>` | progression| opens page n, n >= 2 (mode `page`)                          |
| `Progressive Store Unlock` | progression | the nth copy opens page n+1 (mode `progressive`) |
| `Store Filler`   | filler     | nothing                                                     |
| `Tax Trap`       | trap       | every price rises permanently by `tax_per_trap` percent     |
| `Inflation Trap` | trap       | `inflation_per_trap` percent of the pool is burned (the client charges it with `add`, see the README) |

Traps and McGuffins are placed by Archipelago like any other item, so they can end up anywhere in
the multiworld. That is intentional: a trap always belongs to the store world that created it, no
matter which location it sits in.

A trap takes effect **the moment its item arrives here**. That is not a second path next to the
purchase, it is the same moment: buying a location makes the server deliver that location's item to
the player it belongs to.

1. **You buy the location and the item is yours.** It arrives here, the trap fires.
2. **You buy the location and the item belongs to another player.** It arrives there, so the trap
   fires in their store. Your EnergyLink pool is not touched.
3. **Another player buys a location whose item is yours.** It arrives here, the trap fires.

The effect is derived from the item list the server sends in full on every login and deduplicated by
location id, so a reconnect only repeats what is already known. Burning is the one thing that writes
to the server: how many Inflation Traps already burnt is remembered in `localStorage`, and only the
difference to the item list is burnt. Reloading therefore burns nothing twice and does not forget the
tax increase.

## Locations

Names are `Page <n> Location <m>`, ids are assigned by page and slot. The table covers the maximum
(20 pages x 10 locations) because `location_name_to_id` is the same for every player in a
multiworld; a world only creates the locations its options ask for.

The client builds its pages from the same slot_data (`progress_items`, `locations_per_page`), so page
and slot numbers match on both sides.

## slot_data

The world sends everything the client needs:

```json
{
  "progress_items": 5,
  "locations_per_page": 5,
  "unlock_mode": "page",
  "unlock_item": "Progressive Store Unlock",
  "unlock_item_prefix": "Store Page ",
  "base_price": 1000000,
  "price_step": 1000000,
  "mcguffins_required": 50,
  "filler_joules": 0,
  "trap_percentage": 15,
  "tax_per_trap": 0.1,
  "inflation_per_trap": 0.2,
  "use_team_energylink": true,
  "mcguffin_name": "McGuffin",
  "store_version": 2
}
```

## Playing the goal

Buying locations sends the items into the multiworld, some of them back to you. You finish the world
when you own `mcguffins_required` McGuffins; the client shows the progress as "Goal" in the status
panel. The goal is checked by the client like any other client would send it, so nothing else is
needed.

## Notes

- The world does not touch the EnergyLink pool itself. Only the browser client books joules, which
  keeps a single place of truth for prices.
- Because the client checks locations, it must connect as a real slot with the game name. The client
  detects the game name from the server, so the YAML needs nothing special.
