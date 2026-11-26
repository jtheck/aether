import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { TARGETS } from './targets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, 'app');
const outDir = path.join(appRoot, 'node-steam');
const markerPath = path.join(__dirname, 'cache', 'node-steam-target.txt');
const NODE_VERSION = process.env.AETHER_NODE_STEAM_VERSION || 'v22.16.0';

const argTargets = process.argv.slice(2).filter((arg) => Object.hasOwn(TARGETS, arg));
const targets = argTargets.length
  ? argTargets.filter((id, index, arr) => arr.indexOf(id) === index)
  : [process.platform === 'win32' ? 'win' : 'linux'];

if (process.argv.slice(2).some((arg) => !Object.hasOwn(TARGETS, arg))) {
  console.error('[steam-build] Unknown node-steam target. Use win, linux, linux-arm64, or osx.');
  process.exit(1);
}

function download(fileUrl, dest) {
  return new Promise(function (resolve, reject) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(fileUrl, function (res) {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.rmSync(dest, { force: true });
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error('Download failed: ' + res.statusCode + ' ' + fileUrl));
        return;
      }
      res.pipe(file);
      file.on('finish', function () { file.close(resolve); });
    }).on('error', reject);
  });
}

function clearNodeBins() {
  for (const name of ['node', 'node.exe']) {
    const bin = path.join(outDir, name);
    if (fs.existsSync(bin)) fs.rmSync(bin, { force: true });
  }
}

async function ensureTarget(target) {
  const nodeBin = path.join(outDir, target.nodeBin);
  const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
  if (marker === target.id && fs.existsSync(nodeBin)) {
    console.log('[steam-build] node-steam already present:', nodeBin, '(' + target.id + ')');
    return;
  }

  const folder = `node-${NODE_VERSION}-${target.nodeDist}`;
  const archiveName = target.nodePack === 'zip' ? `${folder}.zip` : `${folder}.${target.nodePack}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}`;
  const cacheDir = path.join(__dirname, 'cache');
  const cacheArchive = path.join(cacheDir, archiveName);

  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(cacheArchive)) {
    console.log('[steam-build] Downloading', url);
    await download(url, cacheArchive);
  }

  if (target.nodePack === 'zip') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${cacheArchive.replace(/'/g, "''")}' -DestinationPath '${cacheDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'inherit' },
    );
  } else {
    const member = `${folder}/bin/node`;
    const flags = target.nodePack === 'tar.gz' ? '-xzf' : '-xJf';
    execSync(`tar ${flags} "${cacheArchive}" -C "${cacheDir}" "${member}"`, { stdio: 'inherit' });
  }

  const extracted = target.nodePack === 'zip'
    ? path.join(cacheDir, folder, 'node.exe')
    : path.join(cacheDir, folder, 'bin', 'node');
  if (!fs.existsSync(extracted)) {
    throw new Error('Node binary missing after extract: ' + extracted);
  }

  fs.mkdirSync(outDir, { recursive: true });
  clearNodeBins();
  fs.copyFileSync(extracted, nodeBin);
  try { fs.chmodSync(nodeBin, 0o755); } catch (_err) { /* cross-build on Windows */ }
  fs.writeFileSync(markerPath, target.id);
  console.log('[steam-build] Installed node-steam →', nodeBin, '(' + target.id + ')');
}

async function main() {
  for (const id of targets) await ensureTarget(TARGETS[id]);
}

main().catch(function (err) {
  console.error('[steam-build] ensure-node-steam failed:', err.message);
  process.exit(1);
});
