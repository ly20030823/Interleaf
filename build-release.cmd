@echo off
cd /d "%~dp0"
node node_modules\typescript\bin\tsc --noEmit
if errorlevel 1 exit /b %errorlevel%
node node_modules\@tauri-apps\cli\tauri.js build
pause
