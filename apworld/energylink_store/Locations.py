"""Locations of the Energylink Store world.

The table is static and covers the maximum the options allow (20 pages x 10 locations), because
``location_name_to_id`` has to be the same for every player in a multiworld. A world only creates the
locations for the pages and slots its options ask for; the rest stay unused.
"""

BASE_LOCATION_ID = 0xE1E57100

MAX_PAGES = 20
MAX_LOCATIONS_PER_PAGE = 10

PAGE_REGION_NAME = "Store Page {page}"
VICTORY_LOCATION_NAME = "Store Completed"


def location_name(page: int, slot: int) -> str:
    """Name of a location. The browser client uses the same page/slot split."""
    return f"Page {page} Location {slot}"


location_table: dict[str, int] = {
    location_name(page, slot): BASE_LOCATION_ID + (page - 1) * MAX_LOCATIONS_PER_PAGE + (slot - 1)
    for page in range(1, MAX_PAGES + 1)
    for slot in range(1, MAX_LOCATIONS_PER_PAGE + 1)
}

location_groups = {
    f"Page {page}": {location_name(page, slot) for slot in range(1, MAX_LOCATIONS_PER_PAGE + 1)}
    for page in range(1, MAX_PAGES + 1)
}
