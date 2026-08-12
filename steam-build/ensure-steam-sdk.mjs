import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const steamBuildRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(steamBuildRoot, 'app');

const copies = [
  {
    dll: path.join(appRoot, 'steamworks_sdk', 'redistributable_bin', 'win64', 'steam_api64.dll'),
    sources: [
      process.env.STEAMWORKS_SDK &&
        path.join(process.env.STEAMWORKS_SDK, 'redistributable_bin', 'win64', 'steam_api64.dll'),
      path.join(appRoot, 'node_modules', 'steamworks.js', 'dist', 'win64', 'steam_api64.dll'),
    ].filter(Boolean),
  },
  {
    dll: path.join(appRoot, 'steamworks_sdk', 'redistributable_bin', 'linux64', 'libsteam_api.so'),
    sources: [
      process.env.STEAMWORKS_SDK &&
        path.join(process.env.STEAMWORKS_SDK, 'redistributable_bin', 'linux64', 'libsteam_api.so'),
    ].filter(Boolean),
  },
];

for (const { dll, sources } of copies) {
  const force = !!process.env.STEAMWORKS_SDK;
  if (fs.existsSync(dll) && !force) continue;
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dll), { recursive: true });
    fs.copyFileSync(src, dll);
    console.log('[steam-build] Copied', path.basename(dll), '→', path.dirname(dll));
    break;
  }
}
