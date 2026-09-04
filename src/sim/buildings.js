// Placed buildings (sim). Placement is via CMD.PLACE_BUILDING — no economy yet.
// Footprints write into field.pass / field.slowMask for pathing + the live tile grid.

import * as fx from './fixed.js';
import {
  TILE,
  HALF_TILE,
  TILE_SIZE_F,
  TERRAIN,
  worldToTile,
  tileCenterX,
  tileCenterY,
  activeWorldHalf,
  isPassable,
  findPath,
  snapToPassable,
  isTerrainSlowTile,
} from './field.js';
import { fellTreeAt } from './trees.js';
import { SCENERY, rockFootprintRadiusForStock } from './scenery.js';
import { UNIT, getUnitDef, isFlyer, getUnitCost } from './unitTypes.js';
import { unitPopCost } from './pop.js';
import { ORDER } from './world.js';
import { MAX_WAYPOINTS, PATH_STYLE, queuePath } from './path.js';
import { spendResources, addResource } from './resources.js';

/** Scratch buffers for render-side rally A* (main thread only). */
const _rallyWx = new Int32Array(64);
const _rallyWy = new Int32Array(64);
import { clearEngagement } from './engagement.js';
import { isCarried } from './transport.js';
import { ownerHasTech, TECH, TECH_BY_ID, getTechCost } from './tech.js';
import { GENERATED_BUILDING_SPAWN_LOCAL } from './buildingSpawnLocal.generated.js';

/** @typedef {'basic' | 'advanced' | 'elemental'} BuildingCategoryId */
/** @typedef {'camp' | 'village' | 'silo' | 'farm' | 'mine' | 'tower' | 'tavern' | 'lab' | 'barracks' | 'workshop' | 'factory' | 'church' | 'moonwell' | 'perch' | 'grove'} BuildingTypeId */
/** @typedef {'block' | 'slow'} BuildingOccupancyMode */
/** @typedef {'unit' | 'upgrade'} BuildingMenuItemKind */

/** Placement / ghost yaw snaps (radians). Visual only — footprints stay axis-aligned. */
export const BUILDING_YAW_SNAP = Math.PI / 12;

/**
 * Baked spawn empties from building GLBs (`spawn_anchor` local translation).
 * Sim uses these — does not dig through live meshes.
 * Hand fallback for tavern until prebake has been run; generated wins on key clash.
 * @type {Readonly<Record<string, { x: number, y: number, z: number }>>}
 */
export const BUILDING_SPAWN_LOCAL = Object.freeze({
  // Fallback if prebake hasn't been run; overwritten by GENERATED_* when present.
  tavern: Object.freeze({
    x: -0.5513424873352051,
    y: 0.7969854474067688,
    z: -8.04394245147705,
  }),
  ...GENERATED_BUILDING_SPAWN_LOCAL,
});

/** Base train time per unit (~2.5s at 20Hz). Split across active tracks. */
export const TRAIN_TICKS = 50;
/** Research time per upgrade (~same as one unit; shares multi-track slowdown). */
export const RESEARCH_TICKS = 50;
/** Free villager from a completed village (~24s at 20 Hz). */
export const VILLAGE_VILLAGER_TICKS = 480;

/**
 * Rotate a model-local XZ offset into world XZ (Y-up yaw, matches render writeMatrix).
 * @param {number} bx
 * @param {number} bz
 * @param {number} yawRad
 * @param {number} lx
 * @param {number} lz
 */
export function buildingLocalToWorld(bx, bz, yawRad, lx, lz) {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return {
    x: bx + c * lx + s * lz,
    z: bz - s * lx + c * lz,
  };
}

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
  farm: { w: 3, h: 3, mode: 'slow' },
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

const BUILDING_DISPLAY_NAMES = Object.freeze({
  agora: 'Agora',
  ...Object.fromEntries(PLACEABLE_BUILDINGS.map((b) => [b.id, b.name])),
});

/** Display name for agora / placeable type ids (selection HUD, menus). */
export function getBuildingDisplayName(typeId) {
  return BUILDING_DISPLAY_NAMES[typeId] ?? String(typeId ?? '');
}

/**
 * Placement cost per building (wood/stone/mineral/food). Charged on placement,
 * refunded if the unfinished site is cancelled. v1's building prices were placeholder
 * single-digits; re-priced here into a real curve against the ~90-wood start:
 *   basic  — affordable early from wood alone (econ/expansion),
 *   advanced — needs a stone economy first (military/tech),
 *   elemental — mineral-gated premium tier.
 * @type {Readonly<Record<string, Record<string, number>>>}
 */
export const BUILDING_COST = Object.freeze({
  // basic
  camp: { wood: 40 },
  village: { wood: 60 },
  farm: { wood: 30 },
  silo: { wood: 25 },
  mine: { wood: 40, stone: 10 },
  // advanced
  tower: { wood: 30, stone: 40 },
  tavern: { wood: 50, stone: 20 },
  barracks: { wood: 60, stone: 25 },
  workshop: { wood: 60, stone: 40 },
  lab: { wood: 30, stone: 40, mineral: 10 },
  // elemental
  factory: { wood: 40, stone: 60, mineral: 25 },
  church: { wood: 40, stone: 30, mineral: 15 },
  moonwell: { stone: 50, mineral: 20 },
  perch: { wood: 60, stone: 20, mineral: 15 },
  grove: { wood: 50, stone: 20, mineral: 15 },
});

/** Resource cost to place a building type ({} when free/undefined). */
export function getBuildingCost(typeId) {
  return BUILDING_COST[typeId] ?? {};
}

