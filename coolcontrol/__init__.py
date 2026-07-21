"""CoolControl - a fan and cooler power manager for Linux.

The package is split into a hardware-agnostic core (``models``, ``hwmon``,
``curve``, ``controller``, ``config``) and a PyQt6 ``gui`` package. The core
has no GUI dependency, so it can be imported and tested on any machine.
"""

__version__ = "0.1.0"
