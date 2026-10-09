@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Desktop Calendar Memo Setup

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js LTS and run this file again.
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Electron binary is missing.
  echo Check your internet connection and run setup again.
  pause
  exit /b 1
)

echo.
echo Setup complete.
echo Run run.bat to start the app.
pause
