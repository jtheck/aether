# Reusable Steam Frame WebGPU WebXR Porting Guide

This is the reproducible recipe behind Æther.Garden's native Steam Frame build.
It is written for reuse by another project, not just as a history of this port.

## What this setup provides

- Native Linux ARM64 NW.js on Steam Frame.
- WebGPU rendering through Vulkan/ANGLE.
- Immersive WebXR through Steam's OpenXR runtime.
- A Linux WebGPU-to-OpenXR copy swapchain missing from stock Chromium.
- A matched 2048×2048 render and OpenXR destination per eye.
- One Linux Steam launch option that works on both x86-64 and ARM64.
- Separate x86-64 and ARM64 depot payloads without path collisions.

Known-good versions:

- NW.js **0.121.0**
- Chromium **158.0.8127.37**
- NW.js Chromium source base
  `90c5d0bcfc9100cf3df3bcc1574e022e681ffeab`
- Source repository: `https://github.com/nwjs/chromium.src.git`
- Steam compatibility runtime: **Runtime 4 ARM**
- Æther's final verified Steam build: **26957512**

## What is reusable and what is project-specific

Reusable:

- The four Chromium/NW.js patches under `patches/nwjs-frame/`.
- ARM64 NW.js build and packaging commands.
- Vulkan, OpenXR, Ozone/X11, sandbox, and framebuffer-scale flags.
- The architecture dispatcher/depot layout.
- The local-bootstrap-to-remote-page pattern.
- The verification and failure-diagnosis procedure.

Project-specific:

- App/depot IDs, URLs, names, icons, and Steam account.
- The immersive-VR permission bypass in patch 2. It is appropriate only for a
  dedicated runtime that loads trusted project content.
- The requested XR scale. Æther uses 1.456 because PC Link rendered this
  headset at 2516² while Frame recommended 1728².
- Whether Node, injected scripts, and Steam integration can be restored.
- Web application engine integration. Æther patches `@babylonjs/lite`.

## Runtime patch series

The actual patches are checked in:

```text
patches/nwjs-frame/
  0001-webxr-support-WebGPU-sessions-with-OpenXR-on-Linux.patch
  0002-nwjs-enable-Aether-WebGPU-XR-sessions-on-Frame.patch
  0003-openxr-log-Frame-view-size-limits.patch
  0004-openxr-enable-Linux-viewport-scaling-for-Aether.patch
```

Apply them to the pinned NW.js Chromium checkout:

```bash
cd /path/to/chromium.src
git checkout 90c5d0bcfc9100cf3df3bcc1574e022e681ffeab
git switch -c frame-webgpu-xr
git am /path/to/project/steam-build/patches/nwjs-frame/*.patch
```

Patch 1 adds the core Linux implementation:

- `XRGPUCopySwapChain` lets WebGPU render into a WebGPU-compatible shared image.
- At frame end, Chromium copies it into the OpenXR Vulkan shared image.
- OpenXR shared images gain raster read/write usage.
- WebGPU's top-left image origin avoids the OpenGL vertical flip.
- Linux advertises the WebGPU XR session feature.

Patch 2 handles NW.js integration:

- OpenXR advertises `XRSessionFeature::WEBGPU` even though NW.js applies
  manifest feature switches after the isolated XR service starts.
- Immersive VR is allowed after Chromium's existing user-activation check,
  because NW.js app windows cannot show Chromium's normal VR permission prompt.
- It also contains temporary generated-background-page and copy-size logging.

Patch 3 logs OpenXR's recommended and maximum dimensions.

Patch 4 enables Chromium's viewport-scaling path on Linux. Stock Chromium
explicitly disables it. The custom copy path supports matched resized source and
destination images.

Security requirement: do not remove Chromium's user-activation check. Do not
reuse the consent bypass in a general-purpose browser or an untrusted shell.

## Building NW.js ARM64

The successful environment was an Ubuntu WSL2 distro named `Aether-NW`, with:

```text
/home/aether/tools/depot_tools
/home/aether/nw-build/src
```

Follow NW.js's Chromium build prerequisites to install depot_tools, system
packages, and sync the checkout's DEPS. The important release GN values are:

```gn
target_cpu = "arm64"
is_debug = false
is_component_build = false
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0
enable_openxr = true
enable_vulkan = true
nwjs_sdk = false
use_sysroot = true
```

Generate `out/nw` with those values and the normal NW.js release arguments.
Build:

```bash
/home/aether/tools/depot_tools/autoninja -C out/nw nwjs -j 10
```

Package:

