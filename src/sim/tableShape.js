// Table silhouette — large cells minus circle holes, filleted convex corners.
// Authoring resolution is the cell grid (default 16 tiles). Tiles are derived.

import {
  TILE_SIZE_F,
  worldHalfFFromField,
  refreshTerrainDerived,
} from './field.js';

export const DEFAULT_CELL_SIZE = 16;
const ARC_SEGMENTS = 10;
const EPS = 1e-5;

export function cellCounts(width, height, cellSize = DEFAULT_CELL_SIZE) {
  const size = Math.max(1, cellSize | 0);
  return {
    cellSize: size,
    chunksX: Math.ceil(width / size),
    chunksZ: Math.ceil(height / size),
  };
}

export function createFullCellMask(width, height, cellSize = DEFAULT_CELL_SIZE) {
  const { chunksX, chunksZ } = cellCounts(width, height, cellSize);
  const mask = new Uint8Array(chunksX * chunksZ);
  mask.fill(1);
  return mask;
}

export function cloneTableShape(shape) {
  if (!shape) return null;
  return {
    cellSize: shape.cellSize,
    chunksX: shape.chunksX,
    chunksZ: shape.chunksZ,
    cellMask: shape.cellMask.slice(),
    cornerRadius: shape.cornerRadius,
    holes: (shape.holes ?? []).map((h) => ({ x: h.x, z: h.z, r: h.r })),
  };
}

export function normalizeTableShape(field, opts = {}) {
  const cellSize = Math.max(1, (opts.cellSize ?? field.tableShape?.cellSize ?? DEFAULT_CELL_SIZE) | 0);
  const { chunksX, chunksZ } = cellCounts(field.width, field.height, cellSize);
  const expected = chunksX * chunksZ;
  let cellMask = opts.cellMask ?? field.tableShape?.cellMask;
  if (!cellMask || cellMask.length !== expected) {
    cellMask = createFullCellMask(field.width, field.height, cellSize);
  } else {
    cellMask = cellMask instanceof Uint8Array ? cellMask.slice() : Uint8Array.from(cellMask);
  }
  const maxR = (cellSize * TILE_SIZE_F) * 0.5 - EPS;
  const cornerRadius = Math.max(0, Math.min(maxR, Number(opts.cornerRadius ?? field.tableShape?.cornerRadius) || 0));
  const holes = (opts.holes ?? field.tableShape?.holes ?? [])
    .map((h) => ({
      x: Number(h.x) || 0,
      z: Number(h.z) || 0,
      r: Math.max(0, Number(h.r) || 0),
    }))
    .filter((h) => h.r > 0);
  return { cellSize, chunksX, chunksZ, cellMask, cornerRadius, holes };
}

export function isCellEnabled(shape, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return false;
  return shape.cellMask[cz * shape.chunksX + cx] !== 0;
}

export function setCellEnabled(shape, cx, cz, enabled) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return;
  shape.cellMask[cz * shape.chunksX + cx] = enabled ? 1 : 0;
}

export function tileCellCoords(tx, tz, cellSize) {
  return { cx: Math.floor(tx / cellSize), cz: Math.floor(tz / cellSize) };
}

export function worldToCell(field, x, z, cellSize) {
  const half = worldHalfFFromField(field);
  const tx = Math.floor((x + half) / TILE_SIZE_F);
  const tz = Math.floor((z + half) / TILE_SIZE_F);
  return tileCellCoords(tx, tz, cellSize);
}

export function tileWorldQuad(field, tx, tz) {
  const half = worldHalfFFromField(field);
  return {
    x0: tx * TILE_SIZE_F - half,
    z0: tz * TILE_SIZE_F - half,
    x1: (tx + 1) * TILE_SIZE_F - half,
    z1: (tz + 1) * TILE_SIZE_F - half,
  };
}

export function tileCenterWorld(field, tx, tz) {
  const half = worldHalfFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - half,
  };
}

