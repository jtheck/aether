// Table silhouette — 16-tile chunks with per-chunk corner radius.
// Play / Forge boards use an odd chunk count so the origin sits in a center chunk.
// A chunk's radius fillets its outside corners (convex) or inside corners
// (concave / punched hole). Radius 0 stays sharp and plants a corner plinth.

import {
  TILE_SIZE_F,
  worldHalfFFromField,
  refreshTerrainDerived,
} from './field.js';

export const DEFAULT_CELL_SIZE = 16;
/** Sharp corners + plinths. Raise a chunk's radius in Forge to fillet it. */
export const DEFAULT_CELL_RADIUS = 0;
/** World size of the leftover r=0 closer on non-silhouette frames. */
export const CORNER_BLOCK_SIZE = 11.55;
const ARC_SEGMENTS = 16;
const EPS = 1e-5;

/** Half-extent of a chunk-sized bastion. Corner radius is a fraction of this (1 = circle). */
export const BASTION_CORNER_T = 0.4;
/** Center and rail plinths vs a full-chunk square. */
export const PLINTH_SCALE = 0.62;

export function bastionHalf(shape) {
  const cell = Math.max(1, (shape?.cellSize ?? DEFAULT_CELL_SIZE) | 0);
  return cell * TILE_SIZE_F * 0.5;
}

export function bastionCornerRadius(shape) {
  return bastionHalf(shape) * BASTION_CORNER_T;
}

export function plinthHalf(shape) {
  return bastionHalf(shape) * PLINTH_SCALE;
}

export function plinthCornerRadius(shape) {
  return plinthHalf(shape) * BASTION_CORNER_T;
}

export function cellCounts(width, height, cellSize = DEFAULT_CELL_SIZE) {
  const size = Math.max(1, cellSize | 0);
  return {
    cellSize: size,
    chunksX: Math.ceil(width / size),
    chunksZ: Math.ceil(height / size),
  };
}

export function maxCellRadius(cellSize = DEFAULT_CELL_SIZE) {
  return (Math.max(1, cellSize | 0) * TILE_SIZE_F) * 0.5 - EPS;
}

export function createFullCellMask(width, height, cellSize = DEFAULT_CELL_SIZE) {
  const { chunksX, chunksZ } = cellCounts(width, height, cellSize);
  const mask = new Uint8Array(chunksX * chunksZ);
  mask.fill(1);
  return mask;
}

export function createFullCellRadius(width, height, cellSize = DEFAULT_CELL_SIZE, value = DEFAULT_CELL_RADIUS) {
  const { chunksX, chunksZ } = cellCounts(width, height, cellSize);
  const radii = new Uint8Array(chunksX * chunksZ);
  const maxR = maxCellRadius(cellSize);
  radii.fill(Math.max(0, Math.min(maxR, Number(value) || 0)));
  return radii;
}

export function cloneTableShape(shape) {
  if (!shape) return null;
  return {
    cellSize: shape.cellSize,
    chunksX: shape.chunksX,
    chunksZ: shape.chunksZ,
    cellMask: shape.cellMask.slice(),
    cellRadius: shape.cellRadius.slice(),
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
  const maxR = maxCellRadius(cellSize);
  let cellRadius = opts.cellRadius ?? field.tableShape?.cellRadius;
  if (!cellRadius || cellRadius.length !== expected) {
    const fallback = Number(opts.cornerRadius ?? DEFAULT_CELL_RADIUS) || 0;
    cellRadius = createFullCellRadius(field.width, field.height, cellSize, fallback);
  } else {
    cellRadius = cellRadius instanceof Uint8Array ? cellRadius.slice() : Uint8Array.from(cellRadius);
    for (let i = 0; i < cellRadius.length; i++) {
      cellRadius[i] = Math.max(0, Math.min(maxR, cellRadius[i]));
    }
  }
  return { cellSize, chunksX, chunksZ, cellMask, cellRadius };
}

export function isCellEnabled(shape, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return false;
  return shape.cellMask[cz * shape.chunksX + cx] !== 0;
}

export function setCellEnabled(shape, cx, cz, enabled) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return;
  shape.cellMask[cz * shape.chunksX + cx] = enabled ? 1 : 0;
}

