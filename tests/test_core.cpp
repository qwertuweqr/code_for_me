// A tiny, dependency-free test harness for the CoolControl core. Each CHECK
// records a failure without aborting, so one run reports every problem.
#include <QCoreApplication>
#include <cstdio>
#include <cmath>

#include "config.h"
#include "controller.h"
#include "curve.h"
#include "hwmon.h"

using namespace cc;

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond)                                                       \
    do {                                                                  \
        ++g_checks;                                                       \
        if (!(cond)) {                                                    \
            ++g_failures;                                                 \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);   \
        }                                                                 \
    } while (0)

static bool nearly(double a, double b, double tol = 0.05) { return std::fabs(a - b) <= tol; }

static void testCurve() {
    FanCurve c({{40, 20}, {60, 80}});
    CHECK(nearly(c.speedAt(50), 50.0));   // halfway
    CHECK(nearly(c.speedAt(45), 35.0));

    FanCurve clamped({{40, 20}, {80, 100}});
    CHECK(nearly(clamped.speedAt(0), 20.0));    // below first point
    CHECK(nearly(clamped.speedAt(200), 100.0)); // above last point

    FanCurve messy({{80, 150}, {30, -10}});     // unsorted + out of range
    CHECK(messy.points().size() == 2);
    CHECK(nearly(messy.points().first().temp, 30));
    CHECK(nearly(messy.points().first().speed, 0));   // -10 clamped up
    CHECK(nearly(messy.points().last().speed, 100));  // 150 clamped down

    FanCurve dup({{50, 30}, {50, 70}});
    CHECK(dup.points().size() == 1);
    CHECK(nearly(dup.speedAt(50), 70.0));  // last wins

    FanCurve base({{30, 0}, {80, 100}});
    FanCurve bigger = base.withPoint({55, 50});
    CHECK(base.points().size() == 2);  // immutable
    CHECK(bigger.points().size() == 3);
    CHECK(bigger.withoutPoint(1).points().size() == 2);

    for (auto it = builtinCurves().constBegin(); it != builtinCurves().constEnd(); ++it) {
        CHECK(FanCurve::fromJson(it.value().toJson()) == it.value());
    }
}

static void testHwmon() {
    SimulatedBackend backend;
    HwmonReader reader(&backend);
    auto chips = reader.readAll();
    CHECK(chips.size() == 1);
    CHECK(chips[0].controllable());
    CHECK(chips[0].pwms.size() == 2);

    CHECK(PwmChannel::percentToRaw(0) == 0);
    CHECK(PwmChannel::percentToRaw(100) == 255);
    CHECK(PwmChannel::percentToRaw(150) == 255);  // clamped

    // Full speed, manual: temperature should trend downward over time.
    SimulatedBackend hot(70.0);
    const QString c = hot.chipIds().first();
    hot.write(c, "pwm1_enable", QString::number(PWM_MANUAL));
    hot.write(c, "pwm2_enable", QString::number(PWM_MANUAL));
    hot.write(c, "pwm1", "255");
    hot.write(c, "pwm2", "255");
    int start = hot.read(c, "temp1_input")->toInt();
    for (int i = 0; i < 40; ++i) hot.tick(1.0);
    int end = hot.read(c, "temp1_input")->toInt();
    CHECK(end < start);
}

static void testController() {
    SimulatedBackend backend;
    FanController ctrl(&backend);
    const QString chip = ctrl.controllableChips().first().id;

    ctrl.setSpeed(chip, "pwm1", 40);
    auto pwm = ctrl.findChannel(chip, "pwm1");
    CHECK(pwm && pwm->isManual());
    CHECK(nearly(pwm->percent(), 40.0, 1.0));

    ctrl.setAutomatic(chip, "pwm1");
    pwm = ctrl.findChannel(chip, "pwm1");
    CHECK(pwm && pwm->enable == PWM_AUTOMATIC);

    ctrl.bindCurve(chip, "pwm1", FanCurve({{0, 100}, {100, 100}}));
    ctrl.tick();
    pwm = ctrl.findChannel(chip, "pwm1");
    CHECK(pwm && nearly(pwm->percent(), 100.0));

    ctrl.applyPreset("Performance");
    CHECK(ctrl.activePreset() == "Performance");
    for (const Chip &ch : ctrl.controllableChips()) {
        for (const PwmChannel &p : ch.pwms) CHECK(ctrl.hasBinding(ch.id, p.key));
    }

    ctrl.applyPreset("Auto");
    CHECK(ctrl.bindings().isEmpty());
    CHECK(ctrl.activePreset() == "Auto");

    ctrl.applyPreset("Balanced");
    ctrl.restoreAllAutomatic();
    for (const Chip &ch : ctrl.controllableChips()) {
        for (const PwmChannel &p : ch.pwms) CHECK(p.enable == PWM_AUTOMATIC);
    }
    CHECK(ctrl.bindings().isEmpty());
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    testCurve();
    testHwmon();
    testController();
    std::printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
