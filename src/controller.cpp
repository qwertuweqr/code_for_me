#include "controller.h"

namespace cc {

QVector<Chip> FanController::controllableChips() const {
    QVector<Chip> out;
    for (const Chip &c : reader_.readAll()) {
        if (c.controllable()) out.push_back(c);
    }
    return out;
}

std::optional<PwmChannel> FanController::findChannel(const QString &chipId,
                                                     const QString &pwmKey) const {
    Chip chip = reader_.readChip(chipId);
    for (const PwmChannel &pwm : chip.pwms) {
        if (pwm.key == pwmKey) return pwm;
    }
    return std::nullopt;
}

void FanController::ensureManual(const QString &chipId, const QString &pwmKey) {
    const QString enableAttr = pwmKey + "_enable";
    auto current = backend_->read(chipId, enableAttr);
    if (!current || current->trimmed().toInt() != PWM_MANUAL) {
        backend_->write(chipId, enableAttr, QString::number(PWM_MANUAL));
    }
}

void FanController::setSpeed(const QString &chipId, const QString &pwmKey, double percent) {
    ensureManual(chipId, pwmKey);
    backend_->write(chipId, pwmKey, QString::number(PwmChannel::percentToRaw(percent)));
}

void FanController::setAutomatic(const QString &chipId, const QString &pwmKey) {
    backend_->write(chipId, pwmKey + "_enable", QString::number(PWM_AUTOMATIC));
    bindings_.remove(bindingId(chipId, pwmKey));
}

void FanController::bindCurve(const QString &chipId, const QString &pwmKey,
                              const FanCurve &curve, const QString &tempKey) {
    QString tk = tempKey;
    if (tk.isEmpty()) {
        Chip chip = reader_.readChip(chipId);
        if (auto h = chip.hottest()) tk = h->key;
    }
    ChannelBinding b;
    b.chipId = chipId;
    b.pwmKey = pwmKey;
    b.curve = curve;
    b.tempKey = tk;
    b.hasCurve = true;
    bindings_.insert(bindingId(chipId, pwmKey), b);
}

std::optional<double> FanController::tempFor(const Chip &chip, const QString &tempKey) {
    if (!tempKey.isEmpty()) {
        for (const TempSensor &t : chip.temps) {
            if (t.key == tempKey) return t.celsius;
        }
    }
    if (auto h = chip.hottest()) return h->celsius;
    return std::nullopt;
}

void FanController::tick() {
    for (const ChannelBinding &b : bindings_.values()) {
        if (!b.hasCurve) continue;
        Chip chip = reader_.readChip(b.chipId);
        auto temp = tempFor(chip, b.tempKey);
        if (!temp) continue;
        setSpeed(b.chipId, b.pwmKey, b.curve.speedAt(*temp));
    }
}

void FanController::applyPreset(const QString &name, const QMap<QString, FanCurve> &curves) {
    if (name == "Auto") {
        for (const Chip &chip : controllableChips()) {
            for (const PwmChannel &pwm : chip.pwms) setAutomatic(chip.id, pwm.key);
        }
        activePreset_ = "Auto";
        return;
    }
    if (!curves.contains(name)) return;  // unknown preset: no-op
    for (const Chip &chip : controllableChips()) {
        for (const PwmChannel &pwm : chip.pwms) bindCurve(chip.id, pwm.key, curves.value(name));
    }
    activePreset_ = name;
    tick();
}

void FanController::restoreAllAutomatic() {
    for (const Chip &chip : controllableChips()) {
        for (const PwmChannel &pwm : chip.pwms) setAutomatic(chip.id, pwm.key);
    }
    bindings_.clear();
    activePreset_ = "Auto";
}

}  // namespace cc
