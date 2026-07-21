"""The CoolControl main window.

This wires the custom widgets to a :class:`~coolcontrol.controller.FanController`.
The layout is deliberately simple: a header with preset buttons, a dashboard
of per-fan cards and temperature readouts, and a second tab holding the
fan-curve editor.
"""

from __future__ import annotations

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QSlider,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from ..config import AppConfig, load_config, save_config
from ..controller import FanController
from ..hwmon import HwmonBackend, SimulatedBackend, default_backend
from .theme import STYLESHEET, Palette
from .widgets import CircularGauge, CurveEditor, TempBar

PRESETS = ["Auto", "Silent", "Balanced", "Performance"]


class FanCard(QFrame):
    """One controllable fan: a gauge, an RPM readout and a speed slider."""

    def __init__(self, chip_id: str, pwm_key: str, title: str, parent=None):
        super().__init__(parent)
        self.chip_id = chip_id
        self.pwm_key = pwm_key
        self.setObjectName("card")
        self._on_speed = None  # callback(chip_id, pwm_key, percent)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(10)

        header = QHBoxLayout()
        self.title = QLabel(title)
        self.title.setObjectName("cardTitle")
        self.badge = QLabel("AUTO")
        self.badge.setObjectName("badgeAuto")
        self.badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.badge.setFixedHeight(22)
        self.badge.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        header.addWidget(self.title)
        header.addStretch(1)
        header.addWidget(self.badge, 0, Qt.AlignmentFlag.AlignTop)
        layout.addLayout(header)

        self.gauge = CircularGauge()
        self.gauge.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Expanding)
        layout.addWidget(self.gauge, 1, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.rpm = QLabel("-- RPM")
        self.rpm.setObjectName("muted")
        self.rpm.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.rpm)

        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(0, 100)
        self.slider.valueChanged.connect(self._slider_moved)
        layout.addWidget(self.slider)

    def bind(self, on_speed) -> None:
        self._on_speed = on_speed

    def _slider_moved(self, value: int) -> None:
        self.gauge.set_value(value)
        if self._on_speed is not None and not self.slider.signalsBlocked():
            self._on_speed(self.chip_id, self.pwm_key, float(value))

    def update_from(self, percent: float, rpm: int, mode: str) -> None:
        """``mode`` is one of "auto", "curve" or "manual"."""
        self.slider.blockSignals(True)
        self.slider.setValue(int(round(percent)))
        self.slider.blockSignals(False)
        color = {"auto": Palette.good, "curve": Palette.accent, "manual": Palette.warn}[mode]
        self.gauge.set_value(percent, sub=mode, color=color)
        self.rpm.setText(f"{rpm} RPM")
        self.badge.setText(mode.upper())
        self.badge.setObjectName({"auto": "badgeAuto", "curve": "badgeCurve", "manual": "badgeManual"}[mode])
        self.badge.style().polish(self.badge)


