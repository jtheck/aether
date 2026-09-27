// Visual-only world dressing. No pass, stock, gather, or entities.
// Grove mushrooms are derived from tree stock. Forge stamps persist on
// field.doodadType and round-trip in .garden (`dd`).

import { TERRAIN, TILE_SIZE_F, worldHalfFFromField } from './field.js';
import { SCENERY, rockFootprintRadius, sceneryTileHash } from './scenery.js';
import { TREE_STOCK_NATURAL_MAX, treeScaleForStage, treeStageFromStock } from './trees.js';

export const DOODAD = {
  NONE: 0,
  MUSHROOM: 1,
  WAGON: 2,
};

/** First wood past a natural canopy — grove overgrowth, not populate/paint. */
export const MUSHROOM_HOST_STOCK = TREE_STOCK_NATURAL_MAX;
/** Chebyshev tiles around a host that count toward "the stand is mature". */
export const MUSHROOM_AREA_RADIUS = 4;
/** Overgrowth trees (including self) required before mushrooms sprout. */
export const MUSHROOM_AREA_MIN = 3;
/** Caps around an old-growth host. Some stands stay bare. */
export const MUSHROOM_PER_HOST_MIN = 0;
export const MUSHROOM_PER_HOST_MAX = 2;
/** Painted mushrooms on open ground keep the fuller cluster. */
const MUSHROOM_BARE_MIN = 3;
const MUSHROOM_BARE_MAX = 6;
/**
 * Ground clearance, in trees.glb local units, times scenery modelScale 0.9.
 * The longest ground leaf reaches ~4.04; this sits a touch inside that tip.
 * Stock scale multiplies this in world space.
 */
const TREE_SKIRT_PER_SCALE = 3.3 * 0.9;
/** Small gap so the cap rests on the skirt instead of standing off it. */
const MUSHROOM_SKIRT_PAD = 0.3;
/** Scatter past the skirt so a host's cluster is not one circle. */
const MUSHROOM_RING = 0.45;
/** Bare authored tiles (no tree) keep a tight floor cluster. */
const MUSHROOM_BARE_INNER = 1.2;
const MUSHROOM_BARE_RING = 1.35;
const MUSHROOM_OPEN_TRIES = 8;
/** How far past the host skirt a cap may walk to leave a neighbor's crown. */
const MUSHROOM_CLEAR_EXTRA = 4;
/** Tiles around the host that can still cover that walk. */
const TREE_SKIRT_REACH_TILES = 10;

export function ensureDoodadArrays(field) {
  if (!field) return field;
  const n = (field.width | 0) * (field.height | 0);
  if (!(field.doodadType instanceof Uint8Array) || field.doodadType.length !== n) {
    field.doodadType = new Uint8Array(n);
  }
  return field;
}

export function hasAuthoredDoodads(field) {
  const types = field?.doodadType;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i]) return true;
  }
  return false;
}

/**
 * Living grove-fed tree. Burned trunks drop their floor dressing.
 * @param {object} field
 * @param {number} tileIndex
 */
export function isGroveOvergrowth(field, tileIndex) {
  const ti = tileIndex | 0;
  if ((field?.treeStock?.[ti] | 0) <= MUSHROOM_HOST_STOCK) return false;
  return !(field.treeBurn?.[ti] | 0);
}

/**
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {number} [radius]
 */
export function overgrowthCountNear(field, tx, tz, radius = MUSHROOM_AREA_RADIUS) {
  const width = field.width | 0;
  const height = field.height | 0;
  const r = radius | 0;
  let n = 0;
  for (let z = tz - r; z <= tz + r; z++) {
    if (z < 0 || z >= height) continue;
    const row = z * width;
    for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || x >= width) continue;
      if (isGroveOvergrowth(field, row + x)) n++;
    }
  }
  return n;
}

/**
 * Host tile whose neighborhood has matured into grove overgrowth.
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 */
export function isMatureOvergrowthHost(field, tx, tz) {
  const width = field.width | 0;
  const ti = (tz | 0) * width + (tx | 0);
  if (!isGroveOvergrowth(field, ti)) return false;
  return overgrowthCountNear(field, tx, tz) >= MUSHROOM_AREA_MIN;
}

/**
 * Every mature overgrowth host on the board. One linear pass; density is
 * only checked on tiles already past the natural cap.
 * @param {object} field
 * @returns {number[]}
 */
