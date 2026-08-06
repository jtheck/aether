// Placed buildings (sim). Placement is via CMD.PLACE_BUILDING — no economy yet.
// Footprints write into field.pass / field.slowMask for pathing + the live tile grid.

import * as fx from './fixed.js';
import {
  TILE,
  HALF_TILE,
  worldToTile,
  tileCenterX,
  tileCenterY,
  activeWorldHalf,
  isPassable,
} from './field.js';
import { fellTreeAt } from './trees.js';
import { UNIT, getUnitDef, isFlyer } from './unitTypes.js';
import { ORDER } from './world.js';
import { queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { isCarried } from './transport.js';

/** @typedef {'basic' | 'advanced' | 'elemental'} BuildingCategoryId */
/** @typedef {'camp' | 'village' | 'silo' | 'farm' | 'mine' | 'tower' | 'tavern' | 'lab' | 'barracks' | 'workshop' | 'factory' | 'church' | 'moonwell' | 'perch' | 'grove'} BuildingTypeId */
/** @typedef {'block' | 'slow'} BuildingOccupancyMode */
/** @typedef {'unit' | 'upgrade'} BuildingMenuItemKind */

/** Placement / ghost yaw snaps (radians). Visual only — footprints stay axis-aligned. */
export const BUILDING_YAW_SNAP = Math.PI / 12;

/**
 * @param {number} yawRad
 * @returns {number}
 */
export function snapBuildingYaw(yawRad) {
  if (!Number.isFinite(yawRad)) return 0;
  return Math.round(yawRad / BUILDING_YAW_SNAP) * BUILDING_YAW_SNAP;
}

/**
 * Square tile footprints (any odd/even size). Yaw rotates the mesh only.
 * Odd sizes snap to tile centers; even sizes snap to tile intersections.
 * @type {Record<string, { w: number, h: number, mode: BuildingOccupancyMode }>}
 */
export const BUILDING_FOOTPRINTS = {
  agora: { w: 4, h: 4, mode: 'slow' },
  // Basic
  camp: { w: 2, h: 2, mode: 'slow' },
  village: { w: 3, h: 3, mode: 'slow' },
  silo: { w: 2, h: 2, mode: 'block' },
  farm: { w: 2, h: 2, mode: 'slow' },
  mine: { w: 2, h: 2, mode: 'slow' },
  // Advanced
  tower: { w: 2, h: 2, mode: 'block' },
  tavern: { w: 3, h: 3, mode: 'block' },
  lab: { w: 3, h: 3, mode: 'block' },
  barracks: { w: 3, h: 3, mode: 'block' },
  workshop: { w: 3, h: 3, mode: 'block' },
  // Elemental
  factory: { w: 3, h: 3, mode: 'block' },
  church: { w: 3, h: 3, mode: 'block' },
  moonwell: { w: 2, h: 2, mode: 'slow' },
  perch: { w: 2, h: 2, mode: 'slow' },
  grove: { w: 3, h: 3, mode: 'slow' },
};

/** GLB paths for placeables (radial icons + world/ghost). */
export const BUILDING_MODEL_URLS = /** @type {const} */ ({
  camp: '/assets/models/camp.glb',
  village: '/assets/models/village.glb',
  silo: '/assets/models/silo.glb',
  farm: '/assets/models/farm.glb',
  mine: '/assets/models/mine.glb',
  tower: '/assets/models/tower.glb',
  tavern: '/assets/models/tavern.glb',
  lab: '/assets/models/lab.glb',
  barracks: '/assets/models/barracks.glb',
  workshop: '/assets/models/workshop.glb',
  factory: '/assets/models/factory.glb',
  church: '/assets/models/church.glb',
  moonwell: '/assets/models/moonwell.glb',
  perch: '/assets/models/perch.glb',
  grove: '/assets/models/grove.glb',
});

/** Placeable from the agora radial (grouped by Basic / Advanced / Elemental). */
export const PLACEABLE_BUILDINGS = /** @type {const} */ ([
  { id: 'camp', name: 'Camp', category: 'basic' },
  { id: 'village', name: 'Village', category: 'basic' },
  { id: 'silo', name: 'Silo', category: 'basic' },
  { id: 'farm', name: 'Farm', category: 'basic' },
  { id: 'mine', name: 'Mine', category: 'basic' },
  { id: 'tower', name: 'Tower', category: 'advanced' },
  { id: 'tavern', name: 'Tavern', category: 'advanced' },
  { id: 'lab', name: 'Lab', category: 'advanced' },
  { id: 'barracks', name: 'Barracks', category: 'advanced' },
  { id: 'workshop', name: 'Workshop', category: 'advanced' },
  { id: 'factory', name: 'Factory', category: 'elemental' },
  { id: 'church', name: 'Church', category: 'elemental' },
  { id: 'moonwell', name: 'Moon Well', category: 'elemental' },
  { id: 'perch', name: 'Perch', category: 'elemental' },
  { id: 'grove', name: 'Grove', category: 'elemental' },
]);

const PLACEABLE_IDS = new Set(PLACEABLE_BUILDINGS.map((b) => b.id));

/**
 * Menu unit keys → sim unit type ids. Add entries here as buildings gain train options.
 * @type {Readonly<Record<string, number>>}
 */
export const BUILDING_MENU_UNITS = {
  villager: UNIT.VILLAGER,
  warrior: UNIT.WARRIOR,
  archer: UNIT.ARCHER,
  warlock: UNIT.WARLOCK,
  priest: UNIT.PRIEST,
  myco: UNIT.MYCO,
  shaman: UNIT.SHAMAN,
  wizard: UNIT.WIZARD,
  monk: UNIT.MONK,
  engineer: UNIT.ENGINEER,
  wagon: UNIT.WAGON,
  dirigible: UNIT.DIRIGIBLE,
  apc: UNIT.APC,
};

/** Upgrade GLBs (radial icons). Assign per building via BUILDING_MENUS. */
export const UPGRADE_MODEL_URLS = /** @type {const} */ ({
  patronage: '/assets/models/patronage.glb',
  armor: '/assets/models/armor.glb',
  artillery: '/assets/models/artillery.glb',
  drayage: '/assets/models/drayage.glb',
  prospecting: '/assets/models/prospecting.glb',
  scribes: '/assets/models/scribes.glb',
  stewardship: '/assets/models/stewardship.glb',
});

/** Display names for upgrades (ids match UPGRADE_MODEL_URLS). */
export const UPGRADE_DEFS = /** @type {const} */ ({
  patronage: { id: 'patronage', name: 'Patronage' },
  armor: { id: 'armor', name: 'Armor' },
  artillery: { id: 'artillery', name: 'Artillery' },
  drayage: { id: 'drayage', name: 'Drayage' },
  prospecting: { id: 'prospecting', name: 'Prospecting' },
  scribes: { id: 'scribes', name: 'Scribes' },
  stewardship: { id: 'stewardship', name: 'Stewardship' },
});

/**
 * Per-building action radial. Omit / empty arrays = no menu for that side.
 * @type {Readonly<Record<string, { units?: readonly string[], upgrades?: readonly string[] }>>}
 */
export const BUILDING_MENUS = {
  camp: { units: ['myco'] },
  village: { units: ['villager', 'monk'] },
  tower: { units: ['wizard'] },
  tavern: { units: ['warlock'], upgrades: ['patronage'] },
  lab: { upgrades: ['artillery'] },
  barracks: { units: ['warrior', 'archer'], upgrades: ['drayage'] },
  workshop: { units: ['wagon', 'engineer'], upgrades: ['armor', 'scribes'] },
  factory: { units: ['apc'] },
  church: { units: ['priest'] },
  moonwell: { upgrades: ['prospecting', 'stewardship'] },
  perch: { units: ['dirigible'] },
  grove: { units: ['shaman'] },
};

/**
 * Resolved menu items for a building type (icons + labels for the action radial).
 * @param {string} typeId
 * @returns {{ units: { id: string, name: string, unitType: number }[], upgrades: { id: string, name: string }[] } | null}
 */
export function getBuildingMenu(typeId) {
  const raw = BUILDING_MENUS[typeId];
  if (!raw) return null;

  /** @type {{ id: string, name: string, unitType: number }[]} */
  const units = [];
  for (const key of raw.units ?? []) {
    const unitType = BUILDING_MENU_UNITS[key];
    if (unitType == null) continue;
    const def = getUnitDef(unitType);
    units.push({ id: key, name: def?.name ?? key, unitType });
  }

  /** @type {{ id: string, name: string }[]} */
  const upgrades = [];
  for (const key of raw.upgrades ?? []) {
    if (!(key in UPGRADE_MODEL_URLS)) continue;
    const def = UPGRADE_DEFS[/** @type {keyof typeof UPGRADE_DEFS} */ (key)];
    upgrades.push({ id: key, name: def?.name ?? key });
  }

  if (!units.length && !upgrades.length) return null;
  return { units, upgrades };
}

/** @param {string} typeId */
export function buildingHasMenu(typeId) {
  return getBuildingMenu(typeId) != null;
}

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
 * Nearest vertical/horizontal grid line index (tile corner), rounding half-up.
 * @param {number} vFixed
 */
function nearestGridLineIndex(vFixed) {
  return fx.toInt(fx.div(vFixed + activeWorldHalf() + HALF_TILE, TILE));
}

/**
 * Snap one world axis: odd footprint size → tile center; even → tile intersection.
 * @param {number} vFixed
 * @param {number} sizeTiles
 * @param {'x' | 'z'} axis
 */
function snapWorldAxis(vFixed, sizeTiles, axis) {
  if ((sizeTiles | 0) & 1) {
    const t = worldToTile(vFixed);
    return axis === 'x' ? tileCenterX(t) : tileCenterY(t);
  }
  const i = nearestGridLineIndex(vFixed);
  return fx.mul(fx.fromInt(i), TILE) - activeWorldHalf();
}

/**
 * Snap placement to the footprint’s geometric center:
 * odd → tile center under the point; even → nearest tile intersection.
 * @param {string} typeId
 * @param {number} xFixed
 * @param {number} zFixed
 * @returns {{ x: number, z: number }}
 */
export function snapBuildingWorld(typeId, xFixed, zFixed) {
  const fp = getBuildingFootprint(typeId);
  if (!fp) return { x: xFixed | 0, z: zFixed | 0 };
  return {
    x: snapWorldAxis(xFixed, fp.w, 'x'),
    z: snapWorldAxis(zFixed, fp.h, 'z'),
  };
}

/**
 * Core claim origin (min tile) centered on the placement point.
 * Odd: center tile via worldToTile. Even: around nearest grid intersection.
 * @param {{ w: number, h: number }} fp
 * @param {number} xFixed
 * @param {number} zFixed
 */
function footprintCoreOrigin(fp, xFixed, zFixed) {
  let coreX0;
  let coreZ0;
  if (fp.w & 1) {
    coreX0 = worldToTile(xFixed) - ((fp.w - 1) >> 1);
  } else {
    coreX0 = nearestGridLineIndex(xFixed) - (fp.w >> 1);
  }
  if (fp.h & 1) {
    coreZ0 = worldToTile(zFixed) - ((fp.h - 1) >> 1);
  } else {
    coreZ0 = nearestGridLineIndex(zFixed) - (fp.h >> 1);
  }
  return { coreX0, coreZ0 };
}

/**
 * Axis-aligned claim rect in tiles. Yaw does not affect occupancy.
 * Placement origin is the geometric center (tile center if odd, intersection if even).
 * @returns {{ x0: number, z0: number, w: number, h: number, coreX0: number, coreZ0: number, coreW: number, coreH: number, mode: BuildingOccupancyMode } | null}
 */
export function buildingFootprintBounds(typeId, xFixed, zFixed) {
  const fp = getBuildingFootprint(typeId);
  if (!fp) return null;
  const { coreX0, coreZ0 } = footprintCoreOrigin(fp, xFixed, zFixed);
  return {
    x0: coreX0,
    z0: coreZ0,
    w: fp.w,
    h: fp.h,
    coreX0,
    coreZ0,
    coreW: fp.w,
    coreH: fp.h,
    mode: fp.mode,
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
 * Iterate axis-aligned occupancy tiles.
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
      fn(tx, tz, tz * width + tx, b.mode);
    }
  }
  return complete;
}

