// House maps live at repo-root maps/ (same idea as assets/).

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
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

/**
 * Skirmish folder listing. Name and spawn count are read from each garden.
 * Two or more agoras show in 1v1. More than two also show in teams.
 * @param {string} repoRoot
 */
export function readSkirmishCatalog(repoRoot) {
  const dir = join(houseMapsDir(repoRoot), 'skirmish');
  if (!existsSync(dir)) return { maps: [] };
  const maps = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.garden')) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const name = String(data?.n || data?.name || file.replace(/\.garden$/i, '')).replace(/\s+/g, ' ').trim();
    const spawns = Array.isArray(data?.g) ? data.g.length : 0;
    maps.push({
      file,
      name: name || file.replace(/\.garden$/i, ''),
      spawns,
      ...(data?.mt ? { mapType: String(data.mt) } : {}),
    });
  }
  maps.sort((a, b) => a.file.localeCompare(b.file));
  return { maps };
}
