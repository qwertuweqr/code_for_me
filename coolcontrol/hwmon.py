"""Talking to the Linux hardware monitoring subsystem (``hwmon``).

On Linux, fan controllers, temperature sensors and PWM outputs are all
exposed as tiny text files under ``/sys/class/hwmon/hwmonN/``. Reading a
fan's speed is ``cat fan1_input``; making a fan quieter is
``echo 120 > pwm1`` (after telling the driver you want manual control with
``echo 1 > pwm1_enable``).

This module hides those files behind a small backend interface so that the
rest of the app never touches ``/sys`` directly. That indirection buys us two
things:

* a :class:`SimulatedBackend` that behaves like real hardware but lives
  entirely in memory, so the app runs (and is testable) on any machine, even
  one with no controllable fans; and
* a single, well-tested place where the sysfs quirks live.
"""

from __future__ import annotations

import glob
import math
import os
import re
from abc import ABC, abstractmethod

from .models import (
    PWM_AUTOMATIC,
    Chip,
    Fan,
    PwmChannel,
    TempSensor,
)


class HwmonError(RuntimeError):
    """Raised when a hwmon attribute cannot be read or written."""


class HwmonBackend(ABC):
    """Raw access to hwmon attribute files, chip by chip."""

    @abstractmethod
    def chip_ids(self) -> list[str]:
        """Identifiers for every chip (a directory path for sysfs)."""

    @abstractmethod
    def attrs(self, chip: str) -> list[str]:
        """Attribute file names available on a chip, e.g. ``["fan1_input"]``."""

    @abstractmethod
    def read(self, chip: str, attr: str) -> str | None:
        """Read an attribute, or ``None`` if it does not exist."""

    @abstractmethod
    def write(self, chip: str, attr: str, value: str) -> None:
        """Write a raw string to an attribute file."""

    @abstractmethod
    def writable(self, chip: str, attr: str) -> bool:
        """Whether ``attr`` can be written (pwm files need root)."""


_INDEX_RE = re.compile(r"(temp|fan|pwm)(\d+)")


def _index(attr: str) -> int:
    m = _INDEX_RE.match(attr)
    return int(m.group(2)) if m else 0


class HwmonReader:
    """Turns a backend's flat attribute files into structured :class:`Chip`s."""

    def __init__(self, backend: HwmonBackend):
        self.backend = backend

    def _read_int(self, chip: str, attr: str) -> int | None:
        raw = self.backend.read(chip, attr)
        if raw is None:
            return None
        try:
            return int(raw.strip())
        except ValueError:
            return None

    def _label(self, chip: str, prefix: str, idx: int, fallback: str) -> str:
        raw = self.backend.read(chip, f"{prefix}{idx}_label")
        return raw.strip() if raw else fallback

    def read_chip(self, chip_id: str) -> Chip:
        attrs = set(self.backend.attrs(chip_id))
        name = (self.backend.read(chip_id, "name") or "hwmon").strip()

        temps: list[TempSensor] = []
        fans: dict[int, Fan] = {}
        pwms: list[PwmChannel] = []

        for attr in sorted(attrs):
            if attr.endswith("_input") and attr.startswith("temp"):
                idx = _index(attr)
                milli = self._read_int(chip_id, attr)
                if milli is None:
                    continue
                temps.append(
                    TempSensor(
                        key=f"temp{idx}",
                        label=self._label(chip_id, "temp", idx, f"temp{idx}"),
                        celsius=round(milli / 1000, 1),
                    )
                )
            elif attr.endswith("_input") and attr.startswith("fan"):
                idx = _index(attr)
                rpm = self._read_int(chip_id, attr) or 0
                fans[idx] = Fan(
                    key=f"fan{idx}",
                    label=self._label(chip_id, "fan", idx, f"fan{idx}"),
                    rpm=rpm,
                )

        for attr in sorted(attrs):
            # A controllable channel is a bare ``pwmN`` file (not pwmN_enable
            # or pwmN_mode).
            if re.fullmatch(r"pwm\d+", attr):
                idx = _index(attr)
                raw = self._read_int(chip_id, attr) or 0
                enable = self._read_int(chip_id, f"pwm{idx}_enable")
                pwms.append(
                    PwmChannel(
                        key=f"pwm{idx}",
                        label=f"Fan {idx}",
                        raw=raw,
                        enable=enable if enable is not None else PWM_AUTOMATIC,
                        fan=fans.get(idx),
                    )
                )

        return Chip(
            id=chip_id,
            name=name,
            temps=temps,
            fans=list(fans.values()),
            pwms=pwms,
        )

    def read_all(self) -> list[Chip]:
        return [self.read_chip(cid) for cid in self.backend.chip_ids()]


class SysfsBackend(HwmonBackend):
    """The real thing: reads and writes ``/sys/class/hwmon``."""

    def __init__(self, base: str = "/sys/class/hwmon"):
        self.base = base

    def chip_ids(self) -> list[str]:
        return sorted(glob.glob(os.path.join(self.base, "hwmon*")))

    def attrs(self, chip: str) -> list[str]:
        try:
            return os.listdir(chip)
        except OSError:
            return []

    def read(self, chip: str, attr: str) -> str | None:
        path = os.path.join(chip, attr)
        try:
            with open(path, "r") as fh:
                return fh.read()
        except (OSError, UnicodeDecodeError):
            return None

    def write(self, chip: str, attr: str, value: str) -> None:
        path = os.path.join(chip, attr)
        try:
            with open(path, "w") as fh:
                fh.write(value)
        except OSError as exc:  # typically EACCES without root
            raise HwmonError(f"could not write {path}: {exc}") from exc

    def writable(self, chip: str, attr: str) -> bool:
        return os.access(os.path.join(chip, attr), os.W_OK)


