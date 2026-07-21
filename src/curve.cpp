#include "curve.h"

#include <QJsonValue>
#include <algorithm>
#include <cmath>

namespace cc {

FanCurve::FanCurve(const QVector<CurvePoint> &points) : points_(normalise(points)) {}

QVector<CurvePoint> FanCurve::normalise(const QVector<CurvePoint> &points) {
    // Sort by temperature and clamp speeds into range. If two points share a
    // temperature we keep the last one, which makes the editor's "drag a point
    // onto its neighbour" gesture well defined.
    QMap<double, double> byTemp;
    for (const auto &p : points) {
        byTemp.insert(p.temp, std::clamp(p.speed, 0.0, 100.0));
    }
    QVector<CurvePoint> out;
    for (auto it = byTemp.constBegin(); it != byTemp.constEnd(); ++it) {
        out.push_back(CurvePoint{it.key(), it.value()});
    }
    return out;
}

double FanCurve::speedAt(double temp) const {
    if (points_.isEmpty()) return 0.0;
    if (temp <= points_.first().temp) return points_.first().speed;
    if (temp >= points_.last().temp) return points_.last().speed;
    for (int i = 0; i + 1 < points_.size(); ++i) {
        const CurvePoint &lo = points_[i];
        const CurvePoint &hi = points_[i + 1];
        if (lo.temp <= temp && temp <= hi.temp) {
            double span = hi.temp - lo.temp;
            if (span == 0) return hi.speed;
            double ratio = (temp - lo.temp) / span;
            double v = lo.speed + ratio * (hi.speed - lo.speed);
            return std::round(v * 10.0) / 10.0;
        }
    }
    return points_.last().speed;  // unreachable
}

FanCurve FanCurve::withPoint(const CurvePoint &point) const {
    QVector<CurvePoint> pts = points_;
    pts.push_back(point);
    return FanCurve(pts);
}

FanCurve FanCurve::withoutPoint(int index) const {
    if (points_.size() <= 1) return *this;  // a curve must keep >= 1 point
    QVector<CurvePoint> pts;
    for (int i = 0; i < points_.size(); ++i) {
        if (i != index) pts.push_back(points_[i]);
    }
    return FanCurve(pts);
}

QJsonArray FanCurve::toJson() const {
    QJsonArray arr;
    for (const auto &p : points_) {
        arr.push_back(QJsonArray{p.temp, p.speed});
    }
    return arr;
}

FanCurve FanCurve::fromJson(const QJsonArray &array) {
    QVector<CurvePoint> pts;
    for (const auto &v : array) {
        QJsonArray pair = v.toArray();
        if (pair.size() >= 2) {
            pts.push_back(CurvePoint{pair[0].toDouble(), pair[1].toDouble()});
        }
    }
    return FanCurve(pts);
}

const QMap<QString, FanCurve> &builtinCurves() {
    static const QMap<QString, FanCurve> curves = {
        {"Silent", FanCurve({{30, 0}, {50, 20}, {65, 35}, {80, 60}, {90, 100}})},
        {"Balanced", FanCurve({{30, 20}, {50, 35}, {65, 55}, {80, 80}, {90, 100}})},
        {"Performance", FanCurve({{30, 40}, {45, 60}, {60, 80}, {75, 100}})},
    };
    return curves;
}

}  // namespace cc
