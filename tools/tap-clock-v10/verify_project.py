from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image


EXPECTED_CONDITION_KEYS = {
    "elseCalc",
    "thenCalc",
    "ifCondition",
    "isConditional",
    "simpleCalc",
    "ifTypeInt",
    "ifBase",
}


def _append_once(errors: list[str], message: str) -> None:
    if message not in errors:
        errors.append(message)


def verify_project(project_path: Path) -> list[str]:
    project_path = Path(project_path)
    errors: list[str] = []
    if not project_path.is_file():
        return [f"project not found: {project_path}"]

    try:
        archive = zipfile.ZipFile(project_path)
    except zipfile.BadZipFile:
        return ["invalid ZIP archive"]

    with archive:
        bad_crc = archive.testzip()
        if bad_crc:
            errors.append(f"CRC failure: {bad_crc}")
        names = set(archive.namelist())

        for required in ("baseImage.jpg", "previewImage.jpg", "contents.json"):
            if required not in names:
                errors.append(f"missing archive entry: {required}")
        if "contents.json" not in names:
            return errors

        try:
            root = json.loads(archive.read("contents.json"))
            project = root["project"]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            errors.append(f"invalid contents.json: {exc}")
            return errors

        if project.get("version") != 4:
            errors.append("project version must be 4")

        inputs = project.get("inputs")
        outputs = project.get("outputs")
        if not isinstance(inputs, list):
            errors.append("project inputs must be a list")
            return errors
        if not isinstance(outputs, list):
            errors.append("project outputs must be a list")
            return errors
        if len(inputs) != 27:
            errors.append(f"expected 27 inputs, found {len(inputs)}")
        if len(outputs) != 24:
            errors.append(f"expected 24 outputs, found {len(outputs)}")

        numeric = inputs[:3]
        expected_numeric = (
            ("clockhour", [0, 1]),
            ("clockminute", [2, 3]),
            ("dummy", [4, 5]),
        )
        for offset, (identifier, digits) in enumerate(expected_numeric):
            if offset >= len(numeric):
                errors.append(f"missing numeric input: {identifier}")
                continue
            item = numeric[offset]
            if item.get("identifier") != identifier or item.get("digitsArray") != digits:
                errors.append(f"invalid numeric input: {identifier}")

        image_inputs = {item.get("identifier"): item for item in inputs[3:] if isinstance(item, dict)}
        output_links: list[str] = []
        output_hashes: list[int] = []
        for output in outputs:
            if not isinstance(output, dict):
                errors.append("output must be an object")
                continue
            output_links.append(output.get("linkedInput"))
            output_hashes.append(output.get("hash"))
            points = output.get("points", {})
            expected_points = {
                "bottom": {
                    "left": [500 / 1024, 1100 / 1536],
                    "right": [860 / 1024, 1100 / 1536],
                },
                "top": {
                    "right": [860 / 1024, 740 / 1536],
                    "left": [500 / 1024, 740 / 1536],
                },
            }
            if points != expected_points:
                _append_once(errors, "output frame does not match the 360x360 dial crop")
        if len(output_hashes) != len(set(output_hashes)):
            errors.append("duplicate output hash")

        expected_links = [f"time{hour:02d}" for hour in range(24)]
        if output_links != expected_links:
            errors.append("output links are not ordered time00 through time23")

        for hour in range(24):
            identifier = f"time{hour:02d}"
            item = image_inputs.get(identifier)
            if item is None:
                errors.append(f"missing image input: {identifier}")
                continue
            calculation = item.get("calculation")
            if not isinstance(calculation, dict) or set(calculation) != EXPECTED_CONDITION_KEYS:
                errors.append(f"invalid calculation schema: {identifier}")
            else:
                expected_calculation = {
                    "elseCalc": "61",
                    "thenCalc": "$clockminute;+1",
                    "ifCondition": str(hour),
                    "isConditional": True,
                    "simpleCalc": "",
                    "ifTypeInt": 0,
                    "ifBase": "$clockhour;",
                }
                if calculation != expected_calculation:
                    errors.append(f"invalid calculation: {identifier}")

            for index in range(1, 101):
                image_name = f"inputs/{identifier}/{index}.png"
                if image_name not in names:
                    errors.append(f"missing image: {image_name}")
                    continue
                try:
                    with Image.open(io.BytesIO(archive.read(image_name))) as image:
                        image.load()
                        if image.mode != "RGBA" or image.size != (360, 360):
                            errors.append(f"invalid image format: {image_name}")
                            continue
                        alpha_box = image.getchannel("A").getbbox()
                        if index <= 60 and alpha_box is None:
                            errors.append(f"active image is transparent: {image_name}")
                        if index >= 61 and alpha_box is not None:
                            errors.append(f"safety image is visible: {image_name}")
                except OSError:
                    errors.append(f"invalid PNG: {image_name}")

        if "baseImage.jpg" in names:
            try:
                with Image.open(io.BytesIO(archive.read("baseImage.jpg"))) as base:
                    if base.size != (1024, 1536):
                        errors.append(f"base image size is {base.size}, expected (1024, 1536)")
            except OSError:
                errors.append("invalid baseImage.jpg")

        for hour in range(24):
            for minute in range(60):
                indexes = {bank: (minute + 1 if bank == hour else 61) for bank in range(24)}
                active = [bank for bank, index in indexes.items() if index <= 60]
                if active != [hour]:
                    errors.append(f"bank simulation failed at {hour:02d}:{minute:02d}")
                    return errors
                if not all(1 <= index <= 100 for index in indexes.values()):
                    errors.append(f"bank index out of range at {hour:02d}:{minute:02d}")
                    return errors

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify_project.py PROJECT.tapProject")
        return 2
    errors = verify_project(Path(sys.argv[1]))
    if errors:
        for error in errors:
            print(error)
        return 1
    print("OK: project structure, images, and all 1,440 valid times verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
