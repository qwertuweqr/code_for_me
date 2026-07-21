// Data models describing the hardware CoolControl talks to.
//
// These are plain structs carrying a snapshot of a hardware-monitoring chip
// and its channels. They contain no I/O: the backends in hwmon.h populate
// them, which keeps the models trivial to construct in tests.
#pragma once

#include <QString>
#include <QVector>
#include <algorithm>
#include <optional>

namespace cc {

// A pwmN_enable value tells the kernel who is in charge of a fan channel.
// "manual" is always 1 and "no control / full speed" is always 0; values >= 2
// are driver-defined automatic modes.
constexpr int PWM_DISABLED = 0;   // fan runs at full speed, ignored by driver
constexpr int PWM_MANUAL = 1;     // userspace sets pwmN directly
constexpr int PWM_AUTOMATIC = 2;  // the firmware/driver controls the fan

constexpr int PWM_RAW_MAX = 255;

struct TempSensor {
    QString key;    // e.g. "temp1"
    QString label;  // human friendly, e.g. "CPU"
    double celsius = 0.0;
};

struct Fan {
    QString key;  // e.g. "fan1"
    QString label;
    int rpm = 0;
};

struct PwmChannel {
    QString key;    // e.g. "pwm1"
    QString label;  // e.g. "Fan 1"
    int raw = 0;    // 0-255
    int enable = PWM_AUTOMATIC;
    std::optional<Fan> fan;  // the tachometer wired to this channel, if known

    double percent() const {
        return std::round(static_cast<double>(raw) / PWM_RAW_MAX * 1000.0) / 10.0;
    }

    static int percentToRaw(double percent) {
        percent = std::clamp(percent, 0.0, 100.0);
        return static_cast<int>(std::lround(percent / 100.0 * PWM_RAW_MAX));
    }

    bool isManual() const { return enable == PWM_MANUAL; }
};

struct Chip {
    QString id;    // backend identifier (a path for sysfs)
    QString name;  // driver name, e.g. "nct6799"
    QVector<TempSensor> temps;
    QVector<Fan> fans;
    QVector<PwmChannel> pwms;

    bool controllable() const { return !pwms.isEmpty(); }

    // The warmest sensor on this chip, used as the default curve input.
    std::optional<TempSensor> hottest() const {
        if (temps.isEmpty()) return std::nullopt;
        return *std::max_element(temps.begin(), temps.end(),
                                 [](const TempSensor &a, const TempSensor &b) {
                                     return a.celsius < b.celsius;
                                 });
    }
};

}  // namespace cc
