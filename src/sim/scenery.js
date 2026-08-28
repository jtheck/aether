// Deterministic v1-style static scenery placement.
// Sim owns the layout because rocks affect passability and trees affect speed.

import * as fx from './fixed.js';
import { TERRAIN, worldToTile, applyTerrainSlow, isTerrainSlowTile } from './field.js';
import { applyTableEdgeOccupancy, refreshTableTerrain } from './tableShape.js';
import {
  TREE_STAGE_MAX,
  TREE_STAGE_MIN,
  TREE_WOOD_PER_STAGE,
  ensureTreeArrays,
  fellTreeAt,
  growTreeAt,
} from './trees.js';

export function defaultTreeStock(tx, tz, seed) {
  const h = sceneryTileHash(tx, tz, seed + 4000);
  // Bias toward the high end so big trees are common, saplings less so.
  const biased = 1 - (1 - h) * (1 - h);
  const span = TREE_STAGE_MAX - TREE_STAGE_MIN + 1;
  const stages = TREE_STAGE_MIN + Math.min(span - 1, Math.floor(biased * span));
  return stages * TREE_WOOD_PER_STAGE;
}

export const SCENERY = {
  NONE: 0,
  TREE: 1,
  ROCK_PLAIN: 2,
  ROCK_MOSS: 3,
  ROCK_SNOW: 4,
};

/** Speed scale on slowMask tiles (trees + partial water + rock borders). */
export const SLOW_MULTIPLIER = fx.fromFloat(0.45);
/** @deprecated Use {@link SLOW_MULTIPLIER} */
export const TREE_SLOW_MULTIPLIER = SLOW_MULTIPLIER;
export const SPAWN_CLEAR_RADIUS_TILES = 6;

const ROCK_RATE = 0.03;
const TREE_GRASS_RATE = 0.2;
const TREE_DIRT_RATE = 0.05;

/** Exact v1 tile hash, isolated from the simulation RNG stream. */
export function sceneryTileHash(x, z, seed) {
  let hash = seed;
  hash = hash ^ (x * 374761393);
  hash = hash ^ (z * 668265263);
  hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
  hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
  hash = hash ^ (hash >>> 16);
  return Math.abs(hash >>> 0) / 4294967296;
}

export function rockFootprintRadius(kind) {
  if (kind === SCENERY.ROCK_SNOW) return 2;
  if (kind === SCENERY.ROCK_MOSS) return 1;
  return 0;
}

export const ROCK_STAGE_MAX = 6;

// Rock nodes yield stone/mineral. Small plain rocks give the rarer mineral;
// larger moss/snow rocks give bulk stone. Stock lives on the CENTER tile only
// (footprint tiles are pass-blockers with no stock). Yields are multiples of
// ROCK_STAGE_MAX so each visual/collision stage is a clean bite of the pile.
const ROCK_YIELD = {
  [SCENERY.ROCK_PLAIN]: 90,
  [SCENERY.ROCK_MOSS]: 180,
  [SCENERY.ROCK_SNOW]: 300,
};

/** Resource kind a rock of this scenery kind yields. */
export function rockResourceKind(kind) {
  return kind === SCENERY.ROCK_PLAIN ? 'mineral' : 'stone';
}

/** Opening stock for a freshly placed rock center (0 if not a rock). */
export function rockYield(kind) {
  return ROCK_YIELD[kind] ?? 0;
}

export function rockStockPerStage(kind) {
  return Math.max(1, (rockYield(kind) / ROCK_STAGE_MAX) | 0);
}

export function rockStageFromStock(kind, stock) {
  if (stock <= 0) return 0;
  return Math.min(ROCK_STAGE_MAX, Math.ceil(stock / rockStockPerStage(kind)));
}

/** Visual scale multiplier for a stage (1..6). Stage 0 → hidden. */
export function rockScaleForStage(stage) {
  if (stage <= 0) return 0;
  if (stage === 1) return 0.40;
  if (stage === 2) return 0.52;
  if (stage === 3) return 0.64;
  if (stage === 4) return 0.76;
  if (stage === 5) return 0.88;
  return 1;
}

