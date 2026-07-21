#include "gui/mainwindow.h"

#include <QButtonGroup>
#include <QComboBox>
#include <QCloseEvent>
#include <QFrame>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QSizePolicy>
#include <QTabWidget>
#include <QTimer>
#include <QVBoxLayout>
#include <cmath>

#include "gui/curveeditor.h"
#include "gui/fancard.h"
#include "gui/gauge.h"
#include "gui/theme.h"

namespace cc {

static const QStringList kPresets = {"Auto", "Silent", "Balanced", "Performance"};

MainWindow::MainWindow(std::unique_ptr<HwmonBackend> backend, QWidget *parent)
    : QWidget(parent),
      backend_(std::move(backend)),
      config_(loadConfig()),
      controller_(backend_.get()) {
    setObjectName("root");
    setWindowTitle("CoolControl");
    setStyleSheet(theme::stylesheet());
    resize(980, 720);

    auto *outer = new QVBoxLayout(this);
    outer->setContentsMargins(24, 22, 24, 20);
    outer->setSpacing(18);
    buildHeader(outer);
    buildPresetBar(outer);

    tabs_ = new QTabWidget();
    tabs_->addTab(buildDashboard(), "Dashboard");
    tabs_->addTab(buildCurveTab(), "Fan Curves");
    outer->addWidget(tabs_, 1);

    status_ = new QLabel("");
    status_->setObjectName("statusText");
    outer->addWidget(status_);

    populateCards();
    applyPreset(config_.activePreset, false);

    timer_ = new QTimer(this);
    connect(timer_, &QTimer::timeout, this, &MainWindow::onTick);
    timer_->start(static_cast<int>(config_.pollInterval * 1000));
    refresh();
}

MainWindow::~MainWindow() = default;

void MainWindow::buildHeader(QVBoxLayout *outer) {
    auto *row = new QHBoxLayout();
    auto *left = new QVBoxLayout();
    auto *title = new QLabel("CoolControl");
    title->setObjectName("title");
    auto *subtitle = new QLabel("Fan & cooler power management for Linux");
    subtitle->setObjectName("subtitle");
    left->addWidget(title);
    left->addWidget(subtitle);
    row->addLayout(left);
    row->addStretch(1);

    autoNote_ = new QLabel("");
    autoNote_->setObjectName("muted");
    autoNote_->setAlignment(Qt::AlignRight);
    row->addWidget(autoNote_);
    outer->addLayout(row);
}

void MainWindow::buildPresetBar(QVBoxLayout *outer) {
    auto *row = new QHBoxLayout();
    row->setSpacing(10);
    auto *label = new QLabel("Profile");
    label->setObjectName("sectionHeading");
    row->addWidget(label);
    row->addSpacing(8);

    presetGroup_ = new QButtonGroup(this);
    presetGroup_->setExclusive(true);
    for (const QString &name : kPresets) {
        auto *btn = new QPushButton(name);
        btn->setObjectName("preset");
        btn->setCheckable(true);
        btn->setCursor(Qt::PointingHandCursor);
        connect(btn, &QPushButton::clicked, this, [this, name]() { applyPreset(name); });
        presetGroup_->addButton(btn);
        row->addWidget(btn);
    }
    row->addStretch(1);
    outer->addLayout(row);
}

QWidget *MainWindow::buildDashboard() {
    auto *page = new QWidget();
    auto *layout = new QHBoxLayout(page);
    layout->setContentsMargins(0, 12, 0, 0);
    layout->setSpacing(18);

    auto *cardsHost = new QWidget();
    cardsGrid_ = new QGridLayout(cardsHost);
    cardsGrid_->setContentsMargins(0, 0, 0, 0);
    cardsGrid_->setSpacing(18);
    layout->addWidget(cardsHost, 2);

    auto *tempPanel = new QFrame();
    tempPanel->setObjectName("panel");
    tempPanel->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Expanding);
    auto *tl = new QVBoxLayout(tempPanel);
    tl->setContentsMargins(18, 16, 18, 16);
    tl->setSpacing(12);
    auto *heading = new QLabel("Temperatures");
    heading->setObjectName("sectionHeading");
    tl->addWidget(heading);
    tempHost_ = new QVBoxLayout();
    tl->addLayout(tempHost_);
    tl->addStretch(1);
    layout->addWidget(tempPanel, 1);
    return page;
}

