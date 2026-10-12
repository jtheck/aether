// Map type stored on a .garden (`mt`). Forge uses it when generating starts.

/** @typedef {'onevsone' | 'teams' | 'koth' | 'adventure'} MapTypeId */

/** @type {Array<{ id: MapTypeId, name: string, players: number, laneBases: boolean, placeAgoras: boolean, koth: boolean }>} */
export const MAP_TYPES = [
  { id: 'onevsone', name: '1 vs 1', players: 2, laneBases: false, placeAgoras: true, koth: false },
  { id: 'teams', name: 'Teams', players: 4, laneBases: true, placeAgoras: true, koth: false },
  { id: 'koth', name: 'King of the Hill', players: 5, laneBases: false, placeAgoras: false, koth: true },
  { id: 'adventure', name: 'Adventure', players: 0, laneBases: false, placeAgoras: false, koth: false },
];

export const DEFAULT_MAP_TYPE = 'adventure';

const ALIASES = {
  '1v1': 'onevsone',
  '1vs1': 'onevsone',
  ffa: 'onevsone',
};

/** @param {string} id */
export function mapTypeById(id) {
  const key = normalizeMapType(id, '');
  return MAP_TYPES.find((t) => t.id === key) || null;
}

/**
 * @param {unknown} raw
 * @param {string} [fallback] Empty string keeps a missing type missing.
 */
export function normalizeMapType(raw, fallback = DEFAULT_MAP_TYPE) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  const id = ALIASES[s] || s;
  return MAP_TYPES.some((t) => t.id === id) ? id : fallback;
}
