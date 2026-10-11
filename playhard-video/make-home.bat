@echo off
chcp 65001 >nul
cd /d "%~dp0"
node make.mjs scenarios\01-home.json %* || (pause & exit /b 1)
start "" "out\01-home\preview.html"
pause
