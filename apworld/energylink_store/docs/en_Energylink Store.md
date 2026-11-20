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
| `base_price`                | 1 000 000  | price of one location on page 1, in joules                      |
| `price_step`                | 1 000 000  | added to the price per page                                     |
| `mcguffins_required`        | 50         | McGuffins needed to win                                         |
| `filler_joules`             | 0          | informational value of a filler item                            |
| `trap_percentage`           | 15         | share of the filler slots replaced by traps                     |
| `tax_trap`                  | on         | allow Tax Traps                                                 |
| `tax_per_trap`              | 10         | percent a Tax Trap adds to every price, permanently             |
| `inflation_trap`            | on         | allow Inflation Traps                                           |
| `inflation_per_trap`        | 20         | percent of the EnergyLink pool one Inflation Trap burns         |
| `team_energylink`           | on         | use the team key `EnergyLink<team>`, the same one Factorio uses |

The price of a location is `base_price + price_step * (page - 1)`. Every location on a page costs the
same. Page N only opens in the client once page N-1 is sold out.

`mcguffins_required` is clamped to the number of locations the world creates, so the seed is always
beatable. A warning is logged when that happens.

## Items

| Item             | Class      | Effect                                                      |
| ---------------- | ---------- | ----------------------------------------------------------- |
| `McGuffin`       | progression| collect `mcguffins_required` of them to win                 |
| `Store Filler`   | filler     | nothing                                                     |
| `Tax Trap`       | trap       | every price rises permanently by `tax_per_trap` percent     |
| `Inflation Trap` | trap       | `inflation_per_trap` percent of the pool is burned          |

McGuffins and traps are **local** to their slot: the world puts them into `local_items`, so they can
never land in another player's world. The client verifies this on connect by scouting and warns when
a seed still has traps on another slot, which means the room was generated with an older world and
needs to be regenerated. A trap has to hurt the player who bought the location, and the
goal counts McGuffins in this slot. The client reads the traps from the items it receives, so a trap
takes effect as soon as the location containing it is bought.

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
