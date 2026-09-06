import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(process.argv[2] || 'dist-win');

function trimLocalesDir(localesDir) {
  if (!fs.existsSync(localesDir)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(localesDir)) {
    if (file !== 'en-US.pak') {
      fs.unlinkSync(path.join(localesDir, file));
      removed += 1;
    }
  }
  return removed;
}

function walk(root) {
  if (!fs.existsSync(root)) return;
  trimLocalesDir(path.join(root, 'locales'));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(root, entry.name));
  }
}

function removeDistUserData() {
  const userData = path.join(distRoot, '.nw-user-data');
  if (!fs.existsSync(userData)) return;
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('[steam-build] Removed dist/.nw-user-data (local profile — do not ship)');
}

// Ship builds: strip --remote-debugging-port from package.nw/package.json before upload.
// function stripRemoteDebuggingFromManifest() {
//   const manifestPath = path.join(distRoot, 'package.nw', 'package.json');
//   if (!fs.existsSync(manifestPath)) return;
//   const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
//   if (typeof manifest['chromium-args'] === 'string') {
//     manifest['chromium-args'] = manifest['chromium-args']
//       .replace(/\s*--remote-debugging-port=\d+/g, '')
//       .trim();
//   }
//   fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
//   console.log('[steam-build] Stripped --remote-debugging-port from dist/package.nw/package.json');
// }

if (fs.existsSync(distRoot)) {
  const licenses = path.join(distRoot, 'LICENSES.chromium.html');
  if (fs.existsSync(licenses)) fs.unlinkSync(licenses);
  walk(distRoot);
  trimLocalesDir(path.join(distRoot, 'locales'));
  removeDistUserData();
  // stripRemoteDebuggingFromManifest();
  console.log('[steam-build] Trimmed locales + LICENSES in dist/');
} else {
  console.warn('[steam-build] No dist/ folder to trim');
}

const plat = distRoot.includes('linux') ? 'linux' : 'win';
spawnSync(process.execPath, ['copy-steam-redist.mjs', distRoot, plat], {
  stdio: 'inherit',
  cwd: __dirname,
});

if (plat === 'linux') {
  const launcherSrc = path.join(__dirname, 'Aether.sh');
  const launcherDest = path.join(distRoot, 'Aether.sh');
  if (fs.existsSync(launcherSrc)) {
    fs.copyFileSync(launcherSrc, launcherDest);
    try { fs.chmodSync(launcherDest, 0o755); } catch (_err) { /* cross-build on Windows */ }
    console.log('[steam-build] Copied Aether.sh →', distRoot);
  }

  // nw-builder on Windows writes host paths into the .desktop file.
  fs.writeFileSync(
    path.join(distRoot, 'Aether.desktop'),
    `[Desktop Entry]
Type=Application
Version=1.5
Name=Aether
Comment=Aether.Garden
Exec=Aether.sh
Icon=package.nw/build/icon.png
Path=.
Terminal=false
Categories=Game;
`,
  );
  console.log('[steam-build] Rewrote Aether.desktop for Linux');

  const manifestPath = path.join(distRoot, 'package.nw', 'package.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extra = '--no-sandbox --disable-gpu-sandbox --ozone-platform=x11 --enable-unsafe-webgpu --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE --use-angle=vulkan --ignore-gpu-blocklist';
    const args = typeof manifest['chromium-args'] === 'string' ? manifest['chromium-args'] : '';
    if (!args.includes('--enable-unsafe-webgpu')) {
      manifest['chromium-args'] = (args + ' ' + extra).trim();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log('[steam-build] Added Linux Chromium sandbox/WebGPU flags');
    }
  }
}
