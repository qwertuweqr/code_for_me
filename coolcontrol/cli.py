"""A no-dependency command line for headless machines and scripts.

Not everyone wants a window. ``coolcontrol-cli`` exposes the same controller
so you can list fans, read temperatures and set speeds from a terminal or a
systemd unit.
"""

from __future__ import annotations

import argparse
import sys

from .controller import FanController
from .curve import BUILTIN_CURVES
from .hwmon import HwmonError, SimulatedBackend, default_backend


def _make_controller(demo: bool) -> FanController:
    backend = SimulatedBackend() if demo else default_backend()
    return FanController(backend)


def cmd_list(ctrl: FanController) -> int:
    chips = ctrl.chips()
    if not chips:
        print("No hwmon chips found.")
        return 1
    for chip in chips:
        marker = "*" if chip.controllable else " "
        print(f"{marker} {chip.name}  ({chip.id})")
        for t in chip.temps:
            print(f"    temp {t.label:<16} {t.celsius:>5.1f} C")
        for pwm in chip.pwms:
            rpm = f"{pwm.fan.rpm} RPM" if pwm.fan else "no tacho"
            mode = "manual" if pwm.is_manual else "auto"
            print(f"    {pwm.key:<6} {pwm.percent:>5.0f}%  {rpm:<10} [{mode}]")
    return 0


def cmd_set(ctrl: FanController, args) -> int:
    try:
        ctrl.set_speed(args.chip, args.pwm, args.percent)
    except HwmonError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("hint: writing PWM usually needs root (try sudo).", file=sys.stderr)
        return 1
    print(f"set {args.pwm} on {args.chip} to {args.percent:.0f}%")
    return 0


def cmd_preset(ctrl: FanController, args) -> int:
    try:
        ctrl.apply_preset(args.name)
    except (KeyError, HwmonError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"applied preset {args.name}")
    return 0


def cmd_auto(ctrl: FanController) -> int:
    ctrl.restore_all_automatic()
    print("all channels returned to firmware control")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="coolcontrol-cli", description=__doc__)
    parser.add_argument("--demo", action="store_true", help="use the simulated device")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list chips, temperatures and fans")

    s = sub.add_parser("set", help="set a fan speed in percent")
    s.add_argument("chip")
    s.add_argument("pwm")
    s.add_argument("percent", type=float)

    p = sub.add_parser("preset", help="apply a preset profile")
    p.add_argument("name", choices=["Auto", *BUILTIN_CURVES.keys()])

    sub.add_parser("auto", help="hand all fans back to firmware control")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    ctrl = _make_controller(args.demo)
    if args.command == "list":
        return cmd_list(ctrl)
    if args.command == "set":
        return cmd_set(ctrl, args)
    if args.command == "preset":
        return cmd_preset(ctrl, args)
    if args.command == "auto":
        return cmd_auto(ctrl)
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
