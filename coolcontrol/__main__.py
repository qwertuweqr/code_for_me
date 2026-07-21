"""``python -m coolcontrol`` launches the GUI."""

from __future__ import annotations

import sys

from .gui import run

if __name__ == "__main__":
    sys.exit(run())
