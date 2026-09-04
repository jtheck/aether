// Grid navigation field — tiles, shallow height, marching-squares atlases, A*.
//
// Sim owns tile authority. Render reads a snapshot; never mutates this.
// World positions are Q16.16 fixed-point; tile size matches v1 (4 world units).

import * as fx from './fixed.js';

export const TILE = fx.fromFloat(4);
export const HALF_TILE = fx.div(TILE, fx.fromInt(2));
export const TILE_SIZE_F = 4;

/** Table silhouette chunks — keep in sync with tableShape.DEFAULT_CELL_SIZE. */
export const TABLE_CHUNK_TILES = 16;

/**
 * Tile count for an odd number of table chunks.
 * Odd sides put the world origin in the middle of a center chunk, not on a seam.
 * Even `chunks` rounds up.
 */
export function tilesForOddChunks(chunks, cellSize = TABLE_CHUNK_TILES) {
  const size = Math.max(1, cellSize | 0);
  let n = Math.max(1, chunks | 0);
  if ((n & 1) === 0) n += 1;
  return n * size;
}

/** Snap a tile count onto the nearest odd chunk board (tie goes larger). */
export function snapTilesToOddChunks(tiles, cellSize = TABLE_CHUNK_TILES) {
  const size = Math.max(1, cellSize | 0);
  const raw = Math.max(1, tiles | 0);
  let n = Math.max(1, Math.round(raw / size) || 1);
  if ((n & 1) === 0) {
    const down = n - 1;
    const up = n + 1;
    n = down < 1 || Math.abs(raw - up * size) <= Math.abs(raw - down * size) ? up : down;
  }
  return n * size;
}

/** Smallest lobby / Forge board — 5×5 chunks (odd). */
export const TINY_MAP_CHUNKS = 5;
export const TINY_MAP_W = tilesForOddChunks(TINY_MAP_CHUNKS);
export const TINY_MAP_H = TINY_MAP_W;
/** Normal play board — 13×13 chunks (odd). */
export const DEFAULT_MAP_CHUNKS = 13;
export const DEFAULT_MAP_W = tilesForOddChunks(DEFAULT_MAP_CHUNKS);
export const DEFAULT_MAP_H = DEFAULT_MAP_W;
/** Small skirmish board — one step down from default (matches Forge's 9-chunk size). */
export const SKIRMISH_MAP_CHUNKS = 9;
export const SKIRMISH_MAP_W = tilesForOddChunks(SKIRMISH_MAP_CHUNKS);
export const SKIRMISH_MAP_H = SKIRMISH_MAP_W;
/** Stress / animStress only — 31×31 chunks (odd). */
export const STRESS_MAP_CHUNKS = 31;
export const STRESS_MAP_W = tilesForOddChunks(STRESS_MAP_CHUNKS);
export const STRESS_MAP_H = STRESS_MAP_W;
/** Forge size picker — 5 / 9 / 13 chunks. */
export const FORGE_MAP_SIZES = [TINY_MAP_CHUNKS, SKIRMISH_MAP_CHUNKS, DEFAULT_MAP_CHUNKS]
  .map((chunks) => tilesForOddChunks(chunks));

/** Default playable board in tiles (aliases for callers that want the normal size). */
export const MAP_W = DEFAULT_MAP_W;
export const MAP_H = DEFAULT_MAP_H;
/** Ground is 832×832 centered on the origin (−416…416 world units) for default play. */
export const WORLD_HALF_F = (MAP_W * TILE_SIZE_F) / 2;
export const WORLD_HALF = fx.fromInt(WORLD_HALF_F);

/** Active session dims — set by createField/buildField / setActiveMapSize. */
let _mapW = MAP_W;
let _mapH = MAP_H;
let _worldHalfF = WORLD_HALF_F;
let _worldHalf = WORLD_HALF;

export function worldHalfFFromMap(mapW) {
  return (mapW * TILE_SIZE_F) / 2;
}

/**
 * Stress play-camera box — 19 chunks covers the pie ring
 * (inner ~0.30·table … support ~0.90·table − 32) and still leaves a vista rim.
 */
export const STRESS_CAMERA_CHUNKS = 19;
export const STRESS_CAMERA_HALF_F = worldHalfFFromMap(tilesForOddChunks(STRESS_CAMERA_CHUNKS));

export function worldHalfFFromField(field) {
  return worldHalfFFromMap(field.width);
}

export function activeMapW() {
  return _mapW;
}

export function activeMapH() {
  return _mapH;
}

export function activeWorldHalfF() {
  return _worldHalfF;
}

export function activeWorldHalf() {
  return _worldHalf;
}

/** Switch session map size (A*, world↔tile, spatial). Call before createWorld for that session. */
export function setActiveMapSize(mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H) {
  const w = Math.max(1, mapW | 0);
  const h = Math.max(1, mapH | 0);
  _mapW = w;
  _mapH = h;
  _worldHalfF = worldHalfFFromMap(w);
  _worldHalf = fx.fromInt(_worldHalfF);
}

