// Grid navigation field — deterministic tile passability + A* pathfinding.
//
// All path math uses integer tile coordinates. World positions are Q16.16
// fixed-point; tile size is a fixed constant (4 world units, matching v1 TILE_SIZE).

import * as fx from './fixed.js';

export const TILE = fx.fromFloat(4);
export const HALF_TILE = fx.div(TILE, fx.fromInt(2));
export const MAP_W = 200;
export const MAP_H = 200;
// Ground is 800×800 centered on the origin (−400…400 world units).
export const WORLD_HALF = fx.fromInt(400);

// Diagonal step cost in fixed-point (sqrt(2) ≈ 1.414 * ONE).
const DIAG_COST = fx.fromFloat(1.414);
const CARD_COST = fx.ONE;

/** @param {number} seed */
export function createField(seed = 0) {
  const pass = new Uint8Array(MAP_W * MAP_H);
  pass.fill(1);
  return { pass, seed: seed >>> 0 };
}

/** Default map: open field with a central obstacle belt for pathing tests. */
export function buildDemoField(seed = 0) {
  const field = createField(seed);
  const midX = 100; // world x ≈ 0
  // Vertical wall segments — forces flanking, not a solid block.
  for (let z = 60; z < 140; z++) {
    if (z < 85 || z > 115) setBlocked(field, midX, z);
    if (z < 80 || z > 120) setBlocked(field, midX + 1, z);
  }
  // Pond on the east side (away from stress spawns).
  for (let x = 115; x < 130; x++) {
    for (let z = 150; z < 170; z++) {
      setBlocked(field, x, z);
    }
  }
  return field;
}

export function tileKey(tx, tz) {
  return tz * MAP_W + tx;
}

export function inBounds(tx, tz) {
  return tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H;
}

export function isPassable(field, tx, tz) {
  if (!inBounds(tx, tz)) return false;
  return field.pass[tileKey(tx, tz)] !== 0;
}

export function setBlocked(field, tx, tz) {
  if (inBounds(tx, tz)) field.pass[tileKey(tx, tz)] = 0;
}

export function worldToTile(x) {
  return fx.toInt(fx.div(x + WORLD_HALF, TILE));
}

export function tileCenterX(tx) {
  return fx.mul(fx.fromInt(tx), TILE) + HALF_TILE - WORLD_HALF;
}

export function tileCenterY(tz) {
  return fx.mul(fx.fromInt(tz), TILE) + HALF_TILE - WORLD_HALF;
}

/** Bresenham tile walk — true if every tile on the line is passable. */
export function lineClear(field, x0, z0, x1, z1) {
  let tx0 = worldToTile(x0);
  let tz0 = worldToTile(z0);
  const tx1 = worldToTile(x1);
  const tz1 = worldToTile(z1);

  let dx = Math.abs(tx1 - tx0);
  let dz = Math.abs(tz1 - tz0);
  const sx = tx0 < tx1 ? 1 : -1;
  const sz = tz0 < tz1 ? 1 : -1;
  let err = dx - dz;

  while (true) {
    if (!isPassable(field, tx0, tz0)) return false;
    if (tx0 === tx1 && tz0 === tz1) return true;
    const e2 = err << 1;
    if (e2 > -dz) {
      err -= dz;
      tx0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      tz0 += sz;
    }
  }
}

/**
 * A* on the tile grid. Returns waypoint count and fills wx/wy (fixed world coords).
 * wx/wy must have room for at least maxWp entries.
 * Returns 0 if no path.
 */