/**
 * Collision radius for a remaining stage. Shrinks as the pile is mined so
 * villagers walk in and the mesh is free to show exhaustion.
 * @returns {number} tile radius, or -1 when the rock is gone
 */
export function rockFootprintRadiusForStage(kind, stage) {
  if (stage <= 0) return -1;
  const maxR = rockFootprintRadius(kind);
  if (maxR <= 0) return 0;
  if (maxR === 1) return stage >= 4 ? 1 : 0;
  if (stage >= 5) return 2;
  if (stage >= 3) return 1;
  return 0;
}

export function rockFootprintRadiusForStock(kind, stock) {
  return rockFootprintRadiusForStage(kind, rockStageFromStock(kind, stock));
}

export function ensureRockArrays(field) {
  const n = field.width * field.height;
  if (!(field.rockStock instanceof Uint16Array) || field.rockStock.length !== n) {
    const next = new Uint16Array(n);
    if (field.rockStock?.length) next.set(field.rockStock.subarray(0, Math.min(field.rockStock.length, n)));
    field.rockStock = next;
  }
  if (!Array.isArray(field.rockDirty)) field.rockDirty = [];
  if (field.rockStockHash == null) field.rockStockHash = 0;
  return field;
}

function markRockDirty(field, tileIndex) {
  const dirty = field.rockDirty;
  for (let i = 0; i < dirty.length; i++) {
    if (dirty[i] === tileIndex) return;
  }
  dirty.push(tileIndex);
}

function mixRockHash(hash, tile, stock) {
  return Math.imul((hash ^ tile ^ stock ^ (stock << 13)) | 0, 0x01000193);
}

function inRockDisc(dx, dz, radius) {
  if (radius < 0) return false;
  return dx * dx + dz * dz <= (radius + 0.5) ** 2;
}

function tileCenterOf(field, tile) {
  const width = field.width;
  const tz = (tile / width) | 0;
  return { tx: tile - tz * width, tz };
}

function isSolidWaterTile(field, i) {
  return field.terrainTypes?.[i] === TERRAIN.WATER && field.tileType?.[i] === 12;
}

function otherRockCovers(field, tx, tz, exceptTile) {
  const { width, height, sceneryType, rockStock } = field;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = tx + dx;
      const cz = tz + dz;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue;
      const i = cz * width + cx;
      if (i === exceptTile) continue;
      const kind = sceneryType[i];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      const r = rockFootprintRadiusForStock(kind, rockStock[i] | 0);
      if (inRockDisc(dx, dz, r)) return true;
    }
  }
  return false;
}

function forEachDiscTile(field, cx, cz, radius, visit) {
  if (radius < 0) return;
  const { width, height } = field;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!inRockDisc(dx, dz, radius)) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= width || tz >= height) continue;
      visit(tx, tz, tz * width + tx);
    }
  }
}

function canUnblockRockTile(field, i, tx, tz, exceptTile) {
  if (field.activeMask && field.activeMask[i] === 0) return false;
  if (isSolidWaterTile(field, i)) return false;
  if (field.tableEdge?.[i]) return false;
  if (otherRockCovers(field, tx, tz, exceptTile)) return false;
  return true;
}

/** Open tiles that left this rock's disc. Never unblocks water / table / other rocks. */
function shrinkRockFootprint(field, tile, prevRadius, nextRadius) {
  if (nextRadius >= prevRadius) return;
  const { tx, tz } = tileCenterOf(field, tile);
  forEachDiscTile(field, tx, tz, prevRadius, (x, z, i) => {
    if (inRockDisc(x - tx, z - tz, nextRadius)) return;
    if (!canUnblockRockTile(field, i, x, z, tile)) return;
    field.pass[i] = 1;
  });
}

