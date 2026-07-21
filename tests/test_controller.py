from coolcontrol.controller import FanController
from coolcontrol.curve import FanCurve
from coolcontrol.hwmon import SimulatedBackend
from coolcontrol.models import PWM_AUTOMATIC


def _controller():
    return FanController(SimulatedBackend())


def test_set_speed_switches_channel_to_manual():
    ctrl = _controller()
    chip = ctrl.controllable_chips()[0]
    ctrl.set_speed(chip.id, "pwm1", 40)
    pwm = ctrl.find_channel(chip.id, "pwm1")
    assert pwm.is_manual
    assert abs(pwm.percent - 40) <= 1  # 40% within rounding of the 0-255 grid


def test_set_automatic_hands_back_to_firmware():
    ctrl = _controller()
    chip = ctrl.controllable_chips()[0]
    ctrl.set_speed(chip.id, "pwm1", 80)
    ctrl.set_automatic(chip.id, "pwm1")
    pwm = ctrl.find_channel(chip.id, "pwm1")
    assert pwm.enable == PWM_AUTOMATIC


def test_curve_binding_applies_speed_from_temperature():
    ctrl = _controller()
    chip = ctrl.controllable_chips()[0]
    # A curve that always demands 100% no matter the temperature.
    ctrl.bind_curve(chip.id, "pwm1", FanCurve([(0, 100), (100, 100)]))
    ctrl.tick()
    pwm = ctrl.find_channel(chip.id, "pwm1")
    assert pwm.percent == 100.0
    assert pwm.is_manual


def test_apply_preset_binds_every_channel():
    ctrl = _controller()
    ctrl.apply_preset("Performance")
    assert ctrl.state.active_preset == "Performance"
    # Every controllable channel should now be bound to a curve.
    for chip in ctrl.controllable_chips():
        for pwm in chip.pwms:
            assert f"{chip.id}::{pwm.key}" in ctrl.state.bindings


def test_auto_preset_clears_bindings():
    ctrl = _controller()
    ctrl.apply_preset("Silent")
    assert ctrl.state.bindings
    ctrl.apply_preset("Auto")
    assert not ctrl.state.bindings
    assert ctrl.state.active_preset == "Auto"


def test_unknown_preset_raises():
    ctrl = _controller()
    try:
        ctrl.apply_preset("Turbo")
    except KeyError:
        return
    raise AssertionError("expected KeyError")


def test_restore_all_automatic():
    ctrl = _controller()
    ctrl.apply_preset("Balanced")
    ctrl.restore_all_automatic()
    for chip in ctrl.controllable_chips():
        for pwm in chip.pwms:
            assert pwm.enable == PWM_AUTOMATIC
    assert not ctrl.state.bindings
