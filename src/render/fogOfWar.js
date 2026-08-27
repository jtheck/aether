// Client-only fog of war. Vision is a 20 Hz tile stamp — not in lockstep/checksums.
// Three overlay levels: current sight, visited, never-seen. Hostile units stay
// through the overlay trail and hide when that veil is most opaque. Enemy
// buildings hide until seen, then last-known while fogged.

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
/** Unlit olive wash on current sight only — lifts the hole without a second sun. */
const SIGHT_LIFT_ALPHA = 0.30;
const SIGHT_LIFT_DIFFUSE = [0.46, 0.50, 0.36];
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
/** Upsample the cover field so bilinear has more than one texel per tile. */
const FOG_TEX_SCALE = 2;

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
  return `${b.type ?? 'agora'}:${Math.round(b.x * 4)}:${Math.round(b.z * 4)}`;
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
    tracks: (b.tracks ?? []).map((t) => ({ ...t })),
  };
}

function displaySig(list) {
  if (!list?.length) return '0';
  let s = String(list.length);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    s += `|${b.type ?? 'agora'}:${b.owner}:${b.x}:${b.z}`;
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
  let liftMesh = null;
  /** @type {object | null} */
  let liftMaterial = null;
  /** @type {object | null} */
  let texture = null;
  /** @type {object | null} */
  let visitedTexture = null;
  /** @type {object | null} */
  let liftTexture = null;
  /** @type {Uint8Array | null} */
  let pixels = null;
  /** @type {Uint8Array | null} */
  let visitedPixels = null;
  /** @type {Uint8Array | null} */
  let liftPixels = null;
  let texW = 0;
  let texH = 0;

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
    gen = 1;
    lastStampAt = 0;
  }

  function forgetOverlay() {
    if (cover) cover.fill(0);
    if (explored) explored.fill(0);
    lastStampAt = 0;
  }

  function decayCover(dtMs) {
    if (!cover || dtMs <= 0) return;
    for (let i = 0; i < cover.length; i++) {
      const floor = explored && explored[i] ? VISITED_COVER : 0;
      const v = cover[i];
      if (v <= floor) continue;
      const span = 255 - floor;
      const drop = Math.max(1, Math.round((span * dtMs) / COVER_DECAY_MS));
      cover[i] = v - drop > floor ? v - drop : floor;
    }
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

  function hidesHostile(owner, x, z) {
    if (!enabled) return false;
    if (localPlayerId < 0) return false;
    if (isAlly(localPlayerId, owner)) return false;
    if (isWorldSight(x, z)) return false;
    return !trailOpen(x, z);
  }

  function stampCircle(cx, cz, radiusTiles) {
    if (!visible && !sight) return;
    const fade = EDGE_FADE_TILES;
    const outer = radiusTiles + fade;
    const r = Math.ceil(outer);
    const hardR2 = radiusTiles * radiusTiles;
    const outer2 = outer * outer;
    const inner = radiusTiles;
    const fadeSpan = Math.max(0.001, outer - inner);
    const active = tileActiveLookup(field);
    for (let tz = cz - r; tz <= cz + r; tz++) {
      if (tz < 0 || tz >= height) continue;
      const dz = tz - cz;
      const row = tz * width;
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (tx < 0 || tx >= width) continue;
        if (!active(tx, tz)) continue;
        const dx = tx - cx;
        const d2 = dx * dx + dz * dz;
        if (d2 > outer2) continue;
        if (sight) sight[row + tx] = gen;
        if (d2 <= hardR2) {
          if (visible) visible[row + tx] = gen;
          if (explored) explored[row + tx] = 1;
        }
        if (!cover) continue;
        const d = Math.sqrt(d2);
        let c = 255;
        if (d > inner) c = Math.round(255 * (1 - (d - inner) / fadeSpan));
        const i = row + tx;
        if (c > cover[i]) cover[i] = c;
      }
    }
  }

  function stampWorld(x, z, radiusTiles) {
    const t = worldToTileF(field, x, z);
    stampCircle(t.tx, t.tz, radiusTiles);
  }

  /**
   * @param {{
   *   world?: object,
   *   buildings?: object[],
   *   agoras?: object[],
   *   field?: object,
   *   localPlayerId?: number,
   *   enabled?: boolean,
   *   now?: number,
   * }} input
   */
  function stamp(input) {
    const nextPlayer = input.localPlayerId ?? localPlayerId;
    if (nextPlayer !== localPlayerId) forgetOverlay();
    localPlayerId = nextPlayer;
    enabled = input.enabled !== false && localPlayerId >= 0;
    if (input.field) adoptField(input.field);
    if (!enabled || !field || !visible) {
      forgetOverlay();
      if (mesh) mesh.visible = false;
      return;
    }
    const now = input.now ?? Date.now();
    if (lastStampAt > 0) {
      decayCover(Math.min(COVER_DECAY_MS, Math.max(0, now - lastStampAt)));
    }
    lastStampAt = now;
    gen++;
    if (gen === 0xffffffff) {
      visible.fill(0);
      if (sight) sight.fill(0);
      gen = 1;
    }
    const world = input.world;
    if (world) {
      const n = world.count | 0;
      const carried = world.carriedBy;
      for (let i = 0; i < n; i++) {
        if (!world.alive[i]) continue;
        if (carried && carried[i] >= 0) continue;
        if (!isAlly(localPlayerId, world.owner[i])) continue;
        stampWorld(
          fx.toFloat(world.px[i]),
          fx.toFloat(world.py[i]),
          visionTilesForUnitType(world.type[i]),
        );
      }
    }
    const buildings = input.buildings;
    if (buildings) {
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (!isAlly(localPlayerId, b.owner)) continue;
        stampWorld(b.x, b.z, visionTilesForBuilding(b.type));
      }
    }
    const agoras = input.agoras;
    if (agoras) {
      for (let i = 0; i < agoras.length; i++) {
        const a = agoras[i];
        if (!isAlly(localPlayerId, a.owner)) continue;
        stampWorld(a.x, a.z, visionTilesForBuilding('agora'));
      }
    }
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
      const ally = isAlly(localPlayerId, item.owner);
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
      if (liveKeys.has(key) && isAlly(localPlayerId, ghost.owner)) continue;
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

  function layerAlphas(seen) {
    if (seen <= 0) return { unseen: 255, visited: 0, lift: 0 };
    if (seen >= 255) return { unseen: 0, visited: 0, lift: 255 };
    if (seen <= VISITED_COVER) {
      const t = seen / VISITED_COVER;
      return {
        unseen: Math.round(255 * (1 - t)),
        visited: Math.round(255 * t),
        lift: 0,
      };
    }
    const t = (seen - VISITED_COVER) / (255 - VISITED_COVER);
    return {
      unseen: 0,
      visited: Math.round(255 * (1 - t)),
      lift: Math.round(255 * t),
    };
  }

  function writeLayer(buf, o, alpha) {
    buf[o] = 255;
    buf[o + 1] = 255;
    buf[o + 2] = 255;
    buf[o + 3] = alpha;
  }

  function paintPixels() {
    if (!pixels || !visitedPixels || !liftPixels) return;
    pixels.fill(0);
    visitedPixels.fill(0);
    liftPixels.fill(0);
    if (!cover && !visible) return;
    const scale = FOG_TEX_SCALE;
    const srcH = height * scale;
    const srcW = width * scale;
    for (let sz = 0; sz < srcH; sz++) {
      const dstRow = sz * texW;
      const fz = (sz + 0.5) / scale - 0.5;
      for (let sx = 0; sx < srcW; sx++) {
        const o = (dstRow + sx) * 4;
        const fx = (sx + 0.5) / scale - 0.5;
        const seen = cover
          ? sampleCover(fx, fz)
          : visible && visible[Math.round(fz) * width + Math.round(fx)] === gen
            ? 255
            : 0;
        const layers = layerAlphas(seen);
        writeLayer(pixels, o, layers.unseen);
        writeLayer(visitedPixels, o, layers.visited);
        writeLayer(liftPixels, o, layers.lift);
      }
    }
  }

  function bindOneOpacity(mat, next) {
    if (!mat || !next) return;
    setStandardOpacityTexture(mat, next);
    mat.opacityFromRGB = false;
    // Blend, don't cutoff — bilinear then fades the tile stairs for free.
    if ('alphaCutOff' in mat) mat.alphaCutOff = 0;
    markMaterialUboDirty?.(mat);
  }

  function writeOpacityTexture(prev, data) {
    if (prev && tryWriteTexture(engine, prev, data, texW, texH)) return prev;
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
    if (!engine || !pixels || !visitedPixels || !liftPixels || !texW || !texH) return;
    paintPixels();
    texture = writeOpacityTexture(texture, pixels);
    visitedTexture = writeOpacityTexture(visitedTexture, visitedPixels);
    liftTexture = writeOpacityTexture(liftTexture, liftPixels);
    bindOneOpacity(material, texture);
    bindOneOpacity(visitedMaterial, visitedTexture);
    bindOneOpacity(liftMaterial, liftTexture);
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
    liftMaterial = createOverlayMaterial(SIGHT_LIFT_DIFFUSE, SIGHT_LIFT_ALPHA);
    mesh = addOverlayMesh('fog-of-war', pos, normals, idx, uv, material);
    visitedMesh = addOverlayMesh(
      'fog-visited',
      pos.slice(),
      normals.slice(),
      idx.slice(),
      uv.slice(),
      visitedMaterial,
    );
    liftMesh = addOverlayMesh(
      'fog-sight-lift',
      pos.slice(),
      normals.slice(),
      idx.slice(),
      uv.slice(),
      liftMaterial,
    );
    if (visitedMesh.position) visitedMesh.position.y = 0.03;
    if (liftMesh.position) liftMesh.position.y = 0.05;
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
    if (liftMesh) softDetachMesh(scene, liftMesh);
    mesh = null;
    material = null;
    visitedMesh = null;
    visitedMaterial = null;
    liftMesh = null;
    liftMaterial = null;
    disposeTexture(texture);
    disposeTexture(visitedTexture);
    disposeTexture(liftTexture);
    texture = null;
    visitedTexture = null;
    liftTexture = null;
    pixels = null;
    visitedPixels = null;
    liftPixels = null;
    texW = 0;
    texH = 0;
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
    liftPixels = new Uint8Array(texW * texH * 4);
    buildOverlayMesh();
  }

  function syncOverlay() {
    if (!mesh || !material) return;
    mesh.visible = enabled;
    if (visitedMesh) visitedMesh.visible = enabled;
    if (liftMesh) liftMesh.visible = enabled;
    if (!enabled) return;
    uploadTexture();
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
    overlayAlphaAt,
    fogFactorAt,
  };
}
