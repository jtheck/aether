import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(root, 'app');
const ffiMain = path.join(appRoot, 'node_modules', 'steamworks-ffi-node', 'dist', 'index.js');

if (fs.existsSync(ffiMain)) {
  process.exit(0);
}

console.warn('[steam-build] steamworks-ffi-node dist missing — reinstalling app dependencies…');
const pkgDir = path.join(appRoot, 'node_modules', 'steamworks-ffi-node');
if (fs.existsSync(pkgDir)) {
  fs.rmSync(pkgDir, { recursive: true, force: true });
}

const install = spawnSync('npm', ['install'], { cwd: appRoot, stdio: 'inherit', shell: true });
if (install.status !== 0) process.exit(install.status ?? 1);

if (!fs.existsSync(ffiMain)) {
  console.error('[steam-build] steamworks-ffi-node still missing dist/index.js after npm install');
  process.exit(1);
}

console.log('[steam-build] app dependencies OK');