/** Map tile counts for boot config — large board under stress / oversized armies. */
export function mapSizeForConfig({ stressPerSide = 0, animStressPerSide = 0, armyPerSide = 0, mapW, mapH } = {}) {
  if (mapW != null && mapH != null) {
    return { mapW: mapW | 0, mapH: mapH | 0 };
  }
  // Default KOTH army is 76; anything larger gets the stress board for packing room.
  if ((stressPerSide | 0) > 0 || (animStressPerSide | 0) > 0 || (armyPerSide | 0) > 76) {
    return { mapW: STRESS_MAP_W, mapH: STRESS_MAP_H };
  }
  return { mapW: DEFAULT_MAP_W, mapH: DEFAULT_MAP_H };
}

/** Semantic terrain per cell. */
export const TERRAIN = {
  WATER: 1,
  DIRT: 2,
  GRASS: 3,
};

/** Which 4×4 atlas PNG a tile samples. */
export const ATLAS = {
  GRASS_DIRT: 0,
  GRASS_WATER: 1,
};

/** World-Y scale for heightMap (0–1) — tile ripples plus edge-locked region lift. */
export const HEIGHT_AMPLITUDE = 14;
/** Shallow dish under water — follows the local felt instead of a 0.35× cliff. */
export const WATER_RECESS = 0.45;
/** Tiles from the table rim before painted / chunk lift is allowed to reach full height. */
export const EDGE_LOCK_TILES = 8;
const DETAIL_WEIGHT = 0.4;
const LIFT_WEIGHT = 0.6;
export const REGION_LIFT_STEP = 0.07;
export const REGION_LIFT_MIN = 0;
export const REGION_LIFT_MAX = 1;

// Diagonal step cost in fixed-point (sqrt(2) ≈ 1.414 * ONE).
const DIAG_COST = fx.fromFloat(1.414);
const CARD_COST = fx.ONE;
/**
 * Extra A* edge cost when entering a slow tile (Drayage / rally planner).
 * Matches move slow ≈ 0.45 → path pays ~1/0.45 so detours can win.
 */
export const SLOW_PATH_COST_MUL = fx.fromFloat(1 / 0.45);
/**
 * Extra A* edge cost when entering a non-tree tile (myco wander).
 * Trees stay at CARD/DIAG so the octile heuristic stays admissible;
 * open ground is expensive enough that a nearby grove wins a detour.
 */
export const TREE_SEEK_OPEN_MUL = fx.fromFloat(4);
/** Matches scenery.SCENERY.TREE — field.js cannot import scenery (cycle). */
const SCENERY_TREE = 1;

/** Marching-squares case (0–15) → atlas cell index (matches v1 atlas art). */
const CASE_TO_ATLAS = new Uint8Array([
  12, 0, 15, 11, 13, 3, 4, 2, 8, 14, 9, 7, 1, 5, 10, 6,
]);

/**
 * @param {number} [seed]
 * @param {{ width?: number, height?: number }} [dims]
 */
export function createField(seed = 0, dims = {}) {
  const width = dims.width ?? DEFAULT_MAP_W;
  const height = dims.height ?? DEFAULT_MAP_H;
  setActiveMapSize(width, height);
  const n = width * height;
  const field = {
    width,
    height,
    worldHalfF: _worldHalfF,
    seed: seed >>> 0,
    activeMask: new Uint8Array(n),
    pass: new Uint8Array(n),
    slowMask: new Uint8Array(n),
    /** Slow tiles owned by farms/agoras — survives tree fell clears. */
    structureSlowMask: new Uint8Array(n),
    /** 1-tile yellow ring around rocks — survives tree fell clears. */
    rockSlowMask: new Uint8Array(n),
    /** Yellow ring inside the table silhouette — survives tree fell clears. */
    tableSlowMask: new Uint8Array(n),
    sceneryType: new Uint8Array(n),
    // Per-tile wood remaining / burn timer (0 when no living tree).
    treeStock: new Uint8Array(n),
    treeBurn: new Uint16Array(n),
    burningTrees: [],
    treeDirty: [],
    treeStockHash: 0,
    // Per-tile stone/mineral remaining on rock CENTER tiles (0 otherwise).
    rockStock: new Uint16Array(n),
    rockDirty: [],
    rockStockHash: 0,
    // 1 on a farm's CENTER tile — an infinite food node villagers work in place.
    foodNode: new Uint8Array(n),
    heightMap: new Float32Array(n),
    /** Natural per-tile ripples (0–1). Region lift is composed on top. */
    detailHeight: new Float32Array(n),
    /** Paintable / seeded lift (0–1). Multiplied by the edge lock at compose. */
    regionLift: new Float32Array(n),
    terrainTypes: new Uint8Array(n),
    tileType: new Uint8Array(n),
    atlasId: new Uint8Array(n),
  };
  field.activeMask.fill(1);
  return field;
}

/**
 * Seeded procedural field: shallow height → terrain → marching squares → pass.
 * @param {number} [seed]
 * @param {{ width?: number, height?: number }} [dims]
 */
