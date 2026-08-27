from __future__ import annotations


def analog_angles(hour: int, minute: int) -> tuple[float, float]:
    if not 0 <= hour <= 23:
        raise ValueError("hour must be between 0 and 23")
    if not 0 <= minute <= 59:
        raise ValueError("minute must be between 0 and 59")

    analog_hour = hour % 12
    hour_angle = analog_hour * 30.0 + minute * 0.5
    minute_angle = minute * 6.0
    return (hour_angle, minute_angle)


def bank_selection(input_hour: int, input_minute: int) -> dict[int, int]:
    selection = {bank: 61 for bank in range(24)}
    if 0 <= input_hour <= 23 and 0 <= input_minute <= 99:
        selection[input_hour] = input_minute + 1
    return selection