export function getCellRadius(shape, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return 0;
  return shape.cellRadius[cz * shape.chunksX + cx] || 0;
}

export function setCellRadius(shape, cx, cz, radius) {
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return;
  const maxR = maxCellRadius(shape.cellSize);
  shape.cellRadius[cz * shape.chunksX + cx] = Math.max(0, Math.min(maxR, Number(radius) || 0));
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

export function cellWorldBox(field, cx, cz, cellSize) {
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

function ownerFromInward(gx, gz, inward) {
  return {
    cx: gx + (inward.ix > 0 ? 0 : -1),
    cz: gz + (inward.iz > 0 ? 0 : -1),
  };
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

function makeCorner(field, shape, gx, gz, inward, kind) {
  const owner = ownerFromInward(gx, gz, inward);
  const r = getCellRadius(shape, owner.cx, owner.cz);
  const V = vertexWorld(field, gx, gz, shape.cellSize);
  return {
    kind,
    x: V.x,
    z: V.z,
    ix: inward.ix,
    iz: inward.iz,
    r,
    cx: V.x + inward.ix * r,
    cz: V.z + inward.iz * r,
    ocx: owner.cx,
    ocz: owner.cz,
  };
}

/** Convex outer corners (exactly one chunk around the vertex). */
export function convexCorners(field, shape) {
  const corners = [];
  for (let gz = 0; gz <= shape.chunksZ; gz++) {
    for (let gx = 0; gx <= shape.chunksX; gx++) {
      const inward = convexInward(shape, gx, gz);
      if (inward) corners.push(makeCorner(field, shape, gx, gz, inward, 'convex'));
    }
  }
  return corners;
}

/** Concave inner corners (exactly three chunks around the vertex). */
export function concaveCorners(field, shape) {
  const corners = [];
  for (let gz = 0; gz <= shape.chunksZ; gz++) {
    for (let gx = 0; gx <= shape.chunksX; gx++) {
      const missing = concaveMissing(shape, gx, gz);
      if (missing) corners.push(makeCorner(field, shape, gx, gz, missing, 'concave'));
    }
  }
  return corners;
}

export function silhouetteCorners(field, shape) {
  return [...convexCorners(field, shape), ...concaveCorners(field, shape)];
}

/** Which silhouette corners this chunk owns. */
export function chunkCornerKind(shape, cx, cz) {
  let convex = 0;
  let concave = 0;
  for (let gz = cz; gz <= cz + 1; gz++) {
    for (let gx = cx; gx <= cx + 1; gx++) {
      const inward = convexInward(shape, gx, gz);
      if (inward) {
        const o = ownerFromInward(gx, gz, inward);
        if (o.cx === cx && o.cz === cz) convex++;
      }
      const missing = concaveMissing(shape, gx, gz);
      if (missing) {
        const o = ownerFromInward(gx, gz, missing);
        if (o.cx === cx && o.cz === cz) concave++;
      }
    }
  }
  if (convex && concave) return 'inside + outside';
  if (concave) return 'inside corner';
  if (convex) return 'outside corner';
  return 'no corner';
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

function pointInCornerBox(x, z, corner) {
  const box = cornerBox(corner);
  return x >= box.x0 - EPS && x <= box.x1 + EPS && z >= box.z0 - EPS && z <= box.z1 + EPS;
}

function aabbOverlap(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1) {
  return ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0;
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

function tileSamplePoints(field, tx, tz) {
  const q = tileWorldQuad(field, tx, tz);
  const mx = (q.x0 + q.x1) * 0.5;
  const mz = (q.z0 + q.z1) * 0.5;
  return [
    [mx, mz],
    [q.x0, q.z0], [q.x1, q.z0], [q.x1, q.z1], [q.x0, q.z1],
    [mx, q.z0], [q.x1, mz], [mx, q.z1], [q.x0, mz],
  ];
}

function tileIntersectsFilletArc(field, tx, tz, corner) {
  if (corner.r <= 0) return false;
  const q = tileWorldQuad(field, tx, tz);
  const box = cornerBox(corner);
  if (!aabbOverlap(q.x0, q.z0, q.x1, q.z1, box.x0, box.z0, box.x1, box.z1)) return false;
  const dMin = distPointToAabb(corner.cx, corner.cz, q.x0, q.z0, q.x1, q.z1);
  const dMax = maxDistPointToAabb(corner.cx, corner.cz, q.x0, q.z0, q.x1, q.z1);
  return dMin <= corner.r + EPS && dMax >= corner.r - EPS;
}

function pointInTableForCell(field, shape, x, z, cx, cz, corners) {
  const enabled = isCellEnabled(shape, cx, cz);
  const list = corners ?? silhouetteCorners(field, shape);
  for (let i = 0; i < list.length; i++) {
    const corner = list[i];
    if (corner.r <= 0) continue;
    if (corner.ocx !== cx || corner.ocz !== cz) continue;
    if (!pointInCornerBox(x, z, corner)) continue;
    const d = Math.hypot(x - corner.cx, z - corner.cz);
    if (corner.kind === 'convex') return d <= corner.r + EPS;
    return d > corner.r;
  }
  return enabled;
}

/** World-space felt test after per-chunk inside/outside fillets. */
export function pointInTable(field, shape, x, z, corners) {
  const half = worldHalfFFromField(field);
  const span = shape.cellSize * TILE_SIZE_F;
  const cx = Math.floor((x + half) / span);
  const cz = Math.floor((z + half) / span);
  return pointInTableForCell(field, shape, x, z, cx, cz, corners);
}

export function tileInTable(field, shape, tx, tz, corners) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const c = tileCenterWorld(field, tx, tz);
  return pointInTable(field, shape, c.x, c.z, corners);
}

/** True if any part of the tile quad is still felt (fills staircase holes on large fillets). */
export function tileHitsTable(field, shape, tx, tz, corners) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const { cx, cz } = tileCellCoords(tx, tz, shape.cellSize);
  const list = corners ?? silhouetteCorners(field, shape);
  const pts = tileSamplePoints(field, tx, tz);
  for (let i = 0; i < pts.length; i++) {
    if (pointInTableForCell(field, shape, pts[i][0], pts[i][1], cx, cz, list)) return true;
  }
  return false;
}

function tileCrossesBoundary(field, shape, tx, tz, corners) {
  const { cx, cz } = tileCellCoords(tx, tz, shape.cellSize);
  const list = corners ?? silhouetteCorners(field, shape);
  const pts = tileSamplePoints(field, tx, tz);
  let inside = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pointInTableForCell(field, shape, pts[i][0], pts[i][1], cx, cz, list)) inside++;
  }
  if (inside > 0 && inside < pts.length) return true;
  for (let i = 0; i < list.length; i++) {
    if (tileIntersectsFilletArc(field, tx, tz, list[i])) return true;
  }
  return false;
}

/** @deprecated Use tileInTable — sharp cell membership without fillets. */
export function tileInSharpTable(field, shape, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const { cx, cz } = tileCellCoords(tx, tz, shape.cellSize);
  return isCellEnabled(shape, cx, cz);
}

/** Tile-grid vertex at the board origin (dead center on odd-chunk maps). */
export function tableCenterVertex(field) {
  const half = worldHalfFFromField(field);
  const vx = Math.round(field.width / 2);
  const vz = Math.round(field.height / 2);
  return {
    x: vx * TILE_SIZE_F - half,
    z: vz * TILE_SIZE_F - half,
    vx,
    vz,
  };
}

/** Odd×odd chunk boards get a center plinth at the origin. */
export function tableHasCenterBlock(field, shape = field.tableShape) {
  if (!shape || (shape.chunksX & 1) === 0 || (shape.chunksZ & 1) === 0) return false;
  const { x, z } = tableCenterVertex(field);
  return pointInTable(field, shape, x, z);
}

function pointInRoundedRect(px, pz, x, z, half, cornerR) {
  const lx = Math.abs(px - x);
  const lz = Math.abs(pz - z);
  if (lx > half || lz > half) return false;
  const inner = half - cornerR;
  if (lx <= inner || lz <= inner) return true;
  const dx = lx - inner;
  const dz = lz - inner;
  return dx * dx + dz * dz <= cornerR * cornerR;
}

function stampRoundedRectFootprint(field, edge, x, z, half, cornerR) {
  const worldHalf = worldHalfFFromField(field);
  const tx0 = Math.max(0, Math.floor((x - half + worldHalf) / TILE_SIZE_F));
  const tz0 = Math.max(0, Math.floor((z - half + worldHalf) / TILE_SIZE_F));
  const tx1 = Math.min(field.width - 1, Math.floor((x + half - EPS + worldHalf) / TILE_SIZE_F));
  const tz1 = Math.min(field.height - 1, Math.floor((z + half - EPS + worldHalf) / TILE_SIZE_F));
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = tz * field.width + tx;
      if (!field.activeMask[i]) continue;
      const cx = (tx + 0.5) * TILE_SIZE_F - worldHalf;
      const cz = (tz + 0.5) * TILE_SIZE_F - worldHalf;
      if (pointInRoundedRect(cx, cz, x, z, half, cornerR)) edge[i] = 1;
    }
  }
}

