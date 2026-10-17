"""Generate a dense 3-axis G-code relief intended for visualizer/load testing.

The resulting program stays within a 220 x 170 mm work area, uses only X/Y/Z,
and raster-cuts a raised, Rebel-style bird emblem and rounded border.  It is
deliberately conservative about machine-specific commands, but is NOT a
ready-to-run machining job: feeds, spindle, tool, stock zero, and limits must
all be set for the actual router before anyone streams it.
"""

from __future__ import annotations

import math
from pathlib import Path


OUT = Path(__file__).with_name("rebel_style_relief_3axis.gcode")
X_MIN, X_MAX = 10.0, 210.0
Y_MIN, Y_MAX = 10.0, 160.0
STEP = 0.5
LEFT_OUTER = ((-5.0, -34.0), (-58.0, -28.0), (-69.0, 31.0), (-7.0, 55.0))
LEFT_INNER = ((-5.0, -11.0), (-40.0, -17.0), (-45.0, 20.0), (-10.0, 33.0))
RIGHT_OUTER = tuple((-x, y) for x, y in LEFT_OUTER)
RIGHT_INNER = tuple((-x, y) for x, y in LEFT_INNER)
CREST = ((0.0, -54.0), (-9.0, -39.0), (-22.0, -30.0), (-10.0, -22.0), (-2.0, -13.0),
         (0.0, 1.0), (2.0, -13.0), (10.0, -22.0), (22.0, -30.0), (9.0, -39.0))
BODY = ((-7.0, -15.0), (-19.0, 5.0), (-16.0, 27.0), (-5.0, 48.0), (0.0, 59.0),
        (5.0, 48.0), (16.0, 27.0), (19.0, 5.0), (7.0, -15.0))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def blend(inside_distance: float, feather: float = 1.5) -> float:
    """Return 1 well inside a shape, 0 well outside, with a soft edge."""
    amount = clamp(0.5 - inside_distance / (2.0 * feather), 0.0, 1.0)
    return amount * amount * (3.0 - 2.0 * amount)


def segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = clamp(((px - ax) * dx + (py - ay) * dy) / length_sq, 0.0, 1.0)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def polygon_distance(px: float, py: float, points: list[tuple[float, float]]) -> float:
    """Signed distance to a polygon: negative within it, positive outside."""
    nearest = min(
        segment_distance(px, py, *points[index], *points[(index + 1) % len(points)])
        for index in range(len(points))
    )
    contained = False
    previous = len(points) - 1
    for current, (cx, cy) in enumerate(points):
        px0, py0 = points[previous]
        crosses = (cy > py) != (py0 > py)
        if crosses and px < (px0 - cx) * (py - cy) / (py0 - cy) + cx:
            contained = not contained
        previous = current
    return -nearest if contained else nearest


def bezier_point(points: tuple[tuple[float, float], ...], t: float) -> tuple[float, float]:
    """Cubic Bezier point used to make the broad emblem wings."""
    inv = 1.0 - t
    return (
        inv**3 * points[0][0] + 3 * inv * inv * t * points[1][0] + 3 * inv * t * t * points[2][0] + t**3 * points[3][0],
        inv**3 * points[0][1] + 3 * inv * inv * t * points[1][1] + 3 * inv * t * t * points[2][1] + t**3 * points[3][1],
    )


def bezier_samples(controls: tuple[tuple[float, float], ...]) -> tuple[tuple[float, float], ...]:
    # Twenty-four segments resolve the broad wing curves well below the 0.5 mm
    # raster increment while keeping generator runtime practical.
    return tuple(bezier_point(controls, step / 24.0) for step in range(25))


def bezier_band_distance(px: float, py: float, samples: tuple[tuple[float, float], ...], width: float) -> float:
    return min(
        segment_distance(px, py, *samples[index], *samples[index + 1])
        for index in range(len(samples) - 1)
    ) - width


LEFT_OUTER_SAMPLES = bezier_samples(LEFT_OUTER)
LEFT_INNER_SAMPLES = bezier_samples(LEFT_INNER)
RIGHT_OUTER_SAMPLES = bezier_samples(RIGHT_OUTER)
RIGHT_INNER_SAMPLES = bezier_samples(RIGHT_INNER)


def rounded_rectangle_distance(px: float, py: float, half_width: float, half_height: float, radius: float) -> float:
    qx = abs(px) - half_width + radius
    qy = abs(py) - half_height + radius
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius


def relief_height(x: float, y: float) -> float:
    """Returns a cutter Z position; 0 is stock top and negative is cutting."""
    px, py = x - 110.0, y - 85.0
    background = -1.60 + 0.045 * math.sin(px * 0.19) * math.cos(py * 0.17)
    raised = -0.13 - 0.055 * math.sin(px * 0.31 + py * 0.17)

    # A raised rounded frame.
    frame_distance = abs(rounded_rectangle_distance(px, py, 96.0, 71.0, 8.0)) - 3.0
    coverage = blend(frame_distance, 1.25)

    # A symmetric, Rebel-style bird: curved outer and inner wings plus a crest
    # and a tapered body.  Coordinates are centered on the work area.
    logo_distance = min(
        bezier_band_distance(px, py, LEFT_OUTER_SAMPLES, 6.5),
        bezier_band_distance(px, py, RIGHT_OUTER_SAMPLES, 6.5),
        bezier_band_distance(px, py, LEFT_INNER_SAMPLES, 4.0),
        bezier_band_distance(px, py, RIGHT_INNER_SAMPLES, 4.0),
        polygon_distance(px, py, CREST),
        polygon_distance(px, py, BODY),
    )
    coverage = max(coverage, blend(logo_distance, 1.5))
    return background + (raised - background) * coverage


def write_program() -> int:
    x_count = round((X_MAX - X_MIN) / STEP)
    y_count = round((Y_MAX - Y_MIN) / STEP)
    lines = [
        "; SIMULATION / VISUALIZER LOAD TEST ONLY - DO NOT STREAM WITHOUT VERIFYING IT.",
        "; Analytic 3-axis relief: 220 x 170 mm stock envelope, X/Y/Z only.",
        "; Z range is approximately -1.65 to -0.08 mm relative to stock top.",
        "; Generated by generate_rebel_style_relief.py; raster step-over is 0.5 mm.",
        "G21 G90 G17 G94",
        "M3 S1000",
        "G0 Z5.000",
    ]
    for row in range(y_count + 1):
        y = Y_MIN + row * STEP
        columns = range(x_count + 1) if row % 2 == 0 else range(x_count, -1, -1)
        first = True
        for column in columns:
            x = X_MIN + column * STEP
            z = relief_height(x, y)
            if first:
                lines.append(f"G0 X{x:.3f} Y{y:.3f}")
                lines.append(f"G1 F300 Z{z:.3f}")
                first = False
            else:
                lines.append(f"G1 F900 X{x:.3f} Y{y:.3f} Z{z:.3f}")
        lines.append("G0 Z5.000")
    lines.extend(("M5", "G0 X0 Y0", "M30"))
    OUT.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")
    return len(lines)


if __name__ == "__main__":
    print(f"Wrote {write_program():,} lines to {OUT}")
