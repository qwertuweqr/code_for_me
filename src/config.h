// Persisting user presets and per-channel curves to disk.
//
// Configuration lives at $XDG_CONFIG_HOME/coolcontrol/config.json (falling
// back to ~/.config). We store custom fan curves and the last selected preset
// so the app comes back the way the user left it.
#pragma once

#include <QMap>
#include <QString>

#include "curve.h"

namespace cc {

struct AppConfig {
    QString activePreset = "Balanced";
    double pollInterval = 2.0;  // seconds between control-loop ticks
    QMap<QString, FanCurve> curves;

    // Built-in curves overlaid with the user's custom ones.
    QMap<QString, FanCurve> allCurves() const;
};

QString configDir();
QString configPath();
AppConfig loadConfig(const QString &path = QString());
void saveConfig(const AppConfig &config, const QString &path = QString());

}  // namespace cc
