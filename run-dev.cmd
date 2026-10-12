@echo off
cd /d "%~dp0"
node node_modules\@tauri-apps\cli\tauri.js dev
pause