/** Building `requires` — own a finished building of each listed type. */
export const BUILDING_REQUIRES = Object.freeze({
  tower: Object.freeze(['camp']),
  tavern: Object.freeze(['camp']),
  lab: Object.freeze(['camp']),
  barracks: Object.freeze(['village']),
  workshop: Object.freeze(['village']),
});

const NO_REQUIRES = Object.freeze([]);

/** @param {string} typeId */
export function getBuildingRequires(typeId) {
  return BUILDING_REQUIRES[typeId] ?? NO_REQUIRES;
}

/** Raised and functional. `undefined` built = done (garden / checkpoint). */
export function buildingIsFinished(b) {
  return !!b && (b.built != null ? b.built | 0 : 1) === 1;
}

/**
 * @param {{ owner?: number, type?: string, built?: number }[] | null | undefined} buildings
 * @param {number} owner
 */
export function ownedFinishedBuildingTypes(buildings, owner) {
  const set = new Set();
  if (!buildings?.length) return set;
  const o = owner | 0;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) === o && b.type && buildingIsFinished(b)) set.add(b.type);
  }
  return set;
}

/**
 * @param {{ owner?: number, type?: string, built?: number }[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} typeId
 */
export function ownerHasBuildingType(buildings, owner, typeId) {
  if (!buildings?.length) return false;
  const o = owner | 0;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) === o && b.type === typeId && buildingIsFinished(b)) return true;
  }
  return false;
}

/**
 * @param {{ owner?: number, type?: string }[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} typeId
 */
export function ownerMeetsBuildingRequires(buildings, owner, typeId) {
  const reqs = getBuildingRequires(typeId);
  for (let i = 0; i < reqs.length; i++) {
    if (!ownerHasBuildingType(buildings, owner, reqs[i])) return false;
  }
  return true;
}

/**
 * Construction time in builder-ticks (work by ONE villager). Two villagers
 * halve the wall-clock; an engineer counts as a slot at half speed. An
 * unattended village still trickles at 0.1× that baseline. See construction.js.
 */
export const BUILD_TIME = Object.freeze({
  // basic
  camp: 80,
  village: 120,
  farm: 60,
  silo: 60,
  mine: 100,
  // advanced
  tower: 120,
  tavern: 140,
  barracks: 160,
  workshop: 160,
  lab: 140,
  // elemental
  factory: 200,
  church: 180,
  moonwell: 160,
  perch: 180,
  grove: 160,
});

const DEFAULT_BUILD_TIME = 100;

/** Hit points by type — a warrior (10 dmg) should take a while on a camp. */
export const BUILDING_HP = Object.freeze({
  camp: 280,
  village: 420,
  farm: 220,
  silo: 200,
  mine: 300,
  tower: 380,
  tavern: 320,
  barracks: 480,
  workshop: 450,
  lab: 340,
  factory: 560,
  church: 400,
  moonwell: 280,
  perch: 280,
  grove: 360,
});

const DEFAULT_BUILDING_HP = 300;

export function getBuildingHp(typeId) {
  return BUILDING_HP[typeId] ?? DEFAULT_BUILDING_HP;
}

export function isBuildingAlive(b) {
  if (!b) return false;
  // Older checkpoints / tests omit hp — treat as standing.
  if (b.hp == null) return true;
  return (b.hp | 0) > 0;
}

/** Builder-ticks to raise a building type (single-worker baseline). */
export function getBuildTime(typeId) {
  return BUILD_TIME[typeId] ?? DEFAULT_BUILD_TIME;
}

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
  village: { units: ['engineer', 'monk'] },
  tower: { units: ['wizard'] },
  tavern: { units: ['warlock'], upgrades: ['patronage'] },
  lab: { upgrades: ['artillery'] },
  barracks: { units: ['warrior', 'archer'], upgrades: ['drayage'] },
  workshop: { units: ['wagon'], upgrades: ['armor', 'scribes'] },
  factory: { units: ['apc'] },
  church: { units: ['priest'] },
  moonwell: { upgrades: ['prospecting', 'stewardship'] },
  perch: { units: ['dirigible'] },
  grove: { units: ['shaman'] },
};

/**
 * Resolved menu items for a building type (icons + labels for the action radial).
 * @param {string} typeId
 * @returns {{ units: { id: string, name: string, unitType: number, cost: Record<string, number> }[], upgrades: { id: string, name: string, cost: Record<string, number> }[] } | null}
 */
export function getBuildingMenu(typeId) {
  const raw = BUILDING_MENUS[typeId];
  if (!raw) return null;

  /** @type {{ id: string, name: string, unitType: number, cost: Record<string, number> }[]} */
  const units = [];
  for (const key of raw.units ?? []) {
    const unitType = BUILDING_MENU_UNITS[key];
    if (unitType == null) continue;
    const def = getUnitDef(unitType);
    const pop = unitPopCost(unitType);
    const cost = pop > 0 ? { ...getUnitCost(unitType), pop } : getUnitCost(unitType);
    units.push({
      id: key,
      name: def?.name ?? key,
      unitType,
      cost,
    });
  }

  /** @type {{ id: string, name: string, cost: Record<string, number> }[]} */
  const upgrades = [];
  for (const key of raw.upgrades ?? []) {
    if (!(key in UPGRADE_MODEL_URLS)) continue;
    const def = UPGRADE_DEFS[/** @type {keyof typeof UPGRADE_DEFS} */ (key)];
    upgrades.push({ id: key, name: def?.name ?? key, cost: getTechCost(key) });
  }

  if (!units.length && !upgrades.length) return null;
  return { units, upgrades };
}

