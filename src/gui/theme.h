// A small, self-contained dark theme for the GUI. Keeping the palette and
// stylesheet in one place means the widgets stay free of hard-coded colours
// and the whole look can be retuned here.
#pragma once

#include <QColor>
#include <QString>

namespace cc {
namespace theme {

// Backgrounds, from deepest to most raised surface.
inline const QString bg = "#0e1017";
inline const QString panel = "#161925";
inline const QString card = "#1d2131";
inline const QString cardHi = "#242942";
inline const QString border = "#2b3145";

// Text.
inline const QString text = "#e7eaf3";
inline const QString muted = "#8b91a7";

// Brand + status accents.
inline const QString accent = "#5b8cff";
inline const QString accentSoft = "#38406a";
inline const QString good = "#45d0a8";
inline const QString warn = "#ffb454";
inline const QString danger = "#ff5c7c";

// Green when cool, amber when warm, red when hot.
inline QColor tempColor(double celsius) {
    if (celsius < 55) return QColor(good);
    if (celsius < 75) return QColor(warn);
    return QColor(danger);
}

QString stylesheet();

}  // namespace theme
}  // namespace cc