export function buildField(seed = 0, dims = {}) {
  const field = createField(seed, dims);
  generateHeightMap(field);
  assignTerrainByElevation(field);
  seedRegionLift(field);
  composeHeightMap(field);
  applyTerrainTransitions(field);
  updatePassFromWater(field);
  return field;
}

/** @deprecated Prefer buildField — kept for call sites / tests. */
export function buildDemoField(seed = 0) {
  return buildField(seed);
}

/** Clone typed arrays for postMessage (worker keeps its own). */
export function fieldSnapshot(field) {
  const snapshot = {
    width: field.width,
    height: field.height,
    worldHalfF: field.worldHalfF ?? worldHalfFFromField(field),
    cameraHalfF: field.cameraHalfF > 0 ? field.cameraHalfF : 0,
    seed: field.seed,
    heightMap: field.heightMap.slice(),
    terrainTypes: field.terrainTypes.slice(),
    tileType: field.tileType.slice(),
    atlasId: field.atlasId.slice(),
    pass: field.pass.slice(),
    slowMask: field.slowMask.slice(),
    structureSlowMask: field.structureSlowMask?.slice?.()
      ?? new Uint8Array(field.width * field.height),
    rockSlowMask: field.rockSlowMask?.slice?.()
      ?? new Uint8Array(field.width * field.height),
    tableSlowMask: field.tableSlowMask?.slice?.()
      ?? new Uint8Array(field.width * field.height),
    tableEdge: field.tableEdge?.slice?.()
      ?? new Uint8Array(field.width * field.height),
    tableCenter: field.tableCenter ? { ...field.tableCenter } : null,
    tableEdgeBlocks: Array.isArray(field.tableEdgeBlocks)
      ? field.tableEdgeBlocks.map((p) => ({ x: p.x, z: p.z, ox: p.ox ?? 0, oz: p.oz ?? 0 }))
      : [],
    tableCornerBlocks: Array.isArray(field.tableCornerBlocks)
      ? field.tableCornerBlocks.map((p) => ({ x: p.x, z: p.z }))
      : [],
    sceneryType: field.sceneryType.slice(),
    treeStock: field.treeStock?.slice?.() ?? new Uint8Array(field.width * field.height),
    treeBurn: field.treeBurn instanceof Uint16Array
      ? field.treeBurn.slice()
      : new Uint16Array(field.treeBurn ?? field.width * field.height),
    rockStock: field.rockStock?.slice?.() ?? new Uint16Array(field.width * field.height),
    rockStockHash: field.rockStockHash | 0,
    foodNode: field.foodNode?.slice?.() ?? new Uint8Array(field.width * field.height),
  };
  const tileMask = field.activeMask ?? field.tileMask ?? field.enabledMask;
  if (tileMask?.slice) snapshot.activeMask = tileMask.slice();
  if (field.chunkMask && typeof field.chunkMask[Symbol.iterator] === 'function') {
    snapshot.chunkMask = new Map(field.chunkMask);
    snapshot.chunkSize = Number(field.chunkSize) || 16;
  }
  if (field.tableShape?.cellMask) {
    snapshot.tableShape = {
      cellSize: field.tableShape.cellSize,
      chunksX: field.tableShape.chunksX,
      chunksZ: field.tableShape.chunksZ,
      cellMask: field.tableShape.cellMask.slice(),
      cellRadius: field.tableShape.cellRadius?.slice?.()
        ?? new Uint8Array(field.tableShape.cellMask.length),
    };
  }
  return snapshot;
}

/** World Y at a grid corner (cx, cz in 0…MAP inclusive). */
export function cornerHeightWorld(field, cx, cz) {
  return tileHeightWorld(field, cx, cz);
}

/** World Y for a tile, matching render `sampleHeight` (water is a small recess). */
export function tileHeightWorld(field, tx, tz) {
  const x = tx < 0 ? 0 : tx >= field.width ? field.width - 1 : tx;
  const z = tz < 0 ? 0 : tz >= field.height ? field.height - 1 : tz;
  const i = z * field.width + x;
  const y = field.heightMap[i] * HEIGHT_AMPLITUDE;
  if (field.terrainTypes[i] === TERRAIN.WATER) return y - WATER_RECESS;
  return y;
}

export function tileKey(tx, tz) {
  return tz * _mapW + tx;
}

export function inBounds(tx, tz) {
  return tx >= 0 && tz >= 0 && tx < _mapW && tz < _mapH;
}

export function isPassable(field, tx, tz) {
  if (!inBounds(tx, tz)) return false;
  const key = tileKey(tx, tz);
  return field.activeMask?.[key] !== 0 && field.pass[key] !== 0;
}

export function setBlocked(field, tx, tz) {
  if (inBounds(tx, tz)) field.pass[tileKey(tx, tz)] = 0;
}

export function isSlowTile(field, tx, tz) {
  if (!inBounds(tx, tz)) return false;
  return field.slowMask?.[tileKey(tx, tz)] !== 0;
}

