// Ranked board. The queue seed picks one slot from the official maps that fit
// this mode, then the auto sizes. An auto slot walks the starts and, when one
// is an agora sitting in open water, steps the seed until every start can
// leave. 1v1 checks two pads. Teams checks the four lanes. The start message
// carries the result, so every guest builds that same table.

import { spawnsFitLobby } from '../houseMapCatalog.js';
import {
  KOTH_LADDER_FIELD_SIZES,
  LADDER_FIELD_SIZES,
  TEAMS_LADDER_FIELD_SIZES,
  cleanMapName,
  mapTilesForField,
  mapTypeFitsLobby,
} from './modes.js';
import {
  TILE_SIZE_F,
  activeMapH,
  activeMapW,
  buildTerrainField,
  setActiveMapSize,
} from '../sim/field.js';
import { SPAWN_REACH_MIN, walkableReach } from '../sim/spawnReach.js';
import { kothBases, spawnBases } from '../sim/worldSetup.js';

export { LADDER_FIELD_SIZES };

const LADDER_SEED_TRIES = 8;

function fieldSizesFor(mode) {
  if (mode === 'teams') return TEAMS_LADDER_FIELD_SIZES;
  if (mode === 'koth') return KOTH_LADDER_FIELD_SIZES;
  return LADDER_FIELD_SIZES;
}

/** Size is fixed by the queue seed, so a later reroll does not reshuffle it. */
export function ladderFieldSize(seed, mode = 'onevsone') {
  const sizes = fieldSizesFor(mode);
  return sizes[(seed >>> 0) % sizes.length];
}

function nextSeed(seed) {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

function tileAt(field, x, z) {
  const halfX = field.width * TILE_SIZE_F * 0.5;
  const halfZ = field.height * TILE_SIZE_F * 0.5;
  return [
    Math.floor((x + halfX) / TILE_SIZE_F),
    Math.floor((z + halfZ) / TILE_SIZE_F),
  ];
}

/** Every start pad can walk off onto real land. Uses the same dry pads as a match. */
export function ladderPadsPlayable(seed, fieldSize, mode = 'onevsone') {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    const { mapW, mapH } = mapTilesForField(fieldSize);
    const halfX = (mapW * TILE_SIZE_F) / 2;
    const halfZ = (mapH * TILE_SIZE_F) / 2;
    const field = buildTerrainField(seed >>> 0, { width: mapW, height: mapH });
    const teams = mode === 'teams';
    const pads = mode === 'koth'
      ? kothBases(halfX, halfZ)
      : spawnBases(halfX, { mapW, worldHalfZF: halfZ, laneBases: teams }).slice(0, teams ? 4 : 2);
    for (let i = 0; i < pads.length; i++) {
      const [tx, tz] = tileAt(field, pads[i][0], pads[i][1]);
      if (walkableReach(field, tx, tz, SPAWN_REACH_MIN) < SPAWN_REACH_MIN) return false;
    }
    return true;
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}

/** Official rows that can host this mode, in the order they were given. */
export function ladderOfficialMaps(maps, mode) {
  const out = [];
  const seen = new Set();
  for (const row of maps || []) {
    const id = String(row?.id || '').trim();
    const name = cleanMapName(row?.name);
    if (!id || !name || seen.has(id)) continue;
    if (!spawnsFitLobby(row?.spawns, mode)) continue;
    if (row?.mapType && !mapTypeFitsLobby(row.mapType, mode)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/**
 * One slot per fitting official map, then one slot per auto size.
 * @param {number} seed Queue seed.
 * @param {'onevsone' | 'teams' | 'koth'} [mode]
 * @param {{ id?: string, name?: string, spawns?: number, mapType?: string }[]} [maps]
 * @returns {{ seed: number, fieldSize: string, chapter: string, mapName: string }}
 */
export function ladderMatchDeal(seed, mode = 'onevsone', maps = []) {
  const base = seed >>> 0;
  const sizes = fieldSizesFor(mode);
  const official = ladderOfficialMaps(maps, mode);
  const pool = [
    ...official.map((row) => ({ chapter: row.id, mapName: row.name, fieldSize: sizes[0] })),
    ...sizes.map((fieldSize) => ({ chapter: '', mapName: '', fieldSize })),
  ];
  const pick = pool[base % pool.length];
  if (pick.chapter) {
    return { seed: base, fieldSize: pick.fieldSize, chapter: pick.chapter, mapName: pick.mapName };
  }
  let next = base;
  for (let i = 0; i < LADDER_SEED_TRIES; i++) {
    if (ladderPadsPlayable(next, pick.fieldSize, mode)) {
      return { seed: next, fieldSize: pick.fieldSize, chapter: '', mapName: '' };
    }
    next = nextSeed(next);
  }
  return { seed: next, fieldSize: pick.fieldSize, chapter: '', mapName: '' };
}
