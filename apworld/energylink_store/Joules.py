"""Reading and writing Joule amounts in a short form.

Nobody wants to count zeros in a player YAML, so every Joule option of this world accepts the
usual decimal prefixes:

    750k       750 000
    1.5m       1 500 000
    2g         2 000 000 000
    1t         1 000 000 000 000
    1.5 megaj  1 500 000

Accepted spellings, case is ignored:

  * prefix    ``k``/``kilo``, ``m``/``mega``, ``g``/``giga``, ``t``/``tera``
  * unit      an optional ``j``/``joule``/``joules`` after the prefix: ``1.5mj``, ``750 kj``
  * number    ``1500000``, ``1500000.0``, ``1.5e6``, ``1_500_000``, ``1,5m`` (comma as decimal mark)
  * spaces    anywhere in the value, also as thousands separator: ``1 500 000``, ``1.5 m``

A bare number is a plain amount of Joules, so old configurations keep working.
"""

from __future__ import annotations

import re
import typing
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

__all__ = ["PREFIXES", "parse_joules", "format_joules"]

#: Multipliers of the decimal prefixes, the single letter and the written out form.
PREFIXES: dict[str, int] = {
    "": 1,
    "k": 1_000,
    "kilo": 1_000,
    "m": 1_000_000,
    "mega": 1_000_000,
    "g": 1_000_000_000,
    "giga": 1_000_000_000,
    "t": 1_000_000_000_000,
    "tera": 1_000_000_000_000,
}

_UNITS = ("", "j", "joule", "joules")

#: Every accepted combination of prefix and unit: "k", "kj", "kilo", "kilojoule", ...
SUFFIXES: dict[str, int] = {
    f"{prefix}{unit}": factor
    for prefix, factor in PREFIXES.items()
    for unit in _UNITS
}

_NUMBER_WITH_SUFFIX = re.compile(
    r"""^
    (?P<number>[+-]?(?:\d[\d_]*)(?:[.,]\d+)?(?:[eE][+-]?\d+)?)
    (?P<suffix>[a-zA-Z]*)
    $""",
    re.VERBOSE,
)

HINT = (
    "Use a plain number (750000) or a prefix: k/kilo, m/mega, g/giga, t/tera. "
    "An optional j may follow the prefix, so 750k, 1.5m, 2g, 1t and 1.5mj all work."
)


def parse_joules(value: typing.Any) -> int:
    """Turn ``"1.5m"``, ``1_500_000`` or ``1500000.0`` into the number of joules.

    Raises ``ValueError`` with a readable message when the text cannot be understood.
    """
    if isinstance(value, bool):
        raise ValueError(f"{value!r} is not a Joule amount. {HINT}")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return _round(Decimal(str(value)))
    if not isinstance(value, str):
        raise ValueError(f"{value!r} is not a Joule amount. {HINT}")

    # Strip all whitespace: it may separate the number from its prefix ("1.5 m") or group
    # thousands ("1 500 000").
    text = "".join(value.split())
    if not text:
        raise ValueError(f"An empty value is not a Joule amount. {HINT}")

    match = _NUMBER_WITH_SUFFIX.match(text)
    if match is None:
        raise ValueError(f"Cannot read {value!r} as a Joule amount. {HINT}")

    suffix = match.group("suffix").lower()
    if suffix not in SUFFIXES:
        raise ValueError(f"{match.group('suffix')!r} is not a known prefix in {value!r}. {HINT}")

    number_text = match.group("number").replace("_", "").replace(",", ".")
    try:
        number = Decimal(number_text)
    except InvalidOperation as error:
        raise ValueError(f"Cannot read {value!r} as a Joule amount. {HINT}") from error

    return _round(number * SUFFIXES[suffix])


def _round(number: Decimal) -> int:
    return int(number.to_integral_value(rounding=ROUND_HALF_UP))


def format_joules(value: int) -> str:
    """Write a Joule amount in the shortest exact form: ``1500000`` -> ``1.5 MJ``.

    The short form is only used when it keeps every joule, so nothing is rounded away:
    ``1_000_000`` -> ``1 MJ``, ``2_250_000`` -> ``2.25 MJ``, ``1_234_567`` -> ``1 234 567 J``.
    """
    amount = int(value)
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    for factor, unit in (
        (1_000_000_000_000, "T"),
        (1_000_000_000, "G"),
        (1_000_000, "M"),
        (1_000, "k"),
    ):
        if amount < factor or amount % (factor // 1_000):
            # too small for that prefix, or it would need more than three decimals
            continue
        scaled = Decimal(amount) / factor
        if scaled >= 1_000:
            continue
        text = f"{scaled.normalize():f}"
        return f"{sign}{text} {unit}J"
    # Not a clean step: keep the exact number but group the zeros for readability.
    return f"{sign}{amount:,} J".replace(",", " ")
