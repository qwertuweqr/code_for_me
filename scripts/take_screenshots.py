"""Render CoolControl to PNG files without a display.

Qt's ``offscreen`` platform plugin lets us build the real window, lay it out
and grab it to an image on a headless machine (CI, a container, a server).
That is exactly how the screenshots in the README and the pull request were
produced - they are the genuine UI, not mockups.

Usage:
    QT_QPA_PLATFORM=offscreen python scripts/take_screenshots.py [outdir]
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt6.QtWidgets import QApplication  # noqa: E402

from coolcontrol.gui.app import MainWindow  # noqa: E402
from coolcontrol.hwmon import SimulatedBackend  # noqa: E402


def _grab(app: QApplication, widget, path: str) -> None:
    for _ in range(4):
        app.processEvents()
    pixmap = widget.grab()
    pixmap.save(path)
    print(f"wrote {path} ({pixmap.width()}x{pixmap.height()})")


def main() -> int:
    outdir = sys.argv[1] if len(sys.argv) > 1 else "assets"
    os.makedirs(outdir, exist_ok=True)

    app = QApplication(sys.argv)
    backend = SimulatedBackend(seed_temp=61.0)
    window = MainWindow(backend=backend)
    window.resize(980, 720)
    window.show()

    # Warm the simulation up and settle on the Balanced profile so the gauges
    # and temperature bars show realistic, non-zero values.
    window._apply_preset("Balanced", persist=False)
    for _ in range(6):
        backend.tick(2.0)
    window.controller.tick()
    window.refresh()

    window.tabs.setCurrentIndex(0)
    _grab(app, window, os.path.join(outdir, "dashboard.png"))

    window.tabs.setCurrentIndex(1)
    window.editor.set_marker(window.controller.chips()[0].hottest().celsius)
    _grab(app, window, os.path.join(outdir, "curves.png"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