function enabledWorldBounds(field, shape) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (let cz = 0; cz < shape.chunksZ; cz++) {
    for (let cx = 0; cx < shape.chunksX; cx++) {
      if (!isCellEnabled(shape, cx, cz)) continue;
      const b = cellWorldBox(field, cx, cz, shape.cellSize);
      any = true;
      minX = Math.min(minX, b.x0);
      maxX = Math.max(maxX, b.x1);
      minZ = Math.min(minZ, b.z0);
      maxZ = Math.max(maxZ, b.z1);
    }
  }
  return any ? { minX, maxX, minZ, maxZ } : null;
}

function isOuterTableEdge(ax, az, bx, bz, ox, oz, bounds) {
  const mx = (ax + bx) * 0.5 + ox * 0.4;
  const mz = (az + bz) * 0.5 + oz * 0.4;
  return mx < bounds.minX - 0.05 || mx > bounds.maxX + 0.05
    || mz < bounds.minZ - 0.05 || mz > bounds.maxZ + 0.05;
}

/** r=0 convex corners get the same plinth as center / rail mids. Filleted corners skip it. */
export function tableCornerPlinths(field, shape = field.tableShape) {
  if (!field || !shape) return [];
  return convexCorners(field, shape)
    .filter((c) => c.r <= 0)
    .map((c) => ({ x: c.x, z: c.z }));
}

