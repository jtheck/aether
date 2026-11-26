# Steam Frame ARM64 / WebGPU WebXR

This records the first confirmed working Frame build before the build pipeline is
cleaned up.

## Confirmed working build

- Steam app: **5043860**
- Frame depot: **5043863** (Linux, ARM64)
- Steam build: **26940024**
- Depot manifest: **2057931815352484221**
- Steam compatibility runtime: **SteamLinuxRuntime_4-arm64** (`Runtime 4 ARM`)
- Launch executable: **`Aether`**
- NW.js: **0.121.0**
- Chromium: **158.0.8127.37**
- Runtime archive:
  `D:\nw-build\artifacts\nwjs-v0.121.0-linux-arm64.tar.gz`
- Source tree in WSL:
  `/home/aether/nw-build/src` in the `Aether-NW` distro
- Chromium branch: `aether-webgpu-xr`

The confirmed Steamworks launch type was **Launch OpenXR App**. It works, but
its UX is awkward: Frame shows an XR loading card while Æther is still a flat
WebXR window waiting for the user to click XR. The user must select Æther from
the Frame taskbar, then click XR. The published configuration later reported
the Frame entry as a normal/default launch while XR remained functional.

Steam's launch filtering exposes both ARM64 and x86-64 as Linux 64-bit, so two
Linux launch entries cannot be cleanly architecture-scoped. Use one Linux
launch option pointing to root `Aether`. Depot **5043862** ships the x86-64
binary at that path and depot **5043863** ships the ARM64 binary at the same
path. Each depot remains architecture-specific.

Separate-depot packaging was uploaded as Steam build **26940437**:

- Linux x86-64 depot 5043862: manifest **1156214623444483669**
- Linux ARM64 depot 5043863: manifest **2057931815352484221** (unchanged)

Before making that build live, replace the old `linux64/Aether` Linux launch
entry with one Linux entry pointing to root `Aether`, then remove the duplicate
Frame launch entry.

## Why stock NW.js did not work

Stock Linux Chromium/NW.js can detect immersive OpenXR, but its Linux OpenXR
path does not support a WebGPU-backed XR projection layer. Æther requires:

```js
navigator.xr.requestSession('immersive-vr', {
  requiredFeatures: ['webgpu'],
  optionalFeatures: ['local-floor'],
});
```

The working runtime therefore carries a Linux WebGPU/OpenXR implementation,
plus two NW.js-specific fixes described below.

## Chromium/NW.js source changes

The committed patch is:

```text
e60fa39ee7e7 webxr: support WebGPU sessions with OpenXR on Linux
```

It:

- Adds `XRGPUCopySwapChain` on Linux. WebGPU renders into its own shared image,
  which is copied into the OpenXR Vulkan swapchain image at frame end.
- Adds raster read/write usage to OpenXR shared images.
- Handles WebGPU's top-left image origin without the OpenGL vertical flip.
- Enables the WebGPU session feature on Linux.

Three additional changes are currently uncommitted in the source tree:

1. `device/vr/openxr/openxr_device.cc`
   - Advertises `XRSessionFeature::WEBGPU` unconditionally.
   - NW.js applies app-manifest feature switches too late for the isolated XR
     service to reliably observe `WebXRWebGPUBinding`.
2. `content/browser/xr/service/vr_service_impl.cc`
   - Grants immersive-VR consent after Chromium's existing user-activation
     check.
   - NW.js app windows cannot display Chromium's normal VR permission prompt,
     so the request otherwise fails as `USER_DENIED_CONSENT`.
   - This bypass is acceptable only because this is a dedicated Æther runtime.
3. `extensions/browser/extension_protocols.cc`
   - Logs the generated NW.js background page as `[aether-nw]`.
   - This is diagnostic instrumentation and should be removed after the build
     is made reproducible.

Preserve the user-activation check. The consent fix must not allow a page to
enter immersive VR without a user gesture.

## Frame package differences

`targets.mjs` makes Frame a separate target using the local patched runtime. Its
important settings are:

- Ozone/X11 (`--ozone-platform=x11`)
- Vulkan/ANGLE Vulkan
- `WebXRLayers`, `WebXRWebGPUBinding`, and `OpenXR`
- `--disable-seccomp-filter-sandbox`
- `--disable-features=NWNewWin`
- Node main disabled
- injected desktop bridge disabled
- page Node context disabled
- `frame-launch.js` as the package entry point

The seccomp filter is disabled because SteamVR/OpenXR calls
`getsockopt(SO_PEERCRED)` while creating the OpenXR instance; Chromium's XR
sandbox kills that process otherwise.