/**
 * True if the footprint fits on walkable tiles clear of structures.
 * Blocks red (impassable) and structure-yellow (farm/agora/slow buildings).
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
 * Nearest passable tile not already reserved (ring search).
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {Set<number>} reserved packed keys (tz << 16 | tx)
 * @param {number} [radius]
 * @returns {{ tx: number, tz: number } | null}
 */
function nearestFreePassable(field, tx, tz, reserved, radius = 12) {
  for (let r = 1; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!isPassable(field, nx, nz)) continue;
        const key = (nz << 16) ^ (nx & 0xffff);
        if (reserved.has(key)) continue;
        return { tx: nx, tz: nz };
      }
    }
  }
  return null;
}

/**
 * Ground units standing in a newly blocked footprint walk to nearby free tiles.
 * @param {object} w
 * @param {object} field
 * @param {string} typeId
 * @param {number} xFixed
 * @param {number} zFixed
 */
export function ejectUnitsFromFootprint(w, field, typeId, xFixed, zFixed) {
  if (!w || !field?.pass) return;
  const fp = getBuildingFootprint(typeId);
  if (!fp || fp.mode !== 'block') return;
  const b = buildingFootprintBounds(typeId, xFixed, zFixed);
  if (!b) return;

  /** @type {number[]} */
  const trapped = [];
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || isFlyer(w.type[i]) || isCarried(w, i)) continue;
    const tx = worldToTile(w.px[i]);
    const tz = worldToTile(w.py[i]);
    if (
      tx < b.coreX0 ||
      tx >= b.coreX0 + b.coreW ||
      tz < b.coreZ0 ||
      tz >= b.coreZ0 + b.coreH
    ) {
      continue;
    }
    trapped.push(i);
  }
  if (!trapped.length) return;

  /** @type {Set<number>} */
  const reserved = new Set();
  for (let t = 0; t < trapped.length; t++) {
    const i = trapped[t];
    const fromTx = worldToTile(w.px[i]);
    const fromTz = worldToTile(w.py[i]);
    const dest = nearestFreePassable(field, fromTx, fromTz, reserved);
    if (!dest) continue;
    reserved.add((dest.tz << 16) ^ (dest.tx & 0xffff));
    const destX = tileCenterX(dest.tx);
    const destY = tileCenterY(dest.tz);
    w.transportTarget[i] = -1;
    w.order[i] = ORDER.MOVE;
    w.tx[i] = destX;
    w.ty[i] = destY;
    w.targetEntity[i] = -1;
    clearEngagement(w, i);
    w.hasTarget[i] = 1;
    w.vx[i] = 0;
    w.vy[i] = 0;
    queuePath(w, i, destX, destY);
  }
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
  const snapped = snapBuildingWorld(type, cmd.tx | 0, cmd.ty | 0);
  const x = snapped.x;
  const z = snapped.z;
  const yaw = cmd.yaw != null ? cmd.yaw | 0 : 0;
  if (field && !canPlaceBuildingAt(field, type, x, z)) return -1;
  w.buildings.push({
    owner,
    type,
    x,
    z,
    yaw,
  });
  if (field) {
    applyStructureOccupancyAt(field, type, x, z);
    ejectUnitsFromFootprint(w, field, type, x, z);
  }
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
