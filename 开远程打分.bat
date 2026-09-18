@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [MISSING] cloudflared not found.
  echo Install it once with:
  echo     winget install --id Cloudflare.cloudflared
  echo Then close this window and run this script again.
  pause
  exit /b 1
)

if not exist dist (
  echo Building UI, please wait...
  call npm run build
)

rem ---- probe: make sure port 18890 really serves OUR app, not another program ----
set NODE_PID=
curl -s --max-time 5 http://127.0.0.1:18890/api/config | findstr /C:"persons" >nul
if errorlevel 1 (
  echo Local server not running, starting one...
  for /f %%i in ('powershell -NoProfile -Command "(Start-Process node -ArgumentList 'server/index.js' -PassThru -WindowStyle Hidden).Id"') do set NODE_PID=%%i
  ping -n 4 127.0.0.1 >nul
  curl -s --max-time 5 http://127.0.0.1:18890/api/config | findstr /C:"persons" >nul
  if errorlevel 1 (
    echo [ERROR] Cannot start the local server on port 18890.
    echo The port may be taken by another program, or Node.js is not installed.
    if defined NODE_PID taskkill /PID !NODE_PID! /F >nul 2>nul
    pause
    exit /b 1
  )
  echo Server started ^(PID !NODE_PID^), this window will close it when done.
)

echo.
echo ============================================================
echo  A temporary public URL is being created for this session.
echo  Copy the  https://xxxx.trycloudflare.com  URL printed below
echo  and send it to your group chat / meeting window.
echo  Friends can open it and score directly in the browser.
echo.
echo  IMPORTANT: the URL is public while this window is open.
echo  Press Ctrl+C here right after the party to close it.
echo ============================================================
echo.
cloudflared tunnel --url http://127.0.0.1:18890 --no-autoupdate

if defined NODE_PID (
  echo Cleaning up the server process started by this window...
  taskkill /PID !NODE_PID! /F >nul 2>nul
)
pause