export function findPath(field, sx, sy, ex, ey, wx, wy, maxWp = 32) {
  let stx = worldToTile(sx);
  let stz = worldToTile(sy);
  let etx = worldToTile(ex);
  let etz = worldToTile(ey);

  if (!isPassable(field, stx, stz)) {
    const snapped = nearestPassable(field, stx, stz, 8);
    if (!snapped) return 0;
    stx = snapped.tx;
    stz = snapped.tz;
  }

  if (!isPassable(field, etx, etz)) {
    // Snap goal to nearest passable tile (spiral search, deterministic order).
    const snapped = nearestPassable(field, etx, etz, 8);
    if (!snapped) return 0;
    etx = snapped.tx;
    etz = snapped.tz;
  }

  if (stx === etx && stz === etz) {
    wx[0] = ex;
    wy[0] = ey;
    return 1;
  }

  if (lineClear(field, sx, sy, ex, ey)) {
    wx[0] = ex;
    wy[0] = ey;
    return 1;
  }

  const W = MAP_W;
  const toKey = (x, z) => z * W + x;
  const startKey = toKey(stx, stz);
  const endKey = toKey(etx, etz);

  // Flat arrays indexed by tile key — reused per call (no allocations in hot path
  // would need a pool; fine for now at 20 Hz × ~100 pathing units).
  const gScore = new Int32Array(W * MAP_H);
  gScore.fill(-1);
  const cameFrom = new Int32Array(W * MAP_H);
  cameFrom.fill(-1);

  const open = new MinHeap();

  const octile = (x, z) => {
    const dx = x - etx;
    const dz = z - etz;
    const adx = dx < 0 ? -dx : dx;
    const adz = dz < 0 ? -dz : dz;
    const mn = adx < adz ? adx : adz;
    const mx = adx > adz ? adx : adz;
    return CARD_COST * (mx - mn) + DIAG_COST * mn;
  };

  gScore[startKey] = 0;
  open.push(startKey, octile(stx, stz));

  const neighbors = [
    [0, -1, CARD_COST],
    [1, 0, CARD_COST],
    [0, 1, CARD_COST],
    [-1, 0, CARD_COST],
    [1, -1, DIAG_COST],
    [1, 1, DIAG_COST],
    [-1, 1, DIAG_COST],
    [-1, -1, DIAG_COST],
  ];

  let iterations = 0;
  const maxIter = 2500;
  let bestKey = startKey;
  let bestH = octile(stx, stz);

  while (open.size > 0 && iterations < maxIter) {
    iterations++;
    const currentKey = open.pop();
    if (currentKey === endKey) {
      return reconstruct(field, cameFrom, currentKey, ex, ey, wx, wy, maxWp);
    }

    const cx = currentKey % W;
    const cz = (currentKey / W) | 0;
    const h = octile(cx, cz);
    if (h < bestH) {
      bestH = h;
      bestKey = currentKey;
    }

    for (let n = 0; n < neighbors.length; n++) {
      const nx = cx + neighbors[n][0];
      const nz = cz + neighbors[n][1];
      if (!isPassable(field, nx, nz)) continue;

      // No corner cutting through blocked diagonal neighbors.
      if (neighbors[n][0] !== 0 && neighbors[n][1] !== 0) {
        if (!isPassable(field, cx + neighbors[n][0], cz) || !isPassable(field, cx, cz + neighbors[n][1])) {
          continue;
        }
      }

      const nKey = toKey(nx, nz);
      const tentative = gScore[currentKey] + neighbors[n][2];
      if (gScore[nKey] !== -1 && tentative >= gScore[nKey]) continue;

      cameFrom[nKey] = currentKey;
      gScore[nKey] = tentative;
      open.push(nKey, tentative + octile(nx, nz));
    }
  }

  // Partial path toward closest reachable tile.
  if (bestKey !== startKey) {
    return reconstruct(field, cameFrom, bestKey, ex, ey, wx, wy, maxWp);
  }
  return 0;
}

function reconstruct(field, cameFrom, endKey, ex, ey, wx, wy, maxWp) {
  const W = MAP_W;
  const tiles = [];
  let k = endKey;
  while (k !== -1) {
    tiles.push(k);
    k = cameFrom[k];
  }
  tiles.reverse();

  let count = 0;
  for (let i = 1; i < tiles.length && count < maxWp; i++) {
    const tx = tiles[i] % W;
    const tz = (tiles[i] / W) | 0;
    wx[count] = tileCenterX(tx);
    wy[count] = tileCenterY(tz);
    count++;
  }
  // Final point is the exact click / target, not tile center.
  if (count < maxWp) {
    wx[count] = ex;
    wy[count] = ey;
    count++;
  } else {
    wx[maxWp - 1] = ex;
    wy[maxWp - 1] = ey;
  }
  return count;
}

function nearestPassable(field, tx, tz, radius) {
  for (let r = 1; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (isPassable(field, nx, nz)) return { tx: nx, tz: nz };
      }
    }
  }
  return null;
}

/** Deterministic binary min-heap on [key, fScore]. Tie-break: lower key. */
class MinHeap {
  constructor() {
    this.keys = [];
    this.fs = [];
  }

  size() {
    return this.keys.length;
  }

  push(key, f) {
    const keys = this.keys;
    const fs = this.fs;
    let i = keys.length;
    keys.push(key);
    fs.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[i] > fs[p] || (fs[i] === fs[p] && keys[i] >= keys[p])) break;
      keys[i] = keys[p];
      fs[i] = fs[p];
      keys[p] = key;
      fs[p] = f;
      key = keys[i];
      f = fs[i];
      i = p;
    }
  }

  pop() {
    const keys = this.keys;
    const fs = this.fs;
    const top = keys[0];
    const lk = keys.pop();
    const lf = fs.pop();
    if (keys.length > 0) {
      keys[0] = lk;
      fs[0] = lf;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < keys.length && (fs[l] < fs[smallest] || (fs[l] === fs[smallest] && keys[l] < keys[smallest]))) {
          smallest = l;
        }
        if (r < keys.length && (fs[r] < fs[smallest] || (fs[r] === fs[smallest] && keys[r] < keys[smallest]))) {
          smallest = r;
        }
        if (smallest === i) break;
        const tk = keys[i];
        const tf = fs[i];
        keys[i] = keys[smallest];
        fs[i] = fs[smallest];
        keys[smallest] = tk;
        fs[smallest] = tf;
        i = smallest;
      }
    }
    return top;
  }
}