function tileKeepsSlowWithoutRock(field, i) {
  return !!(
    isTerrainSlowTile(field, i)
    || field.structureSlowMask?.[i]
    || field.tableSlowMask?.[i]
    || field.sceneryType?.[i] === SCENERY.TREE
    || (field.treeStock?.[i] | 0) > 0
  );
}

function refreshRockSlow(field) {
  const n = field.width * field.height;
  const old = field.rockSlowMask;
  if (old) {
    for (let i = 0; i < n; i++) {
      if (!old[i]) continue;
      field.slowMask[i] = tileKeepsSlowWithoutRock(field, i) ? 1 : 0;
    }
  }
  applyRockSlowBorder(field);
}

/**
 * Re-fit every rock's collision disc to remaining stock. Safe after checkpoint
 * restore (pass is not serialized; rocks would otherwise keep their spawn size).
 */
export function applyRockOccupancyFromStock(field) {
  if (!field?.sceneryType) return field;
  ensureRockArrays(field);
  const { sceneryType, rockStock } = field;
  let changed = false;
  for (let i = 0; i < sceneryType.length; i++) {
    const kind = sceneryType[i];
    if (kind < SCENERY.ROCK_PLAIN) continue;
    const stock = rockStock[i] | 0;
    const maxR = rockFootprintRadius(kind);
    const nextR = rockFootprintRadiusForStock(kind, stock);
    if (stock <= 0) sceneryType[i] = SCENERY.NONE;
    if (nextR !== maxR) {
      shrinkRockFootprint(field, i, maxR, nextR);
      changed = true;
    }
  }
  if (changed) refreshRockSlow(field);
  return field;
}

/**
 * Chip stock off a rock center tile. Returns stone/mineral actually removed.
 * Crossing a stage shrinks the collision disc so exhaustion can show.
 */
export function damageRock(field, tile, amount) {
  ensureRockArrays(field);
  if (amount <= 0) return 0;
  const stock = field.rockStock[tile] | 0;
  if (stock <= 0) return 0;
  const kind = field.sceneryType?.[tile] ?? 0;
  const prevR = rockFootprintRadiusForStock(kind, stock);
  const next = stock > amount ? stock - amount : 0;
  const removed = stock - next;
  field.rockStock[tile] = next;
  field.rockStockHash = mixRockHash(field.rockStockHash | 0, tile, next);
  if (next === 0 && kind >= SCENERY.ROCK_PLAIN) {
    field.sceneryType[tile] = SCENERY.NONE;
  }
  const nextR = rockFootprintRadiusForStock(kind, next);
  if (nextR !== prevR) {
    shrinkRockFootprint(field, tile, prevR, nextR);
    refreshRockSlow(field);
  }
  markRockDirty(field, tile);
  return removed;
}

/** Drain dirty rock tiles for worker → main publish. */
export function takeRockUpdates(field) {
  ensureRockArrays(field);
  const dirty = field.rockDirty;
  if (dirty.length === 0) return null;
  const n = dirty.length;
  const tiles = new Uint32Array(n);
  const stock = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const ti = dirty[i];
    tiles[i] = ti;
    stock[i] = field.rockStock[ti];
  }
  field.rockDirty = [];
  return { tiles, stock };
}

export function applyRockUpdatesToField(field, updates) {
  if (!field || !updates?.tiles?.length) return;
  ensureRockArrays(field);
  const { tiles, stock } = updates;
  let occupancy = false;
  for (let i = 0; i < tiles.length; i++) {
    const ti = tiles[i];
    if (ti < 0 || ti >= field.rockStock.length) continue;
    const kind = field.sceneryType?.[ti] ?? 0;
    const prev = field.rockStock[ti] | 0;
    const next = stock[i] | 0;
    const prevR = rockFootprintRadiusForStock(kind, prev);
    field.rockStock[ti] = next;
    if (next === 0 && kind >= SCENERY.ROCK_PLAIN) {
      field.sceneryType[ti] = SCENERY.NONE;
    }
    const nextR = rockFootprintRadiusForStock(kind, next);
    if (nextR !== prevR) {
      shrinkRockFootprint(field, ti, prevR, nextR);
      occupancy = true;
    }
  }
  if (occupancy) refreshRockSlow(field);
}

