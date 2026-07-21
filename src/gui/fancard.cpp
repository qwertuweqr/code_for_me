#include "gui/fancard.h"

#include <QHBoxLayout>
#include <QLabel>
#include <QSizePolicy>
#include <QSlider>
#include <QStyle>
#include <QVBoxLayout>
#include <cmath>

#include "gui/gauge.h"
#include "gui/theme.h"

namespace cc {

FanCard::FanCard(QString chipId, QString pwmKey, const QString &title, QWidget *parent)
    : QFrame(parent), chipId_(std::move(chipId)), pwmKey_(std::move(pwmKey)) {
    setObjectName("card");

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 16, 18, 16);
    layout->setSpacing(10);

    auto *header = new QHBoxLayout();
    title_ = new QLabel(title);
    title_->setObjectName("cardTitle");
    badge_ = new QLabel("AUTO");
    badge_->setObjectName("badgeAuto");
    badge_->setAlignment(Qt::AlignCenter);
    badge_->setFixedHeight(22);
    badge_->setSizePolicy(QSizePolicy::Maximum, QSizePolicy::Fixed);
    header->addWidget(title_);
    header->addStretch(1);
    header->addWidget(badge_, 0, Qt::AlignTop);
    layout->addLayout(header);

    gauge_ = new CircularGauge();
    gauge_->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Expanding);
    layout->addWidget(gauge_, 1, Qt::AlignHCenter);

    rpm_ = new QLabel("-- RPM");
    rpm_->setObjectName("muted");
    rpm_->setAlignment(Qt::AlignCenter);
    layout->addWidget(rpm_);

    slider_ = new QSlider(Qt::Horizontal);
    slider_->setRange(0, 100);
    connect(slider_, &QSlider::valueChanged, this, &FanCard::onSliderMoved);
    layout->addWidget(slider_);
}

void FanCard::onSliderMoved(int value) {
    gauge_->setValue(value);
    if (!slider_->signalsBlocked()) {
        emit speedChanged(chipId_, pwmKey_, static_cast<double>(value));
    }
}

void FanCard::updateFrom(double percent, int rpm, const QString &mode) {
    slider_->blockSignals(true);
    slider_->setValue(static_cast<int>(std::lround(percent)));
    slider_->blockSignals(false);

    QString color = theme::good;
    QString objName = "badgeAuto";
    if (mode == "curve") {
        color = theme::accent;
        objName = "badgeCurve";
    } else if (mode == "manual") {
        color = theme::warn;
        objName = "badgeManual";
    }
    gauge_->setValue(percent, mode, QColor(color));
    rpm_->setText(QString::number(rpm) + " RPM");
    badge_->setText(mode.toUpper());
    badge_->setObjectName(objName);
    badge_->style()->polish(badge_);
}

}  // namespace cc
