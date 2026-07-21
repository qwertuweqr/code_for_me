// One controllable fan: a gauge, an RPM readout and a speed slider.
#pragma once

#include <QFrame>
#include <QString>

class QLabel;
class QSlider;

namespace cc {

class CircularGauge;

class FanCard : public QFrame {
    Q_OBJECT
public:
    FanCard(QString chipId, QString pwmKey, const QString &title, QWidget *parent = nullptr);

    QString chipId() const { return chipId_; }
    QString pwmKey() const { return pwmKey_; }

    // mode is one of "auto", "curve" or "manual".
    void updateFrom(double percent, int rpm, const QString &mode);

signals:
    void speedChanged(const QString &chipId, const QString &pwmKey, double percent);

private slots:
    void onSliderMoved(int value);

private:
    QString chipId_;
    QString pwmKey_;
    QLabel *title_;
    QLabel *badge_;
    CircularGauge *gauge_;
    QLabel *rpm_;
    QSlider *slider_;
};

}  // namespace cc