/** Recompute the incremental rock-stock hash from scratch (checkpoint restore). */
export function rehashRockStock(field) {
  let h = 0;
  const stock = field.rockStock;
  if (stock) {
    for (let i = 0; i < stock.length; i++) {
      if (stock[i]) h = mixRockHash(h, i, stock[i]);
    }
  }
  field.rockStockHash = h | 0;
}

/** Checksum contribution for rock stock (mirrors mixTreeChecksum). */
export function mixRockChecksum(mix, field) {
  mix(field?.rockStock ? field.rockStockHash | 0 : 0);
}

/**
 * Populate scenery after terrain and initial world spawns exist.
 * @param {object} field
 * @param {object | null} world
 * @param {Array<[number, number]>} reservedWorldPoints
 */
export function populateScenery(field, world = null, reservedWorldPoints = []) {
  const { width, height, seed, activeMask, pass, terrainTypes } = field;
  const n = width * height;
  const sceneryType = field.sceneryType?.length === n
    ? field.sceneryType
    : new Uint8Array(n);
  const slowMask = field.slowMask?.length === n
    ? field.slowMask
    : new Uint8Array(n);
  sceneryType.fill(SCENERY.NONE);
  slowMask.fill(0);
  field.sceneryType = sceneryType;
  field.slowMask = slowMask;
  if (!field.rockSlowMask || field.rockSlowMask.length !== n) {
    field.rockSlowMask = new Uint8Array(n);
  } else {
    field.rockSlowMask.fill(0);
  }
  ensureRockArrays(field);
  field.rockStock.fill(0);
  field.rockDirty.length = 0;
  field.rockStockHash = 0;
  ensureTreeArrays(field);
  field.treeStock.fill(0);
  field.treeBurn.fill(0);
  field.burningTrees.length = 0;
  field.treeDirty.length = 0;
  field.treeStockHash = 0;

  const reserved = buildReservedMask(field, world, reservedWorldPoints);
  const occupied = new Uint8Array(n);

  // Pass 1: rocks on dirt.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (!isEligible(field, i, reserved)) continue;
      if (terrainTypes[i] !== TERRAIN.DIRT) continue;
      if (sceneryTileHash(tx, tz, seed + 1000) >= ROCK_RATE) continue;

      const regionX = Math.floor(tx / 5);
      const regionZ = Math.floor(tz / 5);
      const sizeRoll = sceneryTileHash(regionX, regionZ, seed + 2000);
      const kind = sizeRoll < 0.3
        ? SCENERY.ROCK_PLAIN
        : sizeRoll < 0.7
          ? SCENERY.ROCK_MOSS
          : SCENERY.ROCK_SNOW;
      const radius = rockFootprintRadius(kind);
      if (!footprintAvailable(field, occupied, reserved, tx, tz, radius)) continue;

      sceneryType[i] = kind;
      field.rockStock[i] = rockYield(kind);
      field.rockStockHash = mixRockHash(field.rockStockHash | 0, i, field.rockStock[i]);
      markFootprint(field, occupied, pass, tx, tz, radius);
    }
  }

  // Yellow ring around rock-red (same overlay language as table edge).
  applyRockSlowBorder(field, occupied);

  // Pass 2: trees on unoccupied grass/dirt.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (!isEligible(field, i, reserved) || occupied[i]) continue;
      const terrain = terrainTypes[i];
      if (terrain !== TERRAIN.GRASS && terrain !== TERRAIN.DIRT) continue;
      const rate = terrain === TERRAIN.GRASS ? TREE_GRASS_RATE : TREE_DIRT_RATE;
      if (sceneryTileHash(tx, tz, seed + 3000) >= rate) continue;
      sceneryType[i] = SCENERY.TREE;
      slowMask[i] = 1;
      occupied[i] = 1;
      field.treeStock[i] = defaultTreeStock(tx, tz, seed);
    }
  }

  // Partial-water slow only (after trees so fill(0) above does not wipe it).
  applyTerrainSlow(field);
  // Table-edge yellow/red — populate wipes slowMask, so re-OR the rim.
  applyTableEdgeOccupancy(field);

  return field;
}

