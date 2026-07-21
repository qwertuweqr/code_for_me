"""The control layer: turning intent ("make it quiet") into PWM writes.

The GUI and CLI both drive this class. It knows how to:

* switch a channel between firmware-automatic and userspace-manual control,
* set an absolute fan speed in percent, and
* run a *curve* control loop that reads a temperature and writes the
  corresponding speed on every tick.

It never remembers hardware state itself; it re-reads chips through the
:class:`~coolcontrol.hwmon.HwmonReader` so the UI always shows ground truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .curve import BUILTIN_CURVES, FanCurve
from .hwmon import HwmonBackend, HwmonError, HwmonReader
from .models import PWM_AUTOMATIC, PWM_MANUAL, Chip, PwmChannel


@dataclass
class ChannelBinding:
    """Ties a PWM channel to the curve and temperature that should drive it."""

    chip_id: str
    pwm_key: str
    curve: FanCurve | None = None  # None => user is dragging the slider manually
    temp_key: str | None = None  # which sensor feeds the curve


@dataclass
class ControllerState:
    bindings: dict[str, ChannelBinding] = field(default_factory=dict)
    active_preset: str | None = None


def _binding_id(chip_id: str, pwm_key: str) -> str:
    return f"{chip_id}::{pwm_key}"


class FanController:
    """High level fan control built on top of a hwmon backend."""

    def __init__(self, backend: HwmonBackend):
        self.backend = backend
        self.reader = HwmonReader(backend)
        self.state = ControllerState()

    # -- inspection --------------------------------------------------------
    def chips(self) -> list[Chip]:
        return self.reader.read_all()

    def controllable_chips(self) -> list[Chip]:
        return [c for c in self.chips() if c.controllable]

    def find_channel(self, chip_id: str, pwm_key: str) -> PwmChannel | None:
        chip = self.reader.read_chip(chip_id)
        for pwm in chip.pwms:
            if pwm.key == pwm_key:
                return pwm
        return None

    # -- low level writes --------------------------------------------------
    def _ensure_manual(self, chip_id: str, pwm_key: str) -> None:
        enable_attr = f"{pwm_key}_enable"
        current = self.backend.read(chip_id, enable_attr)
        if current is None or int(current.strip() or 0) != PWM_MANUAL:
            self.backend.write(chip_id, enable_attr, str(PWM_MANUAL))

    def set_speed(self, chip_id: str, pwm_key: str, percent: float) -> None:
        """Set an absolute fan speed (0-100%). Switches the channel to manual."""
        self._ensure_manual(chip_id, pwm_key)
        raw = PwmChannel.percent_to_raw(percent)
        self.backend.write(chip_id, pwm_key, str(raw))

    def set_automatic(self, chip_id: str, pwm_key: str) -> None:
        """Hand the channel back to the firmware's own control."""
        self.backend.write(chip_id, f"{pwm_key}_enable", str(PWM_AUTOMATIC))
        self.state.bindings.pop(_binding_id(chip_id, pwm_key), None)

    # -- curves ------------------------------------------------------------
    def bind_curve(
        self,
        chip_id: str,
        pwm_key: str,
        curve: FanCurve,
        temp_key: str | None = None,
    ) -> None:
        """Attach a curve to a channel so :meth:`tick` will drive it."""
        if temp_key is None:
            chip = self.reader.read_chip(chip_id)
            hottest = chip.hottest()
            temp_key = hottest.key if hottest else None
        self.state.bindings[_binding_id(chip_id, pwm_key)] = ChannelBinding(
            chip_id=chip_id, pwm_key=pwm_key, curve=curve, temp_key=temp_key
        )

    def tick(self) -> None:
        """Apply every bound curve once, using the latest temperatures."""
        for binding in list(self.state.bindings.values()):
            if binding.curve is None:
                continue
            chip = self.reader.read_chip(binding.chip_id)
            temp = self._temp_for(chip, binding.temp_key)
            if temp is None:
                continue
            speed = binding.curve.speed_at(temp)
            try:
                self.set_speed(binding.chip_id, binding.pwm_key, speed)
            except HwmonError:
                # A single failing channel should not stop the others.
                continue

    @staticmethod
    def _temp_for(chip: Chip, temp_key: str | None) -> float | None:
        if temp_key:
            for t in chip.temps:
                if t.key == temp_key:
                    return t.celsius
        hottest = chip.hottest()
        return hottest.celsius if hottest else None

    # -- presets -----------------------------------------------------------
    def apply_preset(self, name: str, curves: dict[str, FanCurve] | None = None) -> None:
        """Bind a named curve to every controllable channel."""
        curves = curves or BUILTIN_CURVES
        if name == "Auto":
            for chip in self.controllable_chips():
                for pwm in chip.pwms:
                    self.set_automatic(chip.id, pwm.key)
            self.state.active_preset = "Auto"
            return
        if name not in curves:
            raise KeyError(f"unknown preset {name!r}")
        for chip in self.controllable_chips():
            for pwm in chip.pwms:
                self.bind_curve(chip.id, pwm.key, curves[name])
        self.state.active_preset = name
        self.tick()

    def restore_all_automatic(self) -> None:
        """Return every channel to firmware control (used on exit)."""
        for chip in self.controllable_chips():
            for pwm in chip.pwms:
                try:
                    self.set_automatic(chip.id, pwm.key)
                except HwmonError:
                    continue
        self.state.bindings.clear()
        self.state.active_preset = "Auto"
