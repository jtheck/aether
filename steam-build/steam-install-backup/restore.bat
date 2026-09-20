@echo off
set INSTALL=D:\SteamLibrary\steamapps\common\Aether.Garden
set PKG=%INSTALL%\package.nw
set HERE=%~dp0
taskkill /F /IM Aether.exe >nul 2>&1
copy /Y "%HERE%node-main.js" "%PKG%\node-main.js"
copy /Y "%HERE%steam.js" "%PKG%\steam.js"
copy /Y "%HERE%steam-client.js" "%PKG%\steam-client.js"
copy /Y "%HERE%steam-worker.js" "%PKG%\steam-worker.js"
copy /Y "%HERE%bridge.js" "%PKG%\bridge.js"
copy /Y "%HERE%bridge-server.js" "%PKG%\bridge-server.js"
if exist "%HERE%package.json" copy /Y "%HERE%package.json" "%PKG%\package.json"
del /F /Q "%PKG%\gamepadTextInput.js" >nul 2>&1
del /F /Q "%INSTALL%\aether.url" >nul 2>&1
echo Restored Steam Aether.Garden package.nw from backup.