function isEligible(field, i, reserved) {
  if (field.activeMask && field.activeMask[i] === 0) return false;
  if (field.pass[i] === 0) return false;
  return reserved[i] === 0;
}

function buildReservedMask(field, world, reservedWorldPoints) {
  const mask = new Uint8Array(field.width * field.height);
  for (const point of reservedWorldPoints) {
    markReservedCircle(field, mask, worldToTile(fx.fromFloat(point[0])), worldToTile(fx.fromFloat(point[1])));
  }
  if (world) {
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      markReservedCircle(field, mask, worldToTile(world.px[i]), worldToTile(world.py[i]));
    }
  }
  return mask;
}

function markReservedCircle(field, mask, cx, cz) {
  const radius = SPAWN_CLEAR_RADIUS_TILES;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) continue;
      mask[tz * field.width + tx] = 1;
    }
  }
}

function footprintAvailable(field, occupied, reserved, cx, cz, radius) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
      const i = tz * field.width + tx;
      if (occupied[i] || reserved[i]) return false;
      if (field.activeMask && field.activeMask[i] === 0) return false;
      if (field.pass[i] === 0) return false;
    }
  }
  return true;
}

function markFootprint(field, occupied, pass, cx, cz, radius) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) continue;
      const i = tz * field.width + tx;
      occupied[i] = 1;
      pass[i] = 0;
    }
  }
}

/**
 * OR a 1-tile slow ring around rock footprints.
 * @param {object} field
 * @param {Uint8Array} [rockMask] rock tiles (defaults to footprints from sceneryType)
 */
export function applyRockSlowBorder(field, rockMask = null) {
  const { width, height, pass, slowMask, activeMask } = field;
  const n = width * height;
  if (!field.rockSlowMask || field.rockSlowMask.length !== n) {
    field.rockSlowMask = new Uint8Array(n);
  } else {
    field.rockSlowMask.fill(0);
  }
  const rockSlow = field.rockSlowMask;
  const mask = rockMask ?? collectRockMask(field);
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (activeMask && activeMask[i] === 0) continue;
      if (pass[i] === 0) continue;
      if (!hasRockNeighbor(mask, width, height, tx, tz)) continue;
      slowMask[i] = 1;
      rockSlow[i] = 1;
    }
  }
  return field;
}

function collectRockMask(field) {
  const { width, height, sceneryType } = field;
  const mask = new Uint8Array(width * height);
  if (!sceneryType) return mask;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const kind = sceneryType[tz * width + tx];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      const stock = field.rockStock?.[tz * width + tx] | 0;
      const radius = stock > 0
        ? rockFootprintRadiusForStock(kind, stock)
        : rockFootprintRadius(kind);
      if (radius < 0) continue;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
          const x = tx + dx;
          const z = tz + dz;
          if (x < 0 || z < 0 || x >= width || z >= height) continue;
          mask[z * width + x] = 1;
        }
      }
    }
  }
  return mask;
}

function ensureSceneryArrays(field) {
  const n = field.width * field.height;
  if (!field.sceneryType || field.sceneryType.length !== n) field.sceneryType = new Uint8Array(n);
  ensureTreeArrays(field);
  ensureRockArrays(field);
}

