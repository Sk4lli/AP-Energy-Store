"""Items of the Energylink Store world.

Item names must be unique and stable: they are part of the DataPackage, which the browser client and
every other client in the multiworld read. The ids are derived from the name order below, so never
reorder or rename an entry without bumping the world version.
"""

from BaseClasses import ItemClassification

BASE_ITEM_ID = 0xE1E57000

MACGUFFIN_ITEM = "McGuffin"
FILLER_ITEM = "Store Filler"
# Tax Trap: raises the prices for good
TAX_TRAP_ITEM = "Tax Trap"
# Inflation Trap: burns a share of the EnergyLink pool
INFLATION_TRAP_ITEM = "Inflation Trap"

# Progressive unlock: page N opens with the Nth copy of this one item.
PROGRESSIVE_UNLOCK_ITEM = "Progressive Store Unlock"
# One item per page: "Store Page 3" opens page 3 and nothing else.
PAGE_UNLOCK_PREFIX = "Store Page "


def page_unlock_item(page: int) -> str:
    """Name of the unlock item that opens ``page`` in the "one item per page" mode."""
    return f"{PAGE_UNLOCK_PREFIX}{page}"


#: Pages an unlock item can refer to. The world only creates the pages it was asked for, but the
#: names have to exist for every page the options allow, because item names are global.
MAX_UNLOCK_PAGE = 20

# name -> classification; the id is BASE_ITEM_ID + index, so it never changes while the list grows.
ITEM_CLASSIFICATIONS: dict[str, ItemClassification] = {
    MACGUFFIN_ITEM: ItemClassification.progression,
    FILLER_ITEM: ItemClassification.filler,
    TAX_TRAP_ITEM: ItemClassification.trap,
    INFLATION_TRAP_ITEM: ItemClassification.trap,
    PROGRESSIVE_UNLOCK_ITEM: ItemClassification.progression,
}
for _page in range(1, MAX_UNLOCK_PAGE + 1):
    ITEM_CLASSIFICATIONS[page_unlock_item(_page)] = ItemClassification.progression

item_table: dict[str, int] = {
    name: BASE_ITEM_ID + index for index, name in enumerate(ITEM_CLASSIFICATIONS)
}

ITEM_GROUPS: dict[str, set[str]] = {
    "McGuffins": {MACGUFFIN_ITEM},
    "Traps": {TAX_TRAP_ITEM, INFLATION_TRAP_ITEM},
    "Filler": {FILLER_ITEM},
    "Store Unlocks": {PROGRESSIVE_UNLOCK_ITEM, *(page_unlock_item(p) for p in range(1, MAX_UNLOCK_PAGE + 1))},
}
for _page in range(1, MAX_UNLOCK_PAGE + 1):
    ITEM_GROUPS[f"Store Page {_page}"] = {page_unlock_item(_page)}

item_groups = ITEM_GROUPS
