// House maps live at repo-root maps/ (same idea as assets/).

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function houseMapsDir(repoRoot) {
  return join(repoRoot, 'maps');
}

/**
 * Resolve `/maps/...` to an on-disk file (dev serve + package).
 * @param {string} repoRoot
 * @param {string} urlPath e.g. `/maps/adventure/adventure.campaign` or `maps/foo.garden`
 */
export function resolveMapsUrl(repoRoot, urlPath) {
  const safe = urlPath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!safe.startsWith('maps/')) return null;
  const rel = safe.slice('maps/'.length);
  const path = join(houseMapsDir(repoRoot), ...rel.split('/'));
  return existsSync(path) ? path : null;
}

/** Relative paths under maps/ to ship (.garden / .campaign), skipping README etc. */
export function listHouseMapRelPaths(repoRoot) {
  const root = houseMapsDir(repoRoot);
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (name === 'README.md') continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, rel);
      else if (name.endsWith('.garden') || name.endsWith('.campaign') || name === 'index.json') {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  };
  walk(root, '');
  return out.sort();
}
