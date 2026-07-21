// The CoolControl main window: a header with preset buttons, a dashboard of
// per-fan cards and temperature readouts, and a fan-curve editor tab.
#pragma once

#include <QMap>
#include <QVector>
#include <QWidget>

#include "config.h"
#include "controller.h"
#include "hwmon.h"

class QButtonGroup;
class QComboBox;
class QGridLayout;
class QLabel;
class QTabWidget;
class QVBoxLayout;
class QTimer;

namespace cc {

class FanCard;
class TempBar;
class CurveEditor;

class MainWindow : public QWidget {
    Q_OBJECT
public:
    // Takes ownership of the backend.
    explicit MainWindow(std::unique_ptr<HwmonBackend> backend, QWidget *parent = nullptr);
    ~MainWindow() override;

    // Exposed so the screenshot helper can drive the UI without the event loop.
    QTabWidget *tabs() const { return tabs_; }
    FanController *controller() { return &controller_; }
    void applyPreset(const QString &name, bool persist = true);
    void refresh();

protected:
    void closeEvent(QCloseEvent *) override;

private:
    void buildHeader(QVBoxLayout *outer);
    void buildPresetBar(QVBoxLayout *outer);
    QWidget *buildDashboard();
    QWidget *buildCurveTab();
    void populateCards();

    void onManualSpeed(const QString &chipId, const QString &pwmKey, double percent);
    void onCurveEdited(const FanCurve &curve);
    void onTick();
    void selectCurve(const QString &name);

    std::unique_ptr<HwmonBackend> backend_;
    AppConfig config_;
    FanController controller_;

    QLabel *autoNote_ = nullptr;
    QLabel *status_ = nullptr;
    QTabWidget *tabs_ = nullptr;
    QButtonGroup *presetGroup_ = nullptr;
    QGridLayout *cardsGrid_ = nullptr;
    QVBoxLayout *tempHost_ = nullptr;
    QComboBox *curveSelector_ = nullptr;
    CurveEditor *editor_ = nullptr;
    QTimer *timer_ = nullptr;

    QVector<FanCard *> cards_;
    QMap<QString, TempBar *> tempBars_;
};

}  // namespace cc