export function collectMushroomHostTiles(field) {
  const stock = field?.treeStock;
  if (!stock) return [];
  const width = field.width | 0;
  const out = [];
  for (let i = 0; i < stock.length; i++) {
    if ((stock[i] | 0) <= MUSHROOM_HOST_STOCK) continue;
    const tz = (i / width) | 0;
    const tx = i - tz * width;
    if (isMatureOvergrowthHost(field, tx, tz)) out.push(i);
  }
  return out;
}

/**
 * Dirty-tile neighborhoods for incremental sync. Includes tiles that should
 * lose mushrooms when a neighbor is felled or burned.
 * @param {object} field
 * @param {ArrayLike<number>} tiles
 * @returns {{ tile: number, live: boolean }[]}
 */
export function mushroomHostStatesNear(field, tiles) {
  if (!field?.treeStock || !tiles?.length) return [];
  const width = field.width | 0;
  const height = field.height | 0;
  const r = MUSHROOM_AREA_RADIUS;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < tiles.length; i++) {
    const ti = tiles[i] | 0;
    if (ti < 0 || ti >= width * height) continue;
    const tz = (ti / width) | 0;
    const tx = ti - tz * width;
    for (let z = tz - r; z <= tz + r; z++) {
      if (z < 0 || z >= height) continue;
      const row = z * width;
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || x >= width) continue;
        const nti = row + x;
        if (seen.has(nti)) continue;
        seen.add(nti);
        out.push({ tile: nti, live: isMatureOvergrowthHost(field, x, z) });
      }
    }
  }
  return out;
}

function tileHasTree(field, tx, tz) {
  const i = tz * field.width + tx;
  return field.sceneryType?.[i] === SCENERY.TREE || (field.treeStock?.[i] | 0) > 0;
}

function tileHasRock(field, tx, tz) {
  const { width, height } = field;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = tx + dx;
      const cz = tz + dz;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue;
      const kind = field.sceneryType[cz * width + cx];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      if (Math.hypot(dx, dz) <= rockFootprintRadius(kind)) return true;
    }
  }
  return false;
}

function isPaintLand(field, i) {
  const terrain = field.terrainTypes?.[i];
  return terrain === TERRAIN.GRASS || terrain === TERRAIN.DIRT;
}

/**
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {number} kind
 */
export function canPaintDoodadAt(field, tx, tz, kind) {
  const width = field.width | 0;
  const height = field.height | 0;
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
  if (kind !== DOODAD.MUSHROOM && kind !== DOODAD.WAGON) return false;
  const i = tz * width + tx;
  if (field.activeMask?.[i] === 0) return false;
  if (field.tableEdge?.[i]) return false;
  if (!isPaintLand(field, i)) return false;
  if (tileHasRock(field, tx, tz)) return false;
  if (kind === DOODAD.WAGON && tileHasTree(field, tx, tz)) return false;
  return true;
}

function stampDoodad(field, tx, tz, kind) {
  ensureDoodadArrays(field);
  const i = tz * field.width + tx;
  if (kind === DOODAD.NONE) {
    if (!field.doodadType[i]) return false;
    field.doodadType[i] = DOODAD.NONE;
    return true;
  }
  if (!canPaintDoodadAt(field, tx, tz, kind)) return false;
  if (field.doodadType[i] === kind) return false;
  field.doodadType[i] = kind;
  return true;
}

/**
 * Stamp or erase authored doodads. Does not touch pass / trees / rocks.
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {number} kind
 * @param {number} [radius]
 * @returns {{ x: number, z: number }[]}
 */
export function paintDoodadBrush(field, tx, tz, kind, radius = 0) {
  ensureDoodadArrays(field);
  const r = Math.max(0, radius | 0);
  const r2 = r * r;
  const dirty = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (stampDoodad(field, x, z, kind)) dirty.push({ x, z });
    }
  }
  return dirty;
}

function tileWorldCenter(field, tx, tz) {
  const half = worldHalfFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - half,
  };
}

/**
 * World radius of a tree's ground skirt. Stage 0 (no wood) is 0.
 * @param {number} stock
 */
export function mushroomHostSkirtRadius(stock) {
  const scale = treeScaleForStage(treeStageFromStock(stock | 0));
  return scale > 0 ? TREE_SKIRT_PER_SCALE * scale : 0;
}

