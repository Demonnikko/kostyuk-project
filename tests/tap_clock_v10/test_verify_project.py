from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "tap-clock-v10"
sys.path.insert(0, str(SOURCE_DIR))

from build_project import build_project  # noqa: E402
from verify_project import verify_project  # noqa: E402


SOURCE_PHOTO = Path("/Users/dmitrijkostuk/Desktop/BD5D9B47-C7B5-4F45-B8F3-DF9591FF36D9.PNG")


class VerifyProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.valid_path = Path(cls.temp_dir.name) / "valid.tapProject"
        build_project(SOURCE_PHOTO, cls.valid_path)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_dir.cleanup()

    def test_accepts_complete_generated_project(self) -> None:
        self.assertEqual(verify_project(self.valid_path), [])

    def test_reports_missing_frame_and_duplicate_output_hash(self) -> None:
        broken_path = Path(self.temp_dir.name) / "broken.tapProject"
        with zipfile.ZipFile(self.valid_path) as source_archive, zipfile.ZipFile(
            broken_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as broken_archive:
            contents = json.loads(source_archive.read("contents.json"))
            outputs = contents["project"]["outputs"]
            outputs[1]["hash"] = outputs[0]["hash"]

            for info in source_archive.infolist():
                if info.filename == "inputs/time10/41.png":
                    continue
                if info.filename == "contents.json":
                    broken_archive.writestr(info, json.dumps(contents, ensure_ascii=False).encode("utf-8"))
                else:
                    broken_archive.writestr(info, source_archive.read(info.filename))

        errors = verify_project(broken_path)

        self.assertIn("missing image: inputs/time10/41.png", errors)
        self.assertIn("duplicate output hash", errors)


if __name__ == "__main__":
    unittest.main()
