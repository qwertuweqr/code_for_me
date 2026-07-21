from coolcontrol.curve import BUILTIN_CURVES, CurvePoint, FanCurve


def test_interpolates_linearly_between_points():
    curve = FanCurve([(40, 20), (60, 80)])
    assert curve.speed_at(50) == 50.0  # halfway
    assert curve.speed_at(45) == 35.0


def test_clamps_below_and_above_range():
    curve = FanCurve([(40, 20), (80, 100)])
    assert curve.speed_at(0) == 20.0  # below first point
    assert curve.speed_at(200) == 100.0  # above last point


def test_points_are_sorted_and_speed_clamped():
    curve = FanCurve([(80, 150), (30, -10)])
    pts = curve.points
    assert [p.temp for p in pts] == [30, 80]
    assert pts[0].speed == 0.0  # -10 clamped up
    assert pts[1].speed == 100.0  # 150 clamped down


def test_duplicate_temperature_keeps_last():
    curve = FanCurve([(50, 30), (50, 70)])
    assert len(curve.points) == 1
    assert curve.speed_at(50) == 70.0


def test_add_and_remove_points_are_immutable():
    curve = FanCurve([(30, 0), (80, 100)])
    bigger = curve.with_point(CurvePoint(55, 50))
    assert len(curve.points) == 2  # original untouched
    assert len(bigger.points) == 3
    smaller = bigger.without_point(1)
    assert len(smaller.points) == 2


def test_cannot_remove_last_point():
    curve = FanCurve([(30, 0)])
    try:
        curve.without_point(0)
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_round_trip_serialisation():
    for curve in BUILTIN_CURVES.values():
        assert FanCurve.from_list(curve.to_list()) == curve


def test_empty_curve_rejected():
    try:
        FanCurve([])
    except ValueError:
        return
    raise AssertionError("expected ValueError")
