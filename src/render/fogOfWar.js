// Client-only fog of war. Vision is a 20 Hz tile stamp — not in lockstep/checksums.
// Two overlay veils: visited and never-seen. Current sight is a hole — no wash.
// Hostile units stay through the overlay trail and hide when that veil is most
// opaque. Enemy buildings hide until seen, then last-known while fogged.
// Changing local player or shared-vision owners wipes explored tiles and
// last-known buildings so spectator / loading-screen vision cannot leak.

import {
  addToScene,
  createMeshFromData,
  createStandardMaterial,
  createTexture2DFromPixels,
  getOrCreateSampler,
  markMaterialUboDirty,
  setStandardOpacityTexture,
} from '../vendor/lite/liteVendor.js';
import * as fx from '../sim/fixed.js';
import { TILE_SIZE_F, worldHalfFFromField } from '../sim/field.js';
import { isAlly } from '../sim/teams.js';
import { UNIT_DEFS, getUnitDef } from '../sim/unitTypes.js';
import { surfaceHeightAt } from './terrain.js';
import { softDetachMesh } from './meshLifecycle.js';

const CIV_VISION_TILES = 8;
const MIL_VISION_MIN = 10;
/** Spellcasters see farther than infantry; towers share this radius. */
const CASTER_VISION_TILES = 18;
/** Airships see farther still; agoras share this radius. */
const DIRIGIBLE_VISION_TILES = 24;
const BUILDING_VISION_TILES = 7;
/** Never-seen shroud — heavier than visited so wilderness is a third step. */
const UNSEEN_MESH_ALPHA = 0.90;
const UNSEEN_DIFFUSE = [0.01, 0.016, 0.028];
/** Visited veil — darker than daylight, still lighter than the shroud. */
const VISITED_MESH_ALPHA = 0.50;
const VISITED_DIFFUSE = [0.045, 0.058, 0.072];
const OVERLAY_LIFT = 0.18;
const TEXEL_ALIGN = 64;
/** Soft overlay + hide skirt past the hard explored circle. */
const EDGE_FADE_TILES = 3;
/** Overlay pixel alpha on explored tiles that are no longer in sight. */
export const VISITED_ALPHA = 110;
/** Remaining cover (seen-ness) once a visited tile finishes fading. */
const VISITED_COVER = 255 - VISITED_ALPHA;
/** Time for leftover overlay cover to fade from current sight to its floor. */
export const COVER_DECAY_MS = 3200;
/**
 * One texel per tile. GPU linear filter does the fade — a CPU 2× bilinear
 * resample was ~5ms on the play board and ~24ms + 12MB uploads on stress.
 */
const FOG_TEX_SCALE = 1;

const UNIT_VISION_TILES = UNIT_DEFS.map((def) => visionTilesForDef(def));

/**
 * @param {{ category?: string, aggroRange?: number } | null | undefined} def
 * @returns {number}
 */
export function visionTilesForDef(def) {
  if (!def) return CIV_VISION_TILES;
  if (def.category === 'civilian') return CIV_VISION_TILES;
  if (def.category === 'air' || def.fly) return DIRIGIBLE_VISION_TILES;
  if (def.primaryAbility) return CASTER_VISION_TILES;
  const aggro = def.aggroRange ? fx.toFloat(def.aggroRange) : 0;
  const fromAggro = aggro > 0 ? Math.ceil(aggro / TILE_SIZE_F) + 1 : 0;
  return Math.max(MIL_VISION_MIN, fromAggro);
}

/**
 * @param {number} typeId
 * @returns {number}
 */
export function visionTilesForUnitType(typeId) {
  return UNIT_VISION_TILES[typeId] ?? visionTilesForDef(getUnitDef(typeId));
}

/**
 * @param {string | undefined} type
 * @returns {number}
 */
export function visionTilesForBuilding(type) {
  if (type === 'tower' || type === 'perch') return CASTER_VISION_TILES;
  if (type === 'agora') return DIRIGIBLE_VISION_TILES;
  return BUILDING_VISION_TILES;
}

/**
 * @param {{ type?: string, x: number, z: number }} b
 * @returns {string}
 */
export function structureKey(b) {
  return `${b.owner | 0}:${b.type ?? 'agora'}:${Math.round(b.x * 4)}:${Math.round(b.z * 4)}`;
}

/**
 * @param {object} field
 * @param {number} x
 * @param {number} z
 * @returns {{ tx: number, tz: number }}
 */
export function worldToTileF(field, x, z) {
  const half = worldHalfFFromField(field);
  return {
    tx: Math.floor((x + half) / TILE_SIZE_F),
    tz: Math.floor((z + half) / TILE_SIZE_F),
  };
}

function cloneBuilding(b) {
  return {
    owner: b.owner | 0,
    type: b.type,
    x: b.x,
    z: b.z,
    yaw: b.yaw ?? 0,
    hasRally: b.hasRally | 0,
    rallyX: b.rallyX ?? 0,
    rallyZ: b.rallyZ ?? 0,
    rallyOrder: b.rallyOrder ?? 0,
    prodPaused: b.prodPaused | 0,
    built: b.built != null ? b.built | 0 : 1,
    buildProgress: b.buildProgress | 0,
    buildTime: b.buildTime | 0,
    tracks: (b.tracks ?? []).map((t) => ({ ...t })),
  };
}

