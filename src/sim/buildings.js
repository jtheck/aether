// Placed buildings (sim). Placement is via CMD.PLACE_BUILDING — no economy yet.
// Footprints write into field.pass / field.slowMask for pathing + the live tile grid.

import * as fx from './fixed.js';
import { worldToTile } from './field.js';
import { fellTreeAt } from './trees.js';

/** @typedef {'barracks' | 'farm' | 'church' | 'tavern' | 'perch'} BuildingTypeId */
/** @typedef {'block' | 'slow'} BuildingOccupancyMode */

/** Placement / ghost yaw snaps (radians). Visual only — footprints stay axis-aligned. */
export const BUILDING_YAW_SNAP = Math.PI / 6;

/**
 * @param {number} yawRad
 * @returns {number}
 */
export function snapBuildingYaw(yawRad) {
  if (!Number.isFinite(yawRad)) return 0;
  return Math.round(yawRad / BUILDING_YAW_SNAP) * BUILDING_YAW_SNAP;
}

/**
 * Square tile footprints (2×2 / 3×3 / 4×4). Yaw rotates the mesh only.
 * `slowPad`: extra slow ring (tiles) around a block core — ignored for slow-only types.
 * @type {Record<string, { w: number, h: number, mode: BuildingOccupancyMode, slowPad?: number }>}
 */
export const BUILDING_FOOTPRINTS = {
  agora: { w: 4, h: 4, mode: 'slow' },
  farm: { w: 2, h: 2, mode: 'slow' },
  barracks: { w: 3, h: 3, mode: 'block', slowPad: 1 },
  church: { w: 3, h: 3, mode: 'block', slowPad: 1 },
  tavern: { w: 3, h: 3, mode: 'block', slowPad: 1 },
  perch: { w: 2, h: 2, mode: 'block', slowPad: 1 },
};

/** Placeable from the agora radial. */
export const PLACEABLE_BUILDINGS = /** @type {const} */ ([
  { id: 'barracks', name: 'Barracks' },
  { id: 'farm', name: 'Farm' },
  { id: 'church', name: 'Church' },
  { id: 'tavern', name: 'Tavern' },
  { id: 'perch', name: 'Perch' },
]);

const PLACEABLE_IDS = new Set(PLACEABLE_BUILDINGS.map((b) => b.id));

/**
 * @param {string} typeId
 * @returns {typeId is BuildingTypeId}
 */
export function isPlaceableBuilding(typeId) {
  return PLACEABLE_IDS.has(typeId);
}

/** @param {string} typeId */
export function getBuildingFootprint(typeId) {
  return BUILDING_FOOTPRINTS[typeId] ?? null;
}

/**
 * Axis-aligned claim rect in tiles (core + slow pad). Yaw does not affect occupancy.
 * @returns {{ x0: number, z0: number, w: number, h: number, coreX0: number, coreZ0: number, coreW: number, coreH: number, mode: BuildingOccupancyMode, slowPad: number } | null}
 */
export function buildingFootprintBounds(typeId, xFixed, zFixed) {
  const fp = getBuildingFootprint(typeId);
  if (!fp) return null;
  const slowPad = fp.mode === 'block' ? (fp.slowPad | 0) : 0;
  const cx = worldToTile(xFixed);
  const cz = worldToTile(zFixed);
  const coreX0 = cx - ((fp.w - 1) >> 1);
  const coreZ0 = cz - ((fp.h - 1) >> 1);
  return {
    x0: coreX0 - slowPad,
    z0: coreZ0 - slowPad,
    w: fp.w + slowPad * 2,
    h: fp.h + slowPad * 2,
    coreX0,
    coreZ0,
    coreW: fp.w,
    coreH: fp.h,
    mode: fp.mode,
    slowPad,
  };
}

/**
 * @param {object} field
 * @returns {Uint8Array}
 */
export function ensureStructureSlowMask(field) {
  const n = field.width * field.height;
  if (!field.structureSlowMask || field.structureSlowMask.length !== n) {
    field.structureSlowMask = new Uint8Array(n);
  }
  return field.structureSlowMask;
}

/**
 * Iterate axis-aligned occupancy tiles (block core + optional slow pad).
 * @param {object} field
 * @param {string} typeId
 * @param {number} xFixed
 * @param {number} zFixed
 * @param {(tx: number, tz: number, tileIndex: number, mode: BuildingOccupancyMode) => void} fn
 * @returns {boolean} false if the claim is clipped by map bounds
 */
export function forEachFootprintTile(field, typeId, xFixed, zFixed, fn) {
  const b = buildingFootprintBounds(typeId, xFixed, zFixed);
  if (!b || !field) return false;
  const { width, height } = field;
  let complete = true;
  for (let dz = 0; dz < b.h; dz++) {
    const tz = b.z0 + dz;
    if (tz < 0 || tz >= height) {
      complete = false;
      continue;
    }
    for (let dx = 0; dx < b.w; dx++) {
      const tx = b.x0 + dx;
      if (tx < 0 || tx >= width) {
        complete = false;
        continue;
      }
      const inCore =
        tx >= b.coreX0 &&
        tx < b.coreX0 + b.coreW &&
        tz >= b.coreZ0 &&
        tz < b.coreZ0 + b.coreH;
      fn(tx, tz, tz * width + tx, inCore ? b.mode : 'slow');
    }
  }
  return complete;
}

