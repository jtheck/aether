# Æther NW.js (Steam)

Desktop shell that loads [https://aether.garden](https://aether.garden).

## Prerequisites

1. App ID is **5043860** (`app/steam_appid.txt`). Windows depot **5043861**. Linux depot **5043862** (`Aether.Garden Depot Linux`).
   - Installation → Launch Options: Linux executable **`Aether`**. Arguments (WebGPU on Linux): `--enable-unsafe-webgpu --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE --use-angle=vulkan --ignore-gpu-blocklist --ozone-platform=x11`
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
# → dist-linux/Aether  +  dist-linux/Aether.sh  and  Aether-linux64.zip
```

Steam Linux / Deck “Play does nothing” is usually the Windows depot + Proton, or a Linux launch option pointing at `Aether.exe` / `Aether.sh`. After the Linux depot is live, the Linux launch executable must be **`Aether`**. To force the wrapper: executable `/bin/sh`, arguments `Aether.sh`.

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

## Workshop seed item

Partner checklist needs one public item. From `steam-build`:

```powershell
$env:STEAMWORKS_SDK="C:\Users\blind\steamworks_sdk"
$env:STEAM_BUILD_USER="your_account"
npm run upload:workshop
```

That uploads `workshop-seed/content/map.garden` (the unit tester) as a public item. Accept https://steamcommunity.com/sharedfiles/workshoplegalagreement on that account first. The published file id is written to `workshop-seed/publishedfileid.txt`.

## Bridge API

Injected `bridge.js` exposes `window.aetherDesktop` (`runtime: 'nwjs'`). The page does not get Node APIs (`node-remote` is unset); Steam calls go over a local HTTP bridge.

```javascript
if (window.aetherDesktop?.steam?.isAvailable()) {
  aetherDesktop.steam.unlockAchievement('ACH_FIRST_LAUNCH');
  aetherDesktop.steam.setPresence('status', 'In match');
  aetherDesktop.steam.openOverlay('achievements');
  aetherDesktop.steam.openOverlay('workshop');
  await aetherDesktop.steam.listWorkshopMaps();
  await aetherDesktop.steam.loadWorkshopGarden('123456789');
  await aetherDesktop.steam.publishWorkshopGarden({ garden, title: 'Grove' });
}
```

Game code uses `window.aetherSteam` (`src/app/steam.js`). No-ops in the browser.

Workshop maps are subscribed items that contain `.garden` files (`map.garden`, or `maps/*.garden` for a campaign pack). The worker reads the Steam install folder and returns JSON over this bridge — the page cannot see the disk. `?garden=workshop:<id>` / `workshop:<id>/maps/02.garden` loads in the game and Forge. Forge can publish the current map. Adventure lobbies list subscribed items; the host embeds the garden JSON on START / CHAPTER so web guests can play without Steam. Campaign `next` can be a relative file in the same pack (`maps/02.garden`). Enable Workshop for app **5043860** on the partner site before items can be published.

DLC ownership is on `getInfo().dlc` (`{ appId, owned }`). First Responder is App ID **5217980**. The game maps that to pack `first_responder` via `aetherSteam.ownedPacks()`. Local art iteration (loopback only): `http://127.0.0.1:5173/?dlc=first_responder`. Ignored on aether.garden.

| API name | When |
|---|---|
| `ACH_FIRST_LAUNCH` | First time the garden is playable (splash down) |
| `ACH_FIRST_MATCH` | First time the player creates a KOTH lobby (not join / claim) |
| `ACH_KOTH_DEFEAT` | First agora-capture loss (not a score wipe or spectator) |
| `ACH_LINUX_LAUNCH` | First splash-down on the native Linux shell (not Proton / Windows) |
| `ACH_FORGE_OPEN` | First time the Forge Field Editor is opened (settings link or /forge) |

Publish those exact names on the Steamworks partner site (drafts do nothing). Smoke test in the NW shell DevTools:

```javascript
aetherSteam.getInfo()
aetherSteam.test()
aetherSteam.test('ACH_FIRST_MATCH')
aetherSteam.test('ACH_KOTH_DEFEAT')
aetherSteam.test('ACH_LINUX_LAUNCH')
aetherSteam.test('ACH_FORGE_OPEN')
aetherSteam.listWorkshopMaps()
aetherSteam.loadWorkshopGarden('123456789')
aetherSteam.openOverlay('workshop')
aetherSteam.publishWorkshopGarden({ garden, title: 'Grove' })
```

Reset on your account via Steam console (`steam://open/console`):

```
achievement_clear 5043860 ACH_FIRST_LAUNCH
achievement_clear 5043860 ACH_FIRST_MATCH
achievement_clear 5043860 ACH_KOTH_DEFEAT
achievement_clear 5043860 ACH_LINUX_LAUNCH
achievement_clear 5043860 ACH_FORGE_OPEN
```

Then clear the session flags or they will not re-fire:

```javascript
aetherSteam._firstLaunchHandled = false
aetherSteam._firstMatchHandled = false
aetherSteam._kothDefeatHandled = false
aetherSteam._forgeOpenedHandled = false
```
