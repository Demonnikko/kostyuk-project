from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

from clock_math import analog_angles


PIVOT = (178, 176)
CROP_ORIGIN = (500, 740)
CANVAS_SIZE = (360, 360)
SUPERSAMPLE = 8

HAND_FILL = (9, 22, 31, 255)
HAND_EDGE = (2, 7, 11, 255)
HAND_HIGHLIGHT = (54, 76, 89, 255)

MINUTE_POLYGON = (
    (-1.8, 10.0),
    (-1.7, -91.0),
    (-3.4, -96.0),
    (0.0, -105.0),
    (3.4, -96.0),
    (1.7, -91.0),
    (1.8, 10.0),
)

HOUR_POLYGON = (
    (-2.4, 9.0),
    (-2.3, -40.0),
    (-6.0, -50.0),
    (-6.5, -57.0),
    (-4.0, -66.0),
    (0.0, -74.0),
    (4.0, -66.0),
    (6.5, -57.0),
    (6.0, -50.0),
    (2.3, -40.0),
    (2.4, 9.0),
)


def _rotate_point(point: tuple[float, float], angle_degrees: float) -> tuple[float, float]:
    x, y = point
    radians = math.radians(angle_degrees)
    cos_angle = math.cos(radians)
    sin_angle = math.sin(radians)
    return (x * cos_angle - y * sin_angle, x * sin_angle + y * cos_angle)


def _canvas_point(point: tuple[float, float], angle_degrees: float) -> tuple[int, int]:
    x, y = _rotate_point(point, angle_degrees)
    return (
        round((PIVOT[0] + x) * SUPERSAMPLE),
        round((PIVOT[1] + y) * SUPERSAMPLE),
    )


def _draw_hand(
    draw: ImageDraw.ImageDraw,
    polygon: tuple[tuple[float, float], ...],
    angle_degrees: float,
    highlight_end: float,
) -> None:
    points = [_canvas_point(point, angle_degrees) for point in polygon]
    draw.polygon(points, fill=HAND_FILL)
    draw.line(points + [points[0]], fill=HAND_EDGE, width=round(1.15 * SUPERSAMPLE), joint="curve")

    highlight_points = [
        _canvas_point((0.7, 3.0), angle_degrees),
        _canvas_point((0.7, highlight_end), angle_degrees),
    ]
    draw.line(highlight_points, fill=HAND_HIGHLIGHT, width=max(1, round(0.65 * SUPERSAMPLE)))


def _draw_center_cap(draw: ImageDraw.ImageDraw) -> None:
    cx = PIVOT[0] * SUPERSAMPLE
    cy = PIVOT[1] * SUPERSAMPLE

    def bounds(radius: float, offset_x: float = 0.0, offset_y: float = 0.0) -> tuple[int, int, int, int]:
        scaled_radius = radius * SUPERSAMPLE
        center_x = cx + offset_x * SUPERSAMPLE
        center_y = cy + offset_y * SUPERSAMPLE
        return (
            round(center_x - scaled_radius),
            round(center_y - scaled_radius),
            round(center_x + scaled_radius),
            round(center_y + scaled_radius),
        )

    draw.ellipse(bounds(7.5), fill=HAND_EDGE)
    draw.ellipse(bounds(5.8), fill=(13, 29, 39, 255))
    draw.ellipse(bounds(2.2, -1.2, -1.3), fill=(72, 91, 101, 255))
    draw.ellipse(bounds(1.5, 1.3, 1.5), fill=(3, 9, 13, 255))


def render_pair(hour: int, minute: int) -> Image.Image:
    hour_angle, minute_angle = analog_angles(hour, minute)
    high_resolution = Image.new(
        "RGBA",
        (CANVAS_SIZE[0] * SUPERSAMPLE, CANVAS_SIZE[1] * SUPERSAMPLE),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(high_resolution)

    _draw_hand(draw, HOUR_POLYGON, hour_angle, -39.0)
    _draw_hand(draw, MINUTE_POLYGON, minute_angle, -72.0)
    _draw_center_cap(draw)

    return high_resolution.resize(CANVAS_SIZE, Image.Resampling.LANCZOS)


def render_preview(source_path: Path, out_path: Path, hour: int, minute: int) -> None:
    with Image.open(source_path) as source:
        preview = source.convert("RGBA")
    preview.alpha_composite(render_pair(hour, minute), dest=CROP_ORIGIN)
    preview.save(out_path)