/**
 * True if the full claim (core + pad) fits on walkable tiles clear of structures.
 * Blocks red (impassable) and structure-yellow (farm/agora/building pad).
 * Tree / shore yellow (slowMask only) is allowed — buildings can claim those tiles.
 * @param {object} field
 * @param {string} typeId
 * @param {number} xFixed
 * @param {number} zFixed
 */
export function canPlaceBuildingAt(field, typeId, xFixed, zFixed) {
  if (!field?.pass || !getBuildingFootprint(typeId)) return false;
  let ok = true;
  let n = 0;
  const complete = forEachFootprintTile(field, typeId, xFixed, zFixed, (_tx, _tz, i) => {
    n++;
    if (field.activeMask && field.activeMask[i] === 0) ok = false;
    else if (field.pass[i] === 0) ok = false;
    else if (field.structureSlowMask?.[i]) ok = false;
  });
  return complete && ok && n > 0;
}

/**
 * Stamp one structure onto pass / slow / structureSlowMask (OR, idempotent).
 * Clears any living trees under the claim so meshes + slow stay in sync.
 * @param {object} field
 * @param {string} typeId
 * @param {number} xFixed Q16.16
 * @param {number} zFixed Q16.16
 */
export function applyStructureOccupancyAt(field, typeId, xFixed, zFixed) {
  if (!field?.pass || !getBuildingFootprint(typeId)) return;
  const structureSlow = ensureStructureSlowMask(field);
  if (!field.slowMask || field.slowMask.length !== structureSlow.length) {
    field.slowMask = new Uint8Array(structureSlow.length);
  }
  forEachFootprintTile(field, typeId, xFixed, zFixed, (_tx, _tz, i, mode) => {
    if ((field.treeStock?.[i] ?? 0) > 0) fellTreeAt(field, i);
    if (mode === 'block') {
      field.pass[i] = 0;
    } else {
      structureSlow[i] = 1;
      field.slowMask[i] = 1;
    }
  });
}

/**
 * Apply occupancy for every agora + placed building (OR into field).
 * @param {object} field
 * @param {{ agoras?: { x: number, z: number }[], buildings?: { type: string, x: number, z: number }[] } | null | undefined} world
 */
export function applyWorldStructureOccupancy(field, world) {
  if (!field || !world) return;
  const agoras = world.agoras;
  if (agoras?.length) {
    for (let i = 0; i < agoras.length; i++) {
      const a = agoras[i];
      applyStructureOccupancyAt(field, 'agora', a.x, a.z);
    }
  }
  const buildings = world.buildings;
  if (buildings?.length) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      applyStructureOccupancyAt(field, b.type, b.x, b.z);
    }
  }
}

/**
 * Main-thread helper: stamp serialized float buildings onto a field clone.
 * @param {object} field
 * @param {{ type: string, x: number, z: number }[] | null | undefined} buildings
 */
export function applySerializedBuildingOccupancy(field, buildings) {
  if (!field || !buildings?.length) return;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    applyStructureOccupancyAt(field, b.type, fx.fromFloat(b.x), fx.fromFloat(b.z));
  }
}

/**
 * @param {{ owner: number, type: string, x: number, z: number, yaw?: number }} opts
 *   x/z are world floats; stored as Q16.16.
 */
export function createBuilding(opts) {
  return {
    owner: opts.owner | 0,
    type: String(opts.type),
    x: fx.fromFloat(opts.x),
    z: fx.fromFloat(opts.z),
    yaw: opts.yaw != null ? fx.fromFloat(opts.yaw) : 0,
  };
}

/**
 * Append a building if type is known and footprint is clear. Returns index or -1.
 * @param {object} w
 * @param {object} field
 * @param {{ owner?: number, playerId?: number, buildingType: string, tx: number, ty: number, yaw?: number }} cmd
 *   tx/ty/yaw are Q16.16 world values.
 */
export function applyPlaceBuilding(w, field, cmd) {
  if (!w.buildings) w.buildings = [];
  const type = cmd.buildingType;
  if (!isPlaceableBuilding(type)) return -1;
  const owner = (cmd.playerId ?? cmd.owner ?? -1) | 0;
  if (owner < 0) return -1;
  const x = cmd.tx | 0;
  const z = cmd.ty | 0;
  const yaw = cmd.yaw != null ? cmd.yaw | 0 : 0;
  if (field && !canPlaceBuildingAt(field, type, x, z)) return -1;
  w.buildings.push({
    owner,
    type,
    x,
    z,
    yaw,
  });
  if (field) applyStructureOccupancyAt(field, type, x, z);
  w.buildingsDirty = 1;
  return w.buildings.length - 1;
}

/**
 * @param {ReturnType<typeof createBuilding>[] | null | undefined} buildings
 */
export function serializeBuildings(buildings) {
  if (!buildings?.length) return [];
  return buildings.map((b) => ({
    owner: b.owner | 0,
    type: b.type,
    x: fx.toFloat(b.x),
    z: fx.toFloat(b.z),
    yaw: fx.toFloat(b.yaw),
  }));
}

export function mixBuildingChecksum(h, mix, buildings) {
  if (!buildings) {
    mix(0);
    return h;
  }
  mix(buildings.length);
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    mix(b.owner);
    // Stable hash of type string
    const s = b.type || '';
    mix(s.length);
    for (let c = 0; c < s.length; c++) mix(s.charCodeAt(c));
    mix(b.x);
    mix(b.z);
    mix(b.yaw);
  }
  return h;
}
