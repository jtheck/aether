// Deterministic match-AI sight (tile circles). Keep radii in sync with render/fogOfWar.js.

import * as fx from './fixed.js';
import { TILE_SIZE_F, worldToTile, worldToTileZ } from './field.js';
import { agoraForOwner } from './agora.js';
import { getUnitDef } from './unitTypes.js';
import { isAlly } from './teams.js';
import { buildingIsFinished, BUILDING_FOOTPRINTS } from './buildings.js';

/** @typedef {'fair' | 'omniscient'} AiVisionMode */

const CIV_VISION_TILES = 8;
const MIL_VISION_MIN = 10;
const CASTER_VISION_TILES = 18;
const DIRIGIBLE_VISION_TILES = 24;

/**
 * @param {{ category?: string, aggroRange?: number, primaryAbility?: string, fly?: boolean } | null | undefined} def
 */
export function visionTilesForDef(def) {
  if (!def) return CIV_VISION_TILES;
  if (def.category === 'civilian') return CIV_VISION_TILES;
  if (def.category === 'air' || def.fly) return DIRIGIBLE_VISION_TILES;
  if (def.primaryAbility) return CASTER_VISION_TILES;
  const aggro = def.aggroRange ? fx.toFloat(def.aggroRange) : 0;
  const fromAggro = aggro > 0 ? Math.ceil(aggro / TILE_SIZE_F) + 1 : 0;
  return Math.max(MIL_VISION_MIN, fromAggro);
}

/**
 * @param {number} typeId
 */
export function visionTilesForUnitType(typeId) {
  return visionTilesForDef(getUnitDef(typeId));
}

function buildingVisionPad(type) {
  const fp = BUILDING_FOOTPRINTS[type];
  if (!fp) return 1;
  return (Math.max(fp.w, fp.h) + 1) >> 1;
}

/**
 * @param {string | undefined} type
 */
export function visionTilesForBuilding(type) {
  if (type === 'tower' || type === 'perch') return CASTER_VISION_TILES;
  if (type === 'agora') return DIRIGIBLE_VISION_TILES;
  return MIL_VISION_MIN + buildingVisionPad(type);
}

/**
 * @param {number} tx
 * @param {number} tz
 * @param {number} cx
 * @param {number} cz
 * @param {number} radiusTiles
 */
function tileInRadius(tx, tz, cx, cz, radiusTiles) {
  const dx = tx - cx;
  const dz = tz - cz;
  const r = radiusTiles | 0;
  return dx * dx + dz * dz <= r * r;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {number[]} outCx
 * @param {number[]} outCz
 * @param {number[]} outR
 */
function collectVisionSources(w, owner, outCx, outCz, outR) {
  let n = 0;
  const carried = w.carriedBy;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (carried && carried[i] >= 0) continue;
    if (!isAlly(w.owner[i] | 0, owner)) continue;
    outCx[n] = worldToTile(w.px[i]);
    outCz[n] = worldToTileZ(w.py[i]);
    outR[n] = visionTilesForUnitType(w.type[i]);
    n++;
  }
  const buildings = w.buildings;
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if (!isAlly(bd.owner | 0, owner)) continue;
      if (!buildingIsFinished(bd)) continue;
      outCx[n] = worldToTile(fx.fromFloat(bd.x));
      outCz[n] = worldToTileZ(fx.fromFloat(bd.z));
      outR[n] = visionTilesForBuilding(bd.type);
      n++;
    }
  }
  return n;
}

const SRC_CAP = 512;

/**
 * @param {object} w
 * @param {object} _field
 * @param {number} owner
 * @param {number} wx
 * @param {number} wz
 */
export function worldPointSeenByOwner(w, _field, owner, wx, wz) {
  const tx = worldToTile(wx);
  const tz = worldToTileZ(wz);
  const cx = new Array(SRC_CAP);
  const cz = new Array(SRC_CAP);
  const r = new Array(SRC_CAP);
  const n = collectVisionSources(w, owner, cx, cz, r);
  for (let i = 0; i < n; i++) {
    if (tileInRadius(tx, tz, cx[i], cz[i], r[i])) return true;
  }
  return false;
}

/**
 * @param {object} w
 * @param {object} field
 * @param {number} owner
 * @param {number} entityIndex
 */
export function entitySeenByOwner(w, field, owner, entityIndex) {
  if (entityIndex < 0 || entityIndex >= w.count || !w.alive[entityIndex]) return false;
  return worldPointSeenByOwner(w, field, owner, w.px[entityIndex], w.py[entityIndex]);
}

/**
 * @param {object} w
 * @param {object} field
 * @param {number} owner
 * @param {{ x: number, z: number }} agora
 */
export function agoraSeenByOwner(w, field, owner, agora) {
  if (!agora) return false;
  const home = agoraForOwner(w.agoras, owner);
  if (home && agora === home) return true;
  return worldPointSeenByOwner(w, field, owner, agora.x, agora.z);
}

export function aiUsesFairVision(strategy) {
  return strategy?.vision === 'fair';
}
