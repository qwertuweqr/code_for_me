"""Custom-painted widgets that give CoolControl its look.

Qt gives us buttons and sliders for free, but the pieces that make a fan
controller feel purpose-built - the circular RPM gauges, the temperature
bars and the draggable fan-curve graph - are all drawn by hand here with
``QPainter``.
"""

from __future__ import annotations

from PyQt6.QtCore import QPointF, QRectF, Qt, pyqtSignal
from PyQt6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QLinearGradient,
    QPainter,
    QPainterPath,
    QPen,
)
from PyQt6.QtWidgets import QWidget

from ..curve import CurvePoint, FanCurve
from .theme import Palette


class CircularGauge(QWidget):
    """A 260-degree arc gauge, used to show fan speed as a percentage."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._value = 0.0  # 0-100
        self._caption = "%"
        self._sub = ""
        self._color = QColor(Palette.accent)
        self.setMinimumSize(150, 150)

    def set_value(self, value: float, sub: str = "", color: str | None = None) -> None:
        self._value = max(0.0, min(100.0, value))
        self._sub = sub
        if color:
            self._color = QColor(color)
        self.update()

    def paintEvent(self, _event) -> None:  # noqa: N802 (Qt naming)
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        side = min(self.width(), self.height())
        margin = 14
        rect = QRectF(
            (self.width() - side) / 2 + margin,
            (self.height() - side) / 2 + margin,
            side - 2 * margin,
            side - 2 * margin,
        )

        start_angle = 230 * 16  # Qt angles are in 1/16 degrees
        span = -280 * 16

        # Track.
        pen = QPen(QColor(Palette.card_hi), 12)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.drawArc(rect, start_angle, span)

        # Value arc.
        pen.setColor(self._color)
        p.setPen(pen)
        p.drawArc(rect, start_angle, int(span * self._value / 100))

        # Centre text.
        p.setPen(QColor(Palette.text))
        f = QFont(self.font())
        f.setPointSize(max(14, int(side / 7)))
        f.setBold(True)
        p.setFont(f)
        p.drawText(rect, Qt.AlignmentFlag.AlignCenter, f"{self._value:.0f}%")

        if self._sub:
            p.setPen(QColor(Palette.muted))
            fs = QFont(self.font())
            fs.setPointSize(max(8, int(side / 16)))
            p.setFont(fs)
            sub_rect = QRectF(rect)
            sub_rect.translate(0, side / 4.2)
            p.drawText(sub_rect, Qt.AlignmentFlag.AlignCenter, self._sub)
        p.end()


class TempBar(QWidget):
    """A labelled horizontal bar whose fill colour tracks the temperature."""

    def __init__(self, label: str, parent: QWidget | None = None):
        super().__init__(parent)
        self._label = label
        self._celsius = 0.0
        self._max = 100.0
        self.setMinimumHeight(46)

    def set_value(self, celsius: float) -> None:
        self._celsius = celsius
        self.update()

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        w = self.width()

        p.setPen(QColor(Palette.muted))
        f = QFont(self.font())
        f.setPointSize(10)
        p.setFont(f)
        p.drawText(QRectF(2, 0, w - 60, 18), Qt.AlignmentFlag.AlignVCenter, self._label)

        p.setPen(QColor(Palette.text))
        fb = QFont(self.font())
        fb.setPointSize(11)
        fb.setBold(True)
        p.setFont(fb)
        p.drawText(
            QRectF(w - 60, 0, 58, 18),
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
            f"{self._celsius:.0f}\u00b0C",
        )

        track = QRectF(2, 24, w - 4, 10)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(Palette.card_hi))
        p.drawRoundedRect(track, 5, 5)

        frac = max(0.0, min(1.0, self._celsius / self._max))
        fill = QRectF(track)
        fill.setWidth(track.width() * frac)
        p.setBrush(QColor(Palette.temp_color(self._celsius)))
        p.drawRoundedRect(fill, 5, 5)
        p.end()


class CurveEditor(QWidget):
    """An interactive temperature -> speed graph with draggable points.

    * drag a point to reshape the curve,
    * double-click empty space to add a point,
    * right-click a point to remove it.

    Emits :attr:`curveChanged` whenever the user edits the curve.
    """

    curveChanged = pyqtSignal(object)  # emits a FanCurve

    T_MIN, T_MAX = 20.0, 100.0
    S_MIN, S_MAX = 0.0, 100.0

    def __init__(self, curve: FanCurve, parent: QWidget | None = None):
        super().__init__(parent)
        self._curve = curve
        self._points = curve.points
        self._drag_index: int | None = None
        self._marker_temp: float | None = None
        self.setMinimumSize(360, 260)
        self.setMouseTracking(True)

    def set_curve(self, curve: FanCurve) -> None:
        self._curve = curve
        self._points = curve.points
        self.update()

    def set_marker(self, temp: float | None) -> None:
        """Draw a vertical marker at the current temperature."""
        self._marker_temp = temp
        self.update()

    # -- coordinate helpers ------------------------------------------------
    def _plot_rect(self) -> QRectF:
        return QRectF(46, 14, self.width() - 60, self.height() - 46)

    def _to_px(self, temp: float, speed: float) -> QPointF:
        r = self._plot_rect()
        x = r.left() + (temp - self.T_MIN) / (self.T_MAX - self.T_MIN) * r.width()
        y = r.bottom() - (speed - self.S_MIN) / (self.S_MAX - self.S_MIN) * r.height()
        return QPointF(x, y)

    def _from_px(self, pos: QPointF) -> tuple[float, float]:
        r = self._plot_rect()
        temp = self.T_MIN + (pos.x() - r.left()) / r.width() * (self.T_MAX - self.T_MIN)
        speed = self.S_MIN + (r.bottom() - pos.y()) / r.height() * (self.S_MAX - self.S_MIN)
        return (
            max(self.T_MIN, min(self.T_MAX, temp)),
            max(self.S_MIN, min(self.S_MAX, speed)),
        )

    # -- painting ----------------------------------------------------------
    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = self._plot_rect()

        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(Palette.bg))
        p.drawRoundedRect(QRectF(0, 0, self.width(), self.height()), 12, 12)

        # Grid + axis labels.
        grid_pen = QPen(QColor(Palette.border), 1)
        p.setFont(QFont(self.font().family(), 8))
        for frac in range(0, 101, 20):
            y = r.bottom() - frac / 100 * r.height()
            p.setPen(grid_pen)
            p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y))
            p.setPen(QColor(Palette.muted))
            p.drawText(QRectF(4, y - 8, 36, 16),
                       Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                       f"{frac}%")
        for temp in range(int(self.T_MIN), int(self.T_MAX) + 1, 20):
            x = self._to_px(temp, 0).x()
            p.setPen(grid_pen)
            p.drawLine(QPointF(x, r.top()), QPointF(x, r.bottom()))
            p.setPen(QColor(Palette.muted))
            p.drawText(QRectF(x - 20, r.bottom() + 4, 40, 16),
                       Qt.AlignmentFlag.AlignCenter, f"{temp}\u00b0")

        # Filled area under the curve.
        area = QPainterPath()
        area.moveTo(self._to_px(self._points[0].temp, 0))
        for pt in self._points:
            area.lineTo(self._to_px(pt.temp, pt.speed))
        area.lineTo(self._to_px(self._points[-1].temp, 0))
        area.closeSubpath()
        grad = QLinearGradient(0, r.top(), 0, r.bottom())
        grad.setColorAt(0, QColor(91, 140, 255, 120))
        grad.setColorAt(1, QColor(91, 140, 255, 10))
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(grad))
        p.drawPath(area)

        # Current-temperature marker.
        if self._marker_temp is not None:
            mx = self._to_px(max(self.T_MIN, min(self.T_MAX, self._marker_temp)), 0).x()
            p.setPen(QPen(QColor(Palette.good), 1, Qt.PenStyle.DashLine))
            p.drawLine(QPointF(mx, r.top()), QPointF(mx, r.bottom()))

        # Curve line.
        line = QPainterPath()
        line.moveTo(self._to_px(self._points[0].temp, self._points[0].speed))
        for pt in self._points[1:]:
            line.lineTo(self._to_px(pt.temp, pt.speed))
        p.setPen(QPen(QColor(Palette.accent), 3))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(line)

        # Control points.
        for pt in self._points:
            c = self._to_px(pt.temp, pt.speed)
            p.setPen(QPen(QColor(Palette.bg), 2))
            p.setBrush(QColor(Palette.text))
            p.drawEllipse(c, 6, 6)
        p.end()

    # -- interaction -------------------------------------------------------
    def _nearest(self, pos: QPointF, tol: float = 14.0) -> int | None:
        best, best_d = None, tol
        for i, pt in enumerate(self._points):
            d = (self._to_px(pt.temp, pt.speed) - pos).manhattanLength()
            if d < best_d:
                best, best_d = i, d
        return best

    def mousePressEvent(self, event) -> None:  # noqa: N802
        pos = event.position()
        if event.button() == Qt.MouseButton.RightButton:
            idx = self._nearest(pos)
            if idx is not None and len(self._points) > 2:
                self._commit(self._curve.without_point(idx))
            return
        self._drag_index = self._nearest(pos)

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self._drag_index is None:
            return
        temp, speed = self._from_px(event.position())
        pts = list(self._points)
        # Keep the first/last point pinned on the temperature axis so the
        # curve always spans the full range; only their speed moves.
        if self._drag_index == 0:
            temp = pts[0].temp
        elif self._drag_index == len(pts) - 1:
            temp = pts[-1].temp
        pts[self._drag_index] = CurvePoint(round(temp), round(speed))
        self._commit(FanCurve(pts))

    def mouseReleaseEvent(self, _event) -> None:  # noqa: N802
        self._drag_index = None

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        temp, speed = self._from_px(event.position())
        self._commit(self._curve.with_point(CurvePoint(round(temp), round(speed))))

    def _commit(self, curve: FanCurve) -> None:
        self._curve = curve
        self._points = curve.points
        self.update()
        self.curveChanged.emit(curve)