function cellWorldBox(field, cx, cz, cellSize) {
  const half = worldHalfFFromField(field);
  const span = cellSize * TILE_SIZE_F;
  return {
    x0: cx * span - half,
    z0: cz * span - half,
    x1: (cx + 1) * span - half,
    z1: (cz + 1) * span - half,
  };
}

function vertexWorld(field, gx, gz, cellSize) {
  const half = worldHalfFFromField(field);
  const span = cellSize * TILE_SIZE_F;
  return { x: gx * span - half, z: gz * span - half };
}

function pointInHole(x, z, holes) {
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const dx = x - h.x;
    const dz = z - h.z;
    if (dx * dx + dz * dz < h.r * h.r) return true;
  }
  return false;
}

export function tileInSharpTable(field, shape, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const { cx, cz } = tileCellCoords(tx, tz, shape.cellSize);
  if (!isCellEnabled(shape, cx, cz)) return false;
  const c = tileCenterWorld(field, tx, tz);
  return !pointInHole(c.x, c.z, shape.holes);
}

function distPointToAabb(px, pz, x0, z0, x1, z1) {
  const cx = Math.max(x0, Math.min(px, x1));
  const cz = Math.max(z0, Math.min(pz, z1));
  return Math.hypot(px - cx, pz - cz);
}

function maxDistPointToAabb(px, pz, x0, z0, x1, z1) {
  let max = 0;
  const xs = [x0, x1];
  const zs = [z0, z1];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const d = Math.hypot(xs[i] - px, zs[j] - pz);
      if (d > max) max = d;
    }
  }
  return max;
}

function aabbOverlap(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1) {
  return ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0;
}

function tileIntersectsCircleRim(field, tx, tz, hole) {
  const q = tileWorldQuad(field, tx, tz);
  const dMin = distPointToAabb(hole.x, hole.z, q.x0, q.z0, q.x1, q.z1);
  const dMax = maxDistPointToAabb(hole.x, hole.z, q.x0, q.z0, q.x1, q.z1);
  return dMin <= hole.r && dMax >= hole.r;
}

/** Convex outer corners of the cell union (count === 1 around a cell vertex). */
export function convexCorners(field, shape) {
  const corners = [];
  const { chunksX, chunksZ, cellSize, cornerRadius } = shape;
  for (let gz = 0; gz <= chunksZ; gz++) {
    for (let gx = 0; gx <= chunksX; gx++) {
      const inward = convexInward(shape, gx, gz);
      if (!inward) continue;
      const V = vertexWorld(field, gx, gz, cellSize);
      corners.push({
        x: V.x,
        z: V.z,
        ix: inward.ix,
        iz: inward.iz,
        r: cornerRadius,
        cx: V.x + inward.ix * cornerRadius,
        cz: V.z + inward.iz * cornerRadius,
      });
    }
  }
  return corners;
}

/** Concave inner corners (count === 3). */
export function concaveCorners(field, shape) {
  const corners = [];
  const { chunksX, chunksZ, cellSize } = shape;
  for (let gz = 0; gz <= chunksZ; gz++) {
    for (let gx = 0; gx <= chunksX; gx++) {
      const missing = concaveMissing(shape, gx, gz);
      if (!missing) continue;
      const V = vertexWorld(field, gx, gz, cellSize);
      corners.push({ x: V.x, z: V.z, ix: missing.ix, iz: missing.iz });
    }
  }
  return corners;
}

function concaveMissing(shape, gx, gz) {
  const a = isCellEnabled(shape, gx - 1, gz - 1);
  const b = isCellEnabled(shape, gx, gz - 1);
  const c = isCellEnabled(shape, gx - 1, gz);
  const d = isCellEnabled(shape, gx, gz);
  const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
  if (n !== 3) return null;
  if (!d) return { ix: 1, iz: 1 };
  if (!c) return { ix: -1, iz: 1 };
  if (!b) return { ix: 1, iz: -1 };
  return { ix: -1, iz: -1 };
}