/** @param {string} typeId */
export function buildingHasMenu(typeId) {
  return getBuildingMenu(typeId) != null;
}

/** Production buildings that spawn units can take a train rally. */
export function buildingCanRally(typeId) {
  return (BUILDING_MENUS[typeId]?.units?.length ?? 0) > 0;
}

/** Extra rally flags after the first planted point (building → flag). */
export const RALLY_EXTRA_HOP_MAX = 1;
/** Drayage unlocks one more hop (building → flag → flag). */
export const RALLY_EXTRA_HOP_MAX_DRAYAGE = 2;

/** How many extra rally hops this owner may plant. */
export function rallyExtraHopCap(w, owner) {
  return ownerHasTech(w, owner, TECH.DRAYAGE)
    ? RALLY_EXTRA_HOP_MAX_DRAYAGE
    : RALLY_EXTRA_HOP_MAX;
}

export function clearBuildingRallyHops(b) {
  if (!b) return;
  b.rallyHopCount = 0;
  b.rallyHop1X = 0;
  b.rallyHop1Z = 0;
  b.rallyHop1Order = ORDER.MOVE;
  b.rallyHop2X = 0;
  b.rallyHop2Z = 0;
  b.rallyHop2Order = ORDER.MOVE;
}

/** Min world-float distance between successive rally flags. */
const RALLY_HOP_MIN_DIST = 2.5;

export function isRallyBeyondPoint(ax, az, bx, bz, minDist = RALLY_HOP_MIN_DIST) {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz > minDist * minDist;
}

/**
 * Visible planted flags on a serialized (world-float) building.
 * hop 0 = primary rally, 1–2 = extra hops.
 * @returns {{ hop: number, x: number, z: number, order: number }[]}
 */
export function listRallyFlags(b) {
  if (!b?.hasRally) return [];
  if (!isRallyBeyondBuilding(b.type, b.x, b.z, b.rallyX, b.rallyZ)) return [];
  /** @type {{ hop: number, x: number, z: number, order: number }[]} */
  const out = [
    { hop: 0, x: b.rallyX, z: b.rallyZ, order: b.rallyOrder | 0 },
  ];
  const n = b.rallyHopCount | 0;
  if (n >= 1) {
    out.push({
      hop: 1,
      x: b.rallyHop1X,
      z: b.rallyHop1Z,
      order: b.rallyHop1Order | 0,
    });
  }
  if (n >= 2) {
    out.push({
      hop: 2,
      x: b.rallyHop2X,
      z: b.rallyHop2Z,
      order: b.rallyHop2Order | 0,
    });
  }
  return out;
}

export function clearUnitRallyHops(w, i) {
  if (w.rallyHopCount) w.rallyHopCount[i] = 0;
}

/** Copy remaining hops from a building onto a newly trained unit. */
export function stampUnitRallyHops(w, i, b) {
  if (!w.rallyHopCount) return;
  const n = Math.min(2, b.rallyHopCount | 0);
  w.rallyHopCount[i] = n;
  if (n >= 1) {
    w.rallyHop1X[i] = b.rallyHop1X | 0;
    w.rallyHop1Y[i] = b.rallyHop1Z | 0;
    w.rallyHop1Order[i] = (b.rallyHop1Order | 0) === ORDER.ATTACK_MOVE
      ? ORDER.ATTACK_MOVE
      : ORDER.MOVE;
  }
  if (n >= 2) {
    w.rallyHop2X[i] = b.rallyHop2X | 0;
    w.rallyHop2Y[i] = b.rallyHop2Z | 0;
    w.rallyHop2Order[i] = (b.rallyHop2Order | 0) === ORDER.ATTACK_MOVE
      ? ORDER.ATTACK_MOVE
      : ORDER.MOVE;
  }
}

/**
 * Arrive at the current rally dest → walk the next stamped hop.
 * @returns {boolean} true when a hop was started (caller should not idle).
 */
