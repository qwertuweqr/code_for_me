#!/usr/bin/env bash
# Build a self-contained CoolControl AppImage.
#
# Produces CoolControl-x86_64.AppImage in the current directory. The AppImage
# bundles the Qt6 libraries, so users can download one file, mark it
# executable and run it on any modern x86-64 Linux distribution.
#
# Requirements: cmake, a C++17 compiler, Qt6 dev packages, and the
# linuxdeploy tool (downloaded automatically if missing).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${HERE}/build-appimage"
APPDIR="${BUILD}/AppDir"

echo ">> Configuring"
cmake -S "${HERE}" -B "${BUILD}" -DCMAKE_BUILD_TYPE=Release
echo ">> Building"
cmake --build "${BUILD}" --parallel
echo ">> Installing into AppDir"
DESTDIR="${APPDIR}" cmake --install "${BUILD}" --prefix /usr

# Fetch linuxdeploy + its Qt plugin if they are not already available.
cd "${BUILD}"
get() { [ -f "$1" ] || { echo ">> Downloading $1"; curl -fL "$2" -o "$1"; chmod +x "$1"; }; }
get linuxdeploy-x86_64.AppImage \
    "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage"
get linuxdeploy-plugin-qt-x86_64.AppImage \
    "https://github.com/linuxdeploy/linuxdeploy-plugin-qt/releases/download/continuous/linuxdeploy-plugin-qt-x86_64.AppImage"

echo ">> Packaging AppImage"
export QMAKE="$(command -v qmake6 || command -v qmake)"
./linuxdeploy-x86_64.AppImage \
    --appdir "${APPDIR}" \
    --plugin qt \
    --desktop-file "${APPDIR}/usr/share/applications/coolcontrol.desktop" \
    --icon-file "${HERE}/packaging/coolcontrol.svg" \
    --output appimage

mv -f CoolControl*-x86_64.AppImage "${HERE}/" 2>/dev/null || mv -f *.AppImage "${HERE}/CoolControl-x86_64.AppImage"
echo ">> Done: ${HERE}/CoolControl-x86_64.AppImage"
