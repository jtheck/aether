import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from './targets.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const target = resolveTarget(process.argv[2] || 'win');
if (!target) {
  console.error('[steam-build] Unknown target. Use win, linux, linux-arm64, or osx.');
  process.exit(1);
}

const distRoot = path.resolve(process.env.AETHER_DIST_DIR || target.outDir);
const pkgNw = path.join(distRoot, target.packageRel);
const checks = [
  path.join(pkgNw, 'node_modules', 'steamworks-ffi-node', 'dist', 'index.js'),
  path.join(pkgNw, 'node_modules', 'koffi', 'build', 'koffi', target.koffi, 'koffi.node'),
  path.join(pkgNw, 'steam_appid.txt'),
  path.join(pkgNw, 'node-steam', target.nodeBin),
  path.join(distRoot, target.launchRel),
];
if (target.ozone) checks.push(path.join(distRoot, 'Aether.sh'));

for (const file of checks) {
  if (!fs.existsSync(file)) {
    console.error('[steam-build] Shipped build missing:', path.relative(root, file));
    process.exit(1);
  }
}

if (target.chromiumExtra || String(target.chromiumFeatures || '').includes('OpenXR')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgNw, 'package.json'), 'utf8'));
  const args = String(manifest['chromium-args'] || '');
  const sh = fs.readFileSync(path.join(distRoot, 'Aether.sh'), 'utf8');
  for (const needle of ['OpenXR', target.chromiumExtra].filter(Boolean)) {
    if (!args.includes(needle) || !sh.includes(needle)) {
      console.error('[steam-build] Frame XR launch flag missing from shipped shell:', needle);
      process.exit(1);
    }
  }
}

console.log('[steam-build] Shipped Steam worker files OK in', path.basename(distRoot));