function convexInward(shape, gx, gz) {
  const a = isCellEnabled(shape, gx - 1, gz - 1);
  const b = isCellEnabled(shape, gx, gz - 1);
  const c = isCellEnabled(shape, gx - 1, gz);
  const d = isCellEnabled(shape, gx, gz);
  const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
  if (n !== 1) return null;
  if (d) return { ix: 1, iz: 1 };
  if (c) return { ix: -1, iz: 1 };
  if (b) return { ix: 1, iz: -1 };
  return { ix: -1, iz: -1 };
}

function cornerBox(corner) {
  const r = Math.max(corner.r, EPS);
  return {
    x0: corner.ix > 0 ? corner.x : corner.x - r,
    x1: corner.ix > 0 ? corner.x + r : corner.x,
    z0: corner.iz > 0 ? corner.z : corner.z - r,
    z1: corner.iz > 0 ? corner.z + r : corner.z,
  };
}

function tileIntersectsFillet(field, tx, tz, corner) {
  if (corner.r <= 0) return false;
  const q = tileWorldQuad(field, tx, tz);
  const box = cornerBox(corner);
  return aabbOverlap(q.x0, q.z0, q.x1, q.z1, box.x0, box.z0, box.x1, box.z1);
}

function tileOnOuterPerimeter(field, shape, tx, tz) {
  return !tileInSharpTable(field, shape, tx, tz - 1)
    || !tileInSharpTable(field, shape, tx, tz + 1)
    || !tileInSharpTable(field, shape, tx - 1, tz)
    || !tileInSharpTable(field, shape, tx + 1, tz);
}

function tileIntersectsEdge(field, shape, tx, tz, corners) {
  if (!tileInSharpTable(field, shape, tx, tz)) return false;
  if (tileOnOuterPerimeter(field, shape, tx, tz)) return true;
  for (let i = 0; i < shape.holes.length; i++) {
    if (tileIntersectsCircleRim(field, tx, tz, shape.holes[i])) return true;
  }
  for (let i = 0; i < corners.length; i++) {
    if (tileIntersectsFillet(field, tx, tz, corners[i])) return true;
  }
  return false;
}

/** Write activeMask / pass / slow from the silhouette. Red = edge, yellow = touches red. */
export function applyTableSilhouette(field, opts = {}) {
  const shape = normalizeTableShape(field, opts);
  field.tableShape = shape;
  field.chunkSize = shape.cellSize;
  field.chunkMask = cellMaskToMap(shape);

  const { width, height } = field;
  const n = width * height;
  const corners = shape.cornerRadius > 0 ? convexCorners(field, shape) : [];
  const edge = new Uint8Array(n);
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      const on = tileInSharpTable(field, shape, tx, tz);
      field.activeMask[i] = on ? 1 : 0;
      if (on && tileIntersectsEdge(field, shape, tx, tz, corners)) edge[i] = 1;
    }
  }

  field.slowMask.fill(0);
  refreshTerrainDerived(field);

  for (let i = 0; i < n; i++) {
    if (edge[i]) field.pass[i] = 0;
  }
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (field.activeMask[i] === 0 || field.pass[i] === 0) continue;
      if (hasRedNeighbor(edge, width, height, tx, tz)) field.slowMask[i] = 1;
    }
  }
  return field;
}

function hasRedNeighbor(edge, width, height, tx, tz) {
  if (tz > 0 && edge[(tz - 1) * width + tx]) return true;
  if (tz + 1 < height && edge[(tz + 1) * width + tx]) return true;
  if (tx > 0 && edge[tz * width + tx - 1]) return true;
  if (tx + 1 < width && edge[tz * width + tx + 1]) return true;
  return false;
}

function cellMaskToMap(shape) {
  const map = new Map();
  for (let cz = 0; cz < shape.chunksZ; cz++) {
    for (let cx = 0; cx < shape.chunksX; cx++) {
      map.set(`${cx},${cz}`, shape.cellMask[cz * shape.chunksX + cx] !== 0);
    }
  }
  return map;
}

