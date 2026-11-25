@echo off
chcp 65001 >nul
cd /d "%~dp0"
"node\node.exe" "app\server\launch.js" --browser "%~dp0cloudflared\cloudflared.exe"
if not errorlevel 1 exit /b 0
pause
exit /b 1
