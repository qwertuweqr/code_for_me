@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Нужен Node.js 18+: https://nodejs.org & pause & exit /b 1)
echo Ставлю зависимости...
call npm install || (pause & exit /b 1)
echo Скачиваю chrome-headless-shell...
call npm run setup || (pause & exit /b 1)
echo Самопроверка на тестовой странице...
call npm test || (pause & exit /b 1)
start "" "out\test-draft\preview.html"
echo Готово.
pause
