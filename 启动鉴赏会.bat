@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js LTS first.
  goto failed
)
if not exist node_modules call npm install --no-audit --no-fund
if errorlevel 1 goto failed
if not exist dist call npm run build
if errorlevel 1 goto failed
node "server\launch.js" --browser
if not errorlevel 1 exit /b 0
:failed
pause
exit /b 1
