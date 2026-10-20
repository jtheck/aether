// Ranked board. The queue seed picks the size. The host then walks the starts
// and, when one is an agora sitting in open water, steps the seed until every
// start can leave. 1v1 checks two pads. Teams checks the four lanes. The start
// message carries the result, so every guest builds that same table.

import { KOTH_LADDER_FIELD_SIZES, LADDER_FIELD_SIZES, TEAMS_LADDER_FIELD_SIZES, mapTilesForField } from './modes.js';
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

/** Size is fixed by the queue seed, so a later reroll does not reshuffle it. */
export function ladderFieldSize(seed, mode = 'onevsone') {
  const sizes = mode === 'teams'
    ? TEAMS_LADDER_FIELD_SIZES
    : mode === 'koth'
      ? KOTH_LADDER_FIELD_SIZES
      : LADDER_FIELD_SIZES;
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

/**
 * @param {number} seed Queue seed.
 * @param {'onevsone' | 'teams'} [mode]
 * @returns {{ seed: number, fieldSize: string }}
 */
export function ladderMatchDeal(seed, mode = 'onevsone') {
  const base = seed >>> 0;
  const fieldSize = ladderFieldSize(base, mode);
  let next = base;
  for (let i = 0; i < LADDER_SEED_TRIES; i++) {
    if (ladderPadsPlayable(next, fieldSize, mode)) return { seed: next, fieldSize };
    next = nextSeed(next);
  }
  return { seed: next, fieldSize };
}
