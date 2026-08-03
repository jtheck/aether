// Wizard lightning — instant sky strike + render-only FX publish.

import * as fx from './fixed.js';
import {
  TILE_SIZE_F,
  activeWorldHalfF,
  inBounds,
  worldToTile,
} from './field.js';
import { ensureTreeArrays, igniteTree } from './trees.js';
import { rngFrac, rngRange } from './rng.js';
import { isHostile } from './teams.js';

/** Strike picks a random hostile inside this radius of the aim point. */
export const LIGHTNING_STRIKE_RADIUS = fx.fromFloat(26);
/**
 * Bolt lands randomly inside this radius of the resolved target/aim —
 * keeps the strike from looking laser-precise on a unit's feet.
 */
export const LIGHTNING_IMPACT_SCATTER = fx.fromFloat(10);
/** Ticks before another bolt (~5.5s at 20Hz). */
export const LIGHTNING_COOLDOWN = 110;

export const LIGHTNING_HIT = {
  UNIT: 1,
  TREE: 2,
  GROUND: 3,
};

const CANDIDATE_CAP = 512;
const unitCandidates = new Int32Array(CANDIDATE_CAP);
const treeCandidates = new Int32Array(CANDIDATE_CAP);

export function createLightningFxStore() {
  return {
    count: 0,
    x: [],
    y: [],
    kind: [],
  };
}

export function pushLightningFx(w, x, y, kind) {
  const store = w.lightningFx;
  if (!store) return;
  store.x.push(fx.toFloat(x));
  store.y.push(fx.toFloat(y));
  store.kind.push(kind);
  store.count++;
}

/** Drain strike FX for worker → main publish (render-only). */
export function takeLightningUpdates(w) {
  const store = w.lightningFx;
  if (!store || store.count === 0) return null;
  const n = store.count;
  const patch = {
    count: n,
    x: store.x.slice(0, n),
    y: store.y.slice(0, n),
    kind: store.kind.slice(0, n),
  };
  store.x.length = 0;
  store.y.length = 0;
  store.kind.length = 0;
  store.count = 0;
  return patch;
}

/**
 * Collect living hostiles in radius (entity-index order → deterministic).
 * @returns {number} candidate count
 */
export function collectHostilesInRadius(w, owner, cx, cy, radius, out = unitCandidates) {
  const radius2 = fx.mul(radius, radius);
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (!isHostile(owner, w.owner[i])) continue;
    if (fx.dist2(cx, cy, w.px[i], w.py[i]) > radius2) continue;
    if (n < out.length) out[n++] = i;
  }
  return n;
}

/**
 * Collect living tree tiles in radius (tile-index order → deterministic).
 * @returns {number} candidate count
 */
export function collectTreesInRadius(field, cx, cy, radius, out = treeCandidates) {
  if (!field?.treeStock) return 0;
  ensureTreeArrays(field);
  const radius2 = fx.mul(radius, radius);
  const tx0 = worldToTile(cx);
  const tz0 = worldToTile(cy);
  const rTiles = Math.ceil(fx.toFloat(radius) / TILE_SIZE_F) + 1;
  let n = 0;
  for (let tz = tz0 - rTiles; tz <= tz0 + rTiles; tz++) {
    for (let tx = tx0 - rTiles; tx <= tx0 + rTiles; tx++) {
      if (!inBounds(tx, tz)) continue;
      const ti = tz * field.width + tx;
      if (field.treeStock[ti] <= 0) continue;
      const half = activeWorldHalfF();
      const wx = fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half);
      const wz = fx.fromFloat((tz + 0.5) * TILE_SIZE_F - half);
      if (fx.dist2(cx, cy, wx, wz) > radius2) continue;
      if (n < out.length) out[n++] = ti;
    }
  }
  return n;
}

/** Deterministic square scatter in ±scatter around (x, y). */
function scatterImpact(rng, x, y, scatter = LIGHTNING_IMPACT_SCATTER) {
  if (!scatter || scatter <= 0 || !rng) return { x, y };
  const ox = (rngFrac(rng) - fx.HALF) * 2;
  const oy = (rngFrac(rng) - fx.HALF) * 2;
  return {
    x: x + fx.mul(scatter, ox),
    y: y + fx.mul(scatter, oy),
  };
}

/**
 * Resolve a lightning strike at aim: random hostile, else random tree ignite,
 * else ground strike (FX only). Impact XY is intentionally scattered.
 * @returns {{ kind: number, x: number, y: number, target: number }}
 */
export function resolveLightningStrike(w, field, owner, aimX, aimY, radius = LIGHTNING_STRIKE_RADIUS) {
  const hostileN = collectHostilesInRadius(w, owner, aimX, aimY, radius, unitCandidates);
  if (hostileN > 0) {
    const pick = unitCandidates[rngRange(w.rng, 0, hostileN)];
    const landed = scatterImpact(w.rng, w.px[pick], w.py[pick]);
    return {
      kind: LIGHTNING_HIT.UNIT,
      x: landed.x,
      y: landed.y,
      target: pick,
    };
  }

  const treeN = collectTreesInRadius(field, aimX, aimY, radius, treeCandidates);
  if (treeN > 0) {
    const ti = treeCandidates[rngRange(w.rng, 0, treeN)];
    const tz = Math.floor(ti / field.width);
    const tx = ti - tz * field.width;
    const half = activeWorldHalfF();
    const x = fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half);
    const y = fx.fromFloat((tz + 0.5) * TILE_SIZE_F - half);
    igniteTree(field, ti);
    const landed = scatterImpact(w.rng, x, y);
    return {
      kind: LIGHTNING_HIT.TREE,
      x: landed.x,
      y: landed.y,
      target: ti,
    };
  }

  const landed = scatterImpact(w.rng, aimX, aimY);
  return {
    kind: LIGHTNING_HIT.GROUND,
    x: landed.x,
    y: landed.y,
    target: -1,
  };
}
