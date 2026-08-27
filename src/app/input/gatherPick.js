// CPU gather pick — ray vs tree/rock volumes, not GPU mesh pick.
// GPU pick is off for units (~1000× slower on mobile); marching a few dozen
// tiles along the click ray is cheap and lets canopy / boulder clicks work.

import { TILE_SIZE_F } from '../../sim/field.js';
import { SCENERY, rockFootprintRadius } from '../../sim/scenery.js';
import { treeScaleForStage, treeStageFromStock } from '../../sim/trees.js';

const TREE_RADIUS = 2.4;
const TREE_HEIGHT = 7.5;
const ROCK_HEIGHT = {
  [SCENERY.ROCK_PLAIN]: 3.4,
  [SCENERY.ROCK_MOSS]: 5.8,
  [SCENERY.ROCK_SNOW]: 7.2,
};
const FARM_RADIUS = 6;
const FARM_HEIGHT = 2.6;
const HALO = 2;
const MAX_STEPS = 80;

function fieldHalf(field) {
  return field.worldHalfF ?? ((field.width | 0) * TILE_SIZE_F) / 2;
}

function tileCenter(tx, tz, half) {
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - half,
  };
}

function rayHitAabb(ray, minX, minY, minZ, maxX, maxY, maxZ) {
  let tEnter = 0;
  let tExit = Infinity;
  const o = [ray.ox, ray.oy, ray.oz];
  const d = [ray.dx, ray.dy, ray.dz];
  const mn = [minX, minY, minZ];
  const mx = [maxX, maxY, maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-10) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
      continue;
    }
    let t1 = (mn[a] - o[a]) / d[a];
    let t2 = (mx[a] - o[a]) / d[a];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (tExit < 0) return null;
  return tEnter >= 0 ? tEnter : 0;
}

function nodeVolume(field, tile, half, heightAt) {
  const w = field.width | 0;
  const tx = tile % w;
  const tz = (tile / w) | 0;
  const { x: cx, z: cz } = tileCenter(tx, tz, half);
  const gy = heightAt(cx, cz);
  if ((field.treeStock?.[tile] | 0) > 0) {
    const stage = treeStageFromStock(field.treeStock[tile] | 0);
    const s = Math.max(0.55, treeScaleForStage(stage));
    const r = TREE_RADIUS * s;
    return { cx, cz, gy, r, h: TREE_HEIGHT * s };
  }
  const kind = field.sceneryType?.[tile] | 0;
  if (kind >= SCENERY.ROCK_PLAIN && (field.rockStock?.[tile] | 0) > 0) {
    const foot = rockFootprintRadius(kind);
    const r = (foot + 0.55) * TILE_SIZE_F + 0.6;
    return { cx, cz, gy, r, h: ROCK_HEIGHT[kind] ?? 3.4 };
  }
  if (field.foodNode?.[tile]) {
    return { cx, cz, gy, r: FARM_RADIUS, h: FARM_HEIGHT };
  }
  return null;
}

function visitTilesOnRayXZ(ox, oz, dx, dz, maxT, half, width, height, visit) {
  let tx = Math.floor((ox + half) / TILE_SIZE_F);
  let tz = Math.floor((oz + half) / TILE_SIZE_F);
  const stepX = dx > 1e-10 ? 1 : dx < -1e-10 ? -1 : 0;
  const stepZ = dz > 1e-10 ? 1 : dz < -1e-10 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(TILE_SIZE_F / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(TILE_SIZE_F / dz) : Infinity;
  let tMaxX = Infinity;
  let tMaxZ = Infinity;
  if (stepX !== 0) {
    const next = stepX > 0 ? (tx + 1) * TILE_SIZE_F - half : tx * TILE_SIZE_F - half;
    tMaxX = (next - ox) / dx;
  }
  if (stepZ !== 0) {
    const next = stepZ > 0 ? (tz + 1) * TILE_SIZE_F - half : tz * TILE_SIZE_F - half;
    tMaxZ = (next - oz) / dz;
  }
  let t = 0;
  for (let i = 0; i < MAX_STEPS && t <= maxT; i++) {
    if (tx >= 0 && tz >= 0 && tx < width && tz < height) visit(tx, tz);
    if (tMaxX < tMaxZ) {
      tx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      tz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
}

/**
 * Nearest harvestable tile whose tree / rock / farm volume the ray hits.
 * @param {object} field
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null} ray
 * @param {{ maxT?: number, heightAt?: (x: number, z: number) => number }} [opts]
 * @returns {number} tile index or -1
 */
export function pickGatherNodeOnRay(field, ray, opts = {}) {
  if (!field || !ray) return -1;
  const width = field.width | 0;
  const height = field.height | 0;
  if (width <= 0 || height <= 0) return -1;
  const half = fieldHalf(field);
  const heightAt = opts.heightAt ?? (() => 0);
  const maxT = Number.isFinite(opts.maxT) ? Math.max(1, opts.maxT) : 400;

  let best = -1;
  let bestT = maxT + 1e-4;
  const seen = new Set();

  const consider = (tile) => {
    if (seen.has(tile)) return;
    seen.add(tile);
    const vol = nodeVolume(field, tile, half, heightAt);
    if (!vol) return;
    const t = rayHitAabb(
      ray,
      vol.cx - vol.r,
      vol.gy - 0.2,
      vol.cz - vol.r,
      vol.cx + vol.r,
      vol.gy + vol.h,
      vol.cz + vol.r,
    );
    if (t != null && t < bestT) {
      bestT = t;
      best = tile;
    }
  };

  visitTilesOnRayXZ(ray.ox, ray.oz, ray.dx, ray.dz, maxT, half, width, height, (tx, tz) => {
    for (let dz = -HALO; dz <= HALO; dz++) {
      for (let dx = -HALO; dx <= HALO; dx++) {
        const x = tx + dx;
        const z = tz + dz;
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        consider(z * width + x);
      }
    }
  });

  return best;
}

/** Distance along a (normalized) ray to a world point. */
export function rayTToPoint(ray, x, y, z) {
  if (!ray) return 0;
  return (x - ray.ox) * ray.dx + (y - ray.oy) * ray.dy + (z - ray.oz) * ray.dz;
}
