#include "config.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>

namespace cc {

QMap<QString, FanCurve> AppConfig::allCurves() const {
    QMap<QString, FanCurve> merged = builtinCurves();
    for (auto it = curves.constBegin(); it != curves.constEnd(); ++it) {
        merged.insert(it.key(), it.value());
    }
    return merged;
}

QString configDir() {
    QString base = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (base.isEmpty()) base = QDir::homePath() + "/.config";
    return base + "/coolcontrol";
}

QString configPath() { return configDir() + "/config.json"; }

AppConfig loadConfig(const QString &path) {
    const QString p = path.isEmpty() ? configPath() : path;
    QFile f(p);
    if (!f.open(QIODevice::ReadOnly)) return AppConfig();
    QJsonDocument doc = QJsonDocument::fromJson(f.readAll());
    if (!doc.isObject()) return AppConfig();
    QJsonObject o = doc.object();

    AppConfig cfg;
    cfg.activePreset = o.value("active_preset").toString("Balanced");
    cfg.pollInterval = o.value("poll_interval").toDouble(2.0);
    QJsonObject curves = o.value("curves").toObject();
    for (auto it = curves.constBegin(); it != curves.constEnd(); ++it) {
        cfg.curves.insert(it.key(), FanCurve::fromJson(it.value().toArray()));
    }
    return cfg;
}

void saveConfig(const AppConfig &config, const QString &path) {
    const QString p = path.isEmpty() ? configPath() : path;
    QDir().mkpath(QFileInfo(p).absolutePath());

    QJsonObject curves;
    for (auto it = config.curves.constBegin(); it != config.curves.constEnd(); ++it) {
        curves.insert(it.key(), it.value().toJson());
    }
    QJsonObject o;
    o.insert("active_preset", config.activePreset);
    o.insert("poll_interval", config.pollInterval);
    o.insert("curves", curves);

    QFile f(p);
    if (f.open(QIODevice::WriteOnly)) {
        f.write(QJsonDocument(o).toJson(QJsonDocument::Indented));
    }
}

}  // namespace cc
