from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "tap-clock-v10"
sys.path.insert(0, str(SOURCE_DIR))

from render_hands import PIVOT, render_pair, render_preview  # noqa: E402


def alpha_max_near(image: Image.Image, x: int, y: int, radius: int = 3) -> int:
    alpha = image.getchannel("A")
    crop = alpha.crop((x - radius, y - radius, x + radius + 1, y + radius + 1))
    return crop.getextrema()[1]


class RenderPairTests(unittest.TestCase):
    def test_renders_exact_rgba_canvas_with_transparent_corners(self) -> None:
        image = render_pair(10, 40)

        self.assertEqual(image.mode, "RGBA")
        self.assertEqual(image.size, (360, 360))
        self.assertEqual(PIVOT, (178, 176))
        self.assertTrue(all(image.getpixel(point)[3] == 0 for point in ((0, 0), (359, 0), (0, 359), (359, 359))))

    def test_1040_minute_hand_points_to_eight_not_four(self) -> None:
        image = render_pair(10, 40)

        self.assertGreater(alpha_max_near(image, 88, 228, 5), 180)
        self.assertEqual(alpha_max_near(image, 268, 228, 5), 0)

    def test_1040_hour_hand_is_between_ten_and_eleven(self) -> None:
        image = render_pair(10, 40)

        self.assertGreater(alpha_max_near(image, 130, 119, 6), 180)
        self.assertEqual(alpha_max_near(image, 178, 102, 5), 0)

    def test_center_cap_is_opaque_and_compact(self) -> None:
        image = render_pair(23, 59)
        alpha = image.getchannel("A")

        self.assertEqual(alpha.getpixel(PIVOT), 255)
        self.assertLess(alpha.getbbox()[0], PIVOT[0])
        self.assertGreater(alpha.getbbox()[2], PIVOT[0])

    def test_preview_keeps_source_dimensions(self) -> None:
        source_path = Path("/Users/dmitrijkostuk/Desktop/BD5D9B47-C7B5-4F45-B8F3-DF9591FF36D9.PNG")
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "preview.png"
            render_preview(source_path, output_path, 10, 40)
            with Image.open(output_path) as preview:
                self.assertEqual(preview.size, (1024, 1536))
                self.assertEqual(preview.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()
