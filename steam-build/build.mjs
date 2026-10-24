import nwbuild from 'nw-builder';

// Keep Steam on Chromium 155. NW.js 0.119.x (Chromium 156) aborts when
// WebGPU WebXR creates its shared-image swapchain (xr_gpu_swap_chain.cc:170).
const NW_VERSION = '0.118.0';

const arg = process.argv[2] || 'win';
const platform = arg === 'linux' ? 'linux' : 'win';
const outDir = process.env.AETHER_DIST_DIR || (platform === 'linux' ? './dist-linux' : './dist-win');

await nwbuild({
  mode: 'build',
  srcDir: './app',
  version: NW_VERSION,
  flavor: 'normal',
  platform,
  arch: 'x64',
  outDir,
  glob: false,
  managedManifest: true,
  app: {
    name: 'Aether',
    icon: platform === 'linux' ? './app/build/icon.png' : './app/build/icon.ico',
  },
});

console.log('[steam-build] Built to ' + outDir + '/ (' + platform + ' x64)');
