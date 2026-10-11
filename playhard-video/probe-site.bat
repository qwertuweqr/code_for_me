@echo off
chcp 65001 >nul
cd /d "%~dp0"
set URL=%~1
if "%URL%"=="" set URL=https://unitodi.ru/
node probe.mjs %URL% || (pause & exit /b 1)
start "" "probe"
pause
