#include "hwmon.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>
#include <QTextStream>
#include <algorithm>
#include <cmath>

namespace cc {

static int indexOf(const QString &attr) {
    static const QRegularExpression re("(temp|fan|pwm)(\\d+)");
    auto m = re.match(attr);
    return m.hasMatch() ? m.captured(2).toInt() : 0;
}

// -- HwmonReader ----------------------------------------------------------
std::optional<int> HwmonReader::readInt(const QString &chip, const QString &attr) const {
    auto raw = backend_->read(chip, attr);
    if (!raw) return std::nullopt;
    bool ok = false;
    int v = raw->trimmed().toInt(&ok);
    if (!ok) return std::nullopt;
    return v;
}

QString HwmonReader::label(const QString &chip, const QString &prefix, int idx,
                           const QString &fallback) const {
    auto raw = backend_->read(chip, QString("%1%2_label").arg(prefix).arg(idx));
    return raw ? raw->trimmed() : fallback;
}

Chip HwmonReader::readChip(const QString &chipId) const {
    QVector<QString> attrs = backend_->attrs(chipId);
    std::sort(attrs.begin(), attrs.end());

    Chip chip;
    chip.id = chipId;
    auto name = backend_->read(chipId, "name");
    chip.name = name ? name->trimmed() : QStringLiteral("hwmon");

    QMap<int, Fan> fans;
    for (const QString &attr : attrs) {
        if (attr.startsWith("temp") && attr.endsWith("_input")) {
            int idx = indexOf(attr);
            auto milli = readInt(chipId, attr);
            if (!milli) continue;
            chip.temps.push_back(TempSensor{
                QString("temp%1").arg(idx),
                label(chipId, "temp", idx, QString("temp%1").arg(idx)),
                std::round(*milli / 1000.0 * 10.0) / 10.0});
        } else if (attr.startsWith("fan") && attr.endsWith("_input")) {
            int idx = indexOf(attr);
            int rpm = readInt(chipId, attr).value_or(0);
            fans.insert(idx, Fan{QString("fan%1").arg(idx),
                                 label(chipId, "fan", idx, QString("fan%1").arg(idx)),
                                 rpm});
        }
    }

    static const QRegularExpression pwmRe("^pwm\\d+$");
    for (const QString &attr : attrs) {
        if (!pwmRe.match(attr).hasMatch()) continue;
        int idx = indexOf(attr);
        int raw = readInt(chipId, attr).value_or(0);
        auto enable = readInt(chipId, QString("pwm%1_enable").arg(idx));
        PwmChannel pwm;
        pwm.key = QString("pwm%1").arg(idx);
        pwm.label = QString("Fan %1").arg(idx);
        pwm.raw = raw;
        pwm.enable = enable.value_or(PWM_AUTOMATIC);
        if (fans.contains(idx)) pwm.fan = fans.value(idx);
        chip.pwms.push_back(pwm);
    }
    const QList<Fan> fanList = fans.values();
    chip.fans = QVector<Fan>(fanList.begin(), fanList.end());
    return chip;
}

QVector<Chip> HwmonReader::readAll() const {
    QVector<Chip> out;
    for (const QString &id : backend_->chipIds()) out.push_back(readChip(id));
    return out;
}

// -- SysfsBackend ---------------------------------------------------------
QVector<QString> SysfsBackend::chipIds() const {
    QVector<QString> out;
    QDir dir(base_);
    const auto entries = dir.entryList(QStringList{"hwmon*"}, QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QString &e : entries) out.push_back(dir.absoluteFilePath(e));
    std::sort(out.begin(), out.end());
    return out;
}

QVector<QString> SysfsBackend::attrs(const QString &chip) const {
    QVector<QString> out;
    QDir dir(chip);
    for (const QString &e : dir.entryList(QDir::Files | QDir::System)) out.push_back(e);
    return out;
}

std::optional<QString> SysfsBackend::read(const QString &chip, const QString &attr) const {
    QFile f(QDir(chip).absoluteFilePath(attr));
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) return std::nullopt;
    return QString::fromUtf8(f.readAll());
}

void SysfsBackend::write(const QString &chip, const QString &attr, const QString &value) {
    QFile f(QDir(chip).absoluteFilePath(attr));
    if (!f.open(QIODevice::WriteOnly | QIODevice::Text)) return;  // typically EACCES
    f.write(value.toUtf8());
}

bool SysfsBackend::writable(const QString &chip, const QString &attr) const {
    return QFileInfo(QDir(chip).absoluteFilePath(attr)).isWritable();
}

