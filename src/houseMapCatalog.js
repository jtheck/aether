// Official competitive maps under maps/1v1 and maps/teams (see maps/README.md).

import { mapTypeFitsLobby } from './lobby/modes.js';

/** @type {Record<'onevsone' | 'teams', string>} */
export const LOBBY_HOUSE_MAP_DIR = {
  onevsone: '1v1',
  teams: 'teams',
};

export function houseMapIndexUrl(modeId) {
  const dir = LOBBY_HOUSE_MAP_DIR[modeId];
  return dir ? `/maps/${dir}/index.json` : '';
}

export function houseMapGardenUrl(modeDir, file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..') || !/\.garden$/i.test(rel)) return '';
  return `/maps/${modeDir}/${rel}`;
}

/**
 * @param {string} modeDir
 * @param {{ maps?: { file?: string, name?: string, mapType?: string }[] }} index
 * @param {string} modeId
 */
export function lobbyOptionsFromHouseIndex(modeDir, index, modeId) {
  const maps = Array.isArray(index?.maps) ? index.maps : [];
  const out = [];
  for (const row of maps) {
    const file = String(row?.file || '').trim();
    const id = houseMapGardenUrl(modeDir, file);
    if (!id) continue;
    const mapType = row.mapType || modeId;
    if (!mapTypeFitsLobby(mapType, modeId)) continue;
    out.push({
      id,
      name: String(row.name || file).trim() || file,
      group: 'Official',
      mapType,
    });
  }
  return out;
}

/** @param {string} modeId */
export async function fetchOfficialHouseMaps(modeId) {
  const url = houseMapIndexUrl(modeId);
  if (!url) return [];
  const dir = LOBBY_HOUSE_MAP_DIR[modeId];
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const index = await res.json();
    return lobbyOptionsFromHouseIndex(dir, index, modeId);
  } catch {
    return [];
  }
}