/** Living tree (stock) or scenery tree mark — not farm/rock/table yellow. */
export function isTreeTile(field, tx, tz) {
  if (!inBounds(tx, tz)) return false;
  const i = tileKey(tx, tz);
  return (field.treeStock?.[i] | 0) > 0 || field.sceneryType?.[i] === SCENERY_TREE;
}

/** Count living-tree tiles on a Bresenham walk (same grid walk as lineClear). */
export function countTreesAlongLine(field, x0, z0, x1, z1) {
  let tx0 = worldToTile(x0);
  let tz0 = worldToTile(z0);
  const tx1 = worldToTile(x1);
  const tz1 = worldToTile(z1);
  let dx = Math.abs(tx1 - tx0);
  let dz = Math.abs(tz1 - tz0);
  const sx = tx0 < tx1 ? 1 : -1;
  const sz = tz0 < tz1 ? 1 : -1;
  let err = dx - dz;
  let n = 0;
  while (true) {
    if (isTreeTile(field, tx0, tz0)) n++;
    if (tx0 === tx1 && tz0 === tz1) return n;
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

/** Apply a v1-compatible enabled/disabled chunk map to sim and render authority. */
export function applyChunkMask(field, chunkMask, chunkSize = 16) {
  if (!field?.activeMask || !chunkMask || typeof chunkMask.get !== 'function') return;
  const size = Math.max(1, Math.floor(chunkSize));
  for (let tz = 0; tz < field.height; tz++) {
    const cz = Math.floor(tz / size);
    for (let tx = 0; tx < field.width; tx++) {
      const cx = Math.floor(tx / size);
      field.activeMask[tz * field.width + tx] =
        chunkMask.get(`${cx},${cz}`) === false ? 0 : 1;
    }
  }
  field.chunkMask = new Map(chunkMask);
  field.chunkSize = size;
  updatePassFromWater(field);
}

export function worldToTile(x) {
  return fx.toInt(fx.div(x + _worldHalf, TILE));
}

export function tileCenterX(tx) {
  return fx.mul(fx.fromInt(tx), TILE) + HALF_TILE - _worldHalf;
}

export function tileCenterY(tz) {
  return fx.mul(fx.fromInt(tz), TILE) + HALF_TILE - _worldHalf;
}

/**
 * Bresenham tile walk — true if every tile on the line is passable.
 * @param {object} [opts]
 * @param {boolean} [opts.avoidSlow] — also reject slowMask tiles (Drayage string-pull).
 */
export function lineClear(field, x0, z0, x1, z1, opts = null) {
  const avoidSlow = !!opts?.avoidSlow;
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
    if (avoidSlow && isSlowTile(field, tx0, tz0)) return false;
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
 *
 * @param {object} [opts]
 * @param {boolean} [opts.slowAware] — charge extra to enter slowMask tiles (rally / Drayage / monk).
 * @param {boolean} [opts.treeSeek] — charge extra to enter non-tree tiles (myco wander).
 */
// Reused A* scratch — sized for the largest supported board (stress), not default MAP_*.
const ASTAR_CELLS = STRESS_MAP_W * STRESS_MAP_H;
const _gScore = new Int32Array(ASTAR_CELLS);
const _cameFrom = new Int32Array(ASTAR_CELLS);
const _closed = new Uint8Array(ASTAR_CELLS);
const _visitGen = new Uint32Array(ASTAR_CELLS);
let _astarGen = 1;

function beginAstar() {
  _astarGen++;
  if (_astarGen === 0) {
    _visitGen.fill(0);
    _astarGen = 1;
  }
}

function astarTouch(key) {
  if (_visitGen[key] !== _astarGen) {
    _visitGen[key] = _astarGen;
    _gScore[key] = -1;
    _cameFrom[key] = -1;
    _closed[key] = 0;
  }
}

export function findPath(field, sx, sy, ex, ey, wx, wy, maxWp = 32, opts = null) {
  const slowAware = !!opts?.slowAware;
  const treeSeek = !!opts?.treeSeek && !slowAware;
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
    const snapped = nearestPassable(field, etx, etz, 8);
    if (!snapped) return 0;
    etx = snapped.tx;
    etz = snapped.tz;
    ex = tileCenterX(etx);
    ey = tileCenterY(etz);
  }

  const startX = tileCenterX(stx);
  const startY = tileCenterY(stz);
  if (worldToTile(ex) !== etx || worldToTile(ey) !== etz || !isPassable(field, etx, etz)) {
    ex = tileCenterX(etx);
    ey = tileCenterY(etz);
  }

  if (stx === etx && stz === etz) {
    wx[0] = ex;
    wy[0] = ey;
    return 1;
  }

  // Geometric LOS shortcut — skip when costing slow / preferring trees.
  if (!slowAware && !treeSeek && lineClear(field, startX, startY, ex, ey)) {
    wx[0] = ex;
    wy[0] = ey;
    return 1;
  }

  const W = field.width;
  const toKey = (x, z) => z * W + x;
  const startKey = toKey(stx, stz);
  const endKey = toKey(etx, etz);
  const startH = octileH(stx, stz, etx, etz);

  beginAstar();
  const open = new MinHeap();
  astarTouch(startKey);
  _gScore[startKey] = 0;
  _cameFrom[startKey] = -1;
  open.push(startKey, startH);

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

  let expansions = 0;
  const maxExpansions = 200000;
  let bestKey = startKey;
  let bestH = startH;
  let reachedGoal = false;

  while (open.size > 0) {
    const currentKey = open.pop();
    astarTouch(currentKey);
    if (_closed[currentKey]) continue;
    _closed[currentKey] = 1;
    expansions++;
    if (expansions > maxExpansions) break;

    if (currentKey === endKey) {
      reachedGoal = true;
      bestKey = currentKey;
      break;
    }

    const cx = currentKey % W;
    const cz = (currentKey / W) | 0;
    const h = octileH(cx, cz, etx, etz);
    if (h < bestH) {
      bestH = h;
      bestKey = currentKey;
    }

    const gHere = _gScore[currentKey];
    for (let n = 0; n < neighbors.length; n++) {
      const nx = cx + neighbors[n][0];
      const nz = cz + neighbors[n][1];
      if (!isPassable(field, nx, nz)) continue;

      if (neighbors[n][0] !== 0 && neighbors[n][1] !== 0) {
        if (!isPassable(field, cx + neighbors[n][0], cz) || !isPassable(field, cx, cz + neighbors[n][1])) {
          continue;
        }
      }

      const nKey = toKey(nx, nz);
      astarTouch(nKey);
      if (_closed[nKey]) continue;

      let step = neighbors[n][2];
      if (slowAware && isSlowTile(field, nx, nz)) {
        step = fx.mul(step, SLOW_PATH_COST_MUL);
      } else if (treeSeek && !isTreeTile(field, nx, nz)) {
        step = fx.mul(step, TREE_SEEK_OPEN_MUL);
      }
      const tentative = (gHere + step) | 0;
      if (_gScore[nKey] !== -1 && tentative >= _gScore[nKey]) continue;

      _cameFrom[nKey] = currentKey;
      _gScore[nKey] = tentative;
      open.push(nKey, tentative + octileH(nx, nz, etx, etz));
    }
  }

  if (!reachedGoal) {
    // Do NOT return shore-hugging partials (best H is often "into the lake").
    // Only accept a partial if we're already within ~4 tiles of the goal.
    if (bestH > CARD_COST * 4) return 0;
    if (bestKey === startKey) return 0;
    const bx = bestKey % W;
    const bz = (bestKey / W) | 0;
    ex = tileCenterX(bx);
    ey = tileCenterY(bz);
  }

  return buildWaypoints(
    _cameFrom,
    bestKey,
    startX,
    startY,
    ex,
    ey,
    wx,
    wy,
    maxWp,
    reachedGoal,
    field,
    opts,
  );
}

function octileH(x, z, etx, etz) {
  const dx = x - etx;
  const dz = z - etz;
  const adx = dx < 0 ? -dx : dx;
  const adz = dz < 0 ? -dz : dz;
  const mn = adx < adz ? adx : adz;
  const mx = adx > adz ? adx : adz;
  return CARD_COST * (mx - mn) + DIAG_COST * mn;
}

/**
 * Full tile path → string-pulled waypoints.
 * Pull against the COMPLETE route so long detours around lakes collapse
 * to a handful of LOS corners (fits in MAX_WAYPOINTS).
 */
function buildWaypoints(
  cameFrom,
  endKey,
  startX,
  startY,
  ex,
  ey,
  wx,
  wy,
  maxWp,
  reachedGoal,
  field,
  pathOpts = null,
) {
  const W = field.width;
  const slowAware = !!pathOpts?.slowAware;
  const treeSeek = !!pathOpts?.treeSeek && !slowAware;
  const pullOpts = slowAware ? { avoidSlow: true } : null;
  // Collect end→start keys.
  let raw = 0;
  let k = endKey;
  while (k !== -1) {
    _tileScratch[raw++] = k;
    k = cameFrom[k];
    if (raw >= _tileScratch.length) break;
  }
  // Reverse into _tilePath as start→end, dropping the start cell.
  let nPts = 0;
  for (let i = raw - 2; i >= 0; i--) {
    _tilePath[nPts++] = _tileScratch[i];
  }
  if (nPts === 0) {
    if (!reachedGoal) return 0;
    wx[0] = ex;
    wy[0] = ey;
    return 1;
  }

  const ptX = (idx) => {
    if (reachedGoal && idx === nPts - 1) return ex;
    const key = _tilePath[idx];
    return tileCenterX(key % W);
  };
  const ptY = (idx) => {
    if (reachedGoal && idx === nPts - 1) return ey;
    const key = _tilePath[idx];
    return tileCenterY((key / W) | 0);
  };

  const treesOnPath = (from, to) => {
    let n = 0;
    for (let k = from; k <= to; k++) {
      const key = _tilePath[k];
      if (isTreeTile(field, key % W, (key / W) | 0)) n++;
    }
    return n;
  };

  let out = 0;
  let ax = startX;
  let ay = startY;
  let i = 0;
  while (i < nPts && out < maxWp) {
    let best = i;
    for (let j = nPts - 1; j > i; j--) {
      if (!lineClear(field, ax, ay, ptX(j), ptY(j), pullOpts)) continue;
      if (treeSeek && countTreesAlongLine(field, ax, ay, ptX(j), ptY(j)) < treesOnPath(i, j)) {
        continue;
      }
      best = j;
      break;
    }
    wx[out] = ptX(best);
    wy[out] = ptY(best);
    ax = wx[out];
    ay = wy[out];
    out++;
    i = best + 1;
  }
  const lastX = ptX(nPts - 1);
  const lastY = ptY(nPts - 1);
  if (out > 0 && (wx[out - 1] !== lastX || wy[out - 1] !== lastY)) {
    if (out < maxWp) {
      wx[out] = lastX;
      wy[out] = lastY;
      out++;
    } else {
      wx[maxWp - 1] = lastX;
      wy[maxWp - 1] = lastY;
    }
  }
  return out;
}

const _tilePath = new Int32Array(ASTAR_CELLS);
const _tileScratch = new Int32Array(ASTAR_CELLS);

/** Snap a world point onto the nearest passable tile center (or null). */
export function snapToPassable(field, x, y, radius = 8) {
  const tx = worldToTile(x);
  const tz = worldToTile(y);
  if (isPassable(field, tx, tz)) return { x, y };
  const snapped = nearestPassable(field, tx, tz, radius);
  if (!snapped) return null;
  return { x: tileCenterX(snapped.tx), y: tileCenterY(snapped.tz) };
}

// --- generation -----------------------------------------------------------

function u32Hash(n) {
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return (n ^ (n >>> 16)) >>> 0;
}

function fade01(t) {
  return t * t * (3 - 2 * t);
}

/** Discrete terrace for one table chunk. Rim chunks stay off the basin floor. */
function chunkReliefValue(cx, cz, seed, chunksX, chunksZ) {
  const h = u32Hash(((cx + 17) * 73856093) ^ ((cz + 31) * 19349663) ^ ((seed + 1) * 83492791));
  const t = h / 4294967296;
  let v;
  if (t < 0.16) v = -1;
  else if (t < 0.38) v = -0.35;
  else if (t < 0.62) v = 0.1;
  else if (t < 0.82) v = 0.5;
  else v = 1;
  const rim = cx <= 0 || cz <= 0 || cx >= chunksX - 1 || cz >= chunksZ - 1;
  if (rim) v = Math.max(v, 0.1);
  return v;
}

function sampleChunkRelief(x, z, seed, width, height, cellSize) {
  const chunksX = Math.max(1, Math.ceil(width / cellSize));
  const chunksZ = Math.max(1, Math.ceil(height / cellSize));
  const px = (x + 0.5) / cellSize - 0.5;
  const pz = (z + 0.5) / cellSize - 0.5;
  const cx0 = Math.floor(px);
  const cz0 = Math.floor(pz);
  const tx = fade01(px - cx0);
  const tz = fade01(pz - cz0);
  const clampC = (c, max) => (c < 0 ? 0 : c >= max ? max - 1 : c);
  const v00 = chunkReliefValue(clampC(cx0, chunksX), clampC(cz0, chunksZ), seed, chunksX, chunksZ);
  const v10 = chunkReliefValue(clampC(cx0 + 1, chunksX), clampC(cz0, chunksZ), seed, chunksX, chunksZ);
  const v01 = chunkReliefValue(clampC(cx0, chunksX), clampC(cz0 + 1, chunksZ), seed, chunksX, chunksZ);
  const v11 = chunkReliefValue(clampC(cx0 + 1, chunksX), clampC(cz0 + 1, chunksZ), seed, chunksX, chunksZ);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

function ensureHeightLayers(field) {
  const n = field.width * field.height;
  if (!field.detailHeight || field.detailHeight.length !== n) field.detailHeight = new Float32Array(n);
  if (!field.regionLift || field.regionLift.length !== n) field.regionLift = new Float32Array(n);
}

/** Tile-ripple height (0–1). Terrain bands read this; region lift is composed after. */
export function generateHeightMap(field) {
  ensureHeightLayers(field);
  const { width, height, heightMap, detailHeight, seed } = field;
  const seed1 = seed * 0.01;
  const seed2 = seed * 0.02;
  const seed3 = seed * 0.03;
  let minH = Infinity;
  let maxH = -Infinity;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const wave1 = Math.sin(x * 0.1 + seed1) * Math.cos(z * 0.1 + seed1);
      const wave2 = Math.sin(x * 0.25 + seed2) * Math.cos(z * 0.25 + seed2);
      const wave3 = Math.sin(x * 0.5 + seed3) * Math.cos(z * 0.5 + seed3);
      const wave4 = Math.sin((x + z) * 0.3 + seed1) * 0.5;
      const h = (wave1 * 0.35 + wave2 * 0.3 + wave3 * 0.25 + wave4 * 0.1 + 1) * 0.5;
      heightMap[z * width + x] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  const range = maxH - minH || 1;
  for (let i = 0; i < heightMap.length; i++) {
    const h = (heightMap[i] - minH) / range;
    heightMap[i] = h;
    detailHeight[i] = h;
  }
}

function seedRegionLift(field) {
  ensureHeightLayers(field);
  const { width, height, regionLift, seed } = field;
  const cellSize = TABLE_CHUNK_TILES;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const relief = sampleChunkRelief(x, z, seed, width, height, cellSize);
      regionLift[z * width + x] = relief * 0.5 + 0.5;
    }
  }
}

function isEdgeLockedTile(field, tx, tz) {
  const { width, height, activeMask, tableEdge } = field;
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return true;
  const i = tz * width + tx;
  if (activeMask && activeMask[i] === 0) return true;
  if (tableEdge && tableEdge[i]) return true;
  if (!tableEdge && (tx === 0 || tz === 0 || tx === width - 1 || tz === height - 1)) return true;
  return false;
}

/** 0 on the table rim, 1 inward — keeps extra lift from spilling off the rails. */
export function computeEdgeLock(field) {
  const { width, height } = field;
  const n = width * height;
  const dist = new Float32Array(n);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (isEdgeLockedTile(field, x, z)) {
        dist[i] = 0;
        q[qt++] = i;
      } else {
        dist[i] = 1e9;
      }
    }
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % width;
    const z = (i / width) | 0;
    const nd = dist[i] + 1;
    if (x > 0 && nd < dist[i - 1]) { dist[i - 1] = nd; q[qt++] = i - 1; }
    if (x + 1 < width && nd < dist[i + 1]) { dist[i + 1] = nd; q[qt++] = i + 1; }
    if (z > 0 && nd < dist[i - width]) { dist[i - width] = nd; q[qt++] = i - width; }
    if (z + 1 < height && nd < dist[i + width]) { dist[i + width] = nd; q[qt++] = i + width; }
  }
  const lock = new Float32Array(n);
  const span = Math.max(1, EDGE_LOCK_TILES);
  for (let i = 0; i < n; i++) {
    const t = dist[i] >= span ? 1 : dist[i] / span;
    lock[i] = t * t * (3 - 2 * t);
  }
  field.edgeLock = lock;
  return lock;
}