/**
 * Neighbor crowns near a host, as world circles the cap must stay outside.
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {number} ignoreTile
 * @returns {{ x: number, z: number, r: number }[]}
 */
function nearbySkirtCircles(field, tx, tz, ignoreTile) {
  const stock = field?.treeStock;
  if (!stock) return [];
  const width = field.width | 0;
  const height = field.height | 0;
  const half = worldHalfFFromField(field);
  const reach = TREE_SKIRT_REACH_TILES;
  const out = [];
  for (let z0 = tz - reach; z0 <= tz + reach; z0++) {
    if (z0 < 0 || z0 >= height) continue;
    const row = z0 * width;
    const cz = (z0 + 0.5) * TILE_SIZE_F - half;
    for (let x0 = tx - reach; x0 <= tx + reach; x0++) {
      if (x0 < 0 || x0 >= width) continue;
      const nti = row + x0;
      if (nti === ignoreTile) continue;
      const skirt = mushroomHostSkirtRadius(stock[nti]);
      if (skirt <= 0) continue;
      out.push({
        x: (x0 + 0.5) * TILE_SIZE_F - half,
        z: cz,
        r: skirt + MUSHROOM_SKIRT_PAD,
      });
    }
  }
  return out;
}

/**
 * Smallest distance along a unit ray that sits outside every circle.
 * Starts at `tStart` (already outside the host). Returns a value above
 * `tMax` when the ray is still inside a crown at the cap.
 * @param {number} hx
 * @param {number} hz
 * @param {number} dx
 * @param {number} dz
 * @param {number} tStart
 * @param {{ x: number, z: number, r: number }[]} circles
 * @param {number} tMax
 */
function clearanceAlongRay(hx, hz, dx, dz, tStart, circles, tMax) {
  let t = tStart;
  for (let pass = 0; pass < 8; pass++) {
    let next = t;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const vx = hx - c.x;
      const vz = hz - c.z;
      const b = vx * dx + vz * dz;
      const cc = vx * vx + vz * vz - c.r * c.r;
      const disc = b * b - cc;
      if (disc <= 1e-8) continue;
      const s = Math.sqrt(disc);
      const t0 = -b - s;
      const t1 = -b + s;
      if (t > t0 - 1e-3 && t < t1 - 1e-3 && t1 > next) next = t1;
    }
    if (next <= t + 1e-4) return t;
    t = next;
    if (t > tMax) return t;
  }
  return t;
}

/**
 * Deterministic forest-floor cluster around one tile center.
 * On a living tree each cap sits just outside that skirt, walked out
 * along the shortest open ray so it is not left inside a neighbor.
 * A cap with no open ground nearby is omitted. World XZ only — render fills Y.
 * @param {object} field
 * @param {number} tileIndex
 */
export function mushroomPlacementsForHost(field, tileIndex) {
  const width = field.width | 0;
  const ti = tileIndex | 0;
  const tz = (ti / width) | 0;
  const tx = ti - tz * width;
  const seed = field.seed | 0;
  const skirt = mushroomHostSkirtRadius(field.treeStock?.[ti] | 0);
  const countMin = skirt > 0 ? MUSHROOM_PER_HOST_MIN : MUSHROOM_BARE_MIN;
  const countMax = skirt > 0 ? MUSHROOM_PER_HOST_MAX : MUSHROOM_BARE_MAX;
  const countRoll = sceneryTileHash(tx, tz, seed + 9001);
  const span = countMax - countMin + 1;
  const count = countMin + Math.min(span - 1, (countRoll * span) | 0);
  const { x: cx, z: cz } = tileWorldCenter(field, tx, tz);
  const inner = skirt > 0 ? skirt + MUSHROOM_SKIRT_PAD : MUSHROOM_BARE_INNER;
  const ring = skirt > 0 ? MUSHROOM_RING : MUSHROOM_BARE_RING;
  const circles = skirt > 0 ? nearbySkirtCircles(field, tx, tz, ti) : null;
  const tMax = inner + MUSHROOM_CLEAR_EXTRA;
  const out = [];
  for (let i = 0; i < count; i++) {
    const hAng = sceneryTileHash(tx, tz, seed + 9100 + i * 17);
    const hRad = sceneryTileHash(tx + i, tz, seed + 9200 + i * 31);
    const hYaw = sceneryTileHash(tx, tz + i, seed + 9300);
    const hScale = sceneryTileHash(tx + 3, tz + i, seed + 9400);
    let ang = hAng * Math.PI * 2;
    let rad = inner + hRad * ring;
    if (circles && circles.length) {
      let bestAng = 0;
      let bestRad = Infinity;
      const step = (Math.PI * 2) / MUSHROOM_OPEN_TRIES;
      for (let k = 0; k < MUSHROOM_OPEN_TRIES; k++) {
        const a = ang + k * step;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const cleared = clearanceAlongRay(cx, cz, dx, dz, inner, circles, tMax);
        const slack = clearanceAlongRay(
          cx, cz, dx, dz, cleared + hRad * ring, circles, tMax,
        );
        if (slack <= tMax && slack < bestRad) {
          bestRad = slack;
          bestAng = a;
          if (slack <= inner + hRad * ring + 1e-3) break;
        }
      }
      if (bestRad > tMax) continue;
      ang = bestAng;
      rad = bestRad;
    }
    out.push({
      type: DOODAD.MUSHROOM,
      host: ti,
      x: cx + Math.cos(ang) * rad,
      z: cz + Math.sin(ang) * rad,
      yaw: hYaw * Math.PI * 2,
      roll: 0,
      yOff: 0,
      scale: 1.75 + hScale * 1.7,
    });
  }
  return out;
}

