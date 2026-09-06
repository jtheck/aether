import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(process.argv[2] || 'dist-win');
const pkgNw = path.join(distRoot, 'package.nw');
const isLinux = distRoot.includes('linux');
const nodeBin = isLinux ? 'node' : 'node.exe';
const checks = [
  path.join(pkgNw, 'node_modules', 'steamworks-ffi-node', 'dist', 'index.js'),
  path.join(pkgNw, 'steam_appid.txt'),
  path.join(pkgNw, 'node-steam', nodeBin),
];
if (isLinux) {
  checks.push(path.join(distRoot, 'Aether'));
  checks.push(path.join(distRoot, 'Aether.sh'));
}

for (const file of checks) {
  if (!fs.existsSync(file)) {
    console.error('[steam-build] Shipped build missing:', path.relative(root, file));
    process.exit(1);
  }
}

console.log('[steam-build] Shipped Steam worker files OK in', path.basename(distRoot));
