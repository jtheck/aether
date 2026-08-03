// Spore Bloom — myco point-cast: fell trees in blast, seed delayed ring growth.

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

const MAX_PENDING = 2048;
const CANDIDATE_CAP = 512;

export function createSporeGrowthStore(capacity = MAX_PENDING) {
  return {
    capacity,
    count: 0,
    tile: new Int32Array(capacity),
    growAtTick: new Int32Array(capacity),
    stock: new Uint8Array(capacity),
  };
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

/** Drain tree-drip + seed markers for worker → main (render-only). */
export function takeSporeBloomUpdates(w) {
  const store = w.sporeBloomFx;
  if (!store) return null;
  if (store.dripCount === 0 && store.seedCount === 0) return null;
  const dn = store.dripCount;
  const sn = store.seedCount;
  const patch = {
    dripCount: dn,
    dripX: store.dripX.slice(0, dn),
    dripY: store.dripY.slice(0, dn),
    seedCount: sn,
    seedX: store.seedX.slice(0, sn),
    seedY: store.seedY.slice(0, sn),
    seedGrowAt: store.seedGrowAt.slice(0, sn),
  };
  store.dripX.length = 0;
  store.dripY.length = 0;
  store.dripCount = 0;
  store.seedX.length = 0;
  store.seedY.length = 0;
  store.seedGrowAt.length = 0;
  store.seedCount = 0;
  return patch;
}

function pendingTileSet(store) {
  const set = new Set();
  for (let i = 0; i < store.count; i++) set.add(store.tile[i]);
  return set;
}

function queueGrowth(store, tileIndex, growAtTick, stock) {
  if (store.count >= store.capacity) return false;
  const i = store.count++;
  store.tile[i] = tileIndex;
  store.growAtTick[i] = growAtTick;
  store.stock[i] = stock;
  return true;
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
 * Collect growable ring tiles (sorted by ring offset then tile index).
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
} = {}) {
  const store = w.treeGrowth;
  if (!store) return 0;
  const pending = pendingTileSet(store);
  const candN = collectSporeSeedCandidates(
    field,
    cx,
    cy,
    outerRadius,
    pending,
    seedTiles,
    seedOffsets,
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
  queueSporeSeeds(w, field, aimX, aimY);
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
