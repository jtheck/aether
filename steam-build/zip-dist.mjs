import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const platform = process.argv[2] === 'linux' ? 'linux' : 'win';
const dist = path.join(root, platform === 'linux' ? 'dist-linux' : 'dist-win');
const outZip = path.join(root, platform === 'linux' ? 'Aether-linux64.zip' : 'Aether-win64.zip');
const launchBin = platform === 'linux' ? 'Aether' : 'Aether.exe';

if (!fs.existsSync(path.join(dist, launchBin))) {
  console.error(`[steam-build] ${dist}/${launchBin} missing — run npm run dist:${platform === 'linux' ? 'linux' : 'win'} first`);
  process.exit(1);
}

const userData = path.join(dist, '.nw-user-data');
if (fs.existsSync(userData)) {
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('[steam-build] Removed .nw-user-data before zipping');
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

// tar handles optional/broken native paths better than Compress-Archive on Windows.
const tar = spawnSync(
  'tar',
  ['-a', '-cf', outZip, '-C', dist, '.'],
  { stdio: 'inherit' },
);

if (tar.status !== 0) process.exit(tar.status ?? 1);

const mb = (fs.statSync(outZip).size / (1024 * 1024)).toFixed(0);
console.log(`[steam-build] Wrote ${outZip} (~${mb} MB)`);