The normal NW.js generated background page was corrupted when ARM Node context
was enabled, producing:

```text
Unexpected non-whitespace character after JSON
```

Disabling `node-main`, `inject_js_start`, and page Node context avoids that
failure. As a result, Steam bridge/integration is temporarily disabled on
Frame.

The entry point cannot create a remote NW.js window directly. It creates local
`frame.html`, which redirects to `https://aether.garden`.

The package also ships a real ARM64 `lib/libatspi.so.0`. Do not use the sysroot
linker stub/truncated copy; that caused a loader segmentation fault.

## Build and upload

Incremental runtime build:

```powershell
wsl.exe -d Aether-NW --cd /home/aether/nw-build/src -- `
  /home/aether/tools/depot_tools/autoninja -C out/nw nwjs -j 10
```

Package and copy the runtime:

```powershell
wsl.exe -d Aether-NW --cd /home/aether/nw-build/src -- `
  python3 content/nw/tools/package_binaries.py `
  -p out/nw -a arm64 -m normal -t linux -s nw

wsl.exe -d Aether-NW -- cp -f `
  /home/aether/nw-build/src/out/nw/dist/nwjs-v0.121.0-linux-arm64.tar.gz `
  /mnt/d/nw-build/artifacts/nwjs-v0.121.0-linux-arm64.tar.gz
```

`libatspi.so.0` must be beside the archive in `D:\nw-build\artifacts`; the
Steam build copies it into the distribution.

Build/upload only the Frame depot:

```powershell
cd steam-build
npm run zip:linux-arm64

$env:STEAM_BUILD_USER="your_build_account"
npm run upload:linux-arm64
```

The user sets the uploaded build live in Steamworks. Do not edit the installed
Steam library copy to deploy a test.

## Verification

In the shipped build:

1. Start Æther on Frame.
2. Select its flat window from the Frame taskbar if the OpenXR loading card
   remains visible.
3. Confirm the XR button reports immersive VR support.
4. Click XR and confirm the game renders in the headset.
5. Check `/tmp/aether.log` for failures:

```bash
grep -n 'frame-launch\|Uncaught\|FATAL\|session failed' /tmp/aether.log | tail -n 40
```

The successful path has all three:

- `navigator.xr.isSessionSupported('immersive-vr') === true`
- `XRGPUBinding` exists
- `navigator.gpu` exists

The previous final blocker looked like:

```text
OpenXR supports immersive-vr, but rejected the required WebGPU session feature
The user denied some part of the requested configuration
```

The first message was the application's interpretation; Chromium's actual
failure was the unshowable VR permission prompt, not missing GPU support.

## Known XR image-quality issue

The confirmed build enters XR, but its headset image appears lower-resolution
than normal. The 1280×720 size in `frame-launch.js` applies only to the flat
bootstrap window and does not control the XR projection texture.

Before changing quality settings, log and compare:

- `XRSession.nativeProjectionScaleFactor`
- the projection layer's `textureWidth` and `textureHeight`
- the OpenXR swapchain/shared-image dimensions

The likely causes are Frame's default projection scale or an unintended scale
in the Linux `XRGPUCopySwapChain` copy path. Increasing the projection layer
scale without measuring these values could hide a copy-size bug and add a large
GPU cost.

A local, not-yet-deployed change in `src/build-lite.mjs` now makes Lite request
`XRSession.nativeProjectionScaleFactor` and logs `[xr] projection` with the
native scale and resulting texture dimensions. `npm run build:lite` succeeds.
It remains undeployed because packaging the current working tree would include
many unrelated `src/` changes.

The same pending client change hides the NW.js app window after XR entry and
shows it again when the session ends. It uses `chrome.app.window.current()` and
safely does nothing in a normal browser. Frame still needs to confirm that this
API remains exposed after the local bootstrap redirects to `aether.garden`; if
not, the shell will need a small explicit message bridge.

## Cleanup guardrails

Before changing the working build:

- Commit/export all three currently uncommitted Chromium changes.
- Remove the generated-background-page diagnostic log separately.
- Keep Frame on its own runtime and depot; do not move Windows, Linux x64, or
  macOS to this custom runtime as part of cleanup.
- Keep each architecture in its own depot. Do not restore the old combined
  `dist-linux-combined` dispatcher package.
- Preserve `libatspi.so.0`, X11 Ozone, sandbox flags, and the Node-disabled
  bootstrap until each is independently retested.
- Use the single normal/default Linux launch option at root `Aether`.
- Verify immersive rendering after every cleanup step, not merely that the
  flat window opens.
