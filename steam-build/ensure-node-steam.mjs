import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, 'app');
const outDir = path.join(appRoot, 'node-steam');
const NODE_VERSION = process.env.AETHER_NODE_STEAM_VERSION || 'v22.16.0';

const argTargets = process.argv.slice(2).filter(function (a) { return a === 'win' || a === 'linux' || a === 'all'; });
const targets = argTargets.includes('all')
  ? ['win', 'linux']
  : argTargets.length
    ? argTargets.filter(function (p, i, arr) { return arr.indexOf(p) === i; })
    : [process.platform === 'win32' ? 'win' : 'linux'];

function download(fileUrl, dest) {
  return new Promise(function (resolve, reject) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(fileUrl, function (res) {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error('Download failed: ' + res.statusCode));
        return;
      }
      res.pipe(file);
      file.on('finish', function () { file.close(resolve); });
    }).on('error', reject);
  });
}

async function ensureWin() {
  const nodeBin = path.join(outDir, 'node.exe');
  if (fs.existsSync(nodeBin)) {
    console.log('[steam-build] node-steam already present:', nodeBin);
    return;
  }

  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${zipName}`;
  const cacheZip = path.join(__dirname, 'cache', zipName);

  fs.mkdirSync(path.join(__dirname, 'cache'), { recursive: true });
  if (!fs.existsSync(cacheZip)) {
    console.log('[steam-build] Downloading', url);
    await download(url, cacheZip);
  }

  fs.mkdirSync(outDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${cacheZip.replace(/'/g, "''")}' -DestinationPath '${path.join(__dirname, 'cache').replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );
  const extracted = path.join(__dirname, 'cache', `node-${NODE_VERSION}-win-x64`, 'node.exe');
  fs.copyFileSync(extracted, nodeBin);
  console.log('[steam-build] Installed node-steam →', nodeBin);
}

async function ensureLinux() {
  const nodeBin = path.join(outDir, 'node');
  if (fs.existsSync(nodeBin)) {
    console.log('[steam-build] node-steam already present:', nodeBin);
    return;
  }

  const archiveName = `node-${NODE_VERSION}-linux-x64.tar.xz`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}`;
  const cacheArchive = path.join(__dirname, 'cache', archiveName);

  fs.mkdirSync(path.join(__dirname, 'cache'), { recursive: true });
  if (!fs.existsSync(cacheArchive)) {
    console.log('[steam-build] Downloading', url);
    await download(url, cacheArchive);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const member = `node-${NODE_VERSION}-linux-x64/bin/node`;
  execSync(`tar -xJf "${cacheArchive}" -C "${path.join(__dirname, 'cache')}" "${member}"`, { stdio: 'inherit' });
  const extracted = path.join(__dirname, 'cache', member);
  fs.copyFileSync(extracted, nodeBin);
  try { fs.chmodSync(nodeBin, 0o755); } catch (_err) { /* cross-build on Windows */ }
  console.log('[steam-build] Installed node-steam →', nodeBin);
}

async function main() {
  if (targets.includes('win')) await ensureWin();
  if (targets.includes('linux')) await ensureLinux();
}

main().catch(function (err) {
  console.error('[steam-build] ensure-node-steam failed:', err.message);
  process.exit(1);
});