```bash
python3 content/nw/tools/package_binaries.py \
  -p out/nw -a arm64 -m normal -t linux -s nw
```

The resulting archive is:

```text
out/nw/dist/nwjs-v0.121.0-linux-arm64.tar.gz
```

Æther copies it to:

```text
D:\nw-build\artifacts\nwjs-v0.121.0-linux-arm64.tar.gz
```

The runtime also needs a real ARM64 `libatspi.so.0` beside the archive. The
build copies it into `lib/libatspi.so.0`. A sysroot linker stub or truncated
copy caused an immediate loader segmentation fault.

## Required Chromium flags

The working Frame target uses:

```text
--no-sandbox
--disable-gpu-sandbox
--disable-seccomp-filter-sandbox
--ozone-platform=x11
--enable-unsafe-webgpu
--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,WebXRLayers,WebXRWebGPUBinding,OpenXR
--use-angle=vulkan
--ignore-gpu-blocklist
--disable-features=NWNewWin
--webxr-max-framebuffer-scale=1.456
```

Why:

- `x11`: Frame provides the working app display through X11.
- Vulkan/ANGLE Vulkan: required for WebGPU and the OpenXR Vulkan path.
- `OpenXR`, `WebXRLayers`, `WebXRWebGPUBinding`: expose the required APIs.
- `--disable-seccomp-filter-sandbox`: SteamVR calls
  `getsockopt(SO_PEERCRED)` during `xrCreateInstance`; Chromium's XR sandbox
  killed the process without this.
- `NWNewWin` disabled: uses the stable NW.js window path for this runtime.
- framebuffer scale 1.456: bounds the runtime's reported 8192² maximum.

These sandbox exceptions increase risk. Use this runtime only for the dedicated
trusted application.

## NW.js manifest and bootstrap

The reliable ARM64 package disables:

```json
{
  "nodejs": false
}
```

It also removes:

```text
node-main
inject_js_start
```

With ARM Node context enabled, NW.js produced:

```text
Unexpected non-whitespace character after JSON
```

from its generated background page. Disabling Node context removed the
corruption. This temporarily disables Æther's Steam bridge on Frame.

NW.js refused to create a remote app window directly:

```text
The URL used for window creation must be local for security reasons.
```

The reliable pattern is:

1. Make a local script the manifest entry point.
2. Create a local HTML app window.
3. Redirect that local page to the trusted HTTPS application.

See `app/frame-launch.js` and `app/frame.html`.

## Web application requirements

The application requests:

```js
await navigator.xr.requestSession('immersive-vr', {
  requiredFeatures: ['webgpu'],
  optionalFeatures: ['local-floor'],
});
```

Verify all three before offering the XR button:

```js
await navigator.xr.isSessionSupported('immersive-vr');
typeof XRGPUBinding === 'function';
!!navigator.gpu;
```

Æther's `@babylonjs/lite` bundle patch:

- Passes a requested projection scale of at least 1.456.
- Logs the requested scale and actual texture dimensions.
- Keeps the ordinary browser behavior safe because stock runtimes clamp the
  requested scale to their own maximum.

Frame's GPU reports a 4096 maximum 2D texture width. The Linux workaround packs
both eyes side by side, so the practical ceiling is **2048×2048 per eye**.
Requesting 1.456 reaches that ceiling:

```text
source=4096x2048 destination=4096x2048
```

PC Link renders at 2516², but reaching that on Frame would require replacing the
side-by-side shared-image design and would add roughly 51% more pixels than
2048². The verified standalone compromise is 2048².

## Steam depots and launch configuration

Steam exposes both ARM64 and x86-64 native Linux depots as `osarch=64`. Both
depots may be installed on either Linux architecture. Therefore, never publish
both architecture-specific ELFs to the same depot path.

Working install layout:

```text
Aether                       # POSIX architecture dispatcher
linux64/
  Aether
  Aether.sh
  ...x86-64 NW.js payload...
linux-arm64/
  Aether
  Aether.sh
  ...ARM64 NW.js payload...
```

Depot responsibilities:

- Linux x86-64 depot supplies root `Aether` and `linux64/`.
- Linux ARM64 depot maps its payload to `linux-arm64/`.
- `stage-linux-depot.mjs` creates the root dispatcher.
- The dispatcher selects with `uname -m`.

Use one Steamworks Linux launch option:

```text
Executable: Aether
Arguments:  empty
Type:       Launch (Default)
OS:         Linux
```

Do not use separate visible x86 and Frame launch options. Do not use
`linux64/Aether` as the published launch path.