class MainWindow(QWidget):
    def __init__(
        self,
        backend: HwmonBackend | None = None,
        config: AppConfig | None = None,
    ):
        super().__init__()
        self.backend = backend or default_backend()
        self.config = config or load_config()
        self.controller = FanController(self.backend)
        self.cards: list[FanCard] = []

        self.setObjectName("root")
        self.setWindowTitle("CoolControl")
        self.setStyleSheet(STYLESHEET)
        self.resize(960, 720)

        self._build()
        self._populate_cards()
        self._apply_preset(self.config.active_preset, persist=False)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._on_tick)
        self.timer.start(int(self.config.poll_interval * 1000))
        self.refresh()

    # -- construction ------------------------------------------------------
    def _build(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(24, 22, 24, 20)
        outer.setSpacing(18)

        outer.addLayout(self._build_header())
        outer.addLayout(self._build_preset_bar())

        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_dashboard(), "Dashboard")
        self.tabs.addTab(self._build_curve_tab(), "Fan Curves")
        outer.addWidget(self.tabs, 1)

        self.status = QLabel("")
        self.status.setObjectName("statusText")
        outer.addWidget(self.status)

    def _build_header(self):
        row = QHBoxLayout()
        left = QVBoxLayout()
        title = QLabel("CoolControl")
        title.setObjectName("title")
        subtitle = QLabel("Fan & cooler power management for Linux")
        subtitle.setObjectName("subtitle")
        left.addWidget(title)
        left.addWidget(subtitle)
        row.addLayout(left)
        row.addStretch(1)

        self.auto_note = QLabel("")
        self.auto_note.setObjectName("muted")
        self.auto_note.setAlignment(Qt.AlignmentFlag.AlignRight)
        row.addWidget(self.auto_note)
        return row

    def _build_preset_bar(self):
        row = QHBoxLayout()
        row.setSpacing(10)
        label = QLabel("Profile")
        label.setObjectName("sectionHeading")
        row.addWidget(label)
        row.addSpacing(8)

        self.preset_group = QButtonGroup(self)
        self.preset_group.setExclusive(True)
        for name in PRESETS:
            btn = QPushButton(name)
            btn.setObjectName("preset")
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _c, n=name: self._apply_preset(n))
            self.preset_group.addButton(btn)
            row.addWidget(btn)
        row.addStretch(1)
        return row

    def _build_dashboard(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(0, 12, 0, 0)
        layout.setSpacing(18)

        self.cards_host = QWidget()
        self.cards_grid = QGridLayout(self.cards_host)
        self.cards_grid.setContentsMargins(0, 0, 0, 0)
        self.cards_grid.setSpacing(18)
        layout.addWidget(self.cards_host, 2)

        temp_panel = QFrame()
        temp_panel.setObjectName("panel")
        temp_panel.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Expanding)
        tl = QVBoxLayout(temp_panel)
        tl.setContentsMargins(18, 16, 18, 16)
        tl.setSpacing(12)
        heading = QLabel("Temperatures")
        heading.setObjectName("sectionHeading")
        tl.addWidget(heading)
        self.temp_host = QVBoxLayout()
        tl.addLayout(self.temp_host)
        tl.addStretch(1)
        self.temp_bars: dict[str, TempBar] = {}
        layout.addWidget(temp_panel, 1)
        return page

    def _build_curve_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 12, 0, 0)
        layout.setSpacing(12)

        controls = QHBoxLayout()
        controls.addWidget(QLabel("Edit curve:"))
        self.curve_selector = QComboBox()
        for name in self.config.all_curves():
            self.curve_selector.addItem(name)
        self.curve_selector.currentTextChanged.connect(self._select_curve)
        controls.addWidget(self.curve_selector)
        controls.addStretch(1)

        hint = QLabel("Drag points \u00b7 double-click to add \u00b7 right-click to remove")
        hint.setObjectName("muted")
        controls.addWidget(hint)
        layout.addLayout(controls)

        first = next(iter(self.config.all_curves().values()))
        self.editor = CurveEditor(first)
        self.editor.curveChanged.connect(self._on_curve_edited)
        layout.addWidget(self.editor, 1)
        return page

    # -- data flow ---------------------------------------------------------
    def _populate_cards(self) -> None:
        for chip in self.controller.controllable_chips():
            for pwm in chip.pwms:
                fan_label = pwm.fan.label if pwm.fan else pwm.label
                card = FanCard(chip.id, pwm.key, fan_label)
                card.bind(self._manual_speed)
                self.cards.append(card)
        for i, card in enumerate(self.cards):
            self.cards_grid.addWidget(card, i // 2, i % 2)

    def _manual_speed(self, chip_id: str, pwm_key: str, percent: float) -> None:
        # A slider drag is an explicit manual override: drop any curve binding.
        self.controller.state.bindings.pop(f"{chip_id}::{pwm_key}", None)
        self.controller.set_speed(chip_id, pwm_key, percent)
        for btn in self.preset_group.buttons():
            btn.setChecked(False)
        self.status.setText(f"Manual override: {pwm_key} \u2192 {percent:.0f}%")

    def _apply_preset(self, name: str, persist: bool = True) -> None:
        self.controller.apply_preset(name, self.config.all_curves())
        for btn in self.preset_group.buttons():
            btn.setChecked(btn.text() == name)
        if persist:
            self.config.active_preset = name
            try:
                save_config(self.config)
            except OSError:
                pass
        self.refresh()

    def _select_curve(self, name: str) -> None:
        curves = self.config.all_curves()
        if name in curves:
            self.editor.set_curve(curves[name])

    def _on_curve_edited(self, curve) -> None:
        name = self.curve_selector.currentText()
        self.config.curves[name] = curve
        # Re-apply live if this curve is the active profile.
        if self.controller.state.active_preset == name:
            self._apply_preset(name)

    def _on_tick(self) -> None:
        if isinstance(self.backend, SimulatedBackend):
            self.backend.tick(self.config.poll_interval)
        self.controller.tick()
        self.refresh()

    def refresh(self) -> None:
        chips = self.controller.chips()
        by_channel = {}
        hottest = 0.0
        for chip in chips:
            for pwm in chip.pwms:
                by_channel[(chip.id, pwm.key)] = pwm
            for t in chip.temps:
                bar = self.temp_bars.get(t.key)
                if bar is None:
                    bar = TempBar(t.label)
                    self.temp_bars[t.key] = bar
                    self.temp_host.addWidget(bar)
                bar.set_value(t.celsius)
                hottest = max(hottest, t.celsius)

        for card in self.cards:
            pwm = by_channel.get((card.chip_id, card.pwm_key))
            if pwm is None:
                continue
            binding = self.controller.state.bindings.get(f"{card.chip_id}::{card.pwm_key}")
            if binding is not None and binding.curve is not None:
                mode = "curve"
            elif pwm.is_manual:
                mode = "manual"
            else:
                mode = "auto"
            card.update_from(pwm.percent, pwm.fan.rpm if pwm.fan else 0, mode)

        self.editor.set_marker(hottest)
        kind = "Simulated device" if isinstance(self.backend, SimulatedBackend) else "hwmon"
        preset = self.controller.state.active_preset or "custom"
        self.auto_note.setText(f"{kind} \u00b7 {len(self.cards)} fans \u00b7 profile: {preset}")

    # -- lifecycle ---------------------------------------------------------
    def closeEvent(self, event) -> None:  # noqa: N802
        # Be a good citizen: hand the fans back to the firmware on exit so a
        # crashed or closed app never leaves them stuck at a fixed speed.
        try:
            self.controller.restore_all_automatic()
        except Exception:
            pass
        super().closeEvent(event)
