import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const nm = path.join(root, 'app', 'node_modules');
if (!fs.existsSync(nm)) process.exit(0);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const parentName = pkg.name;
const suspects = new Set([parentName, 'aether-steam-build', 'steam-build']);

for (const name of fs.readdirSync(nm)) {
  if (!suspects.has(name)) continue;
  const target = path.join(nm, name);
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || st.isDirectory()) {
      // Junctions on Windows: rmdir, do not recurse into the parent tree.
      if (process.platform === 'win32') {
        spawnSync('cmd', ['/c', 'rmdir', target], { stdio: 'inherit' });
      } else {
        fs.unlinkSync(target);
      }
      console.log('[steam-build] Removed parent link', name);
    }
  } catch (err) {
    console.warn('[steam-build] Could not remove', name, err.message);
  }
}

const appPkgPath = path.join(root, 'app', 'package.json');
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));
let changed = false;
for (const name of suspects) {
  if (appPkg.dependencies && appPkg.dependencies[name]) {
    delete appPkg.dependencies[name];
    changed = true;
  }
}
if (changed) {
  fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
  console.log('[steam-build] Stripped parent file: dep from app/package.json');
}
