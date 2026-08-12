import fs from 'fs';
import path from 'path';

const distRoot = path.resolve(process.argv[2] || 'dist-win');
const platform = process.argv[3] || (distRoot.includes('linux') ? 'linux' : 'win');

const sdkRoot = (process.env.STEAMWORKS_SDK || '').trim();
const appIdFile = path.resolve('app/steam_appid.txt');

if (fs.existsSync(appIdFile)) {
  fs.copyFileSync(appIdFile, path.join(distRoot, 'steam_appid.txt'));
  const pkgAppId = path.join(distRoot, 'package.nw', 'steam_appid.txt');
  if (fs.existsSync(path.dirname(pkgAppId))) {
    fs.copyFileSync(appIdFile, pkgAppId);
  }
  console.log('[steam-build] Copied steam_appid.txt →', distRoot);
} else {
  console.warn('[steam-build] app/steam_appid.txt missing — copy steam_appid.txt.example and set your App ID');
}

if (!sdkRoot) {
  console.warn(
    '[steam-build] STEAMWORKS_SDK not set — skip copying steam_api redistributables. ' +
      'Set to your SDK root (contains redistributable_bin/) before dist for Steam builds.'
  );
  process.exit(0);
}

const redistDir = path.join(sdkRoot, 'redistributable_bin');
if (!fs.existsSync(redistDir)) {
  console.warn('[steam-build] redistributable_bin missing under STEAMWORKS_SDK:', sdkRoot);
  process.exit(0);
}

const copies =
  platform === 'linux'
    ? [{ from: path.join(redistDir, 'linux64', 'libsteam_api.so'), to: path.join(distRoot, 'libsteam_api.so') }]
    : [{ from: path.join(redistDir, 'win64', 'steam_api64.dll'), to: path.join(distRoot, 'steam_api64.dll') }];

for (const { from, to } of copies) {
  if (!fs.existsSync(from)) {
    console.warn('[steam-build] Steam redist not found:', from);
    continue;
  }
  fs.copyFileSync(from, to);
  const pkgDll = path.join(distRoot, 'package.nw', 'steamworks_sdk', 'redistributable_bin', platform === 'linux' ? 'linux64' : 'win64', path.basename(from));
  if (fs.existsSync(path.dirname(pkgDll))) {
    fs.copyFileSync(from, pkgDll);
  }
  console.log('[steam-build] Copied', path.basename(to), '→', distRoot);
}

// app id already copied above
process.exit(0);
