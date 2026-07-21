// An interactive temperature -> speed graph with draggable points.
//   * drag a point to reshape the curve,
//   * double-click empty space to add a point,
//   * right-click a point to remove it.
// Emits curveChanged whenever the user edits the curve.
#pragma once

#include <QPointF>
#include <QWidget>

#include "curve.h"

namespace cc {

class CurveEditor : public QWidget {
    Q_OBJECT
public:
    explicit CurveEditor(const FanCurve &curve, QWidget *parent = nullptr);

    void setCurve(const FanCurve &curve);
    void setMarker(double temp);   // vertical marker at current temperature
    void clearMarker();

signals:
    void curveChanged(const FanCurve &curve);

protected:
    void paintEvent(QPaintEvent *) override;
    void mousePressEvent(QMouseEvent *) override;
    void mouseMoveEvent(QMouseEvent *) override;
    void mouseReleaseEvent(QMouseEvent *) override;
    void mouseDoubleClickEvent(QMouseEvent *) override;

private:
    static constexpr double T_MIN = 20.0, T_MAX = 100.0;
    static constexpr double S_MIN = 0.0, S_MAX = 100.0;

    QRectF plotRect() const;
    QPointF toPx(double temp, double speed) const;
    void fromPx(const QPointF &pos, double &temp, double &speed) const;
    int nearest(const QPointF &pos, double tol = 14.0) const;
    void commit(const FanCurve &curve);

    FanCurve curve_;
    int dragIndex_ = -1;
    bool hasMarker_ = false;
    double markerTemp_ = 0.0;
};

}  // namespace cc
