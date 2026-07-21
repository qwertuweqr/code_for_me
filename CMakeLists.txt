cmake_minimum_required(VERSION 3.16)
project(CoolControl VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Qt6 REQUIRED COMPONENTS Core Widgets)

# --- Core library (no widgets): fully unit-testable ---
add_library(cccore STATIC
    src/curve.cpp
    src/hwmon.cpp
    src/controller.cpp
    src/config.cpp
)
target_include_directories(cccore PUBLIC src)
target_link_libraries(cccore PUBLIC Qt6::Core)

# --- GUI application ---
add_executable(coolcontrol
    src/main.cpp
    src/gui/theme.cpp
    src/gui/gauge.cpp
    src/gui/curveeditor.cpp
    src/gui/fancard.cpp
    src/gui/mainwindow.cpp
)
target_link_libraries(coolcontrol PRIVATE cccore Qt6::Widgets)

# --- Command-line tool ---
add_executable(coolcontrol-cli src/cli.cpp)
target_link_libraries(coolcontrol-cli PRIVATE cccore Qt6::Core)

# --- Tests ---
enable_testing()
add_executable(cc_tests tests/test_core.cpp)
target_link_libraries(cc_tests PRIVATE cccore Qt6::Core)
add_test(NAME cc_tests COMMAND cc_tests)

# --- Install ---
include(GNUInstallDirs)
install(TARGETS coolcontrol coolcontrol-cli RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES packaging/coolcontrol.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
install(FILES packaging/coolcontrol.svg DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/scalable/apps)
