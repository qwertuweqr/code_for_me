// A no-dependency command line for headless machines and scripts.
//
//   coolcontrol-cli [--demo] list
//   coolcontrol-cli [--demo] set <chip> <pwm> <percent>
//   coolcontrol-cli [--demo] preset <Auto|Silent|Balanced|Performance>
//   coolcontrol-cli [--demo] auto
#include <QCoreApplication>
#include <QStringList>
#include <QTextStream>

#include "controller.h"
#include "curve.h"
#include "hwmon.h"

using namespace cc;

static int cmdList(FanController &ctrl, QTextStream &out) {
    const auto chips = ctrl.chips();
    if (chips.isEmpty()) {
        out << "No hwmon chips found.\n";
        return 1;
    }
    for (const Chip &chip : chips) {
        out << (chip.controllable() ? "* " : "  ") << chip.name << "  (" << chip.id << ")\n";
        for (const TempSensor &t : chip.temps) {
            out << QString("    temp %1 %2 C\n")
                       .arg(t.label, -16)
                       .arg(t.celsius, 5, 'f', 1);
        }
        for (const PwmChannel &pwm : chip.pwms) {
            QString rpm = pwm.fan ? QString::number(pwm.fan->rpm) + " RPM" : "no tacho";
            out << QString("    %1 %2%  %3 [%4]\n")
                       .arg(pwm.key, -6)
                       .arg(pwm.percent(), 5, 'f', 0)
                       .arg(rpm, -10)
                       .arg(pwm.isManual() ? "manual" : "auto");
        }
    }
    return 0;
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QTextStream out(stdout);
    QTextStream err(stderr);

    QStringList args = app.arguments();
    args.removeFirst();  // program name
    bool demo = args.removeAll("--demo") > 0;

    if (args.isEmpty()) {
        err << "usage: coolcontrol-cli [--demo] <list|set|preset|auto> ...\n";
        return 1;
    }

    auto backend = demo ? std::unique_ptr<HwmonBackend>(std::make_unique<SimulatedBackend>())
                        : defaultBackend();
    FanController ctrl(backend.get());

    const QString cmd = args.takeFirst();
    if (cmd == "list") {
        return cmdList(ctrl, out);
    }
    if (cmd == "set") {
        if (args.size() < 3) {
            err << "usage: set <chip> <pwm> <percent>\n";
            return 1;
        }
        ctrl.setSpeed(args[0], args[1], args[2].toDouble());
        out << QString("set %1 on %2 to %3%\n").arg(args[1], args[0]).arg(qRound(args[2].toDouble()));
        return 0;
    }
    if (cmd == "preset") {
        if (args.isEmpty()) {
            err << "usage: preset <name>\n";
            return 1;
        }
        ctrl.applyPreset(args[0]);
        out << "applied preset " << args[0] << "\n";
        return 0;
    }
    if (cmd == "auto") {
        ctrl.restoreAllAutomatic();
        out << "all channels returned to firmware control\n";
        return 0;
    }
    err << "unknown command: " << cmd << "\n";
    return 1;
}
