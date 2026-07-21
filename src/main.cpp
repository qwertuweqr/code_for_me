// GUI entry point.
//
// Usage:
//   coolcontrol                 launch (real hardware if present, else sim)
//   coolcontrol --demo          force the built-in simulated device
//   coolcontrol --screenshot D  render the two tabs to D/ and exit (headless)
#include <QApplication>
#include <QDir>
#include <QPixmap>
#include <QTabWidget>

#include "gui/curveeditor.h"
#include "gui/mainwindow.h"
#include "hwmon.h"

using namespace cc;

static int screenshot(QApplication &app, const QString &dir) {
    QDir().mkpath(dir);
    auto backend = std::make_unique<SimulatedBackend>(61.0);
    auto *raw = backend.get();
    MainWindow window(std::move(backend));
    window.resize(980, 720);
    window.show();

    window.applyPreset("Balanced", false);
    for (int i = 0; i < 6; ++i) raw->tick(2.0);
    window.controller()->tick();
    window.refresh();

    auto grab = [&](const QString &path) {
        for (int i = 0; i < 4; ++i) app.processEvents();
        window.grab().save(path);
    };

    window.tabs()->setCurrentIndex(0);
    grab(dir + "/dashboard.png");
    window.tabs()->setCurrentIndex(1);
    grab(dir + "/curves.png");
    return 0;
}

int main(int argc, char **argv) {
    QApplication app(argc, argv);

    QStringList args = app.arguments();
    bool demo = args.contains("--demo");

    int shotIdx = args.indexOf("--screenshot");
    if (shotIdx >= 0 && shotIdx + 1 < args.size()) {
        return screenshot(app, args[shotIdx + 1]);
    }

    auto backend = demo ? std::unique_ptr<HwmonBackend>(std::make_unique<SimulatedBackend>())
                        : defaultBackend();
    MainWindow window(std::move(backend));
    window.show();
    return app.exec();
}
