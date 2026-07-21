"""PyQt6 front-end for CoolControl."""

from __future__ import annotations

import sys


def run(argv: list[str] | None = None) -> int:
    """Launch the GUI. Imports Qt lazily so the core stays import-light."""
    from PyQt6.QtWidgets import QApplication

    from ..hwmon import SimulatedBackend, default_backend
    from .app import MainWindow

    argv = list(argv if argv is not None else sys.argv)
    demo = "--demo" in argv
    argv = [a for a in argv if a != "--demo"]

    app = QApplication(argv)
    backend = SimulatedBackend() if demo else default_backend()
    window = MainWindow(backend=backend)
    window.show()
    return app.exec()
