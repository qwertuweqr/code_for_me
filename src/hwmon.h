// Talking to the Linux hardware monitoring subsystem (hwmon).
//
// Fan controllers, temperature sensors and PWM outputs are exposed as tiny
// text files under /sys/class/hwmon/hwmonN/. Reading a fan's speed is
// `cat fan1_input`; making a fan quieter is `echo 120 > pwm1` (after
// `echo 1 > pwm1_enable`).
//
// A small backend interface hides those files so the rest of the app never
// touches /sys directly. That indirection buys us a SimulatedBackend that
// behaves like real hardware but lives in memory, so the app runs and is
// testable on any machine.
#pragma once

#include <QMap>
#include <QString>
#include <QVector>
#include <memory>
#include <optional>

#include "models.h"

namespace cc {

class HwmonBackend {
public:
    virtual ~HwmonBackend() = default;
    virtual QVector<QString> chipIds() const = 0;
    virtual QVector<QString> attrs(const QString &chip) const = 0;
    virtual std::optional<QString> read(const QString &chip, const QString &attr) const = 0;
    virtual void write(const QString &chip, const QString &attr, const QString &value) = 0;
    virtual bool writable(const QString &chip, const QString &attr) const = 0;
    virtual bool isSimulated() const { return false; }
};

// Turns a backend's flat attribute files into structured Chip objects.
class HwmonReader {
public:
    explicit HwmonReader(HwmonBackend *backend) : backend_(backend) {}
    Chip readChip(const QString &chipId) const;
    QVector<Chip> readAll() const;

private:
    std::optional<int> readInt(const QString &chip, const QString &attr) const;
    QString label(const QString &chip, const QString &prefix, int idx,
                  const QString &fallback) const;
    HwmonBackend *backend_;
};

// The real thing: reads and writes /sys/class/hwmon.
class SysfsBackend : public HwmonBackend {
public:
    explicit SysfsBackend(QString base = "/sys/class/hwmon") : base_(std::move(base)) {}
    QVector<QString> chipIds() const override;
    QVector<QString> attrs(const QString &chip) const override;
    std::optional<QString> read(const QString &chip, const QString &attr) const override;
    void write(const QString &chip, const QString &attr, const QString &value) override;
    bool writable(const QString &chip, const QString &attr) const override;

private:
    QString base_;
};

// An in-memory fake that behaves like a laptop with two fans. A crude thermal
// model makes temperatures and RPMs move realistically when you call tick().
class SimulatedBackend : public HwmonBackend {
public:
    explicit SimulatedBackend(double seedTemp = 45.0);
    QVector<QString> chipIds() const override;
    QVector<QString> attrs(const QString &chip) const override;
    std::optional<QString> read(const QString &chip, const QString &attr) const override;
    void write(const QString &chip, const QString &attr, const QString &value) override;
    bool writable(const QString &, const QString &) const override { return true; }
    bool isSimulated() const override { return true; }

    void tick(double dt = 1.0);

private:
    static constexpr double AMBIENT = 24.0;
    double stepTemp(double temp, double heat, double duty, double dt,
                    double kPassive, double kFan, double thermalMass = 180.0) const;
    static double autoDuty(double temp);

    QMap<QString, QMap<QString, QString>> store_;
    QMap<QString, int> maxRpm_;
    QMap<QString, double> temps_;
    QMap<QString, double> heat_;
    double elapsed_ = 0.0;
};

// Pick a real backend if hwmon exists, otherwise simulate. This is what lets
// the app "just run" on a workstation, in a container, or on a machine whose
// fans are not exposed to userspace.
std::unique_ptr<HwmonBackend> defaultBackend();

}  // namespace cc
