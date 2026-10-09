@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Desktop Calendar Memo

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Electron binary is missing.
  echo Run setup.bat once while connected to the internet.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json is missing.
  echo Make sure you extracted the complete folder.
  pause
  exit /b 1
)

if not exist "main.js" (
  echo [ERROR] main.js is missing.
  echo Make sure you extracted the complete folder.
  pause
  exit /b 1
)

rem IMPORTANT: pass a relative app path (.) so Windows/Electron does not
rem mis-handle non-ASCII characters in the folder path.
start "Desktop Calendar Memo" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0
