@echo off
REM Local testing outside Steam library — keeps Steam API without relaunch exit.
set AETHER_STEAM_SKIP_RESTART=1
cd /d "%~dp0dist-win"
if not exist Aether.exe (
  echo Build first: npm run dist:win
  pause
  exit /b 1
)
taskkill /F /IM Aether.exe >nul 2>&1
start "" Aether.exe
