"""Persisting user presets and per-channel curves to disk.

Configuration lives at ``$XDG_CONFIG_HOME/coolcontrol/config.json`` (falling
back to ``~/.config``). We store custom fan curves and the last selected
preset so the app comes back the way the user left it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

from .curve import BUILTIN_CURVES, FanCurve


def config_dir() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "coolcontrol")


def config_path() -> str:
    return os.path.join(config_dir(), "config.json")


@dataclass
class AppConfig:
    active_preset: str = "Balanced"
    poll_interval: float = 2.0  # seconds between control-loop ticks
    curves: dict[str, FanCurve] = field(default_factory=dict)

    def all_curves(self) -> dict[str, FanCurve]:
        """Built-in curves overlaid with the user's custom ones."""
        merged = dict(BUILTIN_CURVES)
        merged.update(self.curves)
        return merged

    # -- serialisation -----------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "active_preset": self.active_preset,
            "poll_interval": self.poll_interval,
            "curves": {name: c.to_list() for name, c in self.curves.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AppConfig":
        curves = {
            name: FanCurve.from_list(pts)
            for name, pts in (data.get("curves") or {}).items()
        }
        return cls(
            active_preset=data.get("active_preset", "Balanced"),
            poll_interval=float(data.get("poll_interval", 2.0)),
            curves=curves,
        )


def load_config(path: str | None = None) -> AppConfig:
    path = path or config_path()
    try:
        with open(path, "r") as fh:
            return AppConfig.from_dict(json.load(fh))
    except (OSError, ValueError):
        return AppConfig()


def save_config(config: AppConfig, path: str | None = None) -> None:
    path = path or config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(config.to_dict(), fh, indent=2)
