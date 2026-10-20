// Wizard lightning — instant sky strike + render-only FX publish.

import * as fx from './fixed.js';
import {
  TILE_SIZE_F,
  activeWorldHalfF,
  inBounds,
  worldToTile,
  worldToTileZ,
  activeWorldHalfZF,
} from './field.js';
import { ensureTreeArrays, igniteTree } from './trees.js';
import { rngFrac, rngRange } from './rng.js';
import { isHostile } from './teams.js';
import { applyDamage } from './damage.js';
import { applyDamageBuilding, buildingFootprintHalf, igniteBuilding } from './buildingCombat.js';
import { buildingIsFinished, isBuildingAlive } from './buildings.js';

/** Strike picks a random hostile inside this radius of the aim point. */
export const LIGHTNING_STRIKE_RADIUS = fx.fromFloat(26);
/**
 * Bolt lands randomly inside this radius of the resolved target/aim —
 * keeps the strike from looking laser-precise on a unit's feet.
 */
export const LIGHTNING_IMPACT_SCATTER = fx.fromFloat(10);
/** Ticks before another bolt (~5.5s at 20Hz). */
export const LIGHTNING_COOLDOWN = 110;
/** Delay between compound follow-up strikes (~0.5s at 20Hz). */
export const LIGHTNING_FOLLOWUP_GAP = 10;

export const LIGHTNING_HIT = {
  UNIT: 1,
  TREE: 2,
  GROUND: 3,
  BUILDING: 4,
};

const CANDIDATE_CAP = 512;
const unitCandidates = new Int32Array(CANDIDATE_CAP);
const treeCandidates = new Int32Array(CANDIDATE_CAP);
const buildingCandidates = new Int32Array(CANDIDATE_CAP);

export function createPendingLightningStore() {
  return {
    count: 0,
    strikeAt: [],
    owner: [],
    source: [],
    aimX: [],
    aimY: [],
    damage: [],
    radius: [],
  };
}

export function queueLightningStrike(w, {
  strikeAt,
  owner,
  source,
  aimX,
  aimY,
  damage,
  radius = LIGHTNING_STRIKE_RADIUS,
}) {
  const store = w.pendingLightning;
  if (!store) return;
  store.strikeAt.push(strikeAt | 0);
  store.owner.push(owner & 0xff);
  store.source.push(source | 0);
  store.aimX.push(aimX | 0);
  store.aimY.push(aimY | 0);
  store.damage.push(damage | 0);
  store.radius.push(radius | 0);
  store.count++;
}

function removePendingAt(store, i) {
  const last = store.count - 1;
  store.strikeAt[i] = store.strikeAt[last];
  store.owner[i] = store.owner[last];
  store.source[i] = store.source[last];
  store.aimX[i] = store.aimX[last];
  store.aimY[i] = store.aimY[last];
  store.damage[i] = store.damage[last];
  store.radius[i] = store.radius[last];
  store.strikeAt.pop();
  store.owner.pop();
  store.source.pop();
  store.aimX.pop();
  store.aimY.pop();
  store.damage.pop();
  store.radius.pop();
  store.count = last;
}

export function mixPendingLightningChecksum(mix, w) {
  const store = w.pendingLightning;
  if (!store) return;
  mix(store.count);
  for (let i = 0; i < store.count; i++) {
    mix(store.strikeAt[i]);
    mix(store.owner[i]);
    mix(store.source[i]);
    mix(store.aimX[i]);
    mix(store.aimY[i]);
    mix(store.damage[i]);
    mix(store.radius?.[i] ?? 0);
  }
}

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
  const tz0 = worldToTileZ(cy);
  const rTiles = Math.ceil(fx.toFloat(radius) / TILE_SIZE_F) + 1;
  let n = 0;
  for (let tz = tz0 - rTiles; tz <= tz0 + rTiles; tz++) {
    for (let tx = tx0 - rTiles; tx <= tx0 + rTiles; tx++) {
      if (!inBounds(tx, tz)) continue;
      const ti = tz * field.width + tx;
      if (field.treeStock[ti] <= 0) continue;
      const half = activeWorldHalfF();
      const halfZ = activeWorldHalfZF();
      const wx = fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half);
      const wz = fx.fromFloat((tz + 0.5) * TILE_SIZE_F - halfZ);
      if (fx.dist2(cx, cy, wx, wz) > radius2) continue;
      if (n < out.length) out[n++] = ti;
    }
  }
  return n;
}

/**
 * Finished hostile buildings in radius (index order → deterministic).
 * Reach includes the footprint so a bolt aimed at the wall still counts.
 * @returns {number} candidate count
 */
