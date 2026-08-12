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
