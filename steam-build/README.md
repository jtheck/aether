# Æther NW.js (Steam)

Desktop shell that loads [https://aether.garden](https://aether.garden).

## Prerequisites

1. App ID is **5043860** (`app/steam_appid.txt`). Windows depot **5043861**.
   - Add a Linux depot on the partner site when you want `upload:linux` / full `upload:steam`.
2. Optional Steam redistributables: set `STEAMWORKS_SDK` to your SDK root before `dist` / upload.

## Run locally

```bash
cd steam-build
npm install
npm start
```

| Env | Purpose |
|-----|---------|
| `AETHER_URL` | Override start URL (allowlisted: aether.garden / localhost) |
| `AETHER_STEAM=0` | Disable Steam worker |
| `AETHER_STEAM_SKIP_RESTART=1` | Don’t quit for Steam relaunch (local testing) |
| `AETHER_BRIDGE_PORT` | Bridge HTTP port (default **9787**) |
| `AETHER_STEAM_PORT` | Steam worker port (default **9786**) |

Point at a local game server while developing:

```powershell
$env:AETHER_URL="http://127.0.0.1:5173"
$env:AETHER_STEAM_SKIP_RESTART="1"
npm start
```

**Hotkeys (window focused):** F5 / Ctrl+R reload · Ctrl+Shift+R hard reload · F11 fullscreen · F12 / Ctrl+Shift+I DevTools.

## Build Windows / Linux

```powershell
$env:STEAMWORKS_SDK="C:\Users\blind\steamworks_sdk"   # optional but needed for Steam API DLL
npm run zip:win
# → dist-win/Aether.exe  and  Aether-win64.zip

npm run zip:linux
# → dist-linux/Aether  and  Aether-linux64.zip
```

Local shipped exe (outside Steam library):

```bat
Launch-Aether.bat
```

## Steam upload

1. Create app + Windows/Linux depots on the partner site.
2. Copy `steampipe/config.example.json` → `steampipe/config.json` and fill `appId` / depot IDs.
3. Put the same App ID in `app/steam_appid.txt`.
4. Upload:

```powershell
$env:STEAMWORKS_SDK="C:\Users\blind\steamworks_sdk"
$env:STEAM_BUILD_USER="your_build_account"
npm run upload:steam
# or: run-upload-win.bat
```

Then set the build live on the partner Builds page.

## Bridge API

Injected `bridge.js` exposes `window.aetherDesktop` (`runtime: 'nwjs'`). The page does not get Node APIs (`node-remote` is unset); Steam calls go over a local HTTP bridge.

```javascript
if (window.aetherDesktop?.steam?.isAvailable()) {
  aetherDesktop.steam.unlockAchievement('ACH_FIRST_LAUNCH');
  aetherDesktop.steam.setPresence('status', 'In match');
  aetherDesktop.steam.openOverlay('achievements');
}
```

Game code uses `window.aetherSteam` (`src/app/steam.js`). No-ops in the browser.

DLC ownership is on `getInfo().dlc` (`{ appId, owned }`). First Responder is App ID **5217980**. The game maps that to pack `first_responder` via `aetherSteam.ownedPacks()`. Local art iteration (loopback only): `http://127.0.0.1:5173/?dlc=first_responder`. Ignored on aether.garden.

| API name | When |
|---|---|
| `ACH_FIRST_LAUNCH` | First time the garden is playable (splash down) |
| `ACH_FIRST_MATCH` | First time the player creates a KOTH lobby (not join / claim) |
| `ACH_KOTH_DEFEAT` | First agora-capture loss (not a score wipe or spectator) |

Publish those exact names on the Steamworks partner site (drafts do nothing). Smoke test in the NW shell DevTools:

```javascript
aetherSteam.getInfo()
aetherSteam.test()
aetherSteam.test('ACH_FIRST_MATCH')
aetherSteam.test('ACH_KOTH_DEFEAT')
```

Reset on your account via Steam console (`steam://open/console`):

```
achievement_clear 5043860 ACH_FIRST_LAUNCH
achievement_clear 5043860 ACH_FIRST_MATCH
achievement_clear 5043860 ACH_KOTH_DEFEAT
```

Then clear the session flags or they will not re-fire:

```javascript
aetherSteam._firstLaunchHandled = false
aetherSteam._firstMatchHandled = false
aetherSteam._kothDefeatHandled = false
```