QWidget *MainWindow::buildCurveTab() {
    auto *page = new QWidget();
    auto *layout = new QVBoxLayout(page);
    layout->setContentsMargins(0, 12, 0, 0);
    layout->setSpacing(12);

    auto *controls = new QHBoxLayout();
    controls->addWidget(new QLabel("Edit curve:"));
    curveSelector_ = new QComboBox();
    const auto curves = config_.allCurves();
    for (auto it = curves.constBegin(); it != curves.constEnd(); ++it) {
        curveSelector_->addItem(it.key());
    }
    connect(curveSelector_, &QComboBox::currentTextChanged, this, &MainWindow::selectCurve);
    controls->addWidget(curveSelector_);
    controls->addStretch(1);
    auto *hint = new QLabel(QStringLiteral(
        "Drag points \u00b7 double-click to add \u00b7 right-click to remove"));
    hint->setObjectName("muted");
    controls->addWidget(hint);
    layout->addLayout(controls);

    FanCurve first = curves.isEmpty() ? FanCurve({{30, 20}, {80, 100}}) : curves.first();
    editor_ = new CurveEditor(first);
    connect(editor_, &CurveEditor::curveChanged, this, &MainWindow::onCurveEdited);
    layout->addWidget(editor_, 1);
    return page;
}

void MainWindow::populateCards() {
    for (const Chip &chip : controller_.controllableChips()) {
        for (const PwmChannel &pwm : chip.pwms) {
            QString fanLabel = pwm.fan ? pwm.fan->label : pwm.label;
            auto *card = new FanCard(chip.id, pwm.key, fanLabel);
            connect(card, &FanCard::speedChanged, this, &MainWindow::onManualSpeed);
            cards_.push_back(card);
        }
    }
    for (int i = 0; i < cards_.size(); ++i) {
        cardsGrid_->addWidget(cards_[i], i / 2, i % 2);
    }
}

void MainWindow::onManualSpeed(const QString &chipId, const QString &pwmKey, double percent) {
    controller_.dropBinding(chipId, pwmKey);
    controller_.setSpeed(chipId, pwmKey, percent);
    for (QAbstractButton *btn : presetGroup_->buttons()) btn->setChecked(false);
    status_->setText(QString("Manual override: %1 \u2192 %2%").arg(pwmKey).arg(qRound(percent)));
}

void MainWindow::applyPreset(const QString &name, bool persist) {
    controller_.applyPreset(name, config_.allCurves());
    for (QAbstractButton *btn : presetGroup_->buttons()) btn->setChecked(btn->text() == name);
    if (persist) {
        config_.activePreset = name;
        saveConfig(config_);
    }
    refresh();
}

void MainWindow::selectCurve(const QString &name) {
    const auto curves = config_.allCurves();
    if (curves.contains(name)) editor_->setCurve(curves.value(name));
}

void MainWindow::onCurveEdited(const FanCurve &curve) {
    const QString name = curveSelector_->currentText();
    config_.curves.insert(name, curve);
    if (controller_.activePreset() == name) applyPreset(name);
}

void MainWindow::onTick() {
    if (auto *sim = dynamic_cast<SimulatedBackend *>(backend_.get())) {
        sim->tick(config_.pollInterval);
    }
    controller_.tick();
    refresh();
}

void MainWindow::refresh() {
    const QVector<Chip> chips = controller_.chips();
    QMap<QString, PwmChannel> byChannel;
    double hottest = 0.0;
    for (const Chip &chip : chips) {
        for (const PwmChannel &pwm : chip.pwms) {
            byChannel.insert(chip.id + "::" + pwm.key, pwm);
        }
        for (const TempSensor &t : chip.temps) {
            TempBar *bar = tempBars_.value(t.key, nullptr);
            if (!bar) {
                bar = new TempBar(t.label);
                tempBars_.insert(t.key, bar);
                tempHost_->addWidget(bar);
            }
            bar->setValue(t.celsius);
            hottest = std::max(hottest, t.celsius);
        }
    }

    for (FanCard *card : cards_) {
        const QString id = card->chipId() + "::" + card->pwmKey();
        if (!byChannel.contains(id)) continue;
        const PwmChannel &pwm = byChannel[id];
        QString mode;
        if (controller_.hasBinding(card->chipId(), card->pwmKey())) mode = "curve";
        else if (pwm.isManual()) mode = "manual";
        else mode = "auto";
        card->updateFrom(pwm.percent(), pwm.fan ? pwm.fan->rpm : 0, mode);
    }

    if (editor_) editor_->setMarker(hottest);
    const QString kind = backend_->isSimulated() ? "Simulated device" : "hwmon";
    const QString preset = controller_.activePreset().isEmpty() ? "custom" : controller_.activePreset();
    autoNote_->setText(QString("%1 \u00b7 %2 fans \u00b7 profile: %3")
                           .arg(kind).arg(cards_.size()).arg(preset));
}

void MainWindow::closeEvent(QCloseEvent *event) {
    // Hand fans back to firmware on exit so a closed app never leaves them stuck.
    controller_.restoreAllAutomatic();
    QWidget::closeEvent(event);
}

}  // namespace cc
