#include "gui/curveeditor.h"

#include <QFont>
#include <QLinearGradient>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <algorithm>
#include <cmath>

#include "gui/theme.h"

namespace cc {

CurveEditor::CurveEditor(const FanCurve &curve, QWidget *parent)
    : QWidget(parent), curve_(curve) {
    setMinimumSize(360, 260);
    setMouseTracking(true);
}

void CurveEditor::setCurve(const FanCurve &curve) {
    curve_ = curve;
    update();
}

void CurveEditor::setMarker(double temp) {
    hasMarker_ = true;
    markerTemp_ = temp;
    update();
}

void CurveEditor::clearMarker() {
    hasMarker_ = false;
    update();
}

QRectF CurveEditor::plotRect() const {
    return QRectF(46, 14, width() - 60, height() - 46);
}

QPointF CurveEditor::toPx(double temp, double speed) const {
    QRectF r = plotRect();
    double x = r.left() + (temp - T_MIN) / (T_MAX - T_MIN) * r.width();
    double y = r.bottom() - (speed - S_MIN) / (S_MAX - S_MIN) * r.height();
    return QPointF(x, y);
}

void CurveEditor::fromPx(const QPointF &pos, double &temp, double &speed) const {
    QRectF r = plotRect();
    temp = T_MIN + (pos.x() - r.left()) / r.width() * (T_MAX - T_MIN);
    speed = S_MIN + (r.bottom() - pos.y()) / r.height() * (S_MAX - S_MIN);
    temp = std::clamp(temp, T_MIN, T_MAX);
    speed = std::clamp(speed, S_MIN, S_MAX);
}

void CurveEditor::paintEvent(QPaintEvent *) {
    const auto &pts = curve_.points();
    if (pts.isEmpty()) return;

    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    QRectF r = plotRect();

    p.setPen(Qt::NoPen);
    p.setBrush(QColor(theme::bg));
    p.drawRoundedRect(QRectF(0, 0, width(), height()), 12, 12);

    QPen gridPen(QColor(theme::border), 1);
    QFont small = font();
    small.setPointSize(8);
    p.setFont(small);
    for (int frac = 0; frac <= 100; frac += 20) {
        double y = r.bottom() - frac / 100.0 * r.height();
        p.setPen(gridPen);
        p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y));
        p.setPen(QColor(theme::muted));
        p.drawText(QRectF(4, y - 8, 36, 16), Qt::AlignRight | Qt::AlignVCenter,
                   QString::number(frac) + "%");
    }
    for (int temp = static_cast<int>(T_MIN); temp <= static_cast<int>(T_MAX); temp += 20) {
        double x = toPx(temp, 0).x();
        p.setPen(gridPen);
        p.drawLine(QPointF(x, r.top()), QPointF(x, r.bottom()));
        p.setPen(QColor(theme::muted));
        p.drawText(QRectF(x - 20, r.bottom() + 4, 40, 16), Qt::AlignCenter,
                   QString::number(temp) + QStringLiteral("\u00b0"));
    }

    // Filled area under the curve.
    QPainterPath area;
    area.moveTo(toPx(pts.first().temp, 0));
    for (const auto &pt : pts) area.lineTo(toPx(pt.temp, pt.speed));
    area.lineTo(toPx(pts.last().temp, 0));
    area.closeSubpath();
    QLinearGradient grad(0, r.top(), 0, r.bottom());
    grad.setColorAt(0, QColor(91, 140, 255, 120));
    grad.setColorAt(1, QColor(91, 140, 255, 10));
    p.setPen(Qt::NoPen);
    p.setBrush(grad);
    p.drawPath(area);

    if (hasMarker_) {
        double mx = toPx(std::clamp(markerTemp_, T_MIN, T_MAX), 0).x();
        p.setPen(QPen(QColor(theme::good), 1, Qt::DashLine));
        p.drawLine(QPointF(mx, r.top()), QPointF(mx, r.bottom()));
    }

    QPainterPath line;
    line.moveTo(toPx(pts.first().temp, pts.first().speed));
    for (int i = 1; i < pts.size(); ++i) line.lineTo(toPx(pts[i].temp, pts[i].speed));
    p.setPen(QPen(QColor(theme::accent), 3));
    p.setBrush(Qt::NoBrush);
    p.drawPath(line);

    for (const auto &pt : pts) {
        QPointF c = toPx(pt.temp, pt.speed);
        p.setPen(QPen(QColor(theme::bg), 2));
        p.setBrush(QColor(theme::text));
        p.drawEllipse(c, 6, 6);
    }
}

int CurveEditor::nearest(const QPointF &pos, double tol) const {
    int best = -1;
    double bestD = tol;
    const auto &pts = curve_.points();
    for (int i = 0; i < pts.size(); ++i) {
        QPointF d = toPx(pts[i].temp, pts[i].speed) - pos;
        double dist = std::abs(d.x()) + std::abs(d.y());
        if (dist < bestD) {
            best = i;
            bestD = dist;
        }
    }
    return best;
}

void CurveEditor::mousePressEvent(QMouseEvent *event) {
    QPointF pos = event->position();
    if (event->button() == Qt::RightButton) {
        int idx = nearest(pos);
        if (idx >= 0 && curve_.points().size() > 2) commit(curve_.withoutPoint(idx));
        return;
    }
    dragIndex_ = nearest(pos);
}

void CurveEditor::mouseMoveEvent(QMouseEvent *event) {
    if (dragIndex_ < 0) return;
    double temp, speed;
    fromPx(event->position(), temp, speed);
    QVector<CurvePoint> pts = curve_.points();
    // Pin the first/last points on the temperature axis; only their speed moves.
    if (dragIndex_ == 0) temp = pts.first().temp;
    else if (dragIndex_ == pts.size() - 1) temp = pts.last().temp;
    pts[dragIndex_] = CurvePoint{std::round(temp), std::round(speed)};
    commit(FanCurve(pts));
}

void CurveEditor::mouseReleaseEvent(QMouseEvent *) { dragIndex_ = -1; }

void CurveEditor::mouseDoubleClickEvent(QMouseEvent *event) {
    double temp, speed;
    fromPx(event->position(), temp, speed);
    commit(curve_.withPoint(CurvePoint{std::round(temp), std::round(speed)}));
}

void CurveEditor::commit(const FanCurve &curve) {
    curve_ = curve;
    update();
    emit curveChanged(curve);
}

}  // namespace cc
