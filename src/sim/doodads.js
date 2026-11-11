// World dressing. Grove mushrooms are derived from tree stock. Forge stamps
// persist on field.doodadType and round-trip in .garden (`dd`).
// A standard also stores a banner index on field.doodadColor (`dc`) and
// blocks a five-tile plus. A torch is a planted stick. Fog stamps its fire
// as a shared sight hole.

import { TERRAIN, isBlockedLiquid, TILE_SIZE_F, worldHalfFFromField, worldHalfZFFromField } from './field.js';
import { SCENERY, rockFootprintRadius, sceneryDensityAllows, sceneryTileHash } from './scenery.js';
import { TREE_STOCK_NATURAL_MAX, treeScaleForStage, treeStageFromStock } from './trees.js';

export const DOODAD = {
  NONE: 0,
  MUSHROOM: 1,
  WAGON: 2,
  TORCH: 3,
  DERRICK: 4,
  WINDVANE: 5,
  STANDARD: 6,
};

/** Center plus the four orthogonal tiles. Arms are blocked, not extra stamps. */
export const STANDARD_PLUS = Object.freeze([
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * Hard sight around a planted torch, in tiles. A villager sees 8.
 * The veil still feathers EDGE_FADE_TILES past this.
 */
export const TORCH_VISION_TILES = 3;

/**
 * Local fire_anchor on the planted stick. Y is up from the ground contact.
 * Scale is the empty size the socket flame multiplies (camp anchors are 1
 * on a building; this stays a small flame).
 */
export const TORCH_FIRE_ANCHOR = Object.freeze({
  name: 'fire_anchor',
  x: 0,
  y: 1.14,
  z: 0,
  scale: 0.2,
});

/** First wood past a natural canopy - grove overgrowth, not populate/paint. */
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
  if (!(field.doodadColor instanceof Uint8Array) || field.doodadColor.length !== n) {
    field.doodadColor = new Uint8Array(n);
  }
  return field;
}

/** Color RLE when a standard uses a swatch other than the first. Index 0 is the default. */
export function authoredStandardColors(field) {
  const types = field?.doodadType;
  const colors = field?.doodadColor;
  if (!types || !colors || colors.length !== types.length) return null;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === DOODAD.STANDARD && colors[i]) return colors;
  }
  return null;
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
  if (
    kind !== DOODAD.MUSHROOM
    && kind !== DOODAD.WAGON
    && kind !== DOODAD.TORCH
    && kind !== DOODAD.DERRICK
    && kind !== DOODAD.WINDVANE
    && kind !== DOODAD.STANDARD
  ) return false;
  const i = tz * width + tx;
  if (field.activeMask?.[i] === 0) return false;
  if (kind !== DOODAD.MUSHROOM) return true;
  if (field.tableEdge?.[i]) return false;
  if (!isPaintLand(field, i)) return false;
  if (tileHasRock(field, tx, tz)) return false;
  return true;
}

function clampColor(color) {
  const n = color | 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

function writeDoodadColor(field, i, kind, color) {
  const next = kind === DOODAD.STANDARD ? clampColor(color) : 0;
  if (field.doodadColor[i] === next) return false;
  field.doodadColor[i] = next;
  return true;
}

function stampDoodad(field, tx, tz, kind, color) {
  ensureDoodadArrays(field);
  const i = tz * field.width + tx;
  if (kind === DOODAD.NONE) {
    if (!field.doodadType[i] && !field.doodadColor[i]) return false;
    field.doodadType[i] = DOODAD.NONE;
    field.doodadColor[i] = 0;
    return true;
  }
  if (!canPaintDoodadAt(field, tx, tz, kind)) return false;
  const recolor = writeDoodadColor(field, i, kind, color);
  if (field.doodadType[i] === kind && !recolor) return false;
  field.doodadType[i] = kind;
  return true;
}

/**
 * Stamp or erase authored doodads. Trees and rocks stay. A standard blocks
 * its plus; every other kind leaves pass alone.
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @param {number} kind
 * @param {number} [radius]
 * @param {{ density?: number, salt?: number, color?: number }} [opts]
 * @returns {{ x: number, z: number }[]}
 */
export function paintDoodadBrush(field, tx, tz, kind, radius = 0, opts = {}) {
  ensureDoodadArrays(field);
  const r = Math.max(0, radius | 0);
  const r2 = r * r;
  const dirty = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (!sceneryDensityAllows(x, z, field.seed, opts.density, opts.salt)) continue;
      if (stampDoodad(field, x, z, kind, opts.color)) dirty.push({ x, z });
    }
  }
  if (dirty.length) applyStandardOccupancy(field);
  return dirty;
}