function displaySig(list) {
  if (!list?.length) return '0';
  let s = String(list.length);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    s += `|${b.type ?? 'agora'}:${b.owner}:${b.x}:${b.z}:${b.built ?? 1}`;
  }
  return s;
}

function tileActiveLookup(field) {
  const { width, height } = field;
  const mask = field.activeMask ?? field.tileMask ?? field.enabledMask;
  if (mask && mask.length >= width * height) {
    return (tx, tz) =>
      tx >= 0 && tz >= 0 && tx < width && tz < height && mask[tz * width + tx] !== 0;
  }
  return (tx, tz) => tx >= 0 && tz >= 0 && tx < width && tz < height;
}

function gpuTextureOf(tex) {
  return tex?._gpu?.texture ?? tex?._gpuTexture ?? tex?.gpuTexture ?? tex?.texture ?? null;
}

function disposeTexture(tex) {
  if (!tex) return;
  try {
    tex.dispose?.();
  } catch { /* vendor shape drift */ }
  try {
    gpuTextureOf(tex)?.destroy?.();
  } catch { /* vendor shape drift */ }
}

function padTexWidth(w) {
  return Math.max(TEXEL_ALIGN, Math.ceil(w / TEXEL_ALIGN) * TEXEL_ALIGN);
}

const EDT_INF = 1 << 28;
const EDT_MAX_R = 48;
/** Enough overlapping sources that per-circle raster is slower than one union EDT. */
const UNION_SOURCE_MIN = 6;

/** @type {Int32Array | null} */
let edtGrid = null;
/** @type {Int32Array | null} */
let edtLine = null;
/** @type {Int32Array | null} */
let edtDist = null;
/** @type {Int32Array | null} */
let edtV = null;
/** @type {Float64Array | null} */
let edtZ = null;

function ensureEdtScratch(bw, bh) {
  const n = bw * bh;
  if (!edtGrid || edtGrid.length < n) edtGrid = new Int32Array(n);
  const m = bw > bh ? bw : bh;
  if (!edtLine || edtLine.length < m) {
    edtLine = new Int32Array(m);
    edtDist = new Int32Array(m);
    edtV = new Int32Array(m);
    edtZ = new Float64Array(m + 1);
  }
}

/** Felzenszwalb 1D squared distance transform. `f` / `d` are length `n`. */
function edt1d(f, n, d) {
  const v = edtV;
  const z = edtZ;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  let k = 0;
  for (let q = 1; q < n; q++) {
    const fq = f[q];
    const q2 = q * q;
    let s;
    for (;;) {
      const vk = v[k];
      s = (fq + q2 - (f[vk] + vk * vk)) / (2 * (q - vk));
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const vk = v[k];
    const dq = q - vk;
    d[q] = dq * dq + f[vk];
  }
}

function edt2d(grid, bw, bh) {
  for (let x = 0; x < bw; x++) {
    for (let y = 0; y < bh; y++) edtLine[y] = grid[y * bw + x];
    edt1d(edtLine, bh, edtDist);
    for (let y = 0; y < bh; y++) grid[y * bw + x] = edtDist[y];
  }
  for (let y = 0; y < bh; y++) {
    const row = y * bw;
    for (let x = 0; x < bw; x++) edtLine[x] = grid[row + x];
    edt1d(edtLine, bw, edtDist);
    for (let x = 0; x < bw; x++) grid[row + x] = edtDist[x];
  }
}

function tryWriteTexture(engine, texture, pixels, w, h) {
  const device = engine?._device;
  const gpuTex = gpuTextureOf(texture);
  if (!device?.queue?.writeTexture || !gpuTex) return false;
  try {
    device.queue.writeTexture(
      { texture: gpuTex },
      pixels,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h, depthOrArrayLayers: 1 },
    );
    return true;
  } catch {
    return false;
  }
}