export function collectHostileBuildingsInRadius(w, owner, cx, cy, radius, out = buildingCandidates) {
  const buildings = w.buildings;
  if (!buildings?.length) return 0;
  let n = 0;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (!isBuildingAlive(b) || !buildingIsFinished(b)) continue;
    if (!isHostile(owner, b.owner)) continue;
    const reach = radius + buildingFootprintHalf(b.type);
    if (fx.dist2(cx, cy, b.x, b.z) > fx.mul(reach, reach)) continue;
    if (n < out.length) out[n++] = bi;
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
 * Resolve a lightning strike at aim: random hostile unit, else random hostile
 * building (damage + ignite), else random tree ignite, else ground (FX only).
 * A hostile building inside the radius still catches fire when the bolt hits
 * a unit. Impact XY is intentionally scattered.
 * Rng order when a unit is hit matches the old path (pick, then scatter)
 * before the building roll, so unit strikes stay put.
 * @returns {{ kind: number, x: number, y: number, target: number }}
 */
export function resolveLightningStrike(w, field, owner, aimX, aimY, radius = LIGHTNING_STRIKE_RADIUS) {
  const hostileN = collectHostilesInRadius(w, owner, aimX, aimY, radius, unitCandidates);
  if (hostileN > 0) {
    const pick = unitCandidates[rngRange(w.rng, 0, hostileN)];
    const landed = scatterImpact(w.rng, w.px[pick], w.py[pick]);
    igniteHostileBuilding(w, owner, aimX, aimY, radius);
    return {
      kind: LIGHTNING_HIT.UNIT,
      x: landed.x,
      y: landed.y,
      target: pick,
    };
  }

  const buildingN = collectHostileBuildingsInRadius(w, owner, aimX, aimY, radius, buildingCandidates);
  if (buildingN > 0) {
    const bi = buildingCandidates[rngRange(w.rng, 0, buildingN)];
    const b = w.buildings[bi];
    igniteBuilding(w, bi);
    const landed = scatterImpact(w.rng, b.x, b.z);
    return {
      kind: LIGHTNING_HIT.BUILDING,
      x: landed.x,
      y: landed.y,
      target: bi,
    };
  }

  const treeN = collectTreesInRadius(field, aimX, aimY, radius, treeCandidates);
  if (treeN > 0) {
    const ti = treeCandidates[rngRange(w.rng, 0, treeN)];
    const tz = Math.floor(ti / field.width);
    const tx = ti - tz * field.width;
    const half = activeWorldHalfF();
    const halfZ = activeWorldHalfZF();
    const x = fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half);
    const y = fx.fromFloat((tz + 0.5) * TILE_SIZE_F - halfZ);
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

/** One random finished hostile building in radius catches fire. */
function igniteHostileBuilding(w, owner, aimX, aimY, radius) {
  const n = collectHostileBuildingsInRadius(w, owner, aimX, aimY, radius, buildingCandidates);
  if (n <= 0) return -1;
  const bi = buildingCandidates[rngRange(w.rng, 0, n)];
  igniteBuilding(w, bi);
  return bi;
}

export function deliverLightningStrike(
  w,
  field,
  owner,
  source,
  aimX,
  aimY,
  damage,
  radius = LIGHTNING_STRIKE_RADIUS,
) {
  if (!field) return null;
  const hit = resolveLightningStrike(w, field, owner, aimX, aimY, radius);
  if (hit.kind === LIGHTNING_HIT.UNIT && hit.target >= 0 && damage > 0) {
    applyDamage(w, hit.target, damage, source);
  } else if (hit.kind === LIGHTNING_HIT.BUILDING && hit.target >= 0 && damage > 0) {
    applyDamageBuilding(w, field, hit.target, damage, owner | 0);
  }
  pushLightningFx(w, hit.x, hit.y, hit.kind);
  return hit;
}

/** Fire queued follow-up bolts whose strikeAt tick has arrived. */
export function pendingLightningSystem(w, field) {
  const store = w.pendingLightning;
  if (!store || store.count === 0 || !field) return;
  const tick = w.tick;
  for (let i = store.count - 1; i >= 0; i--) {
    if (store.strikeAt[i] > tick) continue;
    deliverLightningStrike(
      w,
      field,
      store.owner[i],
      store.source[i],
      store.aimX[i],
      store.aimY[i],
      store.damage[i],
      store.radius[i] || LIGHTNING_STRIKE_RADIUS,
    );
    removePendingAt(store, i);
  }
}
