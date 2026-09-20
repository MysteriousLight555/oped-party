@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

rem ---- portable build: bundled Node, no install, no build step ----
rem ---- if our server already runs, just open the page ----
curl -s --max-time 3 http://127.0.0.1:18890/api/config | findstr /C:"persons" >nul
if not errorlevel 1 (
  start "" http://127.0.0.1:18890
  echo Server already running, opened http://127.0.0.1:18890
  exit /b 0
)

echo Starting oped-party (portable) ...
echo Close this window to stop the server.
start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:18890"
"node\node.exe" "app\server\index.js"
