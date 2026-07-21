// The control layer: turning intent ("make it quiet") into PWM writes.
//
// The GUI and CLI both drive this class. It knows how to switch a channel
// between firmware-automatic and userspace-manual control, set an absolute
// fan speed, and run a curve control loop that reads a temperature and writes
// the corresponding speed on every tick.
#pragma once

#include <QMap>
#include <QString>
#include <optional>

#include "curve.h"
#include "hwmon.h"
#include "models.h"

namespace cc {

struct ChannelBinding {
    QString chipId;
    QString pwmKey;
    FanCurve curve;   // empty curve => user is dragging the slider manually
    QString tempKey;  // which sensor feeds the curve
    bool hasCurve = false;
};

class FanController {
public:
    explicit FanController(HwmonBackend *backend)
        : backend_(backend), reader_(backend) {}

    QVector<Chip> chips() const { return reader_.readAll(); }
    QVector<Chip> controllableChips() const;
    std::optional<PwmChannel> findChannel(const QString &chipId, const QString &pwmKey) const;

    void setSpeed(const QString &chipId, const QString &pwmKey, double percent);
    void setAutomatic(const QString &chipId, const QString &pwmKey);

    void bindCurve(const QString &chipId, const QString &pwmKey, const FanCurve &curve,
                   const QString &tempKey = QString());
    void tick();

    void applyPreset(const QString &name, const QMap<QString, FanCurve> &curves = builtinCurves());
    void restoreAllAutomatic();

    QString activePreset() const { return activePreset_; }
    const QMap<QString, ChannelBinding> &bindings() const { return bindings_; }
    bool hasBinding(const QString &chipId, const QString &pwmKey) const {
        return bindings_.contains(bindingId(chipId, pwmKey));
    }
    void dropBinding(const QString &chipId, const QString &pwmKey) {
        bindings_.remove(bindingId(chipId, pwmKey));
    }

    static QString bindingId(const QString &chipId, const QString &pwmKey) {
        return chipId + "::" + pwmKey;
    }

private:
    void ensureManual(const QString &chipId, const QString &pwmKey);
    static std::optional<double> tempFor(const Chip &chip, const QString &tempKey);

    HwmonBackend *backend_;
    HwmonReader reader_;
    QMap<QString, ChannelBinding> bindings_;
    QString activePreset_;
};

}  // namespace cc