`Launch OpenXR App` worked technically but showed an XR loading card while the
WebXR application was still a flat window waiting for a user click. The default
launch type gives the clean flow. OpenXR remains available.

Use **Runtime 4 ARM** for Frame. The published app mapping appears globally as
`SteamLinuxRuntime_steamrt4-arm64`, but the final dispatcher layout was verified
on both x86-64 Linux and Frame.

## Build and upload

Project-specific target configuration is in:

```text
targets.mjs
build.mjs
postbuild-trim.mjs
upload-steam.mjs
stage-linux-depot.mjs
```

Build the ARM64 package:

```powershell
cd steam-build
npm run zip:linux-arm64
```

Upload both Linux depots together after changing their install layout:

```powershell
$env:STEAM_BUILD_USER="your_build_account"
node upload-steam.mjs --linux-only --linux-arm64-only
```

Do not put a Steam password in scripts or environment examples. SteamCMD can
reuse its authenticated build session.

The upload only creates a Steam build. Set that build live in Steamworks after
reviewing both depot manifests.

## Verification

On Frame:

```bash
grep -E '\[xr\] projection|\[aether-xr-copy\]|\[aether-xr-view\]|session failed' \
  /tmp/aether.log | tail -n 20
```

Verified final dimensions:

```text
[xr] projection {"nativeScale":1,"requestedScale":1.456,"textureWidth":2048,"textureHeight":2048}
[aether-xr-copy] source=4096x2048 destination=4096x2048 descriptor=4096x2048
```

Functional checks:

1. Launch from Steam with no launch-option chooser.
2. Select the flat app window from the Frame taskbar.
3. Click XR and confirm immersive rendering.
4. Exit XR with the XR button.
5. Click XR again and confirm manual re-entry.
6. Start a map with XR Auto and confirm automatic re-entry.
7. Check sharpness and frame rate at 2048².

On x86-64 Linux:

```bash
P="$HOME/.local/share/Steam/steamapps/common/Your.Game"
uname -m
file "$P/Aether"
file "$P/linux64/Aether"
```

Expected:

- Root `Aether` is a POSIX shell script.
- `linux64/Aether` is an x86-64 ELF.
- Steam starts and keeps the game running.

On Frame:

```bash
file "$P/linux-arm64/Aether"
```

Expected: ARM aarch64 ELF.

## Failure signatures

XR support false:

- Ensure `OpenXR` is enabled.
- Ensure Runtime 4 ARM is selected.
- Ensure the seccomp filter is disabled for this dedicated runtime.

`XRGPUBinding` or WebGPU feature rejected:

- Confirm the Linux WebGPU XR patch was applied.
- Confirm the runtime advertises `XRSessionFeature::WEBGPU`.
- Confirm the page requests required feature `webgpu`.

`The user denied some part of the requested configuration`:

- NW.js could not present the VR permission prompt.
- Use the dedicated-runtime consent patch while preserving user activation.

Source and destination sizes differ:

- The page did not request enough projection scale, or Chromium clamped it.
- Confirm `requestedScale`, the framebuffer-scale switch, viewport-scaling
  patch, and WebGPU max texture dimension.

Game says Running, then immediately exits on x86 Linux:

- Run `file` on root `Aether`.
- If it is ARM aarch64, the ARM depot overwrote the x86 launch path.
- Restore the dispatcher/subdirectory depot layout.

Generated background-page JSON syntax error:

- Disable ARM Node context, `node-main`, and injected startup scripts.

Loader segmentation fault before Chromium logs:

- Replace `libatspi.so.0` with the actual ARM64 runtime library.

## Current deliberate limitations

- The Frame package has no Node page context or Æther Steam bridge.
- The dedicated runtime weakens Chromium sandboxing.
- The 2D app window stays present when XR begins; hiding it was tested and
  intentionally reverted.
- Diagnostic runtime logs remain enabled.
- 2048² per eye is the practical side-by-side texture ceiling.

## Checklist for another project

1. Pin NW.js/Chromium to the known-good base.
2. Apply all four checked-in runtime patches.
3. Build and package native ARM64 NW.js.
4. Ship a real ARM64 `libatspi.so.0`.
5. Use the required Vulkan/OpenXR/X11 flags.
6. Disable Node/background injection until independently proven safe.
7. Bootstrap through a local page before redirecting to trusted HTTPS.
8. Request an immersive session with required feature `webgpu`.
9. Request enough scale to match the OpenXR destination.
10. Use one root Linux dispatcher and architecture subdirectories.
11. Upload both Linux depots together after layout changes.
12. Verify dimensions, manual XR re-entry, XR Auto, x86 launch, and Frame launch.