/**
 * Bake display height: tile ripples everywhere, extra lift only away from the rails.
 * Does not re-normalize, so water/land keep their relative dish.
 */
export function composeHeightMap(field) {
  ensureHeightLayers(field);
  const lock = computeEdgeLock(field);
  const { heightMap, detailHeight, regionLift } = field;
  for (let i = 0; i < heightMap.length; i++) {
    const detail = detailHeight[i];
    const e = lock[i];
    const h = detail * DETAIL_WEIGHT
      + regionLift[i] * e * LIFT_WEIGHT
      + detail * (1 - DETAIL_WEIGHT) * (1 - e);
    heightMap[i] = h < 0 ? 0 : h > 1 ? 1 : h;
  }
}

/** Raise / lower the felt as-is. Terrain types stay put; rim lock is reapplied. */
export function paintRegionLift(field, tx, tz, delta, radius = 0) {
  ensureHeightLayers(field);
  const r = Math.max(0, radius | 0);
  const dirty = [];
  const { width, height, regionLift, activeMask } = field;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      const i = z * width + x;
      if (activeMask && activeMask[i] === 0) continue;
      const falloff = r === 0 ? 1 : 1 - Math.sqrt(d2) / (r + 0.001);
      let next = regionLift[i] + delta * falloff;
      if (next < REGION_LIFT_MIN) next = REGION_LIFT_MIN;
      if (next > REGION_LIFT_MAX) next = REGION_LIFT_MAX;
      if (next === regionLift[i]) continue;
      regionLift[i] = next;
      dirty.push({ x, z });
    }
  }
  if (dirty.length) composeHeightMap(field);
  return dirty;
}

