"""A small, self-contained dark theme for the GUI.

Keeping the palette and stylesheet in one module means the widgets stay free
of hard-coded colours and the whole look can be retuned from a single place.
"""

from __future__ import annotations


class Palette:
    # Backgrounds, from deepest to most raised surface.
    bg = "#0e1017"
    panel = "#161925"
    card = "#1d2131"
    card_hi = "#242942"
    border = "#2b3145"

    # Text.
    text = "#e7eaf3"
    muted = "#8b91a7"

    # Brand + status accents.
    accent = "#5b8cff"
    accent_soft = "#38406a"
    good = "#45d0a8"
    warn = "#ffb454"
    danger = "#ff5c7c"

    @staticmethod
    def temp_color(celsius: float) -> str:
        """Green when cool, amber when warm, red when hot."""
        if celsius < 55:
            return Palette.good
        if celsius < 75:
            return Palette.warn
        return Palette.danger


STYLESHEET = f"""
* {{
    font-family: "Inter", "Segoe UI", "Ubuntu", "DejaVu Sans", sans-serif;
    color: {Palette.text};
}}
QWidget#root {{
    background: {Palette.bg};
}}
QLabel#title {{
    font-size: 22px;
    font-weight: 700;
}}
QLabel#subtitle {{
    color: {Palette.muted};
    font-size: 13px;
}}
QLabel#sectionHeading {{
    font-size: 15px;
    font-weight: 600;
}}
QFrame#card, QFrame#panel {{
    background: {Palette.card};
    border: 1px solid {Palette.border};
    border-radius: 16px;
}}
QFrame#panel {{
    background: {Palette.panel};
}}
QLabel#cardTitle {{
    font-size: 15px;
    font-weight: 600;
}}
QLabel#muted {{
    color: {Palette.muted};
    font-size: 12px;
}}
QLabel#badgeCurve {{
    color: #0b1020;
    background: {Palette.accent};
    border-radius: 11px;
    padding: 2px 12px;
    font-size: 11px;
    font-weight: 700;
}}
QLabel#badgeManual {{
    color: #0b1020;
    background: {Palette.warn};
    border-radius: 11px;
    padding: 2px 12px;
    font-size: 11px;
    font-weight: 700;
}}
QLabel#badgeAuto {{
    color: {Palette.text};
    background: {Palette.accent_soft};
    border-radius: 11px;
    padding: 2px 12px;
    font-size: 11px;
    font-weight: 700;
}}
QPushButton#preset {{
    background: {Palette.card};
    border: 1px solid {Palette.border};
    border-radius: 12px;
    padding: 9px 18px;
    font-size: 13px;
    font-weight: 600;
    color: {Palette.muted};
}}
QPushButton#preset:hover {{
    border-color: {Palette.accent};
    color: {Palette.text};
}}
QPushButton#preset:checked {{
    background: {Palette.accent};
    border-color: {Palette.accent};
    color: #0b1020;
}}
QPushButton#ghost {{
    background: transparent;
    border: 1px solid {Palette.border};
    border-radius: 10px;
    padding: 7px 14px;
    color: {Palette.muted};
    font-weight: 600;
}}
QPushButton#ghost:hover {{
    border-color: {Palette.accent};
    color: {Palette.text};
}}
QComboBox {{
    background: {Palette.card};
    border: 1px solid {Palette.border};
    border-radius: 8px;
    padding: 5px 12px;
    min-width: 120px;
    color: {Palette.text};
}}
QComboBox:hover {{
    border-color: {Palette.accent};
}}
QComboBox::drop-down {{
    border: none;
    width: 22px;
}}
QComboBox QAbstractItemView {{
    background: {Palette.card};
    border: 1px solid {Palette.border};
    selection-background-color: {Palette.accent};
    selection-color: #0b1020;
    outline: none;
}}
QTabWidget::pane {{
    border: none;
}}
QTabBar::tab {{
    background: transparent;
    color: {Palette.muted};
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 600;
    border-bottom: 2px solid transparent;
}}
QTabBar::tab:selected {{
    color: {Palette.text};
    border-bottom: 2px solid {Palette.accent};
}}
QSlider::groove:horizontal {{
    height: 6px;
    background: {Palette.card_hi};
    border-radius: 3px;
}}
QSlider::sub-page:horizontal {{
    background: {Palette.accent};
    border-radius: 3px;
}}
QSlider::handle:horizontal {{
    background: {Palette.text};
    width: 16px;
    height: 16px;
    margin: -6px 0;
    border-radius: 8px;
}}
QStatusBar, QLabel#statusText {{
    color: {Palette.muted};
    font-size: 12px;
}}
"""
