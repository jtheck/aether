import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const nwRoot = path.join(root, 'node_modules', 'nw');
const nwPkg = JSON.parse(fs.readFileSync(path.join(nwRoot, 'package.json'), 'utf8'));
const version = nwPkg.version.replace(/-sdk$/, '').split('-')[0];

const { default: get } = await import(pathToFileURL(path.join(nwRoot, 'src', 'get.js')).href);
const { default: parse } = await import(pathToFileURL(path.join(nwRoot, 'src', 'parse.js')).href);
const { default: util } = await import(pathToFileURL(path.join(nwRoot, 'src', 'util.js')).href);

const platform = util.PLATFORM_KV[process.platform];
const arch = util.ARCH_KV[process.arch];
const sdkDir = path.join(
  nwRoot,
  `nwjs-sdk-v${version}-${platform}-${arch}`,
);
const exe = path.join(sdkDir, util.EXE_NAME[platform]);

if (fs.existsSync(exe)) {
  process.exit(0);
}

console.log(`[steam-build] Downloading NW.js SDK v${version} (${platform}-${arch})…`);

const options = await parse({ version, flavor: 'sdk', platform, arch, cacheDir: nwRoot });
try {
  await get(options);
} catch (err) {
  console.warn('[steam-build] SDK download reported an error (often harmless):', err.message);
}

if (!fs.existsSync(exe)) {
  console.error('[steam-build] SDK nw.exe still missing after download:', exe);
  process.exit(1);
}

console.log('[steam-build] SDK ready.');