export function continueRallyHop(w, field, i) {
  const n = w.rallyHopCount?.[i] | 0;
  if (n <= 0) return false;
  let rx = w.rallyHop1X[i];
  let rz = w.rallyHop1Y[i];
  const hopOrder =
    (w.rallyHop1Order[i] | 0) === ORDER.ATTACK_MOVE ? ORDER.ATTACK_MOVE : ORDER.MOVE;
  if (n >= 2) {
    w.rallyHop1X[i] = w.rallyHop2X[i];
    w.rallyHop1Y[i] = w.rallyHop2Y[i];
    w.rallyHop1Order[i] = w.rallyHop2Order[i];
    w.rallyHopCount[i] = 1;
  } else {
    w.rallyHopCount[i] = 0;
  }
  if (field && !isFlyer(w.type[i])) {
    const snapped = snapToPassable(field, rx, rz);
    if (snapped) {
      rx = snapped.x;
      rz = snapped.y;
    }
  }
  w.order[i] = hopOrder;
  w.tx[i] = rx;
  w.ty[i] = rz;
  w.hasTarget[i] = 1;
  if (field) {
    const style = w.pathSlowAware?.[i] | 0;
    queuePath(
      w,
      i,
      rx,
      rz,
      style === PATH_STYLE.TREE_SEEK
        ? { treeSeek: true }
        : style === PATH_STYLE.SLOW_AWARE
          ? { slowAware: true }
          : null,
    );
  }
  return true;
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
export function applyStructureOccupancyAt(field, typeId, xFixed, zFixed, built = true) {
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
  // A farm is a food worksite: mark its center tile as an infinite food node so
  // villagers work food in place (see gather.js). Only once the farm
  // is raised — a construction site produces nothing. Rebuilds/checkpoints
  // re-stamp occupancy, so this stays in sync with the building set.
  if (typeId === 'farm' && built) {
    const n = field.width * field.height;
    if (!field.foodNode || field.foodNode.length !== n) field.foodNode = new Uint8Array(n);
    const tx = worldToTile(xFixed);
    const tz = worldToTile(zFixed);
    if (tx >= 0 && tz >= 0 && tx < field.width && tz < field.height) {
      field.foodNode[tz * field.width + tx] = 1;
    }
  }
}

function isSolidWater(field, i) {
  return field.terrainTypes?.[i] === TERRAIN.WATER && field.tileType?.[i] === 12;
}

function otherLiveBuildingCovers(field, buildings, i, exceptIndex, coordsAreFloat) {
  if (!buildings) return false;
  for (let bi = 0; bi < buildings.length; bi++) {
    if (bi === exceptIndex) continue;
    const b = buildings[bi];
    if (!isBuildingAlive(b)) continue;
    const bx = coordsAreFloat ? fx.fromFloat(b.x) : b.x;
    const bz = coordsAreFloat ? fx.fromFloat(b.z) : b.z;
    let hit = false;
    forEachFootprintTile(field, b.type, bx, bz, (_tx, _tz, ti) => {
      if (ti === i) hit = true;
    });
    if (hit) return true;
  }
  return false;
}

function rockCovers(field, tx, tz) {
  const { width, height, sceneryType, rockStock } = field;
  if (!sceneryType) return false;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = tx + dx;
      const cz = tz + dz;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue;
      const ti = cz * width + cx;
      const kind = sceneryType[ti];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      const r = rockFootprintRadiusForStock(kind, rockStock?.[ti] | 0);
      if (r < 0) continue;
      if (dx * dx + dz * dz <= (r + 0.5) ** 2) return true;
    }
  }
  return false;
}

function tileKeepsSlow(field, i) {
  return !!(
    isTerrainSlowTile(field, i)
    || field.rockSlowMask?.[i]
    || field.tableSlowMask?.[i]
    || field.sceneryType?.[i] === SCENERY.TREE
    || (field.treeStock?.[i] | 0) > 0
  );
}

/**
 * Open a ruined building's tiles. Never unblocks water / table / rocks / other
 * live buildings. Incremental — does not restamp the whole map.
 */
