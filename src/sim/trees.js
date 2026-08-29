// Per-tile tree stock + burn. Harvesting and fire both deplete the same stock;
// visual size is a discrete stage derived from remaining wood.

import * as fx from './fixed.js';
import {
  TILE_SIZE_F,
  TERRAIN,
  inBounds,
  worldToTile,
  isPassable,
  isTerrainSlowTile,
  activeWorldHalfF,
} from './field.js';

// Keep in sync with SCENERY in scenery.js (avoid circular import).
const SCENERY_NONE = 0;
const SCENERY_TREE = 1;

/** Wood removed per visual stage (matches a single legacy gather bite). */
export const TREE_WOOD_PER_STAGE = 7;
export const TREE_STAGE_MIN = 2;
export const TREE_STAGE_MAX = 6;

/** Immediate chip on fireball splash — two visual stages, then the tree keeps burning. */
export const TREE_IGNITE_DAMAGE = TREE_WOOD_PER_STAGE * 2;
/** Ticks a tree stays lit after ignite / re-ignite (~45s at 20Hz). Uint16. */
export const TREE_BURN_TICKS = 900;
/** While burning, lose one stage on this cadence (~2.5s at 20Hz). */
export const TREE_BURN_DAMAGE_INTERVAL = 50;
export const TREE_BURN_DAMAGE = TREE_WOOD_PER_STAGE;

export function treeStageFromStock(stock) {
  if (stock <= 0) return 0;
  return Math.ceil(stock / TREE_WOOD_PER_STAGE);
}

/** Visual scale multiplier for a stage (1..6). Stage 0 → hidden. */
export function treeScaleForStage(stage) {
  if (stage <= 0) return 0;
  if (stage === 1) return 0.42;
  if (stage === 2) return 0.55;
  if (stage === 3) return 0.68;
  if (stage === 4) return 0.82;
  if (stage === 5) return 0.95;
  return 1.12;
}

export function ensureTreeArrays(field) {
  const n = field.width * field.height;
  if (field.treeStock?.length !== n) field.treeStock = new Uint8Array(n);
  // Uint16 — Uint8 wrapped multi-second burn timers down to ~1s.
  if (!(field.treeBurn instanceof Uint16Array) || field.treeBurn.length !== n) {
    field.treeBurn = new Uint16Array(n);
  }
  if (!Array.isArray(field.burningTrees)) field.burningTrees = [];
  if (!Array.isArray(field.treeDirty)) field.treeDirty = [];
  if (field.treeStockHash == null) field.treeStockHash = 0;
  return field;
}

function markTreeDirty(field, tileIndex) {
  const dirty = field.treeDirty;
  for (let i = 0; i < dirty.length; i++) {
    if (dirty[i] === tileIndex) return;
  }
  dirty.push(tileIndex);
}

function mixStockHash(field, tileIndex, stock) {
  field.treeStockHash = Math.imul(
    (field.treeStockHash ^ tileIndex ^ (stock << 8)) | 0,
    0x01000193,
  );
}

function tileKeepsSlowAfterTree(field, tileIndex) {
  return !!(
    isTerrainSlowTile(field, tileIndex)
    || field.structureSlowMask?.[tileIndex]
    || field.rockSlowMask?.[tileIndex]
    || field.tableSlowMask?.[tileIndex]
  );
}

function fellTree(field, tileIndex) {
  field.sceneryType[tileIndex] = SCENERY_NONE;
  // Keep wet shore + farm/agora + rock-border + table-edge slow after the tree is gone.
  field.slowMask[tileIndex] = tileKeepsSlowAfterTree(field, tileIndex) ? 1 : 0;
  field.treeStock[tileIndex] = 0;
  field.treeBurn[tileIndex] = 0;
}

/**
 * Reduce stock; felling clears scenery + slow. Returns wood actually removed.
 */
export function damageTree(field, tileIndex, amount) {
  ensureTreeArrays(field);
  if (amount <= 0) return 0;
  const stock = field.treeStock[tileIndex];
  if (stock <= 0) return 0;
  const next = stock > amount ? stock - amount : 0;
  const removed = stock - next;
  field.treeStock[tileIndex] = next;
  mixStockHash(field, tileIndex, next);
  if (next === 0) fellTree(field, tileIndex);
  markTreeDirty(field, tileIndex);
  return removed;
}

/** Light a living tree (refreshes burn timer). */
export function igniteTree(field, tileIndex) {
  ensureTreeArrays(field);
  if (field.treeStock[tileIndex] <= 0) return false;
  if (field.treeBurn[tileIndex] === 0) {
    field.burningTrees.push(tileIndex);
  }
  field.treeBurn[tileIndex] = TREE_BURN_TICKS;
  markTreeDirty(field, tileIndex);
  return true;
}

/**
 * Empty grass/dirt tile that can accept a new tree (spore growth, etc.).
 * Spawn pads are cleared only at scenery populate — mid-game growth may fill them.
 * @param {Set<number>|null} [pendingTiles] tile indices already queued to grow
 */
export function canGrowTreeAt(field, tx, tz, pendingTiles = null) {
  if (!inBounds(tx, tz)) return false;
  if (!isPassable(field, tx, tz)) return false;
  const i = tz * field.width + tx;
  if (field.activeMask?.[i] === 0) return false;
  if (field.structureSlowMask?.[i]) return false;
  const terrain = field.terrainTypes?.[i];
  if (terrain !== TERRAIN.GRASS && terrain !== TERRAIN.DIRT) return false;
  const kind = field.sceneryType?.[i] ?? SCENERY_NONE;
  if (kind !== SCENERY_NONE) return false;
  if ((field.treeStock?.[i] ?? 0) > 0) return false;
  if (pendingTiles?.has(i)) return false;
  return true;
}

