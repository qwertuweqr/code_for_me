"""Data models describing the hardware CoolControl talks to.

These are plain dataclasses that carry a snapshot of a hardware monitoring
chip and its channels. They deliberately contain no I/O: the backends in
``hwmon.py`` are responsible for populating them, which keeps the models easy
to construct in tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# A pwmN_enable value tells the kernel who is in charge of a fan channel.
# The exact meaning of values >= 2 is driver specific, but "manual" is always
# 1 and "no control / full speed" is always 0.
PWM_DISABLED = 0  # fan runs at full speed, ignored by the driver
PWM_MANUAL = 1  # userspace sets pwmN directly
PWM_AUTOMATIC = 2  # the firmware/driver controls the fan


@dataclass
class TempSensor:
    """A single temperature input (``tempN_input``)."""

    key: str  # e.g. "temp1"
    label: str  # human friendly, e.g. "CPU"
    celsius: float


@dataclass
class Fan:
    """A tachometer reading (``fanN_input``) in RPM."""

    key: str  # e.g. "fan1"
    label: str
    rpm: int


@dataclass
class PwmChannel:
    """A controllable PWM output (``pwmN`` / ``pwmN_enable``).

    ``raw`` is the kernel value in the range 0-255. ``percent`` exposes the
    same value as a friendlier 0-100 scale, which is what the UI works in.
    """

    key: str  # e.g. "pwm1"
    label: str
    raw: int  # 0-255
    enable: int  # see PWM_* constants
    fan: Fan | None = None  # the tachometer wired to this channel, if known

    RAW_MAX = 255

    @property
    def percent(self) -> float:
        return round(self.raw / self.RAW_MAX * 100, 1)

    @staticmethod
    def percent_to_raw(percent: float) -> int:
        percent = max(0.0, min(100.0, percent))
        return round(percent / 100 * PwmChannel.RAW_MAX)

    @property
    def is_manual(self) -> bool:
        return self.enable == PWM_MANUAL


@dataclass
class Chip:
    """A hwmon chip (a directory under ``/sys/class/hwmon``)."""

    id: str  # backend identifier (a path for sysfs)
    name: str  # driver name, e.g. "nct6799"
    temps: list[TempSensor] = field(default_factory=list)
    fans: list[Fan] = field(default_factory=list)
    pwms: list[PwmChannel] = field(default_factory=list)

    @property
    def controllable(self) -> bool:
        return bool(self.pwms)

    def hottest(self) -> TempSensor | None:
        """The warmest sensor on this chip, used as the default curve input."""
        if not self.temps:
            return None
        return max(self.temps, key=lambda t: t.celsius)
