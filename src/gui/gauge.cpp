#include "gui/gauge.h"

#include <QFont>
#include <QPainter>
#include <QRectF>
#include <algorithm>

#include "gui/theme.h"

namespace cc {

CircularGauge::CircularGauge(QWidget *parent) : QWidget(parent), color_(theme::accent) {
    setMinimumSize(150, 150);
}

void CircularGauge::setValue(double value, const QString &sub, const QColor &color) {
    value_ = std::clamp(value, 0.0, 100.0);
    sub_ = sub;
    if (color.isValid()) color_ = color;
    update();
}

void CircularGauge::paintEvent(QPaintEvent *) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    double side = std::min(width(), height());
    double margin = 14;
    QRectF rect((width() - side) / 2 + margin, (height() - side) / 2 + margin,
                side - 2 * margin, side - 2 * margin);

    int startAngle = 230 * 16;  // Qt angles are 1/16 degree
    int span = -280 * 16;

    QPen pen(QColor(theme::cardHi), 12);
    pen.setCapStyle(Qt::RoundCap);
    p.setPen(pen);
    p.drawArc(rect, startAngle, span);

    pen.setColor(color_);
    p.setPen(pen);
    p.drawArc(rect, startAngle, static_cast<int>(span * value_ / 100));

    p.setPen(QColor(theme::text));
    QFont f = font();
    f.setPointSize(std::max(14, static_cast<int>(side / 7)));
    f.setBold(true);
    p.setFont(f);
    p.drawText(rect, Qt::AlignCenter, QString::number(value_, 'f', 0) + "%");

    if (!sub_.isEmpty()) {
        p.setPen(QColor(theme::muted));
        QFont fs = font();
        fs.setPointSize(std::max(8, static_cast<int>(side / 16)));
        p.setFont(fs);
        QRectF subRect = rect.translated(0, side / 4.2);
        p.drawText(subRect, Qt::AlignCenter, sub_);
    }
}

TempBar::TempBar(QString label, QWidget *parent) : QWidget(parent), label_(std::move(label)) {
    setMinimumHeight(46);
}

void TempBar::setValue(double celsius) {
    celsius_ = celsius;
    update();
}

void TempBar::paintEvent(QPaintEvent *) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    double w = width();

    p.setPen(QColor(theme::muted));
    QFont f = font();
    f.setPointSize(10);
    p.setFont(f);
    p.drawText(QRectF(2, 0, w - 60, 18), Qt::AlignVCenter, label_);

    p.setPen(QColor(theme::text));
    QFont fb = font();
    fb.setPointSize(11);
    fb.setBold(true);
    p.setFont(fb);
    p.drawText(QRectF(w - 60, 0, 58, 18), Qt::AlignRight | Qt::AlignVCenter,
               QString::number(celsius_, 'f', 0) + QStringLiteral("\u00b0C"));

    QRectF track(2, 24, w - 4, 10);
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(theme::cardHi));
    p.drawRoundedRect(track, 5, 5);

    double frac = std::clamp(celsius_ / max_, 0.0, 1.0);
    QRectF fill = track;
    fill.setWidth(track.width() * frac);
    p.setBrush(theme::tempColor(celsius_));
    p.drawRoundedRect(fill, 5, 5);
}

}  // namespace cc
