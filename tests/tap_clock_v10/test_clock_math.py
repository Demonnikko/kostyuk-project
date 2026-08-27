from __future__ import annotations

import sys
import unittest
from pathlib import Path


SOURCE_DIR = Path(__file__).resolve().parents[2] / "tools" / "tap-clock-v10"
sys.path.insert(0, str(SOURCE_DIR))

from clock_math import analog_angles, bank_selection  # noqa: E402


class AnalogAnglesTests(unittest.TestCase):
    def test_hand_derived_angle_fixtures(self) -> None:
        fixtures = {
            (0, 0): (0.0, 0.0),
            (10, 40): (320.0, 240.0),
            (12, 50): (25.0, 300.0),
            (13, 0): (30.0, 0.0),
            (23, 59): (359.5, 354.0),
        }

        for input_time, expected in fixtures.items():
            with self.subTest(input_time=input_time):
                self.assertEqual(analog_angles(*input_time), expected)

    def test_rejects_times_outside_supported_clock_range(self) -> None:
        for bad_time in ((-1, 0), (24, 0), (0, -1), (0, 60)):
            with self.subTest(bad_time=bad_time):
                with self.assertRaises(ValueError):
                    analog_angles(*bad_time)


class BankSelectionTests(unittest.TestCase):
    def test_every_valid_time_activates_exactly_its_direct_hour_bank(self) -> None:
        for hour in range(24):
            for minute in range(60):
                selection = bank_selection(hour, minute)
                active = [bank for bank, index in selection.items() if index <= 60]

                self.assertEqual(active, [hour], msg=f"failed at {hour:02d}:{minute:02d}")
                self.assertEqual(selection[hour], minute + 1)
                self.assertTrue(all(1 <= index <= 100 for index in selection.values()))

    def test_invalid_minute_uses_existing_transparent_safety_index(self) -> None:
        selection = bank_selection(10, 99)

        self.assertEqual(selection[10], 100)
        self.assertTrue(all(index == 61 for bank, index in selection.items() if bank != 10))

    def test_invalid_hour_leaves_all_banks_transparent(self) -> None:
        self.assertTrue(all(index == 61 for index in bank_selection(24, 40).values()))


if __name__ == "__main__":
    unittest.main()