/** Garden files omit baked height — rebuild ripples + seeded lift from the seed. */
export function applySeededHeight(field) {
  generateHeightMap(field);
  seedRegionLift(field);
  composeHeightMap(field);
}

function assignTerrainByElevation(field) {
  const { width, height, heightMap, terrainTypes } = field;
  const n = width * height;

  for (let i = 0; i < n; i++) {
    const h = heightMap[i];
    // Water / grass / dirt bands — water is the low end of the heightmap.
    if (h < 0.32) terrainTypes[i] = TERRAIN.WATER;
    else if (h < 0.62) terrainTypes[i] = TERRAIN.GRASS;
    else terrainTypes[i] = TERRAIN.DIRT;
  }

  // No water–dirt atlas: force a grass shoreline buffer.
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (terrainTypes[i] !== TERRAIN.WATER) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const ni = nz * width + nx;
          if (terrainTypes[ni] === TERRAIN.DIRT) terrainTypes[ni] = TERRAIN.GRASS;
        }
      }
    }
  }
}

function applyTerrainTransitions(field) {
  const { width, height, terrainTypes, tileType, atlasId } = field;
  const n = width * height;
  const grassVsDirt = new Uint8Array(n);
  const grassVsWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    grassVsDirt[i] = terrainTypes[i] === TERRAIN.GRASS ? 1 : 0;
    grassVsWater[i] = terrainTypes[i] !== TERRAIN.WATER ? 1 : 0;
  }

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      const terrain = terrainTypes[i];
      let hasWater = false;
      let hasDirt = false;
      let hasGrass = false;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const t = terrainTypes[nz * width + nx];
          if (t === TERRAIN.WATER) hasWater = true;
          else if (t === TERRAIN.DIRT) hasDirt = true;
          else if (t === TERRAIN.GRASS) hasGrass = true;
        }
      }

      if (terrain === TERRAIN.WATER) {
        atlasId[i] = ATLAS.GRASS_WATER;
        tileType[i] = hasGrass ? marchingCase(x, z, grassVsWater, width, height) : 12;
      } else if (terrain === TERRAIN.GRASS) {
        if (hasWater) {
          atlasId[i] = ATLAS.GRASS_WATER;
          tileType[i] = marchingCase(x, z, grassVsWater, width, height);
        } else if (hasDirt) {
          atlasId[i] = ATLAS.GRASS_DIRT;
          tileType[i] = marchingCase(x, z, grassVsDirt, width, height);
        } else {
          atlasId[i] = ATLAS.GRASS_DIRT;
          tileType[i] = 6;
        }
      } else {
        // dirt
        if (hasGrass) {
          atlasId[i] = ATLAS.GRASS_DIRT;
          tileType[i] = marchingCase(x, z, grassVsDirt, width, height);
        } else {
          atlasId[i] = ATLAS.GRASS_DIRT;
          tileType[i] = 12;
        }
      }
    }
  }
}

