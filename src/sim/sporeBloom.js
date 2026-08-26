// Spore Bloom — myco point-cast: fell trees in blast, seed delayed outward arc.

import * as fx from './fixed.js';
import {
  TILE_SIZE_F,
  activeWorldHalfF,
  inBounds,
  worldToTile,
} from './field.js';
import { UNIT } from './unitTypes.js';
import { rngFrac } from './rng.js';
import {
  canGrowTreeAt,
  fellTreeAt,
  growTreeAt,
} from './trees.js';

import { capacityFor } from './capacity.js';

/** Blast clears trees out to this radius. */
export const SPORE_OUTER_RADIUS = fx.fromFloat(TILE_SIZE_F * 3.5);
/** (v1 wood credit zone — unused in v2, kept for parity.) */
export const SPORE_INNER_RADIUS = fx.fromFloat(TILE_SIZE_F * 1.75);
/** Ticks before another bloom (~6s at 20Hz). */
export const SPORE_BLOOM_COOLDOWN = 120;
/** Base delay before seeded trees sprout (~6s at 20Hz) — leaves mushroom beat. */
export const SPORE_GROWTH_DELAY = 120;
/** Stock planted on each seed tile (4 stages × 7). */
export const SPORE_TREE_STOCK = 28;
export const SPORE_MAX_SEEDS = 22;
/** If chance under-rolls, top up to at least this many (then toward max). */
export const SPORE_MIN_SEEDS = 3;
export const SPORE_SEED_CHANCE = 0.78;
/** Half-angle cosine of the seed arc (cos 160° → 320° sweep; small gap toward the myco). */
export const SPORE_SEED_ARC_COS = -0.9397;
/** Half-sweep in radians (acos of the cosine gate). */
export const SPORE_SEED_ARC_HALF = Math.acos(SPORE_SEED_ARC_COS);
/** World-unit keep-off so seeds never land next to the caster. */
const SPORE_SEED_CASTER_CLEAR_F = TILE_SIZE_F * 2;
/** Aim closer than this uses facing for the outward axis. */
const AIM_DIR_MIN = fx.fromFloat(TILE_SIZE_F * 0.5);

/** Initial delayed-sprout queue; grows by powers of two. */
export const SPORE_PENDING_INITIAL = 512;
const CANDIDATE_CAP = 512;

export function createSporeGrowthStore(capacity = SPORE_PENDING_INITIAL) {
  return {
    capacity,
    count: 0,
    tile: new Int32Array(capacity),
    growAtTick: new Int32Array(capacity),
    stock: new Uint8Array(capacity),
  };
}

function ensureSporePendingCapacity(store, minCapacity) {
  if (!store || minCapacity <= store.capacity) return;
  const newCap = capacityFor(minCapacity, { initial: SPORE_PENDING_INITIAL });
  if (newCap <= store.capacity) return;
  const grow = (arr, TypedArray) => {
    const next = new TypedArray(newCap);
    next.set(arr);
    return next;
  };
  store.tile = grow(store.tile, Int32Array);
  store.growAtTick = grow(store.growAtTick, Int32Array);
  store.stock = grow(store.stock, Uint8Array);
  store.capacity = newCap;
}

export function createSporeBloomFxStore() {
  return {
    dripCount: 0,
    dripX: [],
    dripY: [],
    seedCount: 0,
    seedX: [],
    seedY: [],
    seedGrowAt: [],
    arcCount: 0,
    arcX: [],
    arcY: [],
    arcDirX: [],
    arcDirY: [],
    arcRadius: [],
    headCount: 0,
    headEntity: [],
    headX: [],
    headY: [],
    headKill: [],
  };
}

export function pushSporeDripFx(w, x, y) {
  const store = w.sporeBloomFx;
  if (!store) return;
  store.dripX.push(fx.toFloat(x));
  store.dripY.push(fx.toFloat(y));
  store.dripCount++;
}

export function pushSporeSeedFx(w, x, y, growAtTick) {
  const store = w.sporeBloomFx;
  if (!store) return;
  store.seedX.push(fx.toFloat(x));
  store.seedY.push(fx.toFloat(y));
  store.seedGrowAt.push(growAtTick | 0);
  store.seedCount++;
}

export function pushSporeHeadFx(w, entity, x, y, killed) {
  const store = w.sporeBloomFx;
  if (!store) return;
  store.headEntity.push(entity | 0);
  store.headX.push(fx.toFloat(x));
  store.headY.push(fx.toFloat(y));
  store.headKill.push(killed ? 1 : 0);
  store.headCount++;
}

