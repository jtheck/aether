import path from 'node:path';

// One Steam upload can contain every target whose depot ID is set.
// Frame is Linux ARM64. The Mac depot is Intel x64 (Apple Silicon runs it through Rosetta).
export const TARGETS = {
  win: {
    id: 'win',
    nwPlatform: 'win',
    arch: 'x64',
    outDir: 'dist-win',
    zipName: 'Aether-win64.zip',
    launchRel: 'Aether.exe',
    packageRel: 'package.nw',
    nodeDist: 'win-x64',
    nodePack: 'zip',
    nodeBin: 'node.exe',
    koffi: 'win32_x64',
    steamDir: 'win64',
    steamFile: 'steam_api64.dll',
    depotKey: 'win',
    label: 'win64',
  },
  linux: {
    id: 'linux',
    nwPlatform: 'linux',
    arch: 'x64',
    outDir: 'dist-linux',
    zipName: 'Aether-linux64.zip',
    launchRel: 'Aether',
    packageRel: 'package.nw',
    nodeDist: 'linux-x64',
    nodePack: 'tar.xz',
    nodeBin: 'node',
    koffi: 'linux_x64',
    steamDir: 'linux64',
    steamFile: 'libsteam_api.so',
    depotKey: 'linux',
    label: 'linux64',
    ozone: 'x11',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    nwPlatform: 'linux',
    arch: 'arm64',
    outDir: 'dist-linux-arm64',
    zipName: 'Aether-linux-arm64.zip',
    launchRel: 'Aether',
    packageRel: 'package.nw',
    nodeDist: 'linux-arm64',
    nodePack: 'tar.xz',
    nodeBin: 'node',
    koffi: 'linux_arm64',
    steamDir: 'linuxarm64',
    steamFile: 'libsteam_api.so',
    depotKey: 'linuxArm64',
    label: 'linuxarm64',
    ozone: 'x11',
    // This local NW.js 0.121 build carries the Linux OpenXR WebGPU swap-chain
    // patch. Stock Linux NW.js cannot run the game's WebGPU XR session.
    nwVersion: '0.121.0',
    nwArchive: process.env.AETHER_FRAME_NW_ARCHIVE
      || 'D:\\nw-build\\artifacts\\nwjs-v0.121.0-linux-arm64.tar.gz',
    chromiumFeatures: 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,WebXRLayers,WebXRWebGPUBinding,OpenXR',
    // SteamVR on the Frame calls getsockopt(SO_PEERCRED) inside xrCreateInstance.
    // The XR sandbox kills that process, and the support check stays false.
    // Frame recommends 1728² but PC Link renders this headset at 2516².
    // The patched Linux OpenXR path supports viewport scaling; cap it to the
    // matching 2516 / 1728 ratio instead of accepting Frame's 8192² maximum.
    chromiumExtra: '--disable-seccomp-filter-sandbox --disable-features=NWNewWin --webxr-max-framebuffer-scale=1.456',
    disableNodeMain: true,
    disableInjectScript: true,
    disableNode: true,
    mainScript: 'frame-launch.js',
  },
  osx: {
    id: 'osx',
    nwPlatform: 'osx',
    arch: 'x64',
    outDir: 'dist-osx',
    zipName: 'Aether-osx-x64.zip',
    launchRel: 'Aether.app/Contents/MacOS/Aether',
    packageRel: 'Aether.app/Contents/Resources/app.nw',
    nodeDist: 'darwin-x64',
    nodePack: 'tar.gz',
    nodeBin: 'node',
    koffi: 'darwin_x64',
    steamDir: 'osx',
    steamFile: 'libsteam_api.dylib',
    depotKey: 'osx',
    label: 'osx64',
  },
};

export const TARGET_ORDER = ['win', 'linux', 'linux-arm64', 'osx'];

export function resolveTarget(arg) {
  if (!arg) return null;
  if (TARGETS[arg]) return TARGETS[arg];
  const base = path.basename(String(arg).replace(/[\\/]+$/, ''));
  return Object.values(TARGETS).find((target) => target.outDir === base) || null;
}
