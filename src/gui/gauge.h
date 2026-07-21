// Custom-painted widgets that give CoolControl its look: a circular fan-speed
// gauge and a colour-shifting temperature bar.
#pragma once

#include <QColor>
#include <QString>
#include <QWidget>

namespace cc {

class CircularGauge : public QWidget {
public:
    explicit CircularGauge(QWidget *parent = nullptr);
    void setValue(double value, const QString &sub = QString(), const QColor &color = QColor());

protected:
    void paintEvent(QPaintEvent *) override;

private:
    double value_ = 0.0;  // 0-100
    QString sub_;
    QColor color_;
};

class TempBar : public QWidget {
public:
    explicit TempBar(QString label, QWidget *parent = nullptr);
    void setValue(double celsius);

protected:
    void paintEvent(QPaintEvent *) override;

private:
    QString label_;
    double celsius_ = 0.0;
    double max_ = 100.0;
};

}  // namespace cc