/** Midpoints of outer table rails only — skips holes and internal cuts. */
export function tableEdgeMidpoints(field, shape = field.tableShape) {
  if (!field || !shape) return [];
  const bounds = enabledWorldBounds(field, shape);
  if (!bounds) return [];
  const minLen = shape.cellSize * TILE_SIZE_F * 0.9;
  const corners = silhouetteCorners(field, shape);
  const out = [];
  for (const loop of buildCellLoops(field, shape)) {
    const closed = loop.length > 1
      && Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].z - loop[loop.length - 1].z) < 0.05;
    const n = closed ? loop.length - 1 : loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.z - a.z) < minLen) continue;
      const { ox, oz } = loopOutward(field, shape, a.x, a.z, b.x, b.z, corners);
      if (!isOuterTableEdge(a.x, a.z, b.x, b.z, ox, oz, bounds)) continue;
      out.push({
        x: (a.x + b.x) * 0.5,
        z: (a.z + b.z) * 0.5,
        ox,
        oz,
      });
    }
  }
  return out;
}

function stampTableBlocks(field, edge, shape) {
  // `suppressCenterBlock` lets a scenario (e.g. the skirmish table) drop the
  // KOTH-style center plinth while keeping the rounded rails/corners.
  if (tableHasCenterBlock(field, shape) && !field.suppressCenterBlock) {
    const center = tableCenterVertex(field);
    field.tableCenter = center;
    stampRoundedRectFootprint(field, edge, center.x, center.z, plinthHalf(shape), plinthCornerRadius(shape));
  } else {
    field.tableCenter = null;
  }
  const mids = tableEdgeMidpoints(field, shape);
  field.tableEdgeBlocks = mids;
  const corners = tableCornerPlinths(field, shape);
  field.tableCornerBlocks = corners;
  const half = plinthHalf(shape);
  const cornerR = plinthCornerRadius(shape);
  for (const p of mids) stampRoundedRectFootprint(field, edge, p.x, p.z, half, cornerR);
  for (const p of corners) stampRoundedRectFootprint(field, edge, p.x, p.z, half, cornerR);
}