export function clearStructureOccupancyAt(field, typeId, xFixed, zFixed, opts = {}) {
  if (!field?.pass || !getBuildingFootprint(typeId)) return;
  const buildings = opts.buildings;
  const exceptIndex = opts.exceptIndex ?? -1;
  const coordsAreFloat = !!opts.coordsAreFloat;
  forEachFootprintTile(field, typeId, xFixed, zFixed, (tx, tz, i, mode) => {
    if (mode === 'block') {
      if (
        !(field.activeMask && field.activeMask[i] === 0)
        && !isSolidWater(field, i)
        && !field.tableEdge?.[i]
        && !rockCovers(field, tx, tz)
        && !otherLiveBuildingCovers(field, buildings, i, exceptIndex, coordsAreFloat)
      ) {
        field.pass[i] = 1;
      }
    }
    if (field.structureSlowMask) field.structureSlowMask[i] = 0;
    if (field.foodNode) field.foodNode[i] = 0;
    field.slowMask[i] = tileKeepsSlow(field, i) ? 1 : 0;
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
      if (!isBuildingAlive(b)) continue;
      applyStructureOccupancyAt(field, b.type, b.x, b.z, b.built != null ? b.built : 1);
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
    const x = fx.fromFloat(b.x);
    const z = fx.fromFloat(b.z);
    if (!isBuildingAlive(b)) {
      clearStructureOccupancyAt(field, b.type, x, z, {
        buildings,
        exceptIndex: i,
        coordsAreFloat: true,
      });
      continue;
    }
    applyStructureOccupancyAt(
      field,
      b.type,
      x,
      z,
      b.built != null ? b.built : 1,
    );
  }
}

/**
 * @param {{ owner: number, type: string, x: number, z: number, yaw?: number }} opts
 *   x/z are world floats; stored as Q16.16.
 */
export function createBuilding(opts) {
  const type = String(opts.type);
  const x = fx.fromFloat(opts.x);
  const z = fx.fromFloat(opts.z);
  const yaw = opts.yaw != null ? fx.fromFloat(opts.yaw) : 0;
  const buildTime = getBuildTime(type);
  // Defaults to complete — staging showcase, checkpoints, and tests want live
  // buildings. Placement (applyPlaceBuilding) opts into an under-construction site.
  const built = opts.built != null ? opts.built | 0 : 1;
  return {
    owner: opts.owner | 0,
    type,
    x,
    z,
    yaw,
    /** 1 = player-set rally; 0 = use doorway default on train spawn. */
    hasRally: 0,
    rallyX: 0,
    rallyZ: 0,
    /** ORDER.MOVE or ORDER.ATTACK_MOVE for trained units walking to the rally. */
    rallyOrder: ORDER.MOVE,
    /** Extra hops after the first planted flag (0–2). */
    rallyHopCount: 0,
    rallyHop1X: 0,
    rallyHop1Z: 0,
    rallyHop1Order: ORDER.MOVE,
    rallyHop2X: 0,
    rallyHop2Z: 0,
    rallyHop2Order: ORDER.MOVE,
    /** 1 = hold production tracks (queue stays, progress freezes). */
    prodPaused: 0,
    /** 0 = under construction (inert); 1 = raised and functional. */
    built,
    /** Builder-ticks accrued (see construction.js). */
    buildProgress: built ? buildTime : 0,
    /** Leftover half-tick from engineer work (0 or 1). */
    buildHalfAcc: 0,
    /** Remainder toward the next idle-village builder-tick (0..IDLE_VILLAGE_DEN-1). */
    buildIdleAcc: 0,
    /** Builder-ticks required to raise this building. */
    buildTime,
    /** @type {{ kind: 'unit' | 'upgrade', id: string, unitType?: number, count: number, progress: number }[]} */
    tracks: [],
    /** Ticks accrued toward the next free village villager (0 while a site). */
    villageSpawnAcc: 0,
    /** Last engineer stack on this drop-off, held until engBonusUntil. */
    engBonus: 0,
    engBonusUntil: 0,
    /** Ticks until a watchtower may fire again. */
    attackCd: 0,
    maxHp: getBuildingHp(type),
    hp: opts.hp != null ? opts.hp | 0 : getBuildingHp(type),
    locustTicks: 0,
    locustStacks: 0,
    locustAcc: 0,
    locustHops: 0,
    locustSource: -1,
  };
}

/**
 * True when the rally point sits outside the building's axis-aligned footprint.
 * @param {string} typeId
 * @param {number} bx world float
 * @param {number} bz world float
 * @param {number} rx world float
 * @param {number} rz world float
 */
export function isRallyBeyondBuilding(typeId, bx, bz, rx, rz) {
  const fp = getBuildingFootprint(typeId);
  const halfW = ((fp?.w ?? 2) * TILE_SIZE_F) * 0.5;
  const halfH = ((fp?.h ?? 2) * TILE_SIZE_F) * 0.5;
  const margin = 0.75;
  return Math.abs(rx - bx) > halfW + margin || Math.abs(rz - bz) > halfH + margin;
}

/**
 * Default walk-out point just past the spawn doorway.
 * @param {string} typeId
 * @param {number} xF
 * @param {number} zF
 * @param {number} yawF
 */
export function defaultRallyWorld(typeId, xF, zF, yawF) {
  const local = BUILDING_SPAWN_LOCAL[typeId] ?? { x: 0, y: 0, z: 0 };
  return buildingLocalToWorld(xF, zF, yawF, local.x * 1.35, local.z * 1.35);
}

/**
 * True when every trainable unit on this building is a flyer (e.g. perch → dirigible).
 * Air rallies are straight-line — no ground A*.
 * @param {string} typeId
 */
export function buildingTrainsOnlyFlyers(typeId) {
  const units = BUILDING_MENUS[typeId]?.units;
  if (!units?.length) return false;
  for (let i = 0; i < units.length; i++) {
    const ut = BUILDING_MENU_UNITS[units[i]];
    if (ut == null || !isFlyer(ut)) return false;
  }
  return true;
}

/**
 * World-float polyline for a train rally: building → spawn door → A* → rally.
 * Flyer buildings (perch) use a straight air stem. Falls back to a straight
 * stem if the field is missing or A* finds nothing.
 * @param {object | null | undefined} field
 * @param {{ type: string, x: number, z: number, yaw?: number }} b world-float building
 * @param {number} rx
 * @param {number} rz
 * @param {{ slowAware?: boolean }} [opts]
 * @returns {{ x: number, z: number }[]}
 */
export function rallyPathWorldPoints(field, b, rx, rz, opts = null) {
  const bx = b.x;
  const bz = b.z;
  const yaw = b.yaw ?? 0;
  const local = BUILDING_SPAWN_LOCAL[b.type] ?? { x: 0, y: 0, z: 0 };
  const spawn = buildingLocalToWorld(bx, bz, yaw, local.x, local.z);
  /** @type {{ x: number, z: number }[]} */
  const pts = [{ x: bx, z: bz }];
  if (Math.hypot(spawn.x - bx, spawn.z - bz) > 0.35) {
    pts.push({ x: spawn.x, z: spawn.z });
  }

  // Dirigibles / air units ignore ground blockers and slow — fly straight.
  if (buildingTrainsOnlyFlyers(b.type) || !field) {
    pts.push({ x: rx, z: rz });
    return pts;
  }

  let sx = fx.fromFloat(spawn.x);
  let sz = fx.fromFloat(spawn.z);
  let dx = fx.fromFloat(rx);
  let dz = fx.fromFloat(rz);
  const snappedS = snapToPassable(field, sx, sz);
  if (snappedS) {
    sx = snappedS.x;
    sz = snappedS.y;
  }
  const snappedE = snapToPassable(field, dx, dz);
  if (snappedE) {
    dx = snappedE.x;
    dz = snappedE.y;
  }

  const n = findPath(
    field,
    sx,
    sz,
    dx,
    dz,
    _rallyWx,
    _rallyWy,
    MAX_WAYPOINTS,
    opts?.slowAware ? { slowAware: true } : null,
  );
  if (n <= 0) {
    pts.push({ x: rx, z: rz });
    return pts;
  }

  const sxf = fx.toFloat(sx);
  const szf = fx.toFloat(sz);
  const last = pts[pts.length - 1];
  if (Math.hypot(sxf - last.x, szf - last.z) > 0.35) {
    pts.push({ x: sxf, z: szf });
  }
  appendRallyAstarPoints(pts, n, rx, rz);
  return pts;
}

/**
 * World-float polyline between two points (flag → next flag / ghost tip).
 * Straight if `air` or the field is missing.
 * @param {object | null | undefined} field
 * @param {number} ax
 * @param {number} az
 * @param {number} bx
 * @param {number} bz
 * @param {{ slowAware?: boolean, air?: boolean }} [opts]
 * @returns {{ x: number, z: number }[]}
 */
export function rallySegmentWorldPoints(field, ax, az, bx, bz, opts = null) {
  /** @type {{ x: number, z: number }[]} */
  const pts = [{ x: ax, z: az }];
  if (opts?.air || !field) {
    pts.push({ x: bx, z: bz });
    return pts;
  }
  let sx = fx.fromFloat(ax);
  let sz = fx.fromFloat(az);
  let dx = fx.fromFloat(bx);
  let dz = fx.fromFloat(bz);
  const snappedS = snapToPassable(field, sx, sz);
  if (snappedS) {
    sx = snappedS.x;
    sz = snappedS.y;
  }
  const snappedE = snapToPassable(field, dx, dz);
  if (snappedE) {
    dx = snappedE.x;
    dz = snappedE.y;
  }
  const n = findPath(
    field,
    sx,
    sz,
    dx,
    dz,
    _rallyWx,
    _rallyWy,
    MAX_WAYPOINTS,
    opts?.slowAware ? { slowAware: true } : null,
  );
  if (n <= 0) {
    pts.push({ x: bx, z: bz });
    return pts;
  }
  appendRallyAstarPoints(pts, n, bx, bz);
  return pts;
}

function appendRallyAstarPoints(pts, n, ex, ez) {
  for (let i = 0; i < n; i++) {
    const x = fx.toFloat(_rallyWx[i]);
    const z = fx.toFloat(_rallyWy[i]);
    const prev = pts[pts.length - 1];
    if (Math.hypot(x - prev.x, z - prev.z) < 0.2) continue;
    pts.push({ x, z });
  }
  const end = pts[pts.length - 1];
  if (Math.hypot(ex - end.x, ez - end.z) > 0.2) {
    pts.push({ x: ex, z: ez });
  }
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
    if (w.targetBuilding) w.targetBuilding[i] = -1;
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
  if (!ownerMeetsBuildingRequires(w.buildings, owner, type)) return -1;
  if (!spendResources(w, owner, getBuildingCost(type))) return -1;
  w.buildings.push({
    owner,
    type,
    x,
    z,
    yaw,
    hasRally: 0,
    rallyX: 0,
    rallyZ: 0,
    rallyOrder: ORDER.MOVE,
    rallyHopCount: 0,
    rallyHop1X: 0,
    rallyHop1Z: 0,
    rallyHop1Order: ORDER.MOVE,
    rallyHop2X: 0,
    rallyHop2Z: 0,
    rallyHop2Order: ORDER.MOVE,
    prodPaused: 0,
    // Placed as an inert construction site — villagers raise it (construction.js).
    built: 0,
    buildProgress: 0,
    buildHalfAcc: 0,
    buildIdleAcc: 0,
    buildTime: getBuildTime(type),
    tracks: [],
    villageSpawnAcc: 0,
    engBonus: 0,
    engBonusUntil: 0,
    attackCd: 0,
    maxHp: getBuildingHp(type),
    hp: getBuildingHp(type),
  });
  if (field) {
    // Block tiles now (the foundation occupies space) but defer the farm food
    // node until the build completes.
    applyStructureOccupancyAt(field, type, x, z, /* built */ false);
    ejectUnitsFromFootprint(w, field, type, x, z);
  }
  w.buildingsDirty = 1;
  return w.buildings.length - 1;
}

/**
 * Set a building's train rally point (world Q16.16 xz) and walk-out order.
 * hopFrom -1 (default) = first flag from the building (clears extra hops).
 * hopFrom 0 = extra hop from the first flag; hopFrom 1 = second extra (Drayage).
 * @param {object} w
 * @param {{ playerId?: number, buildingIndex?: number, buildingIndices?: number[], tx: number, ty: number, order?: number, hopFrom?: number }} cmd
 */
export function applySetRally(w, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const indices = cmd.buildingIndices?.length
    ? cmd.buildingIndices
    : [cmd.buildingIndex];
  const order =
    (cmd.order | 0) === ORDER.ATTACK_MOVE ? ORDER.ATTACK_MOVE : ORDER.MOVE;
  let dirty = false;
  for (let i = 0; i < indices.length; i++) {
    const bi = indices[i] | 0;
    if (bi < 0 || bi >= buildings.length) continue;
    const b = buildings[bi];
    const playerId = (cmd.playerId ?? -1) | 0;
    if (playerId >= 0 && b.owner !== playerId) continue;
    if (!buildingCanRally(b.type)) continue;
    const rx = cmd.tx | 0;
    const rz = cmd.ty | 0;
    const hopFrom = cmd.hopFrom != null ? cmd.hopFrom | 0 : -1;
    const cap = rallyExtraHopCap(w, b.owner);
    if (hopFrom < 0) {
      if (
        !isRallyBeyondBuilding(
          b.type,
          fx.toFloat(b.x),
          fx.toFloat(b.z),
          fx.toFloat(rx),
          fx.toFloat(rz),
        )
      ) {
        continue;
      }
      b.hasRally = 1;
      b.rallyX = rx;
      b.rallyZ = rz;
      b.rallyOrder = order;
      clearBuildingRallyHops(b);
      dirty = true;
      continue;
    }
    if (hopFrom === 0) {
      if (!b.hasRally || cap < 1) continue;
      if (
        !isRallyBeyondPoint(
          fx.toFloat(b.rallyX),
          fx.toFloat(b.rallyZ),
          fx.toFloat(rx),
          fx.toFloat(rz),
        )
      ) {
        continue;
      }
      b.rallyHop1X = rx;
      b.rallyHop1Z = rz;
      b.rallyHop1Order = order;
      b.rallyHopCount = 1;
      b.rallyHop2X = 0;
      b.rallyHop2Z = 0;
      b.rallyHop2Order = ORDER.MOVE;
      dirty = true;
      continue;
    }
    if (hopFrom === 1) {
      if ((b.rallyHopCount | 0) < 1 || cap < 2) continue;
      if (
        !isRallyBeyondPoint(
          fx.toFloat(b.rallyHop1X),
          fx.toFloat(b.rallyHop1Z),
          fx.toFloat(rx),
          fx.toFloat(rz),
        )
      ) {
        continue;
      }
      b.rallyHop2X = rx;
      b.rallyHop2Z = rz;
      b.rallyHop2Order = order;
      b.rallyHopCount = 2;
      dirty = true;
    }
  }
  if (dirty) w.buildingsDirty = 1;
}

/**
 * Queue one unit on a building's production track (multi-track; slowdown in step).
 * @param {object} w
 * @param {{ playerId?: number, buildingIndex: number, unitKey: string }} cmd
 */
export function applyQueueTrain(w, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const bi = cmd.buildingIndex | 0;
  if (bi < 0 || bi >= buildings.length) return;
  const b = buildings[bi];
  const playerId = (cmd.playerId ?? -1) | 0;
  if ((b.owner | 0) !== playerId) return;
  if (b.built === 0) return; // can't train from a site under construction
  const unitKey = String(cmd.unitKey ?? '');
  const unitType = BUILDING_MENU_UNITS[unitKey];
  if (unitType == null) return;
  const menu = BUILDING_MENUS[b.type];
  if (!menu?.units?.includes(unitKey)) return;
  if (!spendResources(w, b.owner | 0, getUnitCost(unitType))) return;
  if (!b.tracks) b.tracks = [];
  let track = null;
  for (let i = 0; i < b.tracks.length; i++) {
    const t = b.tracks[i];
    if (t.kind === 'unit' && t.id === unitKey) {
      track = t;
      break;
    }
  }
  if (!track) {
    track = { kind: 'unit', id: unitKey, unitType, count: 0, progress: 0 };
    b.tracks.push(track);
  }
  track.count = (track.count | 0) + 1;
  w.buildingsDirty = 1;
}

/**
 * Queue research on a building's upgrade track (one at a time per tech).
 * Completes via buildingProductionSystem → grantTech.
 * @param {object} w
 * @param {{ playerId?: number, buildingIndex: number, techId: string }} cmd
 */
export function applyQueueResearch(w, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const bi = cmd.buildingIndex | 0;
  if (bi < 0 || bi >= buildings.length) return;
  const b = buildings[bi];
  const playerId = (cmd.playerId ?? -1) | 0;
  if ((b.owner | 0) !== playerId) return;
  if (b.built === 0) return; // can't research from a site under construction
  const techId = String(cmd.techId ?? '');
  if (!TECH_BY_ID[techId]) return;
  const menu = BUILDING_MENUS[b.type];
  if (!menu?.upgrades?.includes(techId)) return;
  if (ownerHasTech(w, playerId, TECH_BY_ID[techId])) return;
  if (!b.tracks) b.tracks = [];
  for (let i = 0; i < b.tracks.length; i++) {
    const t = b.tracks[i];
    if (t.kind === 'upgrade' && t.id === techId && (t.count | 0) > 0) return;
  }
  if (!spendResources(w, playerId, getTechCost(techId))) return;
  b.tracks.push({ kind: 'upgrade', id: techId, count: 1, progress: 0 });
  w.buildingsDirty = 1;
}

/**
 * Tear down an unfinished construction site and refund its placement cost.
 * Finished buildings are unchanged (use combat / CANCEL_TRAIN for those).
 * @param {object} w
 * @param {object} [field]
 * @param {{ playerId?: number, buildingIndex: number }} cmd
 */
export function applyCancelConstruction(w, field, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const bi = cmd.buildingIndex | 0;
  if (bi < 0 || bi >= buildings.length) return;
  const b = buildings[bi];
  const playerId = (cmd.playerId ?? -1) | 0;
  if ((b.owner | 0) !== playerId) return;
  if (b.built !== 0) return;
  if (!isBuildingAlive(b)) return;
  const cost = getBuildingCost(b.type);
  for (const kind in cost) addResource(w, playerId, kind, cost[kind] | 0);
  b.hp = 0;
  if (field) {
    clearStructureOccupancyAt(field, b.type, b.x, b.z, {
      buildings: w.buildings,
      exceptIndex: bi,
    });
  }
  w.buildingsDirty = 1;
}

/**
 * Clear all production tracks on a building.
 * @param {object} w
 * @param {{ playerId?: number, buildingIndex: number }} cmd
 */
export function applyCancelTrain(w, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const bi = cmd.buildingIndex | 0;
  if (bi < 0 || bi >= buildings.length) return;
  const b = buildings[bi];
  const playerId = (cmd.playerId ?? -1) | 0;
  if ((b.owner | 0) !== playerId) return;
  if (!b.tracks?.length) return;
  refundTracks(w, b);
  b.tracks = [];
  b.prodPaused = 0;
  w.buildingsDirty = 1;
}

/** Return resources for every queued-but-unspawned unit / cancelled upgrade. */
function refundTracks(w, b) {
  const owner = b.owner | 0;
  for (let i = 0; i < b.tracks.length; i++) {
    const t = b.tracks[i];
    const count = t.count | 0;
    if (count <= 0) continue;
    const cost = t.kind === 'upgrade' ? getTechCost(t.id) : getUnitCost(t.unitType);
    for (const kind in cost) addResource(w, owner, kind, (cost[kind] | 0) * count);
  }
}

function buildingHasProduction(b) {
  const tracks = b?.tracks;
  if (!tracks?.length) return false;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if ((t.count | 0) > 0 || (Number(t.progress) || 0) > 0) return true;
  }
  return false;
}

