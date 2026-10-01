@echo off
cd /d "%~dp0"
title My CaptionKit

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"

powershell.exe -NoProfile -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 1; if ($health.service -eq 'mycaptionkit') { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  echo.
  echo My CaptionKit is already running. Opening the Control screen...
  start "" "http://127.0.0.1:4173/control"
  exit /b 0
)

node server.js --open
if errorlevel 1 (
  echo.
  echo My CaptionKit could not start. Please check the message above.
  pause
)