function canReleaseStandard(field, i) {
  if (field.activeMask?.[i] === 0) return false;
  if (isBlockedLiquid(field, i)) return false;
  if (field.tableEdge?.[i]) return false;
  if (field.wallBlock?.[i]) return false;
  const width = field.width | 0;
  const tz = (i / width) | 0;
  const tx = i - tz * width;
  if (tileHasRock(field, tx, tz)) return false;
  return true;
}

/**
 * Rebuild the standard plus into field.pass. Tiles that leave the plus open
 * again unless liquid, the table rim, a wall, or a rock still owns them.
 * A pass rebuild (water, table silhouette) clears the block until this runs.
 * @param {object} field
 */
export function applyStandardOccupancy(field) {
  if (!field?.pass || !field.doodadType) return field;
  const width = field.width | 0;
  const height = field.height | 0;
  const n = width * height;
  const next = new Uint8Array(n);
  const types = field.doodadType;
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== DOODAD.STANDARD) continue;
    const tz = (i / width) | 0;
    const tx = i - tz * width;
    for (let a = 0; a < STANDARD_PLUS.length; a++) {
      const x = tx + STANDARD_PLUS[a][0];
      const z = tz + STANDARD_PLUS[a][1];
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      const ti = z * width + x;
      if (field.activeMask?.[ti] === 0) continue;
      next[ti] = 1;
    }
  }
  const prev = field.standardBlock;
  if (prev && prev.length === n) {
    for (let i = 0; i < n; i++) {
      if (prev[i] && !next[i] && canReleaseStandard(field, i)) field.pass[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (next[i]) field.pass[i] = 0;
  }
  field.standardBlock = next;
  return field;
}

function tileWorldCenter(field, tx, tz) {
  return {
    x: (tx + 0.5) * TILE_SIZE_F - worldHalfFFromField(field),
    z: (tz + 0.5) * TILE_SIZE_F - worldHalfZFFromField(field),
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
  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const reach = TREE_SKIRT_REACH_TILES;
  const out = [];
  for (let z0 = tz - reach; z0 <= tz + reach; z0++) {
    if (z0 < 0 || z0 >= height) continue;
    const row = z0 * width;
    const cz = (z0 + 0.5) * TILE_SIZE_F - halfZ;
    for (let x0 = tx - reach; x0 <= tx + reach; x0++) {
      if (x0 < 0 || x0 >= width) continue;
      const nti = row + x0;
      if (nti === ignoreTile) continue;
      const skirt = mushroomHostSkirtRadius(stock[nti]);
      if (skirt <= 0) continue;
      out.push({
        x: (x0 + 0.5) * TILE_SIZE_F - halfX,
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
 * A cap with no open ground nearby is omitted. World XZ only - render fills Y.
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

/**
 * Upright stick in the ground. Yaw and a small shift only - roll stays 0
 * so the fire_anchor sits on the tip.
 * @param {object} field
 * @param {number} tileIndex
 */
export function torchPlacementForTile(field, tileIndex) {
  const width = field.width | 0;
  const ti = tileIndex | 0;
  const tz = (ti / width) | 0;
  const tx = ti - tz * width;
  const seed = field.seed | 0;
  const { x, z } = tileWorldCenter(field, tx, tz);
  const hYaw = sceneryTileHash(tx, tz, seed + 7100);
  const hOff = sceneryTileHash(tx, tz, seed + 7200);
  const hScale = sceneryTileHash(tx, tz, seed + 7300);
  return {
    type: DOODAD.TORCH,
    host: ti,
    x: x + (hOff - 0.5) * 0.4,
    z: z + (sceneryTileHash(tx + 1, tz, seed + 7400) - 0.5) * 0.4,
    yaw: hYaw * Math.PI * 2,
    roll: 0,
    yOff: 0,
    scale: 0.92 + hScale * 0.16,
  };
}

/**
 * Upright model prop. The mesh keeps its authored size; render centers it
 * on the stamp. Roll stays 0 so a derrick does not lie down like a wagon.
 * @param {object} field
 * @param {number} tileIndex
 * @param {number} type
 * @param {number} salt
 */
function plantedPropPlacement(field, tileIndex, type, salt) {
  const width = field.width | 0;
  const ti = tileIndex | 0;
  const tz = (ti / width) | 0;
  const tx = ti - tz * width;
  const seed = field.seed | 0;
  const { x, z } = tileWorldCenter(field, tx, tz);
  const hYaw = sceneryTileHash(tx, tz, seed + salt);
  const hOff = sceneryTileHash(tx, tz, seed + salt + 100);
  return {
    type,
    host: ti,
    x: x + (hOff - 0.5) * 0.4,
    z: z + (sceneryTileHash(tx + 1, tz, seed + salt + 200) - 0.5) * 0.4,
    yaw: hYaw * Math.PI * 2,
    roll: 0,
    yOff: 0,
    scale: 1,
  };
}

/** Static derrick mesh. Not a building, so it never collapses into a well. */
export function derrickPlacementForTile(field, tileIndex) {
  return plantedPropPlacement(field, tileIndex, DOODAD.DERRICK, 6100);
}

/** Windvane from the props folder. Visual only. */
export function windvanePlacementForTile(field, tileIndex) {
  return plantedPropPlacement(field, tileIndex, DOODAD.WINDVANE, 5100);
}

/** Upright flag. Color lives on the tile, not in this pose. */
export function standardPlacementForTile(field, tileIndex) {
  return plantedPropPlacement(field, tileIndex, DOODAD.STANDARD, 7100);
}

/** World XZ of every authored torch. Fog stamps these for every player. */
export function forEachTorch(field, fn) {
  const types = field?.doodadType;
  if (!types || !fn) return;
  const width = field.width | 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== DOODAD.TORCH) continue;
    const p = torchPlacementForTile(field, i);
    fn(p.x, p.z);
  }
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
    if (kind === DOODAD.TORCH) {
      out.push(torchPlacementForTile(field, i));
      continue;
    }
    if (kind === DOODAD.DERRICK) {
      out.push(derrickPlacementForTile(field, i));
      continue;
    }
    if (kind === DOODAD.WINDVANE) {
      out.push(windvanePlacementForTile(field, i));
      continue;
    }
    if (kind === DOODAD.STANDARD) {
      out.push(standardPlacementForTile(field, i));
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
    } else if (kind === DOODAD.TORCH) {
      slots.push({ key: `t:${i}`, kind, tile: i, grove: false });
    } else if (kind === DOODAD.DERRICK) {
      slots.push({ key: `d:${i}`, kind, tile: i, grove: false });
    } else if (kind === DOODAD.WINDVANE) {
      slots.push({ key: `v:${i}`, kind, tile: i, grove: false });
    } else if (kind === DOODAD.STANDARD) {
      slots.push({
        key: `s:${i}`,
        kind,
        tile: i,
        grove: false,
        color: field.doodadColor?.[i] ?? 0,
      });
    } else if (kind === DOODAD.MUSHROOM && !grove.has(i)) {
      slots.push({ key: `a:${i}`, kind, tile: i, grove: false });
    }
  }
  return slots;
}
