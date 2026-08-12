@echo off
cd /d "%~dp0"
if not exist steampipe\config.json (
  if exist steampipe\config.example.json copy steampipe\config.example.json steampipe\config.json
  echo.
  echo Edit steampipe\config.json — set appId, depots.win, and depots.linux.
  echo Partner site: SteamPipe -^> Depots
  echo.
  notepad steampipe\config.json
  pause
  exit /b 1
)
if not defined STEAMWORKS_SDK set STEAMWORKS_SDK=C:\Users\blind\steamworks_sdk
call npm run upload:win
echo.
echo If upload succeeded, set the build live on the partner Builds page.
pause