function outwardOfDirected(ax, az, bx, bz, insideFn) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const mx = (ax + bx) * 0.5;
  const mz = (az + bz) * 0.5;
  if (insideFn(mx + nx * 0.4, mz + nz * 0.4)) return { ox: -nx, oz: -nz };
  return { ox: nx, oz: nz };
}

function pointInSharpWorld(field, shape, x, z) {
  const half = worldHalfFFromField(field);
  const tx = Math.floor((x + half) / TILE_SIZE_F);
  const tz = Math.floor((z + half) / TILE_SIZE_F);
  return tileInSharpTable(field, shape, tx, tz);
}

/** Closed polylines in world XZ, each point {x,z}. Used to extrude rails. */
export function silhouetteLoops(field, shape) {
  const loops = [];
  const cellLoops = buildCellLoops(field, shape);
  const r = shape.cornerRadius;
  const corners = r > 0 ? convexCorners(field, shape) : [];
  for (const loop of cellLoops) {
    loops.push(filletLoop(loop, corners, r));
  }
  for (const hole of shape.holes) {
    loops.push(holeLoop(hole));
  }
  return loops;
}

function buildCellLoops(field, shape) {
  const raw = [];
  for (let cz = 0; cz < shape.chunksZ; cz++) {
    for (let cx = 0; cx < shape.chunksX; cx++) {
      if (!isCellEnabled(shape, cx, cz)) continue;
      const b = cellWorldBox(field, cx, cz, shape.cellSize);
      if (!isCellEnabled(shape, cx, cz + 1)) raw.push({ ax: b.x0, az: b.z1, bx: b.x1, bz: b.z1 });
      if (!isCellEnabled(shape, cx, cz - 1)) raw.push({ ax: b.x1, az: b.z0, bx: b.x0, bz: b.z0 });
      if (!isCellEnabled(shape, cx + 1, cz)) raw.push({ ax: b.x1, az: b.z1, bx: b.x1, bz: b.z0 });
      if (!isCellEnabled(shape, cx - 1, cz)) raw.push({ ax: b.x0, az: b.z0, bx: b.x0, bz: b.z1 });
    }
  }
  return chainSegments(mergeColinear(raw));
}

function mergeColinear(edges) {
  const groups = new Map();
  for (const e of edges) {
    const horizontal = Math.abs(e.az - e.bz) < EPS;
    const fixed = horizontal ? e.az : e.ax;
    const a = horizontal ? e.ax : e.az;
    const b = horizontal ? e.bx : e.bz;
    const dir = b >= a ? 1 : -1;
    const key = `${horizontal ? 'h' : 'v'}:${fixed.toFixed(4)}:${dir}`;
    let g = groups.get(key);
    if (!g) {
      g = { horizontal, fixed, dir, spans: [] };
      groups.set(key, g);
    }
    g.spans.push([Math.min(a, b), Math.max(a, b)]);
  }
  const merged = [];
  for (const g of groups.values()) {
    g.spans.sort((a, b) => a[0] - b[0]);
    let start = g.spans[0][0];
    let end = g.spans[0][1];
    const emit = () => {
      if (g.horizontal) {
        if (g.dir > 0) merged.push({ ax: start, az: g.fixed, bx: end, bz: g.fixed });
        else merged.push({ ax: end, az: g.fixed, bx: start, bz: g.fixed });
      } else if (g.dir > 0) {
        merged.push({ ax: g.fixed, az: start, bx: g.fixed, bz: end });
      } else {
        merged.push({ ax: g.fixed, az: end, bx: g.fixed, bz: start });
      }
    };
    for (let i = 1; i < g.spans.length; i++) {
      if (g.spans[i][0] <= end + 0.05) {
        end = Math.max(end, g.spans[i][1]);
      } else {
        emit();
        start = g.spans[i][0];
        end = g.spans[i][1];
      }
    }
    emit();
  }
  return merged;
}

