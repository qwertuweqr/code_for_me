#include "gui/theme.h"

namespace cc {
namespace theme {

QString stylesheet() {
    return QString(R"(
* {
    font-family: "Inter", "Segoe UI", "Ubuntu", "DejaVu Sans", sans-serif;
    color: %(text);
}
QWidget#root { background: %(bg); }
QLabel#title { font-size: 22px; font-weight: 700; }
QLabel#subtitle { color: %(muted); font-size: 13px; }
QLabel#sectionHeading { font-size: 15px; font-weight: 600; }
QFrame#card, QFrame#panel {
    background: %(card);
    border: 1px solid %(border);
    border-radius: 16px;
}
QFrame#panel { background: %(panel); }
QLabel#cardTitle { font-size: 15px; font-weight: 600; }
QLabel#muted { color: %(muted); font-size: 12px; }
QLabel#badgeCurve {
    color: #0b1020; background: %(accent);
    border-radius: 11px; padding: 2px 12px; font-size: 11px; font-weight: 700;
}
QLabel#badgeManual {
    color: #0b1020; background: %(warn);
    border-radius: 11px; padding: 2px 12px; font-size: 11px; font-weight: 700;
}
QLabel#badgeAuto {
    color: %(text); background: %(accentSoft);
    border-radius: 11px; padding: 2px 12px; font-size: 11px; font-weight: 700;
}
QPushButton#preset {
    background: %(card); border: 1px solid %(border); border-radius: 12px;
    padding: 9px 18px; font-size: 13px; font-weight: 600; color: %(muted);
}
QPushButton#preset:hover { border-color: %(accent); color: %(text); }
QPushButton#preset:checked {
    background: %(accent); border-color: %(accent); color: #0b1020;
}
QComboBox {
    background: %(card); border: 1px solid %(border); border-radius: 8px;
    padding: 5px 12px; min-width: 120px; color: %(text);
}
QComboBox:hover { border-color: %(accent); }
QComboBox::drop-down { border: none; width: 22px; }
QComboBox QAbstractItemView {
    background: %(card); border: 1px solid %(border);
    selection-background-color: %(accent); selection-color: #0b1020; outline: none;
}
QTabWidget::pane { border: none; }
QTabBar::tab {
    background: transparent; color: %(muted); padding: 8px 18px;
    font-size: 13px; font-weight: 600; border-bottom: 2px solid transparent;
}
QTabBar::tab:selected { color: %(text); border-bottom: 2px solid %(accent); }
QSlider::groove:horizontal { height: 6px; background: %(cardHi); border-radius: 3px; }
QSlider::sub-page:horizontal { background: %(accent); border-radius: 3px; }
QSlider::handle:horizontal {
    background: %(text); width: 16px; height: 16px; margin: -6px 0; border-radius: 8px;
}
QLabel#statusText { color: %(muted); font-size: 12px; }
)")
        .replace("%(text)", text)
        .replace("%(bg)", bg)
        .replace("%(panel)", panel)
        .replace("%(cardHi)", cardHi)
        .replace("%(card)", card)
        .replace("%(border)", border)
        .replace("%(muted)", muted)
        .replace("%(accentSoft)", accentSoft)
        .replace("%(accent)", accent)
        .replace("%(warn)", warn)
        .replace("%(good)", good);
}

}  // namespace theme
}  // namespace cc