/**
 * Flipped cart on its back, slightly askew. Visual only.
 * @param {object} field
 * @param {number} tileIndex
 */
export function wagonPlacementForTile(field, tileIndex) {
  const width = field.width | 0;
  const ti = tileIndex | 0;
  const tz = (ti / width) | 0;
  const tx = ti - tz * width;
  const seed = field.seed | 0;
  const { x, z } = tileWorldCenter(field, tx, tz);
  const hYaw = sceneryTileHash(tx, tz, seed + 8100);
  const hRoll = sceneryTileHash(tx, tz, seed + 8200);
  const hOff = sceneryTileHash(tx, tz, seed + 8300);
  return {
    type: DOODAD.WAGON,
    host: ti,
    x: x + (hOff - 0.5) * 0.55,
    z: z + (sceneryTileHash(tx + 1, tz, seed + 8400) - 0.5) * 0.55,
    yaw: hYaw * Math.PI * 2,
    roll: Math.PI * (0.88 + hRoll * 0.18),
    yOff: 1.08,
    scale: 1,
  };
}

function appendAuthoredDoodads(field, out) {
  const types = field?.doodadType;
  if (!types) return;
  const width = field.width | 0;
  const grove = new Set(collectMushroomHostTiles(field));
  for (let i = 0; i < types.length; i++) {
    const kind = types[i];
    if (kind === DOODAD.WAGON) {
      out.push(wagonPlacementForTile(field, i));
      continue;
    }
    if (kind !== DOODAD.MUSHROOM) continue;
    if (grove.has(i)) continue;
    const list = mushroomPlacementsForHost(field, i);
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
}

/**
 * Grove mushrooms plus Forge-stamped doodads.
 * @param {object} field
 */
export function collectDoodads(field) {
  const hosts = collectMushroomHostTiles(field);
  const out = [];
  for (let i = 0; i < hosts.length; i++) {
    const list = mushroomPlacementsForHost(field, hosts[i]);
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  appendAuthoredDoodads(field, out);
  return out;
}

/**
 * @param {object} field
 * @returns {{ key: string, kind: number, tile: number }[]}
 */
export function collectDoodadSlots(field) {
  const slots = [];
  const hosts = collectMushroomHostTiles(field);
  for (let i = 0; i < hosts.length; i++) {
    const tile = hosts[i];
    slots.push({ key: `g:${tile}`, kind: DOODAD.MUSHROOM, tile, grove: true });
  }
  const types = field?.doodadType;
  if (!types) return slots;
  const grove = new Set(hosts);
  for (let i = 0; i < types.length; i++) {
    const kind = types[i];
    if (kind === DOODAD.WAGON) {
      slots.push({ key: `w:${i}`, kind, tile: i, grove: false });
    } else if (kind === DOODAD.MUSHROOM && !grove.has(i)) {
      slots.push({ key: `a:${i}`, kind, tile: i, grove: false });
    }
  }
  return slots;
}
