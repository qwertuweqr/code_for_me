"""Fan curves: the mapping from temperature to fan speed.

A fan curve is the heart of any "adequate" fan control tool. It answers a
single question: *given the current temperature, how fast should the fan
spin?* We model it as a list of control points and interpolate linearly
between them, which is exactly what users expect from the little graph they
drag around in the UI.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CurvePoint:
    temp: float  # degrees Celsius
    speed: float  # fan speed in percent (0-100)


class FanCurve:
    """A monotonic temperature -> speed mapping with linear interpolation.

    Points are kept sorted by temperature. Below the first point the curve is
    flat at the first point's speed; above the last point it is flat at the
    last point's speed. This "clamp at the ends" behaviour avoids surprising
    extrapolation (e.g. negative fan speeds on a cold boot).
    """

    def __init__(self, points: list[CurvePoint] | list[tuple[float, float]]):
        normalised: list[CurvePoint] = []
        for p in points:
            if isinstance(p, CurvePoint):
                normalised.append(p)
            else:
                normalised.append(CurvePoint(float(p[0]), float(p[1])))
        if not normalised:
            raise ValueError("a fan curve needs at least one point")
        self._points = self._normalise(normalised)

    @staticmethod
    def _normalise(points: list[CurvePoint]) -> list[CurvePoint]:
        # Sort by temperature and clamp speeds into the valid range. If two
        # points share a temperature we keep the last one, which makes the
        # editor's "drag a point onto its neighbour" gesture well defined.
        by_temp: dict[float, float] = {}
        for p in points:
            by_temp[float(p.temp)] = max(0.0, min(100.0, float(p.speed)))
        return [CurvePoint(t, by_temp[t]) for t in sorted(by_temp)]

    @property
    def points(self) -> list[CurvePoint]:
        return list(self._points)

    def speed_at(self, temp: float) -> float:
        """Return the interpolated fan speed (percent) for ``temp``."""
        pts = self._points
        if temp <= pts[0].temp:
            return pts[0].speed
        if temp >= pts[-1].temp:
            return pts[-1].speed
        # Find the segment [lo, hi] that brackets temp and interpolate.
        for lo, hi in zip(pts, pts[1:]):
            if lo.temp <= temp <= hi.temp:
                span = hi.temp - lo.temp
                if span == 0:
                    return hi.speed
                ratio = (temp - lo.temp) / span
                return round(lo.speed + ratio * (hi.speed - lo.speed), 1)
        return pts[-1].speed  # unreachable, but keeps type checkers happy

    def with_point(self, point: CurvePoint) -> "FanCurve":
        return FanCurve(self._points + [point])

    def without_point(self, index: int) -> "FanCurve":
        if len(self._points) <= 1:
            raise ValueError("a fan curve must keep at least one point")
        remaining = [p for i, p in enumerate(self._points) if i != index]
        return FanCurve(remaining)

    def to_list(self) -> list[list[float]]:
        return [[p.temp, p.speed] for p in self._points]

    @classmethod
    def from_list(cls, data: list) -> "FanCurve":
        return cls([CurvePoint(float(t), float(s)) for t, s in data])

    def __eq__(self, other: object) -> bool:
        return isinstance(other, FanCurve) and other._points == self._points

    def __repr__(self) -> str:
        inner = ", ".join(f"({p.temp:g}\u00b0,{p.speed:g}%)" for p in self._points)
        return f"FanCurve[{inner}]"


# Sensible built-in curves. Percentages are conservative so that "Silent"
# really is quiet and "Performance" ramps early to keep temperatures down.
BUILTIN_CURVES: dict[str, FanCurve] = {
    "Silent": FanCurve([(30, 0), (50, 20), (65, 35), (80, 60), (90, 100)]),
    "Balanced": FanCurve([(30, 20), (50, 35), (65, 55), (80, 80), (90, 100)]),
    "Performance": FanCurve([(30, 40), (45, 60), (60, 80), (75, 100)]),
}
