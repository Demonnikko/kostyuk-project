from __future__ import annotations

import io
import json
import zlib
import zipfile
from pathlib import Path

from PIL import Image

from render_hands import CROP_ORIGIN, CANVAS_SIZE, render_pair


PROJECT_NAME = "Часы ИДЕАЛЬНЫЕ ТОЧНО ДО МИНУТЫ v10"


def _jpeg_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(
        buffer,
        format="JPEG",
        quality=95,
        subsampling=0,
        optimize=True,
    )
    return buffer.getvalue()


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def _numeric_input(identifier: str, digits: list[int], color: list[float]) -> dict:
    return {
        "pseudoDigitsCount": 0,
        "digitsArray": digits,
        "convertZeros": False,
        "calculate": False,
        "type": 0,
        "zeroFill": True,
        "color": color,
        "identifier": identifier,
        "available": True,
    }


def _image_input(hour: int) -> dict:
    return {
        "calculation": {
            "elseCalc": "61",
            "thenCalc": "$clockminute;+1",
            "ifCondition": str(hour),
            "isConditional": True,
            "simpleCalc": "",
            "ifTypeInt": 0,
            "ifBase": "$clockhour;",
        },
        "calculate": True,
        "pseudoDigitsCount": 2,
        "type": 3,
        "available": True,
        "color": [144, 19, 254, 1],
        "digitsArray": [],
        "identifier": f"time{hour:02d}",
    }


def _output(hour: int) -> dict:
    left = CROP_ORIGIN[0] / 1024
    top = CROP_ORIGIN[1] / 1536
    right = (CROP_ORIGIN[0] + CANVAS_SIZE[0]) / 1024
    bottom = (CROP_ORIGIN[1] + CANVAS_SIZE[1]) / 1536
    identifier = f"time{hour:02d}"
    return {
        "blur": 0,
        "saturation": 1,
        "tint": 0,
        "brightness": 0,
        "points": {
            "bottom": {"left": [left, bottom], "right": [right, bottom]},
            "top": {"right": [right, top], "left": [left, top]},
        },
        "hash": zlib.crc32(f"tap-clock-v10-{identifier}".encode("utf-8")) & 0x7FFFFFFF,
        "linkedInput": identifier,
        "opacity": 1,
        "type": "Image",
        "cornerRadius": 0,
        "name": f"Time {hour:02d}",
        "contentMode": 0,
        "temperature": 6000,
        "contrast": 1,
        "placeholderIndex": 60,
        "edgesBlur": 0,
    }


def _contents() -> dict:
    inputs = [
        _numeric_input("clockhour", [0, 1], [126, 211, 33, 1]),
        _numeric_input("clockminute", [2, 3], [255, 139, 0, 1]),
        _numeric_input("dummy", [4, 5], [74, 144, 226, 1]),
    ]
    inputs.extend(_image_input(hour) for hour in range(24))

    return {
        "project": {
            "saveAsFavorite": False,
            "useCustomLocation": False,
            "locationAddress": None,
            "locationDescription": None,
            "filter": None,
            "exportScale": 1,
            "dateTime": {
                "inputHour": "00",
                "staticDate": None,
                "useRandomTime": False,
                "inputMinute": "00",
                "relativeQuantity": 0,
                "type": 0,
                "inputDay": "01",
                "relativeDirection": 0,
                "inputMonth": "01",
                "relativeUnity": 0,
                "inputYear": "2018",
            },
            "inputs": inputs,
            "name": PROJECT_NAME,
            "author": "",
            "albumName": "TAP Performances",
            "version": 4,
            "outputs": [_output(hour) for hour in range(24)],
            "locationLongitude": 0,
            "locationLatitude": 0,
        }
    }


def build_project(source_path: Path, output_path: Path) -> Path:
    source_path = Path(source_path)
    output_path = Path(output_path)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)

    with Image.open(source_path) as opened_source:
        source = opened_source.convert("RGBA")
    if source.size != (1024, 1536):
        raise ValueError(f"source must be 1024x1536, got {source.size}")

    preview = source.copy()
    preview.alpha_composite(render_pair(10, 40), dest=CROP_ORIGIN)
    transparent_png = _png_bytes(Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0)))
    rendered_banks: dict[int, list[bytes]] = {}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("baseImage.jpg", _jpeg_bytes(source))
        archive.writestr("previewImage.jpg", _jpeg_bytes(preview))
        archive.writestr(
            "contents.json",
            json.dumps(_contents(), ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        )
        archive.writestr("outputs/", b"")
        archive.writestr("outputs/masks/", b"")
        archive.writestr("inputs/", b"")

        for hour in range(24):
            identifier = f"time{hour:02d}"
            archive.writestr(f"inputs/{identifier}/", b"")
            analog_hour = hour % 12
            if analog_hour not in rendered_banks:
                rendered_banks[analog_hour] = [
                    _png_bytes(render_pair(analog_hour, minute)) for minute in range(60)
                ]
            for minute, image_bytes in enumerate(rendered_banks[analog_hour], start=1):
                archive.writestr(f"inputs/{identifier}/{minute}.png", image_bytes)
            for index in range(61, 101):
                archive.writestr(f"inputs/{identifier}/{index}.png", transparent_png)

    return output_path
