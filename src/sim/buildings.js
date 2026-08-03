// Placed buildings (sim). Placement is via CMD.PLACE_BUILDING — no economy yet.

import * as fx from './fixed.js';

/** @typedef {'barracks' | 'farm' | 'church' | 'tavern' | 'perch'} BuildingTypeId */

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
 * Append a building if type is known. Returns index or -1.
 * @param {object} w
 * @param {{ owner?: number, playerId?: number, buildingType: string, tx: number, ty: number, yaw?: number }} cmd
 *   tx/ty/yaw are Q16.16 world values.
 */
export function applyPlaceBuilding(w, cmd) {
  if (!w.buildings) w.buildings = [];
  const type = cmd.buildingType;
  if (!isPlaceableBuilding(type)) return -1;
  const owner = (cmd.playerId ?? cmd.owner ?? -1) | 0;
  if (owner < 0) return -1;
  w.buildings.push({
    owner,
    type,
    x: cmd.tx | 0,
    z: cmd.ty | 0,
    yaw: cmd.yaw != null ? cmd.yaw | 0 : 0,
  });
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
