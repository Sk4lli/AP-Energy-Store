"""Options of the Energylink Store world.

The store client reads the same values from slot_data, so every number here ends up in the browser.
"""

from dataclasses import dataclass
from typing import Any

from Options import Choice, OptionGroup, PerGameCommonOptions, Range, Toggle

from .Joules import format_joules, parse_joules

# 1 TJ is the largest amount a Joule option accepts. Anything above is a typo, not a price.
MAX_JOULES = 1_000_000_000_000


class JouleOption(Range):
    """A range of Joule amounts that also reads short forms.

    A plain number is a plain amount of Joules, so old YAMLs keep working. On top of that the
    decimal prefixes k/kilo, m/mega, g/giga and t/tera are accepted, optionally followed by a j:

        750k   1.5m   2g   1t   1.5mj   750 kj   1 500 000

    The value is stored and sent as a whole number of Joules. In the spoiler log, the options page
    and the generated CSV it is written back in the short form.
    """

    @classmethod
    def from_text(cls, text: str) -> "JouleOption":
        text = text.strip()
        lowered = text.lower()
        # "random", "random-low", "high", "low", "default" and "true"/"false" stay with the core.
        if lowered in ("high", "low", "default", "true", "false") or lowered.startswith("random"):
            return super().from_text(text)

        try:
            value = parse_joules(text)
        except ValueError as error:
            raise Exception(str(error)) from error

        try:
            return cls(value)
        except Exception as error:
            raise Exception(
                f"{text!r} is {format_joules(value)}, but {cls.__name__} allows "
                f"{format_joules(cls.range_start)} to {format_joules(cls.range_end)}."
            ) from error

    @classmethod
    def from_any(cls, data: Any) -> "JouleOption":
        if type(data) is int:
            return cls(data)
        return cls.from_text(str(data))

    @classmethod
    def get_option_name(cls, value: int) -> str:
        return format_joules(value)


class ProgressPages(Range):
    """How many progress pages ("progress items") the store has.

    Every page holds one chunk of locations and unlocks after the previous page is sold out.
    """

    display_name = "Progress Pages"
    range_start = 1
    range_end = 20
    default = 5


class LocationsPerPage(Range):
    """How many locations one progress page offers.

    The web client supports 5 to 10 locations per page.
    """

    display_name = "Locations per Page"
    range_start = 5
    range_end = 10
    default = 5


class BasePrice(JouleOption):
    """Price of a location on page 1, in joules of the EnergyLink pool.

    Short forms are accepted: ``750k``, ``1.5m``, ``2g``, ``1t``. A plain number is read as joules.
    """

    display_name = "Base Price (Joules)"
    range_start = 10_000
    range_end = MAX_JOULES
    default = 1_000_000


class PriceStep(JouleOption):
    """Added to the price for every further page, in joules.

    With a base price of 1 MJ and a step of 1 MJ a page 1 location costs 1 MJ, page 2 costs 2 MJ, and so on.
    Short forms are accepted here too: ``250k``, ``1.5m``, ``1t``.
    """

    display_name = "Price Step (Joules)"
    range_start = 0
    range_end = MAX_JOULES
    default = 1_000_000


class UnlockMode(Choice):
    """How the store pages are unlocked.

    ``page``: every page has its own item ("Store Page 1", "Store Page 2", ...). The item for page N
    opens page N only, not the pages before or after it.

    ``progressive``: one item ("Progressive Store Unlock") opens the pages in order. The first copy
    opens page 1, the second page 2, and so on.
    """

    display_name = "Store Unlock Mode"
    option_page = 0
    option_progressive = 1
    default = 0


class McguffinCount(Range):
    """How many McGuffin items are needed to win.

    The store world puts that many McGuffins into the item pool. You win when you have collected them all,
    so the goal is reached by buying locations until enough McGuffins dropped.
    """

    display_name = "McGuffins Required"
    range_start = 1
    range_end = 500
    default = 50


class TrapFillPercentage(Range):
    """Percentage of the filler items that are replaced by traps."""

    display_name = "Trap Percentage"
    range_start = 0
    range_end = 100
    default = 15


class FillerJoules(JouleOption):
    """How much joule a plain filler item is worth when the store client shows it.

    Short forms are accepted as well, for example ``500k`` or ``1.5m``.
    """

    display_name = "Filler Value (Joules)"
    range_start = 0
    range_end = MAX_JOULES
    default = 0


class TaxTrap(Toggle):
    """Enable the "Tax" trap, which raises the prices of the store for good."""

    display_name = "Tax Trap"
    default = 1


class TaxPerTrap(Range):
    """How much one Tax Trap raises every price, in percent.

    The increase stays for the rest of the run, so a few of them make the store expensive.
    """

    display_name = "Tax per Trap (%)"
    range_start = 0
    range_end = 100
    default = 10


class InflationPerTrap(Range):
    """How much of the EnergyLink pool one Inflation Trap burns, in percent.

    Percent instead of an absolute value, so the trap keeps hurting when the pool grows.
    """

    display_name = "Inflation per Trap (%)"
    range_start = 1
    range_end = 100
    default = 20


class InflationTrap(Toggle):
    """Enable the "Inflation" trap, which burns a share of the EnergyLink pool."""

    display_name = "Inflation Trap"
    default = 1


class EnergyLinkShared(Toggle):
    """Use the team-wide EnergyLink key (EnergyLink<team>).

    Turn this off only if you want the store to read a custom key; the client falls back to
    "EnergyLink<team>" when slot_data has no key.
    """

    display_name = "Use Team EnergyLink"
    default = 1


@dataclass
class EnergylinkStoreOptions(PerGameCommonOptions):
    progress_pages: ProgressPages
    locations_per_page: LocationsPerPage
    unlock_mode: UnlockMode
    base_price: BasePrice
    price_step: PriceStep
    mcguffins_required: McguffinCount
    trap_percentage: TrapFillPercentage
    filler_joules: FillerJoules
    tax_trap: TaxTrap
    tax_per_trap: TaxPerTrap
    inflation_trap: InflationTrap
    inflation_per_trap: InflationPerTrap
    team_energylink: EnergyLinkShared


option_groups = [
    OptionGroup(
        "Store Layout",
        [ProgressPages, LocationsPerPage, UnlockMode, BasePrice, PriceStep, EnergyLinkShared],
    ),
    OptionGroup(
        "Items and Goal",
        [
            McguffinCount,
            FillerJoules,
            TrapFillPercentage,
            TaxTrap,
            TaxPerTrap,
            InflationTrap,
            InflationPerTrap,
        ],
    ),
]