function marchingCase(x, z, density, width, height) {
  let caseNum = 0;
  if (cornerFilled(x, z, density, width, height) > 0) caseNum += 1;
  if (cornerFilled(x, z + 1, density, width, height) > 0) caseNum += 2;
  if (cornerFilled(x + 1, z, density, width, height) > 0) caseNum += 4;
  if (cornerFilled(x + 1, z + 1, density, width, height) > 0) caseNum += 8;
  return CASE_TO_ATLAS[caseNum];
}

function cornerFilled(cx, cz, density, width, height) {
  // Corner shared by up to 4 tiles — filled if any neighbor is filled.
  let max = 0;
  const samples = [
    [cx, cz],
    [cx - 1, cz],
    [cx, cz - 1],
    [cx - 1, cz - 1],
  ];
  for (let s = 0; s < 4; s++) {
    const tx = samples[s][0];
    const tz = samples[s][1];
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) continue;
    const v = density[tz * width + tx];
    if (v > max) max = v;
  }
  return max;
}

/** Marching-squares atlas + water pass + water slow. Does not clear tree slow. */
export function refreshTerrainDerived(field) {
  applyTerrainTransitions(field);
  updatePassFromWater(field);
  applyTerrainSlow(field);
  return field;
}

function updatePassFromWater(field) {
  const { width, height, activeMask, terrainTypes, tileType, pass } = field;
  const n = width * height;
  pass.fill(1);
  for (let i = 0; i < n; i++) {
    if (activeMask && activeMask[i] === 0) {
      pass[i] = 0;
      continue;
    }
    // Pure water (solid atlas cell) is impassable; shore transitions stay walkable.
    if (terrainTypes[i] === TERRAIN.WATER && tileType[i] === 12) pass[i] = 0;
  }
}

