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

# name -> classification; the id is BASE_ITEM_ID + index, so it never changes while the list grows.
ITEM_CLASSIFICATIONS: dict[str, ItemClassification] = {
    MACGUFFIN_ITEM: ItemClassification.progression,
    FILLER_ITEM: ItemClassification.filler,
    TAX_TRAP_ITEM: ItemClassification.trap,
    INFLATION_TRAP_ITEM: ItemClassification.trap,
}

item_table: dict[str, int] = {
    name: BASE_ITEM_ID + index for index, name in enumerate(ITEM_CLASSIFICATIONS)
}

item_groups = {
    "McGuffins": {MACGUFFIN_ITEM},
    "Traps": {TAX_TRAP_ITEM, INFLATION_TRAP_ITEM},
    "Filler": {FILLER_ITEM},
}