/** Write activeMask / pass / slow from the silhouette. Red = edge, yellow = touches red. */
export function applyTableSilhouette(field, opts = {}) {
  const shape = normalizeTableShape(field, opts);
  field.tableShape = shape;
  field.chunkSize = shape.cellSize;
  field.chunkMask = cellMaskToMap(shape);

  const { width, height } = field;
  const n = width * height;
  const corners = silhouetteCorners(field, shape);
  const edge = new Uint8Array(n);
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      field.activeMask[i] = tileHitsTable(field, shape, tx, tz, corners) ? 1 : 0;
    }
  }
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (field.activeMask[i] === 0) continue;
      if (
        tileCrossesBoundary(field, shape, tx, tz, corners)
        || hasInactiveNeighbor8(field.activeMask, width, height, tx, tz)
      ) {
        edge[i] = 1;
      }
    }
  }

  stampTableBlocks(field, edge, shape);
  field.tableEdge = edge;
  refreshTableTerrain(field);
  return field;
}

/**
 * OR table-edge red/yellow onto pass + slow without wiping trees/rocks.
 * Safe after populateScenery.
 */
export function applyTableEdgeOccupancy(field) {
  const edge = field.tableEdge;
  if (!edge || !field.pass) return field;
  const { width, height } = field;
  const n = width * height;
  if (!field.slowMask || field.slowMask.length !== n) {
    field.slowMask = new Uint8Array(n);
  }
  if (!field.tableSlowMask || field.tableSlowMask.length !== n) {
    field.tableSlowMask = new Uint8Array(n);
  } else {
    field.tableSlowMask.fill(0);
  }
  const tableSlow = field.tableSlowMask;
  for (let i = 0; i < n; i++) {
    if (edge[i]) field.pass[i] = 0;
  }
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (field.activeMask?.[i] === 0 || field.pass[i] === 0) continue;
      if (!hasRedNeighbor(edge, width, height, tx, tz)) continue;
      field.slowMask[i] = 1;
      tableSlow[i] = 1;
    }
  }
  return field;
}

/** Recompute atlas/pass/slow after terrain paint without rebuilding the silhouette. */
export function refreshTableTerrain(field) {
  field.slowMask?.fill?.(0);
  field.tableSlowMask?.fill?.(0);
  refreshTerrainDerived(field);
  applyTableEdgeOccupancy(field);
  return field;
}

function hasInactiveNeighbor8(mask, width, height, tx, tz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height || mask[nz * width + nx] === 0) {
        return true;
      }
    }
  }
  return false;
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

/** Closed polylines in world XZ, each point {x,z}. Used to extrude rails. */
export function silhouetteLoops(field, shape) {
  const loops = [];
  const corners = silhouetteCorners(field, shape);
  const cellLoops = buildCellLoops(field, shape);
  for (const loop of cellLoops) {
    loops.push(filletLoop(loop, corners));
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

function filletLoop(pts, corners) {
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
    if (!corner || corner.r <= 0) {
      filleted.push(cur);
      continue;
    }
    const r = corner.r;
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
        x: c.x + Math.cos(ang) * r,
        z: c.z + Math.sin(ang) * r,
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

export function loopOutward(field, shape, ax, az, bx, bz, corners) {
  const list = corners ?? silhouetteCorners(field, shape);
  return outwardOfDirected(ax, az, bx, bz, (x, z) => pointInTable(field, shape, x, z, list));
}

/** Paint terrainTypes in a tile-radius brush on remaining felt. Returns dirty tiles. */
export function paintTerrainBrush(field, tx, tz, terrainType, radius = 0) {
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
      if (field.activeMask[i] === 0) continue;
      if (field.terrainTypes[i] !== terrainType) {
        field.terrainTypes[i] = terrainType;
        dirty.push({ x, z });
      }
    }
  }
  return dirty;
}
