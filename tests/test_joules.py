"""Unit tests for the Joule short forms in the APWorld.

Run with:  python3 tests/test_joules.py     (or: npm run test:apworld)

The module under test cannot import Archipelago, so this runs without an AP install.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apworld" / "energylink_store"))

from Joules import format_joules, parse_joules  # noqa: E402


class ParseJoules(unittest.TestCase):
    def test_plain_numbers_are_joules(self):
        self.assertEqual(parse_joules("750000"), 750_000)
        self.assertEqual(parse_joules(750_000), 750_000)
        self.assertEqual(parse_joules("0"), 0)

    def test_prefixes(self):
        cases = {
            "1k": 1_000,
            "750k": 750_000,
            "1.5m": 1_500_000,
            "2m": 2_000_000,
            "3g": 3_000_000_000,
            "1t": 1_000_000_000_000,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_joules(text), expected)

    def test_written_out_prefixes(self):
        self.assertEqual(parse_joules("750kilo"), 750_000)
        self.assertEqual(parse_joules("1.5mega"), 1_500_000)
        self.assertEqual(parse_joules("2 giga"), 2_000_000_000)
        self.assertEqual(parse_joules("1tera"), 1_000_000_000_000)

    def test_optional_joule_unit(self):
        for text in ("1.5mj", "1.5mJ", "1.5mjoule", "1.5 mjoules", "1.5 megaj", "1.5 megajoules"):
            with self.subTest(text=text):
                self.assertEqual(parse_joules(text), 1_500_000)

    def test_case_and_spaces(self):
        self.assertEqual(parse_joules("750K"), 750_000)
        self.assertEqual(parse_joules("  750 k  "), 750_000)
        self.assertEqual(parse_joules("1 500 000"), 1_500_000)

    def test_number_spellings(self):
        self.assertEqual(parse_joules("1_500_000"), 1_500_000)
        self.assertEqual(parse_joules("1500000.0"), 1_500_000)
        self.assertEqual(parse_joules("1.5e6"), 1_500_000)
        self.assertEqual(parse_joules("1,5m"), 1_500_000)

    def test_rounding(self):
        self.assertEqual(parse_joules("0.5"), 1)
        self.assertEqual(parse_joules("0.4"), 0)
        self.assertEqual(parse_joules(1.5), 2)

    def test_rejects_nonsense(self):
        for text in ("", "   ", "abc", "1x", "m", "kilo", "1.2.3m", "--1k", "1 kk"):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_joules(text)

    def test_rejects_bool(self):
        with self.assertRaises(ValueError):
            parse_joules(True)


class FormatJoules(unittest.TestCase):
    def test_short_forms(self):
        cases = {
            0: "0 J",
            750: "750 J",
            1_000: "1 kJ",
            750_000: "750 kJ",
            1_000_000: "1 MJ",
            1_500_000: "1.5 MJ",
            2_250_000: "2.25 MJ",
            2_000_000_000: "2 GJ",
            999_000: "999 kJ",
            1_000_000_000_000: "1 TJ",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(format_joules(value), expected)

    def test_keeps_every_joule(self):
        # no prefix fits without rounding, so the exact number is written out
        self.assertEqual(format_joules(1_234_567), "1 234 567 J")
        self.assertEqual(format_joules(1_000_999), "1 000 999 J")

    def test_round_trip(self):
        for value in (0, 750, 10_000, 750_000, 1_000_000, 1_500_000, 2_250_000,
                      2_000_000_000, 999_000, 1_000_000_000_000):
            with self.subTest(value=value):
                self.assertEqual(parse_joules(format_joules(value)), value)


if __name__ == "__main__":
    unittest.main(verbosity=2)