/**
 * Hold or resume production on a building. Queue stays; progress freezes.
 * @param {object} w
 * @param {{ playerId?: number, buildingIndex: number, paused?: number }} cmd
 */
export function applyPauseTrain(w, cmd) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const bi = cmd.buildingIndex | 0;
  if (bi < 0 || bi >= buildings.length) return;
  const b = buildings[bi];
  const playerId = (cmd.playerId ?? -1) | 0;
  if ((b.owner | 0) !== playerId) return;
  if (!buildingHasProduction(b)) return;
  const next = cmd.paused != null ? ((cmd.paused | 0) ? 1 : 0) : b.prodPaused ? 0 : 1;
  if ((b.prodPaused | 0) === next) return;
  b.prodPaused = next;
  w.buildingsDirty = 1;
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
    hasRally: b.hasRally | 0,
    rallyX: b.hasRally ? fx.toFloat(b.rallyX) : 0,
    rallyZ: b.hasRally ? fx.toFloat(b.rallyZ) : 0,
    rallyOrder: b.hasRally
      ? (b.rallyOrder | 0) === ORDER.ATTACK_MOVE
        ? ORDER.ATTACK_MOVE
        : ORDER.MOVE
      : ORDER.MOVE,
    rallyHopCount: b.rallyHopCount | 0,
    rallyHop1X: (b.rallyHopCount | 0) >= 1 ? fx.toFloat(b.rallyHop1X) : 0,
    rallyHop1Z: (b.rallyHopCount | 0) >= 1 ? fx.toFloat(b.rallyHop1Z) : 0,
    rallyHop1Order:
      (b.rallyHop1Order | 0) === ORDER.ATTACK_MOVE ? ORDER.ATTACK_MOVE : ORDER.MOVE,
    rallyHop2X: (b.rallyHopCount | 0) >= 2 ? fx.toFloat(b.rallyHop2X) : 0,
    rallyHop2Z: (b.rallyHopCount | 0) >= 2 ? fx.toFloat(b.rallyHop2Z) : 0,
    rallyHop2Order:
      (b.rallyHop2Order | 0) === ORDER.ATTACK_MOVE ? ORDER.ATTACK_MOVE : ORDER.MOVE,
    prodPaused: b.prodPaused | 0,
    built: b.built != null ? b.built | 0 : 1,
    buildProgress: b.buildProgress | 0,
    buildTime: b.buildTime != null ? b.buildTime | 0 : getBuildTime(b.type),
    tracks: (b.tracks ?? []).map((t) => ({
      kind: t.kind,
      id: t.id,
      unitType: t.unitType | 0,
      count: t.count | 0,
      progress: Number(t.progress) || 0,
    })),
    maxHp: b.maxHp != null ? b.maxHp | 0 : getBuildingHp(b.type),
    hp: b.hp != null ? b.hp | 0 : getBuildingHp(b.type),
    locustStacks: b.locustStacks | 0,
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
    mix(b.hasRally | 0);
    mix(b.rallyX | 0);
    mix(b.rallyZ | 0);
    mix(b.rallyOrder | 0);
    mix(b.rallyHopCount | 0);
    mix(b.rallyHop1X | 0);
    mix(b.rallyHop1Z | 0);
    mix(b.rallyHop1Order | 0);
    mix(b.rallyHop2X | 0);
    mix(b.rallyHop2Z | 0);
    mix(b.rallyHop2Order | 0);
    mix(b.prodPaused | 0);
    mix(b.built != null ? b.built | 0 : 1);
    mix(b.buildProgress | 0);
    mix(b.buildHalfAcc | 0);
    mix(b.buildIdleAcc | 0);
    mix(b.villageSpawnAcc | 0);
    mix(b.engBonus | 0);
    mix(b.engBonusUntil | 0);
    mix(b.attackCd | 0);
    mix(b.maxHp != null ? b.maxHp | 0 : getBuildingHp(b.type));
    mix(b.hp != null ? b.hp | 0 : getBuildingHp(b.type));
    mix(b.locustTicks | 0);
    mix(b.locustStacks | 0);
    mix(b.locustAcc | 0);
    mix(b.locustHops | 0);
    mix(b.locustSource | 0);
    const tracks = b.tracks ?? [];
    mix(tracks.length);
    for (let ti = 0; ti < tracks.length; ti++) {
      const t = tracks[ti];
      const id = t.id || '';
      mix(id.length);
      for (let c = 0; c < id.length; c++) mix(id.charCodeAt(c));
      mix(t.unitType | 0);
      mix(t.count | 0);
      mix(fx.fromFloat(Number(t.progress) || 0));
    }
  }
  return h;
}
