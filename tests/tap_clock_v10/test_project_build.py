from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "tap-clock-v10"
sys.path.insert(0, str(SOURCE_DIR))

from build_project import build_project  # noqa: E402


SOURCE_PHOTO = Path("/Users/dmitrijkostuk/Desktop/BD5D9B47-C7B5-4F45-B8F3-DF9591FF36D9.PNG")


class TapProjectBuildTests(unittest.TestCase):
    def test_builds_complete_minute_accurate_tap_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "clock.tapProject"
            build_project(SOURCE_PHOTO, output_path)

            with zipfile.ZipFile(output_path) as archive:
                self.assertIsNone(archive.testzip())
                names = archive.namelist()
                project = json.loads(archive.read("contents.json"))["project"]

                self.assertEqual(project["version"], 4)
                self.assertEqual(project["name"], "Часы ИДЕАЛЬНЫЕ ТОЧНО ДО МИНУТЫ v10")
                self.assertEqual(len(project["inputs"]), 27)
                self.assertEqual(len(project["outputs"]), 24)

                numeric_inputs = project["inputs"][:3]
                self.assertEqual([item["identifier"] for item in numeric_inputs], ["clockhour", "clockminute", "dummy"])
                self.assertEqual([item["digitsArray"] for item in numeric_inputs], [[0, 1], [2, 3], [4, 5]])

                image_inputs = project["inputs"][3:]
                self.assertEqual([item["identifier"] for item in image_inputs], [f"time{hour:02d}" for hour in range(24)])
                for hour, item in enumerate(image_inputs):
                    with self.subTest(hour=hour):
                        self.assertTrue(item["calculate"])
                        self.assertEqual(item["type"], 3)
                        self.assertEqual(
                            item["calculation"],
                            {
                                "elseCalc": "61",
                                "thenCalc": "$clockminute;+1",
                                "ifCondition": str(hour),
                                "isConditional": True,
                                "simpleCalc": "",
                                "ifTypeInt": 0,
                                "ifBase": "$clockhour;",
                            },
                        )

                hashes = [output["hash"] for output in project["outputs"]]
                self.assertEqual(len(set(hashes)), 24)
                self.assertEqual(
                    [output["linkedInput"] for output in project["outputs"]],
                    [f"time{hour:02d}" for hour in range(24)],
                )

                image_names = [name for name in names if name.startswith("inputs/time") and name.endswith(".png")]
                self.assertEqual(len(image_names), 2_400)
                for hour in range(24):
                    bank_names = [name for name in image_names if name.startswith(f"inputs/time{hour:02d}/")]
                    self.assertEqual(len(bank_names), 100)
                    self.assertIn(f"inputs/time{hour:02d}/1.png", bank_names)
                    self.assertIn(f"inputs/time{hour:02d}/100.png", bank_names)

                with Image.open(io.BytesIO(archive.read("baseImage.jpg"))) as base:
                    self.assertEqual(base.size, (1024, 1536))
                with Image.open(io.BytesIO(archive.read("inputs/time10/41.png"))) as active:
                    self.assertEqual(active.size, (360, 360))
                    self.assertEqual(active.mode, "RGBA")
                    self.assertIsNotNone(active.getchannel("A").getbbox())
                with Image.open(io.BytesIO(archive.read("inputs/time10/61.png"))) as safety:
                    self.assertIsNone(safety.getchannel("A").getbbox())


if __name__ == "__main__":
    unittest.main()