export function pushSporeArcFx(w, x, y, dirX, dirY, radius) {
  const store = w.sporeBloomFx;
  if (!store) return;
  store.arcX.push(fx.toFloat(x));
  store.arcY.push(fx.toFloat(y));
  store.arcDirX.push(fx.toFloat(dirX));
  store.arcDirY.push(fx.toFloat(dirY));
  store.arcRadius.push(fx.toFloat(radius));
  store.arcCount++;
}

/** Drain tree-drip + seed markers + cast-arc flash for worker → main. */
export function takeSporeBloomUpdates(w) {
  const store = w.sporeBloomFx;
  if (!store) return null;
  if (
    store.dripCount === 0 &&
    store.seedCount === 0 &&
    !store.arcCount &&
    !store.headCount
  ) return null;
  const dn = store.dripCount;
  const sn = store.seedCount;
  const an = store.arcCount || 0;
  const hn = store.headCount || 0;
  const patch = {
    dripCount: dn,
    dripX: store.dripX.slice(0, dn),
    dripY: store.dripY.slice(0, dn),
    seedCount: sn,
    seedX: store.seedX.slice(0, sn),
    seedY: store.seedY.slice(0, sn),
    seedGrowAt: store.seedGrowAt.slice(0, sn),
    arcCount: an,
    arcX: store.arcX.slice(0, an),
    arcY: store.arcY.slice(0, an),
    arcDirX: store.arcDirX.slice(0, an),
    arcDirY: store.arcDirY.slice(0, an),
    arcRadius: store.arcRadius.slice(0, an),
    headCount: hn,
    headEntity: store.headEntity.slice(0, hn),
    headX: store.headX.slice(0, hn),
    headY: store.headY.slice(0, hn),
    headKill: store.headKill.slice(0, hn),
  };
  store.dripX.length = 0;
  store.dripY.length = 0;
  store.dripCount = 0;
  store.seedX.length = 0;
  store.seedY.length = 0;
  store.seedGrowAt.length = 0;
  store.seedCount = 0;
  store.arcX.length = 0;
  store.arcY.length = 0;
  store.arcDirX.length = 0;
  store.arcDirY.length = 0;
  store.arcRadius.length = 0;
  store.arcCount = 0;
  store.headEntity.length = 0;
  store.headX.length = 0;
  store.headY.length = 0;
  store.headKill.length = 0;
  store.headCount = 0;
  return patch;
}

function pendingTileSet(store) {
  const set = new Set();
  for (let i = 0; i < store.count; i++) set.add(store.tile[i]);
  return set;
}

function queueGrowth(store, tileIndex, growAtTick, stock) {
  if (store.count >= store.capacity) {
    ensureSporePendingCapacity(store, store.count + 1);
  }
  if (store.count >= store.capacity) return false;
  const i = store.count++;
  store.tile[i] = tileIndex;
  store.growAtTick[i] = growAtTick;
  store.stock[i] = stock;
  return true;
}

/**
 * Plant one delayed tree seed at (or nearest to) a world point.
 * Used when a myco head-mushroom hit is the killing blow.
 * @returns {number} tile index, or -1
 */
export function queueTreeSeedAt(w, field, x, y, {
  delayTicks = SPORE_GROWTH_DELAY,
  stock = SPORE_TREE_STOCK,
} = {}) {
  const store = w.treeGrowth;
  if (!store || !field) return -1;
  const pending = pendingTileSet(store);
  const tx0 = worldToTile(x);
  const tz0 = worldToTile(y);
  let best = -1;
  let bestD2 = 999;
  const R = 3;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const tx = tx0 + dx;
      const tz = tz0 + dz;
      if (!canGrowTreeAt(field, tx, tz, pending)) continue;
      const d2 = dx * dx + dz * dz;
      const ti = tz * field.width + tx;
      if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || ti < best))) {
        bestD2 = d2;
        best = ti;
      }
    }
  }
  if (best < 0) return -1;
  const growAt = w.tick + delayTicks;
  if (!queueGrowth(store, best, growAt, stock)) return -1;
  const tz = Math.floor(best / field.width);
  const tx = best - tz * field.width;
  const c = tileCenterFixed(tx, tz);
  pushSporeSeedFx(w, c.x, c.y, growAt);
  return best;
}

function tileCenterFixed(tx, tz) {
  return {
    x: fx.fromFloat((tx + 0.5) * TILE_SIZE_F - activeWorldHalfF()),
    y: fx.fromFloat((tz + 0.5) * TILE_SIZE_F - activeWorldHalfF()),
  };
}