// -- SimulatedBackend -----------------------------------------------------
SimulatedBackend::SimulatedBackend(double seedTemp) {
    maxRpm_ = {{"pwm1", 3200}, {"pwm2", 2600}};
    temps_ = {{"cpu", seedTemp}, {"gpu", seedTemp - 3}};
    heat_ = {{"cpu", 950.0}, {"gpu", 780.0}};

    QMap<QString, QString> chip;
    chip["name"] = "coolcontrol-sim";
    chip["temp1_input"] = "45000";
    chip["temp1_label"] = "CPU Package";
    chip["temp2_input"] = "42000";
    chip["temp2_label"] = "GPU";
    chip["temp3_input"] = "38000";
    chip["temp3_label"] = "Motherboard";
    chip["fan1_input"] = "1500";
    chip["fan1_label"] = "CPU Fan";
    chip["fan2_input"] = "1200";
    chip["fan2_label"] = "System Fan";
    chip["pwm1"] = "128";
    chip["pwm1_enable"] = QString::number(PWM_AUTOMATIC);
    chip["pwm2"] = "110";
    chip["pwm2_enable"] = QString::number(PWM_AUTOMATIC);
    store_["sim/hwmon0"] = chip;
    tick(0.0);
}

QVector<QString> SimulatedBackend::chipIds() const {
    const QList<QString> keys = store_.keys();
    return QVector<QString>(keys.begin(), keys.end());
}

QVector<QString> SimulatedBackend::attrs(const QString &chip) const {
    if (!store_.contains(chip)) return {};
    const auto keys = store_[chip].keys();
    return QVector<QString>(keys.begin(), keys.end());
}

std::optional<QString> SimulatedBackend::read(const QString &chip, const QString &attr) const {
    if (!store_.contains(chip) || !store_[chip].contains(attr)) return std::nullopt;
    return store_[chip][attr];
}

void SimulatedBackend::write(const QString &chip, const QString &attr, const QString &value) {
    if (!store_.contains(chip)) return;
    store_[chip][attr] = value.trimmed();
}

double SimulatedBackend::autoDuty(double temp) {
    if (temp <= 40) return 25;
    if (temp >= 85) return 100;
    return 25 + (temp - 40) / 45 * 75;
}

double SimulatedBackend::stepTemp(double temp, double heat, double duty, double dt,
                                  double kPassive, double kFan, double thermalMass) const {
    double cooling = (kPassive + kFan * duty) * (temp - AMBIENT);
    temp += (heat - cooling) / thermalMass * dt;
    return std::clamp(temp, AMBIENT + 4, 98.0);
}

void SimulatedBackend::tick(double dt) {
    const QString c = "sim/hwmon0";
    auto &store = store_[c];

    QMap<QString, double> duties;
    for (auto it = maxRpm_.constBegin(); it != maxRpm_.constEnd(); ++it) {
        const QString &pwmKey = it.key();
        int raw = store.value(pwmKey, "0").toInt();
        int enable = store.value(pwmKey + "_enable", QString::number(PWM_AUTOMATIC)).toInt();
        if (enable == PWM_AUTOMATIC) {
            double target = autoDuty(temps_["cpu"]);
            raw = static_cast<int>(std::lround(target / 100.0 * 255));
            store[pwmKey] = QString::number(raw);
        }
        duties[pwmKey] = raw / 255.0;
    }

    store["fan1_input"] = QString::number(static_cast<int>(300 + duties["pwm1"] * maxRpm_["pwm1"]));
    store["fan2_input"] = QString::number(static_cast<int>(250 + duties["pwm2"] * maxRpm_["pwm2"]));

    elapsed_ += dt;
    double wobble = 40 * std::sin(elapsed_ / 12);

    temps_["cpu"] = stepTemp(temps_["cpu"], heat_["cpu"] + wobble, duties["pwm1"], dt, 10.0, 42.0);
    temps_["gpu"] = stepTemp(temps_["gpu"], heat_["gpu"] + wobble * 0.6, duties["pwm2"], dt, 9.0, 36.0);

    store["temp1_input"] = QString::number(static_cast<int>(temps_["cpu"] * 1000));
    store["temp2_input"] = QString::number(static_cast<int>(temps_["gpu"] * 1000));
    store["temp3_input"] =
        QString::number(static_cast<int>((temps_["cpu"] + temps_["gpu"]) / 2 * 1000 - 6000));
}

std::unique_ptr<HwmonBackend> defaultBackend() {
    QDir dir("/sys/class/hwmon");
    if (dir.exists() && !dir.entryList(QStringList{"hwmon*"}, QDir::Dirs | QDir::NoDotAndDotDot).isEmpty()) {
        return std::make_unique<SysfsBackend>();
    }
    return std::make_unique<SimulatedBackend>();
}

}  // namespace cc
