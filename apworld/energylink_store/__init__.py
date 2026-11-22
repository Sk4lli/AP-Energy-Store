"""Energylink Store: a shop world for Archipelago.

The world has no gameplay of its own. It provides locations and items; the buying happens in the
browser client in this repository, which pays joules from the team's EnergyLink pool and then checks
the location. Every bought location sends its item to whoever it belongs to in the multiworld.

Items:
  * McGuffin        progression, collecting ``mcguffins_required`` of them wins the game
  * Store Filler    filler, no effect
  * Tax Trap        trap, the store should read it as "take joules out of the pool"
  * Inflation Trap  trap, the store should read it as "the current page gets more expensive"

Locations are grouped into pages. Page N owns ``locations_per_page`` locations; the client builds the
same grouping from slot_data, so page 1 of the client is page 1 of the world.

Traps and McGuffins are placed like any other item and may end up in any world. The client applies a
trap when its location is bought, so the effect always lands on this store.
"""

from __future__ import annotations

import logging
import typing

from BaseClasses import Item, ItemClassification, Location, Region, Tutorial
from worlds.AutoWorld import WebWorld, World

from .Joules import format_joules
from .Items import (
    FILLER_ITEM,
    INFLATION_TRAP_ITEM,
    ITEM_CLASSIFICATIONS,
    MACGUFFIN_ITEM,
    PAGE_UNLOCK_PREFIX,
    PROGRESSIVE_UNLOCK_ITEM,
    TAX_TRAP_ITEM,
    item_groups,
    item_table,
    page_unlock_item,
)
from .Locations import PAGE_REGION_NAME, location_groups, location_name, location_table
from .Options import EnergylinkStoreOptions, option_groups


class EnergylinkStoreWeb(WebWorld):
    theme = "ocean"
    game_info_languages = ["en"]
    tutorials = [
        Tutorial(
            "Multiworld Setup Guide",
            "A guide to setting up the Energylink Store client in a browser.",
            "English",
            "setup/en_setup.md",
            "setup/en",
            ["devx"],
        ),
    ]
    option_groups = option_groups


class EnergylinkStoreItem(Item):
    game = "Energylink Store"


class EnergylinkStoreLocation(Location):
    game = "Energylink Store"


