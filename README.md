# CoolControl

**Управление мощностью кулеров для Linux с аккуратным дизайном.**
A fan & cooler power manager for Linux with a clean, modern GUI.

CoolControl reads your fans, temperatures and PWM outputs straight from the
Linux `hwmon` subsystem and lets you set fan speed by hand, pick a profile, or
draw a custom temperature → speed curve.

![Dashboard](assets/dashboard.png)

![Fan curve editor](assets/curves.png)

> The images above are real, unretouched renders of the app produced headlessly
> by `scripts/take_screenshots.py`.

## Features

- **Live dashboard** — circular gauges for each fan, RPM readouts and a
  temperature panel that turns amber and red as things heat up.
- **One-click profiles** — `Auto` (hand control back to firmware), `Silent`,
  `Balanced`, `Performance`.
- **Interactive fan curves** — drag points on a graph, double-click to add a
  point, right-click to remove one. Curves are applied live.
- **Manual override** — grab a slider to pin a fan at any speed.
- **Works everywhere** — if no controllable hardware is found (a VM, a
  container, a locked-down laptop), CoolControl runs against a built-in
  **simulated device** so you can still explore the UI.
- **CLI included** — `coolcontrol-cli` for headless boxes and scripts.
- **Safe by default** — on exit every channel is handed back to the firmware,
  so a closed app never leaves a fan stuck.

## How it works

On Linux, fans and temperature sensors live as small text files under
`/sys/class/hwmon/hwmonN/`:

| File            | Meaning                                   |
| --------------- | ----------------------------------------- |
| `fan1_input`    | fan speed in RPM (read-only)              |
| `temp1_input`   | temperature in milli-°C (read-only)       |
| `pwm1`          | fan duty cycle, `0`–`255` (read/write)    |
| `pwm1_enable`   | `0` full speed, `1` manual, `2` automatic |

CoolControl wraps these files behind a small backend interface
(`coolcontrol/hwmon.py`). The real `SysfsBackend` talks to `/sys`; the
`SimulatedBackend` mimics a two-fan laptop in memory, complete with a thermal
model, so the app is fully usable and testable without hardware.

## Install

```bash
# from a checkout of this repo
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

This pulls in PyQt6 and adds two entry points: `coolcontrol` (GUI) and
`coolcontrol-cli`.

## Usage

```bash
# Launch the GUI (uses real hardware if present, otherwise the simulator)
coolcontrol

# Force the built-in simulated device (great for a first look)
coolcontrol --demo
# or:  python -m coolcontrol --demo

# Headless / scripting
coolcontrol-cli --demo list
coolcontrol-cli set /sys/class/hwmon/hwmon2 pwm1 45   # 45%
coolcontrol-cli preset Silent
coolcontrol-cli auto                                  # back to firmware
```

### Permissions

Reading sensors works as a normal user. **Writing** PWM values requires root,
because `/sys/class/hwmon/*/pwm*` is root-owned. Either launch the GUI with
`pkexec coolcontrol`, or grant your user access with a udev rule
(see [`packaging/`](packaging/)).

If your fans do not expose `pwmN` files at all, load the right sensor driver
first — `sudo sensors-detect` (from `lm-sensors`) will tell you which module to
add.

## Development

```bash
pip install -e ".[dev]"
pytest                                    # run the test suite
QT_QPA_PLATFORM=offscreen python scripts/take_screenshots.py
```

The core (`models`, `hwmon`, `curve`, `controller`, `config`) has **no GUI
dependency** and is covered by unit tests. The `gui` package is a thin PyQt6
layer on top.

## License

MIT — see [`LICENSE`](LICENSE).