function chainSegments(edges) {
  const unused = edges.slice();
  const loops = [];
  while (unused.length) {
    const first = unused.pop();
    const pts = [{ x: first.ax, z: first.az }, { x: first.bx, z: first.bz }];
    let guard = unused.length + 2;
    while (guard-- > 0) {
      const tail = pts[pts.length - 1];
      let found = -1;
      for (let i = 0; i < unused.length; i++) {
        const e = unused[i];
        if (Math.hypot(e.ax - tail.x, e.az - tail.z) < 0.05) {
          pts.push({ x: e.bx, z: e.bz });
          found = i;
          break;
        }
        if (Math.hypot(e.bx - tail.x, e.bz - tail.z) < 0.05) {
          pts.push({ x: e.ax, z: e.az });
          found = i;
          break;
        }
      }
      if (found < 0) break;
      unused.splice(found, 1);
      if (Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].z - pts[0].z) < 0.05) {
        pts[pts.length - 1] = { x: pts[0].x, z: pts[0].z };
        break;
      }
    }
    if (pts.length >= 4) loops.push(pts);
  }
  return loops;
}

function filletLoop(pts, corners, r) {
  if (r <= 0 || corners.length === 0) return pts;
  const verts = pts[pts.length - 1] && pts[0]
    && Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].z - pts[0].z) < 0.05
    ? pts.slice(0, -1)
    : pts.slice();
  const m = verts.length;
  const filleted = [];
  for (let i = 0; i < m; i++) {
    const prev = verts[(i - 1 + m) % m];
    const cur = verts[i];
    const next = verts[(i + 1) % m];
    const corner = matchCorner(cur, corners);
    if (!corner) {
      filleted.push(cur);
      continue;
    }
    const inDx = cur.x - prev.x;
    const inDz = cur.z - prev.z;
    const inLen = Math.hypot(inDx, inDz) || 1;
    const outDx = next.x - cur.x;
    const outDz = next.z - cur.z;
    const outLen = Math.hypot(outDx, outDz) || 1;
    const trim = Math.min(r, inLen * 0.49, outLen * 0.49);
    const a = { x: cur.x - (inDx / inLen) * trim, z: cur.z - (inDz / inLen) * trim };
    const b = { x: cur.x + (outDx / outLen) * trim, z: cur.z + (outDz / outLen) * trim };
    const c = { x: corner.cx, z: corner.cz };
    let a0 = Math.atan2(a.z - c.z, a.x - c.x);
    let a1 = Math.atan2(b.z - c.z, b.x - c.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    filleted.push(a);
    for (let s = 1; s < ARC_SEGMENTS; s++) {
      const t = s / ARC_SEGMENTS;
      const ang = a0 + delta * t;
      filleted.push({
        x: c.x + Math.cos(ang) * corner.r,
        z: c.z + Math.sin(ang) * corner.r,
      });
    }
    filleted.push(b);
  }
  if (filleted.length) filleted.push({ x: filleted[0].x, z: filleted[0].z });
  return filleted;
}

function matchCorner(pt, corners) {
  for (let i = 0; i < corners.length; i++) {
    if (Math.hypot(pt.x - corners[i].x, pt.z - corners[i].z) < 0.2) return corners[i];
  }
  return null;
}

function holeLoop(hole) {
  const pts = [];
  const segs = 36;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push({
      x: hole.x + Math.cos(a) * hole.r,
      z: hole.z + Math.sin(a) * hole.r,
    });
  }
  return pts;
}

export function loopOutward(field, shape, ax, az, bx, bz) {
  return outwardOfDirected(ax, az, bx, bz, (x, z) => pointInSharpWorld(field, shape, x, z));
}

/** Paint terrainTypes in a tile-radius brush on remaining felt. */
export function paintTerrainBrush(field, tx, tz, terrainType, radius = 0) {
  const r = Math.max(0, radius | 0);
  const r2 = r * r;
  let changed = false;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      const i = z * field.width + x;
      if (field.activeMask[i] === 0) continue;
      if (field.terrainTypes[i] !== terrainType) {
        field.terrainTypes[i] = terrainType;
        changed = true;
      }
    }
  }
  return changed;
}
