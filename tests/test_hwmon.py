import os

from coolcontrol.hwmon import (
    HwmonReader,
    SimulatedBackend,
    SysfsBackend,
    default_backend,
)
from coolcontrol.models import PWM_MANUAL, PwmChannel


def _write_tree(root, chip, files):
    path = os.path.join(root, chip)
    os.makedirs(path)
    for name, value in files.items():
        with open(os.path.join(path, name), "w") as fh:
            fh.write(str(value))
    return path


def test_sysfs_reader_parses_chip(tmp_path):
    base = tmp_path / "hwmon"
    base.mkdir()
    _write_tree(
        str(base),
        "hwmon0",
        {
            "name": "nct6799",
            "temp1_input": "52000",
            "temp1_label": "CPU",
            "fan1_input": "1800",
            "fan1_label": "CPU Fan",
            "pwm1": "128",
            "pwm1_enable": "1",
        },
    )
    reader = HwmonReader(SysfsBackend(str(base)))
    chips = reader.read_all()
    assert len(chips) == 1
    chip = chips[0]
    assert chip.name == "nct6799"
    assert chip.temps[0].label == "CPU"
    assert chip.temps[0].celsius == 52.0  # millidegrees -> degrees
    assert chip.pwms[0].fan.rpm == 1800
    assert chip.pwms[0].percent == 50.2  # 128/255
    assert chip.pwms[0].is_manual


def test_percent_raw_conversions_round_trip():
    for pct in (0, 25, 50, 75, 100):
        raw = PwmChannel.percent_to_raw(pct)
        assert 0 <= raw <= 255
    assert PwmChannel.percent_to_raw(0) == 0
    assert PwmChannel.percent_to_raw(100) == 255
    assert PwmChannel.percent_to_raw(150) == 255  # clamped


def test_simulated_backend_has_controllable_fans():
    reader = HwmonReader(SimulatedBackend())
    chips = reader.read_all()
    assert chips and chips[0].controllable
    assert len(chips[0].pwms) == 2


def test_simulation_reacts_to_fan_speed():
    backend = SimulatedBackend(seed_temp=70.0)
    chip = backend.chip_ids()[0]
    # Full speed, manual: temperature should trend downward over time.
    backend.write(chip, "pwm1_enable", str(PWM_MANUAL))
    backend.write(chip, "pwm2_enable", str(PWM_MANUAL))
    backend.write(chip, "pwm1", "255")
    backend.write(chip, "pwm2", "255")
    start = int(backend.read(chip, "temp1_input"))
    for _ in range(40):
        backend.tick(1.0)
    end = int(backend.read(chip, "temp1_input"))
    assert end < start


def test_default_backend_always_returns_usable_chips():
    # Whether or not this machine exposes real hwmon fans, the default backend
    # must return something the UI can render (real hardware or the simulator).
    backend = default_backend()
    assert backend.chip_ids()
