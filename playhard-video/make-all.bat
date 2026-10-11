@echo off
chcp 65001 >nul
cd /d "%~dp0"
node make-all.mjs %* || (pause & exit /b 1)
node pack.mjs || (pause & exit /b 1)
start "" "out\unitodi-case-videos\index.html"
pause