class SimulatedBackend(HwmonBackend):
    """An in-memory fake that behaves like a laptop with two fans.

    The simulation runs a crude thermal model: each virtual fan removes heat
    in proportion to its PWM duty cycle, while the CPU/GPU inject heat. Call
    :meth:`tick` on a timer and the temperatures and RPMs move in a way that
    feels real, which is perfect for demos, screenshots and tests.
    """

    AMBIENT = 24.0

    def __init__(self, seed_temp: float = 45.0):
        # attribute store: {chip_id: {attr: raw string value}}
        self._store: dict[str, dict[str, str]] = {}
        self._max_rpm = {"pwm1": 3200, "pwm2": 2600}
        self._temps = {"cpu": seed_temp, "gpu": seed_temp - 3}
        # Steady heat load (arbitrary units) and how much airflow it takes to
        # shed it. Tuned so idle-with-no-fan runs hot and full-fan runs cool.
        self._heat = {"cpu": 950.0, "gpu": 780.0}
        self._elapsed = 0.0
        self._build()
        self.tick(0.0)

    def _build(self) -> None:
        chip = "sim/hwmon0"
        self._store[chip] = {
            "name": "coolcontrol-sim",
            "temp1_input": "45000",
            "temp1_label": "CPU Package",
            "temp2_input": "42000",
            "temp2_label": "GPU",
            "temp3_input": "38000",
            "temp3_label": "Motherboard",
            "fan1_input": "1500",
            "fan1_label": "CPU Fan",
            "fan2_input": "1200",
            "fan2_label": "System Fan",
            "pwm1": "128",
            "pwm1_enable": str(PWM_AUTOMATIC),
            "pwm2": "110",
            "pwm2_enable": str(PWM_AUTOMATIC),
        }

    # -- backend interface -------------------------------------------------
    def chip_ids(self) -> list[str]:
        return list(self._store)

    def attrs(self, chip: str) -> list[str]:
        return list(self._store.get(chip, {}))

    def read(self, chip: str, attr: str) -> str | None:
        return self._store.get(chip, {}).get(attr)

    def write(self, chip: str, attr: str, value: str) -> None:
        if chip not in self._store:
            raise HwmonError(f"no such chip {chip}")
        self._store[chip][attr] = str(value).strip()

    def writable(self, chip: str, attr: str) -> bool:
        return True

    # -- simulation --------------------------------------------------------
    def tick(self, dt: float = 1.0) -> None:
        """Advance the thermal model by ``dt`` seconds."""
        chip = "sim/hwmon0"
        store = self._store[chip]

        duties = {}
        for pwm_key, max_rpm in self._max_rpm.items():
            raw = int(store.get(pwm_key, "0"))
            enable = int(store.get(f"{pwm_key}_enable", str(PWM_AUTOMATIC)))
            if enable == PWM_AUTOMATIC:
                # Firmware mode: chase a gentle curve off the CPU temperature.
                target = self._auto_duty(self._temps["cpu"])
                raw = round(target / 100 * 255)
                store[pwm_key] = str(raw)
            duties[pwm_key] = raw / 255

        # Fan RPM follows the duty cycle with a small idle floor.
        store["fan1_input"] = str(int(300 + duties["pwm1"] * self._max_rpm["pwm1"]))
        store["fan2_input"] = str(int(250 + duties["pwm2"] * self._max_rpm["pwm2"]))

        self._elapsed += dt
        # A gentle load wobble keeps demos and screenshots looking alive
        # without making the equilibrium unpredictable for tests.
        wobble = 40 * math.sin(self._elapsed / 12)

        # Newton-style cooling. Equilibrium temperature is
        #   T_eq = AMBIENT + heat / (k_passive + k_fan * duty)
        # so more airflow (higher duty) pulls the steady-state temperature
        # down, and a stalled fan lets the chip heat up.
        self._temps["cpu"] = self._step_temp(
            self._temps["cpu"], self._heat["cpu"] + wobble, duties["pwm1"], dt,
            k_passive=10.0, k_fan=42.0,
        )
        self._temps["gpu"] = self._step_temp(
            self._temps["gpu"], self._heat["gpu"] + wobble * 0.6, duties["pwm2"], dt,
            k_passive=9.0, k_fan=36.0,
        )

        store["temp1_input"] = str(int(self._temps["cpu"] * 1000))
        store["temp2_input"] = str(int(self._temps["gpu"] * 1000))
        store["temp3_input"] = str(int((self._temps["cpu"] + self._temps["gpu"]) / 2 * 1000 - 6000))

    def _step_temp(
        self, temp: float, heat: float, duty: float, dt: float,
        k_passive: float, k_fan: float, thermal_mass: float = 180.0,
    ) -> float:
        cooling = (k_passive + k_fan * duty) * (temp - self.AMBIENT)
        temp += (heat - cooling) / thermal_mass * dt
        return max(self.AMBIENT + 4, min(98.0, temp))

    @staticmethod
    def _auto_duty(temp: float) -> float:
        if temp <= 40:
            return 25
        if temp >= 85:
            return 100
        return 25 + (temp - 40) / 45 * 75


def default_backend() -> HwmonBackend:
    """Pick a real backend if hwmon exists, otherwise simulate.

    This is what lets the app "just run" on a workstation, in a container, or
    on a machine whose fans are not exposed to userspace.
    """
    base = "/sys/class/hwmon"
    if os.path.isdir(base) and glob.glob(os.path.join(base, "hwmon*")):
        return SysfsBackend(base)
    return SimulatedBackend()


def has_controllable_hardware(backend: HwmonBackend | None = None) -> bool:
    backend = backend or SysfsBackend()
    reader = HwmonReader(backend)
    return any(chip.controllable for chip in reader.read_all())