/** Fell every living tree inside radius of (cx, cy). Publishes drip FX per tree. */
export function fellTreesInRadius(w, field, cx, cy, radius) {
  if (!field?.treeStock || !radius || radius <= 0) return 0;
  const radius2 = fx.mul(radius, radius);
  const tx0 = worldToTile(cx);
  const tz0 = worldToTile(cy);
  const rTiles = Math.ceil(fx.toFloat(radius) / TILE_SIZE_F) + 1;
  let felled = 0;
  for (let tz = tz0 - rTiles; tz <= tz0 + rTiles; tz++) {
    for (let tx = tx0 - rTiles; tx <= tx0 + rTiles; tx++) {
      if (!inBounds(tx, tz)) continue;
      const ti = tz * field.width + tx;
      if (field.treeStock[ti] <= 0) continue;
      const c = tileCenterFixed(tx, tz);
      if (fx.dist2(cx, cy, c.x, c.y) > radius2) continue;
      if (fellTreeAt(field, ti) > 0) {
        pushSporeDripFx(w, c.x, c.y);
        felled++;
      }
    }
  }
  return felled;
}

/**
 * Keep tiles on the far arc of the aim ring (away from the caster), and
 * never inside the caster keep-off. `arc` is optional (full ring if omitted).
 */
function seedOnOutwardArc(wx, wz, cxF, cyF, d2, arc) {
  if (!arc) return true;
  const ox = fx.toFloat(arc.originX);
  const oy = fx.toFloat(arc.originY);
  const tdx = wx - ox;
  const tdz = wz - oy;
  if (tdx * tdx + tdz * tdz < SPORE_SEED_CASTER_CLEAR_F * SPORE_SEED_CASTER_CLEAR_F) {
    return false;
  }
  const dirX = fx.toFloat(arc.dirX);
  const dirY = fx.toFloat(arc.dirY);
  const dirLen2 = dirX * dirX + dirY * dirY;
  if (dirLen2 <= 0) return true;
  const adx = wx - cxF;
  const adz = wz - cyF;
  const mag = Math.sqrt(d2 * dirLen2);
  if (mag <= 0) return true;
  return (adx * dirX + adz * dirY) / mag >= SPORE_SEED_ARC_COS;
}

function bloomAimDir(w, caster, aimX, aimY) {
  const dx = aimX - w.px[caster];
  const dy = aimY - w.py[caster];
  if (fx.len(dx, dy) >= AIM_DIR_MIN) return { dirX: dx, dirY: dy };
  return { dirX: w.faceX[caster] || 0, dirY: w.faceY[caster] || 0 };
}

/**
 * Collect growable arc tiles (sorted by ring offset then tile index).
 * @returns {number} candidate count written into outTiles / outOffset
 */
export function collectSporeSeedCandidates(
  field,
  cx,
  cy,
  outerRadius,
  pendingTiles,
  outTiles,
  outOffset,
  arc,
) {
  const outer = fx.toFloat(outerRadius);
  const ringHalf = Math.max(TILE_SIZE_F * 0.32, outer * 0.08);
  const ringMin = Math.max(TILE_SIZE_F, outer - ringHalf);
  const ringMax = outer + Math.min(TILE_SIZE_F * 0.18, ringHalf * 0.5);
  const ringMin2 = ringMin * ringMin;
  const ringMax2 = ringMax * ringMax;
  const cxF = fx.toFloat(cx);
  const cyF = fx.toFloat(cy);
  const tx0 = worldToTile(cx);
  const tz0 = worldToTile(cy);
  const rTiles = Math.ceil(ringMax / TILE_SIZE_F) + 1;
  const half = activeWorldHalfF();

  let n = 0;
  for (let tz = tz0 - rTiles; tz <= tz0 + rTiles; tz++) {
    for (let tx = tx0 - rTiles; tx <= tx0 + rTiles; tx++) {
      if (!inBounds(tx, tz)) continue;
      if (!canGrowTreeAt(field, tx, tz, pendingTiles)) continue;
      const wx = (tx + 0.5) * TILE_SIZE_F - half;
      const wz = (tz + 0.5) * TILE_SIZE_F - half;
      const dx = wx - cxF;
      const dz = wz - cyF;
      const d2 = dx * dx + dz * dz;
      if (d2 < ringMin2 || d2 > ringMax2) continue;
      if (!seedOnOutwardArc(wx, wz, cxF, cyF, d2, arc)) continue;
      if (n >= outTiles.length) break;
      outTiles[n] = tz * field.width + tx;
      outOffset[n] = Math.abs(Math.sqrt(d2) - outer);
      n++;
    }
  }

  // Insertion sort by ring offset, then tile index (deterministic).
  for (let i = 1; i < n; i++) {
    const t = outTiles[i];
    const o = outOffset[i];
    let j = i - 1;
    while (
      j >= 0 &&
      (outOffset[j] > o || (outOffset[j] === o && outTiles[j] > t))
    ) {
      outTiles[j + 1] = outTiles[j];
      outOffset[j + 1] = outOffset[j];
      j--;
    }
    outTiles[j + 1] = t;
    outOffset[j + 1] = o;
  }
  return n;
}