/**
 * Plant a living tree on an empty tile. Returns false if the tile is occupied.
 */
export function growTreeAt(field, tileIndex, stock) {
  ensureTreeArrays(field);
  if (tileIndex < 0 || tileIndex >= field.treeStock.length) return false;
  const amount = Math.max(0, Math.min(255, stock | 0));
  if (amount <= 0) return false;
  if ((field.treeStock[tileIndex] ?? 0) > 0) return false;
  const kind = field.sceneryType?.[tileIndex] ?? SCENERY_NONE;
  if (kind !== SCENERY_NONE && kind !== SCENERY_TREE) return false;

  field.sceneryType[tileIndex] = SCENERY_TREE;
  field.treeStock[tileIndex] = amount;
  field.treeBurn[tileIndex] = 0;
  field.slowMask[tileIndex] = 1;
  mixStockHash(field, tileIndex, amount);
  markTreeDirty(field, tileIndex);
  return true;
}

/** Instantly fell a living tree (full stock wipe). */
export function fellTreeAt(field, tileIndex) {
  ensureTreeArrays(field);
  const stock = field.treeStock[tileIndex];
  if (stock <= 0) return 0;
  return damageTree(field, tileIndex, stock);
}

/** Fireball / AoE: ignite + chip trees inside splash radius. */
export function applyTreeSplash(field, impactX, impactY, radius) {
  if (!field?.treeStock || !radius || radius <= 0) return false;
  ensureTreeArrays(field);
  const radius2 = fx.mul(radius, radius);
  const cx = worldToTile(impactX);
  const cz = worldToTile(impactY);
  const rTiles = Math.ceil(fx.toFloat(radius) / TILE_SIZE_F) + 1;
  let hit = false;

  for (let tz = cz - rTiles; tz <= cz + rTiles; tz++) {
    for (let tx = cx - rTiles; tx <= cx + rTiles; tx++) {
      if (!inBounds(tx, tz)) continue;
      const i = tz * field.width + tx;
      if (field.treeStock[i] <= 0) continue;
      const half = activeWorldHalfF();
      const wx = fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half);
      const wz = fx.fromFloat((tz + 0.5) * TILE_SIZE_F - half);
      if (fx.dist2(impactX, impactY, wx, wz) > radius2) continue;
      if (igniteTree(field, i)) hit = true;
      if (damageTree(field, i, TREE_IGNITE_DAMAGE) > 0) hit = true;
    }
  }
  return hit;
}

/** Advance burning trees; depletes stock on a fixed cadence. */
export function treeBurnSystem(field) {
  ensureTreeArrays(field);
  const list = field.burningTrees;
  for (let i = list.length - 1; i >= 0; i--) {
    const ti = list[i];
    let burn = field.treeBurn[ti];
    if (burn === 0 || field.treeStock[ti] === 0) {
      field.treeBurn[ti] = 0;
      list[i] = list[list.length - 1];
      list.pop();
      markTreeDirty(field, ti);
      continue;
    }
    burn -= 1;
    field.treeBurn[ti] = burn;
    // Damage on the interval boundary; publish only on stock/ignite/extinguish.
    if (burn % TREE_BURN_DAMAGE_INTERVAL === 0) {
      damageTree(field, ti, TREE_BURN_DAMAGE);
    }
    if (field.treeStock[ti] === 0 || burn === 0) {
      field.treeBurn[ti] = 0;
      list[i] = list[list.length - 1];
      list.pop();
      markTreeDirty(field, ti);
    }
  }
}

/** Drain dirty tiles for worker → main publish. */
export function takeTreeUpdates(field) {
  ensureTreeArrays(field);
  const dirty = field.treeDirty;
  if (dirty.length === 0) return null;
  const n = dirty.length;
  const tiles = new Uint32Array(n);
  const stock = new Uint8Array(n);
  const burn = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const ti = dirty[i];
    tiles[i] = ti;
    stock[i] = field.treeStock[ti];
    burn[i] = field.treeBurn[ti];
  }
  field.treeDirty = [];
  return { tiles, stock, burn };
}

export function applyTreeUpdatesToField(field, updates) {
  if (!field || !updates?.tiles?.length) return;
  ensureTreeArrays(field);
  const { tiles, stock, burn } = updates;
  for (let i = 0; i < tiles.length; i++) {
    const ti = tiles[i];
    if (ti < 0 || ti >= field.treeStock.length) continue;
    const nextStock = stock[i];
    field.treeStock[ti] = nextStock;
    field.treeBurn[ti] = burn[i];
    if (nextStock === 0) {
      if (field.sceneryType[ti] === SCENERY_TREE) {
        field.sceneryType[ti] = SCENERY_NONE;
        field.slowMask[ti] = tileKeepsSlowAfterTree(field, ti) ? 1 : 0;
      }
    } else {
      field.sceneryType[ti] = SCENERY_TREE;
      field.slowMask[ti] = 1;
    }
  }
}

export function mixTreeChecksum(mix, field) {
  if (!field?.treeStock) return;
  mix(field.treeStockHash | 0);
  const list = field.burningTrees;
  mix(list?.length ?? 0);
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const ti = list[i];
    mix(ti);
    mix(field.treeStock[ti]);
    mix(field.treeBurn[ti]);
  }
}