/** `bytesPerRow` is `w*4`; origin.x must stay 256-byte aligned (w is 64-texel padded). */
function tryWriteTextureRect(engine, texture, pixels, texW, texH, x, y, rw, rh) {
  const device = engine?._device;
  const gpuTex = gpuTextureOf(texture);
  if (!device?.queue?.writeTexture || !gpuTex) return false;
  const ox = Math.max(0, x | 0);
  const oy = Math.max(0, y | 0);
  const bw = Math.min(texW - ox, rw | 0);
  const bh = Math.min(texH - oy, rh | 0);
  if (bw <= 0 || bh <= 0) return true;
  try {
    device.queue.writeTexture(
      { texture: gpuTex, origin: { x: ox, y: oy } },
      pixels,
      { offset: (oy * texW + ox) * 4, bytesPerRow: texW * 4, rowsPerImage: bh },
      { width: bw, height: bh, depthOrArrayLayers: 1 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{
 *   reset: (field: object | null) => void,
 *   stamp: (input: object) => void,
 *   isEnabled: () => boolean,
 *   isWorldVisible: (x: number, z: number) => boolean,
 *   isWorldExplored: (x: number, z: number) => boolean,
 *   isWorldSight: (x: number, z: number) => boolean,
 *   hidesHostile: (owner: number, x: number, z: number) => boolean,
 *   filterBuildings: (list: object[] | null | undefined) => object[],
 *   filterAgoras: (list: object[] | null | undefined) => object[],
 *   commitDisplayLists: (buildings: object[], agoras: object[]) => boolean,
 *   attachOverlay: (engine: object, scene: object, field: object) => void,
 *   syncOverlay: () => void,
 *   detachOverlay: () => void,
 *   overlayNeedsFullPaint: () => boolean,
 *   forEachDirtyTile: (fn: (tileIndex: number) => void) => void,
 *   overlayAlphaAt: (x: number, z: number) => number,
 *   fogFactorAt: (x: number, z: number) => number,
 * }}
 */
export function createFogOfWar() {
  let field = null;
  let width = 0;
  let height = 0;
  let half = 0;
  /** @type {Uint32Array | null} */
  let visible = null;
  /** Current sight including the fade skirt. */
  /** @type {Uint32Array | null} */
  let sight = null;
  /** Overlay coverage 0–255 (255 = fully seen). Hide waits until this hits the floor. */
  /** @type {Uint8Array | null} */
  let cover = null;
  /** Hard-circle memory. Once seen, overlay never returns to unexplored. */
  /** @type {Uint8Array | null} */
  let explored = null;
  let gen = 1;
  let enabled = false;
  let localPlayerId = 0;
  /** Extra owners whose units/buildings stamp vision (combat stays hostile). */
  const shareVision = new Set();
  let lastStampAt = 0;
  /** @type {Map<string, object>} */
  const lastBuildings = new Map();
  let buildingSig = '';
  let agoraSig = '';

  /** @type {object | null} */
  let engine = null;
  /** @type {object | null} */
  let scene = null;
  /** @type {object | null} */
  let mesh = null;
  /** @type {object | null} */
  let material = null;
  /** @type {object | null} */
  let visitedMesh = null;
  /** @type {object | null} */
  let visitedMaterial = null;
  /** @type {object | null} */
  let texture = null;
  /** @type {object | null} */
  let visitedTexture = null;
  /** @type {Uint8Array | null} */
  let pixels = null;
  /** @type {Uint8Array | null} */
  let visitedPixels = null;
  let texW = 0;
  let texH = 0;
  /** Tiles with cover above the explored/unseen floor — decay walks only these. */
  /** @type {Int32Array | null} */
  let hot = null;
  let hotN = 0;
  /** @type {Uint8Array | null} */
  let inHot = null;
  /** Cover changed this stamp — overlay paint / GPU upload. */
  /** @type {Int32Array | null} */
  let dirtyList = null;
  let dirtyN = 0;
  /** @type {Uint8Array | null} */
  let dirty = null;
  let paintedOnce = false;
  /** Largest vision already stamped from this tile this gen. */
  /** @type {Uint8Array | null} */
  let tileStampR = null;
  /** @type {Uint32Array | null} */
  let tileStampGen = null;
  /** Unique source tiles this stamp (same-tile max radius). */
  /** @type {Int32Array | null} */
  let srcTiles = null;
  let srcN = 0;
  /** @type {Uint8Array | null} */
  let hasRad = null;

  function resetOverlayScratch(n) {
    if (!inHot || inHot.length !== n) {
      inHot = n ? new Uint8Array(n) : null;
      hot = n ? new Int32Array(n) : null;
      dirty = n ? new Uint8Array(n) : null;
      dirtyList = n ? new Int32Array(n) : null;
      tileStampR = n ? new Uint8Array(n) : null;
      tileStampGen = n ? new Uint32Array(n) : null;
      srcTiles = n ? new Int32Array(n) : null;
    } else {
      inHot.fill(0);
      dirty.fill(0);
    }
    if (!hasRad) hasRad = new Uint8Array(EDT_MAX_R + 1);
    hotN = 0;
    dirtyN = 0;
    srcN = 0;
    paintedOnce = false;
  }

  function markHot(i) {
    if (!inHot || inHot[i]) return;
    inHot[i] = 1;
    hot[hotN++] = i;
  }

  function markDirty(i) {
    if (!dirty || dirty[i]) return;
    dirty[i] = 1;
    dirtyList[dirtyN++] = i;
  }

  function clearVision() {
    width = field?.width | 0;
    height = field?.height | 0;
    half = field ? worldHalfFFromField(field) : 0;
    const n = width * height;
    if (!visible || visible.length !== n) visible = n ? new Uint32Array(n) : null;
    else visible.fill(0);
    if (!sight || sight.length !== n) sight = n ? new Uint32Array(n) : null;
    else sight.fill(0);
    if (!cover || cover.length !== n) cover = n ? new Uint8Array(n) : null;
    else cover.fill(0);
    if (!explored || explored.length !== n) explored = n ? new Uint8Array(n) : null;
    else explored.fill(0);
    resetOverlayScratch(n);
    gen = 1;
    lastStampAt = 0;
  }

  function forgetOverlay() {
    if (cover) cover.fill(0);
    if (explored) explored.fill(0);
    resetOverlayScratch(width * height);
    lastBuildings.clear();
    lastStampAt = 0;
  }

  function sameShareVision(list) {
    if (list == null) return true;
    const n = list.length;
    if (n !== shareVision.size) return false;
    for (let i = 0; i < n; i++) {
      if (!shareVision.has(list[i] | 0)) return false;
    }
    return true;
  }

  function decayCover(dtMs) {
    if (!cover || dtMs <= 0 || hotN <= 0) return;
    const dropOpen = Math.max(1, Math.round((255 * dtMs) / COVER_DECAY_MS));
    const dropVisited = Math.max(1, Math.round(((255 - VISITED_COVER) * dtMs) / COVER_DECAY_MS));
    let w = 0;
    for (let h = 0; h < hotN; h++) {
      const i = hot[h];
      if (sight && sight[i] === gen) {
        hot[w++] = i;
        continue;
      }
      const floor = explored && explored[i] ? VISITED_COVER : 0;
      const v = cover[i];
      if (v <= floor) {
        inHot[i] = 0;
        continue;
      }
      const drop = floor ? dropVisited : dropOpen;
      const next = v - drop > floor ? v - drop : floor;
      if (next !== v) {
        cover[i] = next;
        markDirty(i);
      }
      if (next <= floor) {
        inHot[i] = 0;
        continue;
      }
      hot[w++] = i;
    }
    hotN = w;
  }

  function adoptField(nextField) {
    if (!nextField) {
      field = null;
      clearVision();
      return;
    }
    const same = field && field.width === nextField.width && field.height === nextField.height;
    field = nextField;
    if (same) {
      half = worldHalfFFromField(field);
      return;
    }
    clearVision();
  }

  function reset(nextField) {
    field = nextField ?? null;
    lastBuildings.clear();
    buildingSig = '';
    agoraSig = '';
    clearVision();
  }

  function isWorldVisible(x, z) {
    if (!enabled) return true;
    if (!visible || !field) return true;
    const tx = Math.floor((x + half) / TILE_SIZE_F);
    const tz = Math.floor((z + half) / TILE_SIZE_F);
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
    return visible[tz * width + tx] === gen;
  }

  function isWorldExplored(x, z) {
    if (!enabled) return true;
    if (!explored || !field) return true;
    const tx = Math.floor((x + half) / TILE_SIZE_F);
    const tz = Math.floor((z + half) / TILE_SIZE_F);
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
    return explored[tz * width + tx] !== 0;
  }

  function isWorldSight(x, z) {
    if (!enabled) return true;
    if (!sight || !field) return true;
    const tx = Math.floor((x + half) / TILE_SIZE_F);
    const tz = Math.floor((z + half) / TILE_SIZE_F);
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
    return sight[tz * width + tx] === gen;
  }

  /** True while leftover cover is still decaying toward visited / unseen. */
  function trailOpen(x, z) {
    if (!cover || !field) return false;
    const tx = Math.floor((x + half) / TILE_SIZE_F);
    const tz = Math.floor((z + half) / TILE_SIZE_F);
    if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
    const i = tz * width + tx;
    const floor = explored && explored[i] ? VISITED_COVER : 0;
    return cover[i] > floor;
  }

  function isVisionAlly(owner) {
    if (isAlly(localPlayerId, owner)) return true;
    return shareVision.has(owner | 0);
  }

  function adoptShareVision(list) {
    shareVision.clear();
    if (!list) return;
    for (let i = 0; i < list.length; i++) shareVision.add(list[i] | 0);
  }

  function hidesHostile(owner, x, z) {
    if (!enabled) return false;
    if (isVisionAlly(owner)) return false;
    if (isWorldSight(x, z)) return false;
    return !trailOpen(x, z);
  }

  function applyStamp(i, hard, d2, hardR2, fadeDen) {
    if (sight) sight[i] = gen;
    if (hard) {
      if (visible) visible[i] = gen;
      if (explored) explored[i] = 1;
    }
    if (!cover) return;
    const c = hard ? 255 : ((fadeDen - (d2 - hardR2)) * 255 / fadeDen) | 0;
    if (c > cover[i]) {
      cover[i] = c;
      markDirty(i);
    }
    markHot(i);
  }

  function stampCircle(cx, cz, radiusTiles, mask) {
    if (!visible && !sight) return;
    const outer = radiusTiles + EDGE_FADE_TILES;
    const hardR2 = radiusTiles * radiusTiles;
    const outer2 = outer * outer;
    const fadeDen = outer2 - hardR2 || 1;
    const z0 = cz - outer < 0 ? 0 : cz - outer;
    const z1 = cz + outer >= height ? height - 1 : cz + outer;
    for (let tz = z0; tz <= z1; tz++) {
      const dz = tz - cz;
      const dz2 = dz * dz;
      const remO = outer2 - dz2;
      if (remO < 0) continue;
      const xrO = Math.sqrt(remO) | 0;
      let xa = cx - xrO;
      let xb = cx + xrO;
      if (xa < 0) xa = 0;
      if (xb >= width) xb = width - 1;
      const remH = hardR2 - dz2;
      const xh0 = remH >= 0 ? cx - (Math.sqrt(remH) | 0) : xa;
      const xh1 = remH >= 0 ? cx + (Math.sqrt(remH) | 0) : xa - 1;
      const row = tz * width;
      for (let tx = xa; tx <= xb; tx++) {
        const i = row + tx;
        if (mask && mask[i] === 0) continue;
        const hard = tx >= xh0 && tx <= xh1;
        const d2 = hard ? 0 : (tx - cx) * (tx - cx) + dz2;
        applyStamp(i, hard, d2, hardR2, fadeDen);
      }
    }
  }

  function addSource(x, z, radiusTiles, mask) {
    const cx = Math.floor((x + half) / TILE_SIZE_F);
    const cz = Math.floor((z + half) / TILE_SIZE_F);
    if (cx < 0 || cz < 0 || cx >= width || cz >= height || radiusTiles > EDT_MAX_R) {
      stampCircle(cx, cz, radiusTiles, mask);
      return;
    }
    const ti = cz * width + cx;
    if (tileStampGen[ti] === gen) {
      if (radiusTiles > tileStampR[ti]) tileStampR[ti] = radiusTiles;
      return;
    }
    tileStampGen[ti] = gen;
    tileStampR[ti] = radiusTiles;
    srcTiles[srcN++] = ti;
  }

  function stampUnionEdt(x0, z0, bw, bh, radMin, radMax, mask) {
    ensureEdtScratch(bw, bh);
    const grid = edtGrid;
    const n = bw * bh;
    for (let r = radMin; r <= radMax; r++) {
      if (!hasRad[r]) continue;
      const hardR2 = r * r;
      const outer = r + EDGE_FADE_TILES;
      const outer2 = outer * outer;
      const fadeDen = outer2 - hardR2 || 1;
      grid.fill(EDT_INF, 0, n);
      for (let s = 0; s < srcN; s++) {
        const ti = srcTiles[s];
        if (tileStampR[ti] !== r) continue;
        const tz = (ti / width) | 0;
        const tx = ti - tz * width;
        grid[(tz - z0) * bw + (tx - x0)] = 0;
      }
      edt2d(grid, bw, bh);
      for (let lz = 0; lz < bh; lz++) {
        const tz = z0 + lz;
        const row = tz * width;
        const grow = lz * bw;
        for (let lx = 0; lx < bw; lx++) {
          const d2 = grid[grow + lx];
          if (d2 > outer2) continue;
          const i = row + x0 + lx;
          if (mask && mask[i] === 0) continue;
          applyStamp(i, d2 <= hardR2, d2, hardR2, fadeDen);
        }
      }
    }
  }

  function flushSources(mask) {
    if (srcN <= 0) return;
    let x0 = width;
    let z0 = height;
    let x1 = -1;
    let z1 = -1;
    let radMin = EDT_MAX_R;
    let radMax = 0;
    let circleWork = 0;
    hasRad.fill(0);
    let nRad = 0;
    for (let s = 0; s < srcN; s++) {
      const ti = srcTiles[s];
      const tz = (ti / width) | 0;
      const tx = ti - tz * width;
      const r = tileStampR[ti];
      const o = r + EDGE_FADE_TILES;
      circleWork += (2 * o + 1) * (2 * o + 1);
      if (tx - o < x0) x0 = tx - o;
      if (tz - o < z0) z0 = tz - o;
      if (tx + o > x1) x1 = tx + o;
      if (tz + o > z1) z1 = tz + o;
      if (r < radMin) radMin = r;
      if (r > radMax) radMax = r;
      if (!hasRad[r]) {
        hasRad[r] = 1;
        nRad++;
      }
    }
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= width) x1 = width - 1;
    if (z1 >= height) z1 = height - 1;
    const bw = x1 - x0 + 1;
    const bh = z1 - z0 + 1;
    const useUnion = srcN >= UNION_SOURCE_MIN && circleWork > bw * bh * nRad * 3;
    if (!useUnion) {
      for (let s = 0; s < srcN; s++) {
        const ti = srcTiles[s];
        const tz = (ti / width) | 0;
        stampCircle(ti - tz * width, tz, tileStampR[ti], mask);
      }
      srcN = 0;
      return;
    }
    stampUnionEdt(x0, z0, bw, bh, radMin, radMax, mask);
    srcN = 0;
  }

  /**
   * @param {{
   *   world?: object,
   *   buildings?: object[],
   *   agoras?: object[],
   *   field?: object,
   *   localPlayerId?: number,
   *   enabled?: boolean,
   *   shareVisionWith?: number[],
   *   now?: number,
   * }} input
   */
  function stamp(input) {
    const nextPlayer = input.localPlayerId ?? localPlayerId;
    // Spectator catch-up and loading-screen shared vision stamp every army.
    // Dropping that set (or swapping local player) must wipe explored tiles
    // and last-known buildings — otherwise the joiner keeps a second map.
    const shareChanged = input.shareVisionWith !== undefined && !sameShareVision(input.shareVisionWith);
    if (nextPlayer !== localPlayerId || shareChanged) forgetOverlay();
    localPlayerId = nextPlayer;
    if (input.shareVisionWith !== undefined) adoptShareVision(input.shareVisionWith);
    // Spectators (localPlayerId < 0) still run fog when the caller asks, so
    // shared-owner stamps can veil wilderness instead of revealing the map.
    enabled =
      input.enabled === false
        ? false
        : localPlayerId >= 0 || shareVision.size > 0 || input.enabled === true;
    if (input.field) adoptField(input.field);
    if (!enabled || !field || !visible) {
      forgetOverlay();
      if (mesh) mesh.visible = false;
      return;
    }
    const now = input.now ?? Date.now();
    const dt = lastStampAt > 0 ? Math.min(COVER_DECAY_MS, Math.max(0, now - lastStampAt)) : 0;
    lastStampAt = now;
    gen++;
    if (gen === 0xffffffff) {
      visible.fill(0);
      if (sight) sight.fill(0);
      gen = 1;
    }
    const maskSrc = field.activeMask ?? field.tileMask ?? field.enabledMask;
    const mask = maskSrc && maskSrc.length >= width * height ? maskSrc : null;
    srcN = 0;
    const world = input.world;
    if (world) {
      const n = world.count | 0;
      const carried = world.carriedBy;
      for (let i = 0; i < n; i++) {
        if (!world.alive[i]) continue;
        if (carried && carried[i] >= 0) continue;
        if (!isVisionAlly(world.owner[i])) continue;
        addSource(
          fx.toFloat(world.px[i]),
          fx.toFloat(world.py[i]),
          visionTilesForUnitType(world.type[i]),
          mask,
        );
      }
    }
    const buildings = input.buildings;
    if (buildings) {
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (!isVisionAlly(b.owner)) continue;
        addSource(b.x, b.z, visionTilesForBuilding(b.type), mask);
      }
    }
    const agoras = input.agoras;
    if (agoras) {
      for (let i = 0; i < agoras.length; i++) {
        const a = agoras[i];
        if (!isVisionAlly(a.owner)) continue;
        addSource(a.x, a.z, visionTilesForBuilding('agora'), mask);
      }
    }
    flushSources(mask);
    if (dt > 0) decayCover(dt);
    if (mesh) mesh.visible = true;
  }

  function filterStructures(live, lastKnown, kind) {
    if (!enabled) return live ? live.slice() : [];
    const src = live ?? [];
    const out = [];
    const liveKeys = new Set();
    for (let i = 0; i < src.length; i++) {
      const item = src[i];
      const key = structureKey(kind === 'agora' ? { ...item, type: 'agora' } : item);
      liveKeys.add(key);
      const ally = isVisionAlly(item.owner);
      if (ally || isWorldVisible(item.x, item.z)) {
        lastKnown.set(key, cloneBuilding(item));
        out.push(item);
      }
    }
    for (const [key, ghost] of lastKnown) {
      if (isWorldVisible(ghost.x, ghost.z)) {
        if (!liveKeys.has(key)) lastKnown.delete(key);
        continue;
      }
      if (liveKeys.has(key) && isVisionAlly(ghost.owner)) continue;
      if (out.some((item) => structureKey(kind === 'agora' ? { ...item, type: 'agora' } : item) === key)) {
        continue;
      }
      out.push(ghost);
    }
    return out;
  }

  function filterBuildings(list) {
    return filterStructures(list, lastBuildings, 'building');
  }

  /** Agoras and their flags stay up — landmarks, not fog secrets. */
  function filterAgoras(list) {
    return list ?? [];
  }

  function commitDisplayLists(buildings, agoras) {
    const nextB = displaySig(buildings);
    const nextA = displaySig(agoras);
    const dirty = nextB !== buildingSig || nextA !== agoraSig;
    buildingSig = nextB;
    agoraSig = nextA;
    return dirty;
  }

  function overlayAlphaAt(x, z) {
    if (!enabled || !cover || !field) return 0;
    const fx = (x + half) / TILE_SIZE_F - 0.5;
    const fz = (z + half) / TILE_SIZE_F - 0.5;
    return 255 - sampleCover(fx, fz);
  }

  /** 0 = current sight, ~VISITED_ALPHA/255 = explored, 1 = never seen. */
  function fogFactorAt(x, z) {
    return overlayAlphaAt(x, z) / 255;
  }

  function coverAt(tx, tz) {
    if (!cover || tx < 0 || tz < 0 || tx >= width || tz >= height) return 0;
    const i = tz * width + tx;
    const c = cover[i];
    if (explored && explored[i] && c < VISITED_COVER) return VISITED_COVER;
    return c;
  }

  function sampleCover(fx, fz) {
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const c00 = coverAt(x0, z0);
    const c10 = coverAt(x0 + 1, z0);
    const c01 = coverAt(x0, z0 + 1);
    const c11 = coverAt(x0 + 1, z0 + 1);
    return (c00 * (1 - tx) + c10 * tx) * (1 - tz) + (c01 * (1 - tx) + c11 * tx) * tz;
  }

  function writeLayer(buf, o, alpha) {
    buf[o] = 255;
    buf[o + 1] = 255;
    buf[o + 2] = 255;
    buf[o + 3] = alpha;
  }

  function paintTexel(tx, tz) {
    const o = (tz * texW + tx) * 4;
    const seen = cover
      ? coverAt(tx, tz)
      : visible && visible[tz * width + tx] === gen
        ? 255
        : 0;
    let unseen;
    let visitedA;
    if (seen <= 0) {
      unseen = 255;
      visitedA = 0;
    } else if (seen >= 255) {
      unseen = 0;
      visitedA = 0;
    } else if (seen <= VISITED_COVER) {
      const t = seen / VISITED_COVER;
      unseen = Math.round(255 * (1 - t));
      visitedA = Math.round(255 * t);
    } else {
      const t = (seen - VISITED_COVER) / (255 - VISITED_COVER);
      unseen = 0;
      visitedA = Math.round(255 * (1 - t));
    }
    writeLayer(pixels, o, unseen);
    writeLayer(visitedPixels, o, visitedA);
  }

  function paintPixels(incremental) {
    if (!pixels || !visitedPixels) return;
    if (incremental) {
      for (let d = 0; d < dirtyN; d++) {
        const i = dirtyList[d];
        const tz = (i / width) | 0;
        paintTexel(i - tz * width, tz);
      }
      return;
    }
    pixels.fill(0);
    visitedPixels.fill(0);
    if (!cover && !visible) return;
    for (let tz = 0; tz < height; tz++) {
      for (let tx = 0; tx < width; tx++) paintTexel(tx, tz);
    }
    paintedOnce = true;
  }

  function clearDirty() {
    if (!dirty || dirtyN <= 0) {
      dirtyN = 0;
      return;
    }
    for (let d = 0; d < dirtyN; d++) dirty[dirtyList[d]] = 0;
    dirtyN = 0;
  }

  function dirtyTexBounds() {
    if (dirtyN <= 0) return null;
    let x0 = width;
    let z0 = height;
    let x1 = -1;
    let z1 = -1;
    for (let d = 0; d < dirtyN; d++) {
      const i = dirtyList[d];
      const tz = (i / width) | 0;
      const tx = i - tz * width;
      if (tx < x0) x0 = tx;
      if (tz < z0) z0 = tz;
      if (tx > x1) x1 = tx;
      if (tz > z1) z1 = tz;
    }
    if (x1 < 0) return null;
    x0 -= x0 % TEXEL_ALIGN;
    const xEnd = Math.min(texW, Math.ceil((x1 + 1) / TEXEL_ALIGN) * TEXEL_ALIGN);
    const w = xEnd - x0;
    const h = z1 - z0 + 1;
    if (w * h * 2 >= texW * texH) return null;
    return { x: x0, y: z0, w, h };
  }

  function bindOneOpacity(mat, next) {
    if (!mat || !next) return;
    setStandardOpacityTexture(mat, next);
    mat.opacityFromRGB = false;
    // Blend, don't cutoff — bilinear then fades the tile stairs for free.
    if ('alphaCutOff' in mat) mat.alphaCutOff = 0;
    markMaterialUboDirty?.(mat);
  }

  function writeOpacityTexture(prev, data, rect) {
    try {
      if (
        prev &&
        rect &&
        tryWriteTextureRect(engine, prev, data, texW, texH, rect.x, rect.y, rect.w, rect.h)
      ) {
        return prev;
      }
      if (prev && tryWriteTexture(engine, prev, data, texW, texH)) return prev;
    } catch (err) {
      console.warn('[fog] texture write failed', err);
    }
    const next = createTexture2DFromPixels(engine, data, texW, texH, {
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    next.sampler = getOrCreateSampler(engine, {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });
    disposeTexture(prev);
    return next;
  }

  function uploadTexture() {
    if (!engine || !pixels || !visitedPixels || !texW || !texH) return;
    // After detach/attach the pixel buffers are new but paintedOnce can still
    // be true — a dirty-only upload then writes a hole into a zeroed shroud
    // (wilderness stays transparent = inverted mask).
    if (paintedOnce && dirtyN === 0 && texture && visitedTexture) return;
    const incremental = !!(paintedOnce && dirtyN > 0 && texture && visitedTexture);
    paintPixels(incremental);
    const rect = incremental ? dirtyTexBounds() : null;
    texture = writeOpacityTexture(texture, pixels, rect);
    visitedTexture = writeOpacityTexture(visitedTexture, visitedPixels, rect);
    bindOneOpacity(material, texture);
    bindOneOpacity(visitedMaterial, visitedTexture);
    clearDirty();
  }

  function buildOverlayMesh() {
    if (!engine || !field) return;
    const active = tileActiveLookup(field);
    const positions = [];
    const uvs = [];
    const indices = [];
    let count = 0;
    for (let tz = 0; tz < height; tz++) {
      for (let tx = 0; tx < width; tx++) {
        if (!active(tx, tz)) continue;
        const x1 = tx * TILE_SIZE_F - half;
        const x2 = (tx + 1) * TILE_SIZE_F - half;
        const z1 = tz * TILE_SIZE_F - half;
        const z2 = (tz + 1) * TILE_SIZE_F - half;
        const y00 = surfaceHeightAt(field, x1, z1) + OVERLAY_LIFT;
        const y10 = surfaceHeightAt(field, x2, z1) + OVERLAY_LIFT;
        const y11 = surfaceHeightAt(field, x2, z2) + OVERLAY_LIFT;
        const y01 = surfaceHeightAt(field, x1, z2) + OVERLAY_LIFT;
        const base = count * 4;
        positions.push(x1, y00, z1, x2, y10, z1, x2, y11, z2, x1, y01, z2);
        const u0 = (tx * FOG_TEX_SCALE) / texW;
        const u1 = ((tx + 1) * FOG_TEX_SCALE) / texW;
        const v0 = (tz * FOG_TEX_SCALE) / texH;
        const v1 = ((tz + 1) * FOG_TEX_SCALE) / texH;
        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        count++;
      }
    }
    if (count === 0) return;
    const pos = new Float32Array(positions);
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    const idx = new Uint32Array(indices);
    const uv = new Float32Array(uvs);
    material = createOverlayMaterial(UNSEEN_DIFFUSE, UNSEEN_MESH_ALPHA);
    visitedMaterial = createOverlayMaterial(VISITED_DIFFUSE, VISITED_MESH_ALPHA);
    mesh = addOverlayMesh('fog-of-war', pos, normals, idx, uv, material);
    visitedMesh = addOverlayMesh(
      'fog-visited',
      pos.slice(),
      normals.slice(),
      idx.slice(),
      uv.slice(),
      visitedMaterial,
    );
    if (visitedMesh.position) visitedMesh.position.y = 0.03;
    uploadTexture();
  }

  function createOverlayMaterial(color, alpha) {
    const mat = createStandardMaterial();
    mat.diffuseColor = color;
    mat.emissiveColor = [0, 0, 0];
    mat.ambientColor = [0, 0, 0];
    mat.specularColor = [0, 0, 0];
    mat.disableLighting = true;
    mat.alpha = alpha;
    mat.backFaceCulling = true;
    return mat;
  }

  function addOverlayMesh(name, pos, normals, idx, uv, mat) {
    const next = createMeshFromData(engine, name, pos, normals, idx, uv);
    next.material = mat;
    next.pickable = false;
    next.receiveShadows = false;
    next.visible = enabled;
    addToScene(scene, next);
    return next;
  }

  function detachOverlay() {
    if (mesh) softDetachMesh(scene, mesh);
    if (visitedMesh) softDetachMesh(scene, visitedMesh);
    mesh = null;
    material = null;
    visitedMesh = null;
    visitedMaterial = null;
    disposeTexture(texture);
    disposeTexture(visitedTexture);
    texture = null;
    visitedTexture = null;
    pixels = null;
    visitedPixels = null;
    texW = 0;
    texH = 0;
    paintedOnce = false;
    engine = null;
    scene = null;
  }

  function attachOverlay(nextEngine, nextScene, nextField) {
    detachOverlay();
    if (!nextEngine || !nextScene || !nextField) return;
    engine = nextEngine;
    scene = nextScene;
    adoptField(nextField);
    texW = padTexWidth(width * FOG_TEX_SCALE);
    texH = Math.max(1, height * FOG_TEX_SCALE);
    pixels = new Uint8Array(texW * texH * 4);
    visitedPixels = new Uint8Array(texW * texH * 4);
    paintedOnce = false;
    buildOverlayMesh();
  }

  function syncOverlay() {
    if (!mesh || !material) return;
    mesh.visible = enabled;
    if (visitedMesh) visitedMesh.visible = enabled;
    if (!enabled) return;
    uploadTexture();
  }

  function overlayNeedsFullPaint() {
    return !paintedOnce;
  }

  function forEachDirtyTile(fn) {
    if (!fn || dirtyN <= 0) return;
    for (let d = 0; d < dirtyN; d++) fn(dirtyList[d]);
  }

  return {
    reset,
    stamp,
    isEnabled: () => enabled,
    isWorldVisible,
    isWorldExplored,
    isWorldSight,
    hidesHostile,
    filterBuildings,
    filterAgoras,
    commitDisplayLists,
    attachOverlay,
    syncOverlay,
    detachOverlay,
    overlayNeedsFullPaint,
    forEachDirtyTile,
    overlayAlphaAt,
    fogFactorAt,
  };
}
