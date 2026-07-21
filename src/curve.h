// Fan curves: the mapping from temperature to fan speed.
//
// A fan curve answers one question: given the current temperature, how fast
// should the fan spin? We model it as sorted control points and interpolate
// linearly between them, clamping at the ends so a cold boot never asks for a
// negative fan speed.
#pragma once

#include <QJsonArray>
#include <QMap>
#include <QString>
#include <QVector>

namespace cc {

struct CurvePoint {
    double temp = 0.0;   // degrees Celsius
    double speed = 0.0;  // fan speed in percent (0-100)

    bool operator==(const CurvePoint &o) const {
        return temp == o.temp && speed == o.speed;
    }
};

class FanCurve {
public:
    FanCurve() = default;
    explicit FanCurve(const QVector<CurvePoint> &points);

    const QVector<CurvePoint> &points() const { return points_; }

    // Interpolated fan speed (percent) for a temperature.
    double speedAt(double temp) const;

    FanCurve withPoint(const CurvePoint &point) const;
    FanCurve withoutPoint(int index) const;

    QJsonArray toJson() const;
    static FanCurve fromJson(const QJsonArray &array);

    bool operator==(const FanCurve &o) const { return points_ == o.points_; }
    bool isEmpty() const { return points_.isEmpty(); }

private:
    static QVector<CurvePoint> normalise(const QVector<CurvePoint> &points);
    QVector<CurvePoint> points_;
};

// Sensible built-in curves. Percentages are conservative so that "Silent" is
// genuinely quiet and "Performance" ramps early to keep temperatures down.
const QMap<QString, FanCurve> &builtinCurves();

}  // namespace cc
