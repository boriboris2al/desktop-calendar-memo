@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Desktop Calendar Memo v1.4.1 - Build Installer

echo ========================================
echo  Desktop Calendar Memo v1.4.1
echo  Windows Installer Build
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js LTS and run this file again.
  pause
  exit /b 1
)

echo Installing build dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo Building Windows installer...
call npm run dist
if errorlevel 1 (
  echo [ERROR] Installer build failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  BUILD COMPLETE
echo ========================================
echo.
echo Check the dist folder for:
echo DesktopCalendarMemo_v1.4.1.exe
echo.
pause
