@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js LTS first.
  pause
  exit /b 1
)
if not exist node_modules call npm install --no-audit --no-fund
if not exist dist call npm run build
start "" http://127.0.0.1:18890
node server\index.js
pause