/**
 * Walkable partial-water cells only (water terrain, not solid tileType 12).
 * Does not mark grass–water atlas grass — those are dry shore.
 */
export function isTerrainSlowTile(field, tileIndex) {
  if (!field?.pass || field.pass[tileIndex] === 0) return false;
  return (
    field.terrainTypes[tileIndex] === TERRAIN.WATER &&
    field.tileType[tileIndex] !== 12
  );
}

/** OR partial-water slow into slowMask (does not clear trees). */
export function applyTerrainSlow(field) {
  const n = field.width * field.height;
  if (!field.slowMask || field.slowMask.length !== n) {
    field.slowMask = new Uint8Array(n);
  }
  for (let i = 0; i < n; i++) {
    if (isTerrainSlowTile(field, i)) field.slowMask[i] = 1;
  }
  return field;
}

function nearestPassable(field, tx, tz, radius) {
  // First Chebyshev ring with a free tile, then the Euclidean-nearest on that
  // ring. Corners of a ring are ~√2 farther than cardinals — old first-hit
  // order parked miners on a diagonal outside harvest reach of moss/snow rocks.
  for (let r = 1; r <= radius; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!isPassable(field, nx, nz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = { tx: nx, tz: nz };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Deterministic binary min-heap on [key, fScore]. Tie-break: lower key. */
class MinHeap {
  constructor() {
    this.keys = [];
    this.fs = [];
  }

  get size() {
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
      if (f > fs[p] || (f === fs[p] && key >= keys[p])) break;
      keys[i] = keys[p];
      fs[i] = fs[p];
      i = p;
    }
    keys[i] = key;
    fs[i] = f;
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
