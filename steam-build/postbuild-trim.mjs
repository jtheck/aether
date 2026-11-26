import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveTarget } from './targets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = resolveTarget(process.argv[2] || 'win');
if (!target) {
  console.error('[steam-build] Unknown target. Use win, linux, linux-arm64, or osx.');
  process.exit(1);
}
const distRoot = path.resolve(process.env.AETHER_DIST_DIR || target.outDir);

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
  console.log('[steam-build] Removed dist/.nw-user-data (local profile - do not ship)');
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

spawnSync(process.execPath, ['copy-steam-redist.mjs', distRoot, target.id], {
  stdio: 'inherit',
  cwd: __dirname,
});

if (target.ozone) {
  const launcherSrc = path.join(__dirname, 'Aether.sh');
  const launcherDest = path.join(distRoot, 'Aether.sh');
  if (fs.existsSync(launcherSrc)) {
    const features = chromiumFeatures(target);
    let sh = fs.readFileSync(launcherSrc, 'utf8')
      .replace('--ozone-platform=x11', '--ozone-platform=' + target.ozone)
      .replace(
        '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,WebXRLayers,WebXRWebGPUBinding',
        '--enable-features=' + features,
      );
    if (target.chromiumExtra && !sh.includes(target.chromiumExtra)) {
      sh = sh.replace(
        '  --ignore-gpu-blocklist \\\n',
        '  --ignore-gpu-blocklist \\\n  ' + target.chromiumExtra + ' \\\n',
      );
    }
    fs.writeFileSync(launcherDest, sh);
    try { fs.chmodSync(launcherDest, 0o755); } catch (_err) { /* cross-build on Windows */ }
    console.log('[steam-build] Wrote Aether.sh (ozone ' + target.ozone + ') →', distRoot);
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

  const manifestPath = path.join(distRoot, target.packageRel, 'package.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (target.disableNodeMain) {
      delete manifest['node-main'];
      console.log('[steam-build] Disabled node-main for Frame background-page compatibility');
    }
    if (target.disableInjectScript) {
      delete manifest.inject_js_start;
      console.log('[steam-build] Disabled injected bridge for Frame background-page compatibility');
    }
    if (target.disableNode) {
      manifest.nodejs = false;
      console.log('[steam-build] Disabled Node context for Frame Chromium isolation');
    }
    if (target.mainScript) {
      manifest.main = target.mainScript;
      console.log('[steam-build] Using Frame window bootstrap ' + target.mainScript);
    }
    const extra = '--no-sandbox --disable-gpu-sandbox --ozone-platform=' + target.ozone
      + ' --enable-unsafe-webgpu --enable-features=' + chromiumFeatures(target)
      + ' --use-angle=vulkan --ignore-gpu-blocklist'
      + (target.chromiumExtra ? ' ' + target.chromiumExtra : '');
    let args = typeof manifest['chromium-args'] === 'string' ? manifest['chromium-args'] : '';
    // Brave presents without this. In-process GPU is what the Steam shell adds,
    // and mapAsync stalls there after the first frames.
    const withoutInProcess = args.replace(/(?:^|\s)--in-process-gpu(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    let next = withoutInProcess;
    if (!next.includes('--enable-unsafe-webgpu')) next = (next + ' ' + extra).trim();
    if (next !== args) manifest['chromium-args'] = next;
    if (next !== args || target.disableNodeMain) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log('[steam-build] Linux Chromium flags: Vulkan on, in-process GPU off, ozone ' + target.ozone);
    }
  }
}

// A relative --user-data-dir must already exist. The Steam package does not ship
// .nw-user-data, so the first launch fails. The default profile dir is writable.
stripShippedUserDataDir();

function chromiumFeatures(target) {
  return target.chromiumFeatures
    || 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,WebXRLayers,WebXRWebGPUBinding';
}

function stripShippedUserDataDir() {
  const manifestPath = path.join(distRoot, target.packageRel, 'package.json');
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest['chromium-args'] !== 'string') return;
  let next = manifest['chromium-args']
    .replace(/(?:^|\s)--user-data-dir=\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Mac launches with this and the GPU thread abort()s the whole app.
  // Linux already drops it. A separate GPU process can die without quitting.
  if (target.nwPlatform === 'osx') {
    next = next.replace(/(?:^|\s)--in-process-gpu(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (next === manifest['chromium-args']) return;
  manifest['chromium-args'] = next;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('[steam-build] Adjusted shipped Chromium flags');
}