function stampRockCenter(field, tx, tz, kind) {
  const { width, height } = field;
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
  const i = tz * width + tx;
  if (field.activeMask?.[i] === 0) return false;
  if (kind < SCENERY.ROCK_PLAIN || kind > SCENERY.ROCK_SNOW) return false;
  const radius = rockFootprintRadius(kind);
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= width || z >= height) return false;
      if (field.activeMask?.[z * width + x] === 0) return false;
    }
  }
  if (field.sceneryType[i] === SCENERY.TREE) fellTreeAt(field, i);
  field.sceneryType[i] = kind;
  if (field.rockStock) {
    field.rockStock[i] = rockYield(kind);
    field.rockStockHash = mixRockHash(field.rockStockHash | 0, i, field.rockStock[i]);
  }
  return true;
}

function stampClear(field, tx, tz) {
  const i = tz * field.width + tx;
  const kind = field.sceneryType?.[i] ?? SCENERY.NONE;
  let changed = false;
  if (kind === SCENERY.TREE || (field.treeStock?.[i] > 0)) {
    fellTreeAt(field, i);
    changed = true;
  }
  if (kind >= SCENERY.ROCK_PLAIN) {
    field.sceneryType[i] = SCENERY.NONE;
    if (field.rockStock) {
      field.rockStock[i] = 0;
      field.rockStockHash = mixRockHash(field.rockStockHash | 0, i, 0);
    }
    changed = true;
  }
  return changed;
}

/** Plant a rock center and refresh occupancy. */
export function placeRockAt(field, tx, tz, kind = SCENERY.ROCK_PLAIN) {
  ensureSceneryArrays(field);
  if (!stampRockCenter(field, tx, tz, kind)) return false;
  applyAuthoredScenery(field);
  return true;
}

/** Remove a tree or rock at a tile. */
export function clearSceneryAt(field, tx, tz) {
  const { width, height } = field;
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
  ensureSceneryArrays(field);
  if (!stampClear(field, tx, tz)) return false;
  applyAuthoredScenery(field);
  return true;
}

/** Recompute rock pass + tree slow from sceneryType / treeStock without regenerating. */
export function applyAuthoredScenery(field) {
  const { width, height } = field;
  const n = width * height;
  ensureSceneryArrays(field);
  refreshTableTerrain(field);
  const occupied = new Uint8Array(n);
  ensureRockArrays(field);
  field.rockStock.fill(0);
  field.rockStockHash = 0;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      const kind = field.sceneryType[i];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      markFootprint(field, occupied, field.pass, tx, tz, rockFootprintRadius(kind));
      field.rockStock[i] = rockYield(kind);
      field.rockStockHash = mixRockHash(field.rockStockHash | 0, i, field.rockStock[i]);
    }
  }
  applyRockSlowBorder(field, occupied);
  for (let i = 0; i < n; i++) {
    if (field.sceneryType[i] === SCENERY.TREE || (field.treeStock[i] > 0)) {
      field.sceneryType[i] = SCENERY.TREE;
      field.slowMask[i] = 1;
    }
  }
  applyTerrainSlow(field);
  applyTableEdgeOccupancy(field);
  return field;
}

export function paintSceneryBrush(field, tx, tz, kind, radius = 0) {
  ensureSceneryArrays(field);
  const r = Math.max(0, radius | 0);
  const r2 = r * r;
  const dirty = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      const i = z * field.width + x;
      if (field.activeMask?.[i] === 0) continue;
      if (kind === SCENERY.NONE) {
        if (stampClear(field, x, z)) dirty.push({ x, z });
        continue;
      }
      if (kind === SCENERY.TREE) {
        if (field.sceneryType[i] >= SCENERY.ROCK_PLAIN) continue;
        const stock = defaultTreeStock(x, z, field.seed);
        if (growTreeAt(field, i, stock)) dirty.push({ x, z });
        continue;
      }
      if (stampRockCenter(field, x, z, kind)) dirty.push({ x, z });
    }
  }
  if (dirty.length) applyAuthoredScenery(field);
  return dirty;
}

function hasRockNeighbor(mask, width, height, tx, tz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      if (mask[nz * width + nx]) return true;
    }
  }
  return false;
}