const seedTiles = new Int32Array(CANDIDATE_CAP);
const seedOffsets = new Float64Array(CANDIDATE_CAP);

/**
 * Pick seed tiles on the blast ring and queue delayed growth.
 * @returns {number} seeds queued
 */
export function queueSporeSeeds(w, field, cx, cy, {
  outerRadius = SPORE_OUTER_RADIUS,
  delayTicks = SPORE_GROWTH_DELAY,
  stock = SPORE_TREE_STOCK,
  maxSeeds = SPORE_MAX_SEEDS,
  minSeeds = SPORE_MIN_SEEDS,
  seedChance = SPORE_SEED_CHANCE,
  originX,
  originY,
  dirX,
  dirY,
} = {}) {
  const store = w.treeGrowth;
  if (!store) return 0;
  const pending = pendingTileSet(store);
  const arc = originX != null && originY != null
    ? { originX, originY, dirX: dirX || 0, dirY: dirY || 0 }
    : undefined;
  const candN = collectSporeSeedCandidates(
    field,
    cx,
    cy,
    outerRadius,
    pending,
    seedTiles,
    seedOffsets,
    arc,
  );
  if (candN <= 0) return 0;

  const selected = [];
  for (let i = 0; i < candN && selected.length < maxSeeds; i++) {
    if (rngFrac(w.rng) <= seedChance) selected.push(seedTiles[i]);
  }
  // Floor only — if chance under-rolls, top up toward maxSeeds (not stop at min).
  if (selected.length < minSeeds) {
    const used = new Set(selected);
    for (let i = 0; i < candN && selected.length < maxSeeds; i++) {
      const ti = seedTiles[i];
      if (used.has(ti)) continue;
      selected.push(ti);
      used.add(ti);
    }
  }

  const baseTick = w.tick + delayTicks;
  let queued = 0;
  for (let i = 0; i < selected.length; i++) {
    const ti = selected[i];
    const growAt = baseTick + (i % 3) * 4;
    if (!queueGrowth(store, ti, growAt, stock)) break;
    const tz = Math.floor(ti / field.width);
    const tx = ti - tz * field.width;
    const c = tileCenterFixed(tx, tz);
    pushSporeSeedFx(w, c.x, c.y, growAt);
    queued++;
  }
  return queued;
}

/**
 * Point-cast Spore Bloom at aim. Always consumes cast if myco is valid.
 */
export function castSporeBloom(w, field, caster, aimX, aimY) {
  if (caster < 0 || caster >= w.count || !w.alive[caster]) return false;
  if (w.type[caster] !== UNIT.MYCO) return false;
  if (!field) return false;

  fellTreesInRadius(w, field, aimX, aimY, SPORE_OUTER_RADIUS);
  const aimDir = bloomAimDir(w, caster, aimX, aimY);
  pushSporeArcFx(w, aimX, aimY, aimDir.dirX, aimDir.dirY, SPORE_OUTER_RADIUS);
  queueSporeSeeds(w, field, aimX, aimY, {
    originX: w.px[caster],
    originY: w.py[caster],
    dirX: aimDir.dirX,
    dirY: aimDir.dirY,
  });
  return true;
}

/** Sprout queued trees whose growAtTick has arrived. */
export function sporeGrowthSystem(w, field) {
  const store = w.treeGrowth;
  if (!store || store.count === 0 || !field) return;
  const tick = w.tick;
  for (let i = store.count - 1; i >= 0; i--) {
    if (store.growAtTick[i] > tick) continue;
    const ti = store.tile[i];
    const stock = store.stock[i];
    // Swap-remove before grow so pending set stays accurate if grow fails.
    const last = store.count - 1;
    store.tile[i] = store.tile[last];
    store.growAtTick[i] = store.growAtTick[last];
    store.stock[i] = store.stock[last];
    store.count = last;
    growTreeAt(field, ti, stock);
  }
}

export function mixSporeGrowthChecksum(mix, w) {
  const store = w.treeGrowth;
  if (!store) return;
  mix(store.count);
  for (let i = 0; i < store.count; i++) {
    mix(store.tile[i]);
    mix(store.growAtTick[i]);
    mix(store.stock[i]);
  }
}
