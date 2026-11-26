import fs from 'fs';
import path from 'path';
import { resolveTarget } from './targets.mjs';

const distRoot = path.resolve(process.argv[2] || 'dist-win');
const target = resolveTarget(process.argv[3] || distRoot);

if (!target) {
  console.error('[steam-build] Unknown target for steam redist:', process.argv[3] || distRoot);
  process.exit(1);
}

const sdkRoot = (process.env.STEAMWORKS_SDK || 'C:\\Users\\blind\\steamworks_sdk').trim();
const appIdFile = path.resolve('app/steam_appid.txt');
const packageRoot = path.join(distRoot, target.packageRel);

if (fs.existsSync(appIdFile)) {
  fs.copyFileSync(appIdFile, path.join(distRoot, 'steam_appid.txt'));
  if (fs.existsSync(packageRoot)) {
    fs.copyFileSync(appIdFile, path.join(packageRoot, 'steam_appid.txt'));
  }
  if (target.nwPlatform === 'osx') {
    const macOs = path.join(distRoot, 'Aether.app', 'Contents', 'MacOS');
    if (fs.existsSync(macOs)) fs.copyFileSync(appIdFile, path.join(macOs, 'steam_appid.txt'));
  }
  console.log('[steam-build] Copied steam_appid.txt →', distRoot);
} else {
  console.warn('[steam-build] app/steam_appid.txt missing - copy steam_appid.txt.example and set your App ID');
}

if (!sdkRoot) {
  console.warn(
    '[steam-build] STEAMWORKS_SDK not set - skip copying steam_api redistributables. ' +
      'Set to your SDK root (contains redistributable_bin/) before dist for Steam builds.'
  );
  process.exit(0);
}

const redistDir = path.join(sdkRoot, 'redistributable_bin');
if (!fs.existsSync(redistDir)) {
  console.warn('[steam-build] redistributable_bin missing under STEAMWORKS_SDK:', sdkRoot);
  process.exit(0);
}

const from = path.join(redistDir, target.steamDir, target.steamFile);
if (!fs.existsSync(from)) {
  console.warn('[steam-build] Steam redist not found:', from);
  process.exit(0);
}

const destinations = [
  path.join(distRoot, target.packageRel, 'steamworks_sdk', 'redistributable_bin', target.steamDir, target.steamFile),
];
if (target.nwPlatform === 'osx') {
  destinations.push(path.join(distRoot, 'Aether.app', 'Contents', 'MacOS', target.steamFile));
} else {
  destinations.push(path.join(distRoot, target.steamFile));
}

for (const to of destinations) {
  if (!fs.existsSync(path.dirname(to))) continue;
  fs.copyFileSync(from, to);
  console.log('[steam-build] Copied', path.basename(to), '→', path.dirname(to));
}

process.exit(0);