class EnergylinkStoreWorld(World):
    """A shop: buy locations with joules from the EnergyLink pool, the items go to the multiworld."""

    game = "Energylink Store"
    web = EnergylinkStoreWeb()
    options_dataclass = EnergylinkStoreOptions
    options: EnergylinkStoreOptions

    item_name_to_id = item_table
    location_name_to_id = location_table
    item_name_groups = item_groups
    location_name_groups = {
        name: set(names) for name, names in location_groups.items()
    }

    page_count: int
    locations_per_page: int
    effective_mcguffins: int
    unlock_mode: str
    unlock_items: list[str]

    def generate_early(self) -> None:
        self.page_count = self.options.progress_pages.value
        self.locations_per_page = self.options.locations_per_page.value

        # Which items open the pages. "page" gives every page its own item, "progressive" hands out
        # the same item repeatedly, page N opens with the Nth copy.
        self.unlock_mode = "page" if self.options.unlock_mode.value == 0 else "progressive"
        self.unlock_items = self._unlock_items()

        # The world is unbeatable if it asks for more McGuffins than it has locations, so clamp. The
        # unlock items are placed first and need their own locations, so they count as taken.
        available = self.page_count * self.locations_per_page - len(self.unlock_items)
        wanted = self.options.mcguffins_required.value
        self.effective_mcguffins = max(1, min(wanted, max(1, available)))
        if self.effective_mcguffins != wanted:
            logging.warning(
                "Energylink Store (player %s): %s McGuffins requested but only %s locations available, "
                "using %s.", self.player, wanted, available, self.effective_mcguffins
            )

    def create_regions(self) -> None:
        player = self.player
        menu = Region("Menu", player, self.multiworld)
        self.multiworld.regions.append(menu)

        # Page 1 is always open. Every further page hangs on its own unlock item, so the fill can
        # never place that item behind the page it opens -- that would make the seed unbeatable.
        for page in range(1, self.page_count + 1):
            region = Region(PAGE_REGION_NAME.format(page=page), player, self.multiworld)
            region.add_locations(
                {
                    location_name(page, slot): location_table[location_name(page, slot)]
                    for slot in range(1, self.locations_per_page + 1)
                },
                EnergylinkStoreLocation,
            )
            if page == 1:
                menu.connect(region)
            elif self.unlock_mode == "progressive":
                # Page 1 is free, so the first copy opens page 2: page n needs n-1 copies.
                menu.connect(
                    region,
                    rule=lambda state, count=page - 1: state.has(PROGRESSIVE_UNLOCK_ITEM, player, count),
                )
            else:
                # The client opens page n with "Store Page n", so that is what the rule uses. The
                # chain is transitive: page n-1 needs "Store Page n-1", which cannot be found there.
                needed = page_unlock_item(page)
                menu.connect(
                    region,
                    rule=lambda state, item=needed: state.has(item, player),
                )
            self.multiworld.regions.append(region)

        required = self.effective_mcguffins
        victory = Region("Victory", player, self.multiworld)
        victory.add_event(
            "Store Completed",
            "Victory",
            rule=lambda state: state.has(MACGUFFIN_ITEM, player, required),
            location_type=EnergylinkStoreLocation,
            item_type=EnergylinkStoreItem,
        )
        menu.connect(victory)
        self.multiworld.regions.append(victory)

    def create_items(self) -> None:
        total = len(self.multiworld.get_unfilled_locations(self.player))
        required = max(1, min(self.effective_mcguffins, total))

        pool: list[Item] = [self._item(name) for name in self.unlock_items]
        pool.extend(self._item(MACGUFFIN_ITEM) for _ in range(required))

        remaining = total - len(pool)
        if remaining < 0:
            # More pages than locations can only happen with a tiny slot; drop the surplus unlocks
            # rather than producing more items than there are locations.
            logging.warning(
                "Energylink Store (player %s): %s locations do not fit %s unlock items, "
                "dropping the surplus.", self.player, total, len(self.unlock_items)
            )
            pool = pool[:total]
            remaining = 0

        trap_chance = self.options.trap_percentage.value / 100
        trap_count = int(round(remaining * trap_chance)) if self._traps_enabled() else 0
        pool.extend(self._trap() for _ in range(trap_count))
        pool.extend(self._item(FILLER_ITEM) for _ in range(remaining - trap_count))

        # trim/pad so item count and location count match, core also expects that
        while len(pool) < total:
            pool.append(self._item(FILLER_ITEM))
        self.multiworld.itempool.extend(pool[:total])

    def unlock_item_for(self, page: int) -> str:
        """Name of the item that opens ``page`` (page 1 is always open and has none)."""
        if self.unlock_mode == "progressive":
            return PROGRESSIVE_UNLOCK_ITEM
        return page_unlock_item(page)

    def _unlock_items(self) -> list[str]:
        """Items that go into the pool so the pages after the first can open.

        Page 1 is always open, so it has no unlock item at all.
        """
        if self.page_count < 2:
            return []
        if self.unlock_mode == "progressive":
            # Page 1 is free, so page_count - 1 copies open the remaining pages.
            return [PROGRESSIVE_UNLOCK_ITEM] * (self.page_count - 1)
        return [page_unlock_item(page) for page in range(2, self.page_count + 1)]

    def _traps_enabled(self) -> bool:
        return bool(self.options.tax_trap.value or self.options.inflation_trap.value)

    def _trap(self) -> EnergylinkStoreItem:
        names: list[str] = []
        if self.options.tax_trap.value:
            names.append(TAX_TRAP_ITEM)
        if self.options.inflation_trap.value:
            names.append(INFLATION_TRAP_ITEM)
        return self._item(self.random.choice(names))

    def _item(self, name: str) -> EnergylinkStoreItem:
        classification = ITEM_CLASSIFICATIONS.get(name, ItemClassification.filler)
        return EnergylinkStoreItem(name, classification, item_table[name], self.player)

    def set_rules(self) -> None:
        self.multiworld.completion_condition[self.player] = (
            lambda state: state.has("Victory", self.player)
        )

    def get_filler_item_name(self) -> str:
        return FILLER_ITEM

    def create_item(self, name: str) -> EnergylinkStoreItem:
        return self._item(name)

    def fill_slot_data(self) -> dict[str, typing.Any]:
        """Everything the browser client needs to build the same store."""
        return {
            "progress_items": self.page_count,
            "locations_per_page": self.locations_per_page,
            # how the client knows which pages an item opens:
            #   "page"        -> item name "Store Page <n>" opens page n
            #   "progressive" -> the nth copy of one item opens page n
            "unlock_mode": self.unlock_mode,
            "unlock_item": PROGRESSIVE_UNLOCK_ITEM,
            "unlock_item_prefix": PAGE_UNLOCK_PREFIX,
            "base_price": self.options.base_price.value,
            "price_step": self.options.price_step.value,
            "mcguffins_required": self.effective_mcguffins,
            "filler_joules": self.options.filler_joules.value,
            "trap_percentage": self.options.trap_percentage.value,
            # Tax Trap: permanent price increase, as a fraction (0.1 = +10 % per trap)
            "tax_per_trap": self.options.tax_per_trap.value / 100,
            # Inflation Trap: share of the pool that burns, as a fraction (0.2 = 20 % per trap)
            "inflation_per_trap": self.options.inflation_per_trap.value / 100,
            "use_team_energylink": bool(self.options.team_energylink.value),
            "mcguffin_name": MACGUFFIN_ITEM,
            "store_version": 2,
        }

    def write_spoiler(self, spoiler_handle: typing.TextIO) -> None:
        spoiler_handle.write(
            f"\nEnergylink Store: {self.page_count} pages x {self.locations_per_page} locations, "
            f"unlock mode {self.unlock_mode}\n"
        )
        for page in range(1, self.page_count + 1):
            price = self.options.base_price.value + self.options.price_step.value * (page - 1)
            spoiler_handle.write(
                f"  Page {page} ({format_joules(price)}): {self.locations_per_page} locations\n"
            )
