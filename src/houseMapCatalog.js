// Official competitive maps under maps/skirmish (see maps/README.md).
// Names and agora counts come from each .garden, not from a stored label.

import { cleanMapName } from './lobby/modes.js';

export const HOUSE_SKIRMISH_DIR = 'skirmish';

const OUT_OF_SKIRMISH = new Set(['koth', 'adventure', 'stress']);

export function houseMapIndexUrl() {
  return `/maps/${HOUSE_SKIRMISH_DIR}/index.json`;
}

export function houseMapGardenUrl(file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..') || !/\.garden$/i.test(rel)) return '';
  return `/maps/${HOUSE_SKIRMISH_DIR}/${rel}`;
}

/** 1v1 lists every map with two or more starts. Teams lists more than two. */
export function spawnsFitLobby(spawns, modeId) {
  const n = Number(spawns) | 0;
  if (modeId === 'onevsone') return n >= 2;
  if (modeId === 'teams') return n > 2;
  return false;
}

/** Name and agora count off a garden file. */
export function gardenLobbyFields(data, file = '') {
  const fallback = String(file || '').replace(/\.garden$/i, '');
  const name = cleanMapName(data?.n || data?.name) || fallback;
  const spawns = Array.isArray(data?.g) ? data.g.length : 0;
  return { name, spawns };
}

/**
 * @param {{ maps?: { file?: string, name?: string, spawns?: number, mapType?: string }[] }} index
 * @param {string} modeId
 */
export function lobbyOptionsFromHouseIndex(index, modeId) {
  const maps = Array.isArray(index?.maps) ? index.maps : [];
  const out = [];
  for (const row of maps) {
    const file = String(row?.file || '').trim();
    const id = houseMapGardenUrl(file);
    if (!id) continue;
    const declared = String(row?.mapType || '').trim().toLowerCase();
    if (OUT_OF_SKIRMISH.has(declared)) continue;
    const fields = row?.spawns == null && (row?.name == null)
      ? null
      : {
        name: cleanMapName(row?.name) || file.replace(/\.garden$/i, ''),
        spawns: Number(row?.spawns) | 0,
      };
    if (!fields || !spawnsFitLobby(fields.spawns, modeId)) continue;
    out.push({
      id,
      name: fields.name || file,
      group: 'Official',
      mapType: 'skirmish',
      spawns: fields.spawns,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

let catalog = null;
let catalogInflight = null;

/** Last successful skirmish index. Null until the first fetch settles. */
export function peekSkirmishCatalog() {
  return catalog;
}

/** In-flight catalog read, or null when idle. */
export function skirmishCatalogInflight() {
  return catalogInflight;
}

async function fetchSkirmishCatalog() {
  if (catalog) return catalog;
  if (!catalogInflight) {
    catalogInflight = readSkirmishCatalog().then((next) => {
      catalog = next;
      return next;
    }).finally(() => { catalogInflight = null; });
  }
  return catalogInflight;
}

/** File list from the folder index, names and spawn counts from each garden. */
async function readSkirmishCatalog() {
  const res = await fetch(houseMapIndexUrl(), { cache: 'no-store' });
  if (!res.ok) return { maps: [] };
  const index = await res.json();
  const maps = [];
  await Promise.all((Array.isArray(index?.maps) ? index.maps : []).map(async (row) => {
    const file = String(row?.file || '').trim();
    const url = houseMapGardenUrl(file);
    if (!url) return;
    try {
      const gardenRes = await fetch(url, { cache: 'no-store' });
      if (!gardenRes.ok) return;
      const data = await gardenRes.json();
      maps.push({ file, mapType: data?.mt, ...gardenLobbyFields(data, file) });
    } catch {
      /* skip a garden that is not readable */
    }
  }));
  return { maps };
}

/** @param {string} modeId */
export async function fetchOfficialHouseMaps(modeId) {
  try {
    const catalog = await fetchSkirmishCatalog();
    return lobbyOptionsFromHouseIndex(catalog, modeId);
  } catch {
    return [];
  }
}
