@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

rem ---- portable remote scoring: bundled cloudflared + bundled Node ----

rem ---- ensure local server on 18890 ----
curl -s --max-time 3 http://127.0.0.1:18890/api/config | findstr /C:"persons" >nul
if errorlevel 1 (
  echo Starting local server (minimized window) ...
  start "oped-party server" /min cmd /c ""node\node.exe" "app\server\index.js""
  ping -n 4 127.0.0.1 >nul
  curl -s --max-time 5 http://127.0.0.1:18890/api/config | findstr /C:"persons" >nul
  if errorlevel 1 (
    echo [ERROR] local server failed to start on port 18890.
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo  Public tunnel starting. After it prints a line like
echo     https://xxxx-yyyy-dddd.trycloudflare.com
echo  send that URL to classmates (WeChat works).
echo  Scoring page = that URL + /#/join
echo  Close this window to stop the tunnel.
echo ============================================================
echo.
"cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:18890
