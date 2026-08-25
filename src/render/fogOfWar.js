// Client-only fog of war. Vision is a 20 Hz tile stamp — not in lockstep/checksums.
// Map stays visible and is dimmed outside current sight. Hostile units hide.
// Enemy buildings hide until seen, then freeze as last-known while fogged.

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
/** Overlay fragment alpha on fogged tiles — dim, not a black sheet. */
const FOG_MESH_ALPHA = 0.4;
const OVERLAY_LIFT = 0.18;
const TEXEL_ALIGN = 64;
/** Overlay-only skirt past the hard vision circle. Gameplay hide stays binary. */
const EDGE_FADE_TILES = 3;
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
  /** Overlay coverage 0–255 (255 = fully seen). Soft edge only — not used to hide. */
  /** @type {Uint8Array | null} */
  let cover = null;
  let gen = 1;
  let enabled = false;
  let localPlayerId = 0;
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
  let texture = null;
  /** @type {Uint8Array | null} */
  let pixels = null;
  let texW = 0;
  let texH = 0;

  function clearVision() {
    width = field?.width | 0;
    height = field?.height | 0;
    half = field ? worldHalfFFromField(field) : 0;
    const n = width * height;
    if (!visible || visible.length !== n) visible = n ? new Uint32Array(n) : null;
    else visible.fill(0);
    if (!cover || cover.length !== n) cover = n ? new Uint8Array(n) : null;
    else cover.fill(0);
    gen = 1;
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

  function hidesHostile(owner, x, z) {
    if (!enabled) return false;
    if (localPlayerId < 0) return false;
    if (isAlly(localPlayerId, owner)) return false;
    return !isWorldVisible(x, z);
  }

  function stampCircle(cx, cz, radiusTiles) {
    if (!visible) return;
    const fade = EDGE_FADE_TILES;
    const outer = radiusTiles + fade;
    const r = Math.ceil(outer);
    const hardR2 = radiusTiles * radiusTiles;
    const outer2 = outer * outer;
    const inner = Math.max(0, radiusTiles - 0.35);
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
        if (d2 <= hardR2) visible[row + tx] = gen;
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
   * }} input
   */
  function stamp(input) {
    localPlayerId = input.localPlayerId ?? localPlayerId;
    enabled = input.enabled !== false && localPlayerId >= 0;
    if (input.field) adoptField(input.field);
    if (!enabled || !field || !visible) {
      if (mesh) mesh.visible = false;
      return;
    }
    gen++;
    if (gen === 0xffffffff) {
      visible.fill(0);
      gen = 1;
    }
    if (cover) cover.fill(0);
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

  /** 0 = fully seen, 1 = fully fogged. Same skirt as the ground overlay. */
  function fogFactorAt(x, z) {
    return overlayAlphaAt(x, z) / 255;
  }

  function coverAt(tx, tz) {
    if (!cover || tx < 0 || tz < 0 || tx >= width || tz >= height) return 0;
    return cover[tz * width + tx];
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

  function paintPixels() {
    if (!pixels) return;
    pixels.fill(255);
    if (!cover && !visible) return;
    const scale = FOG_TEX_SCALE;
    const srcH = height * scale;
    const srcW = width * scale;
    for (let sz = 0; sz < srcH; sz++) {
      const dstRow = sz * texW;
      const fz = (sz + 0.5) / scale - 0.5;
      for (let sx = 0; sx < srcW; sx++) {
        const o = (dstRow + sx) * 4;
        pixels[o] = 255;
        pixels[o + 1] = 255;
        pixels[o + 2] = 255;
        const fx = (sx + 0.5) / scale - 0.5;
        const seen = cover
          ? sampleCover(fx, fz)
          : visible && visible[Math.round(fz) * width + Math.round(fx)] === gen
            ? 255
            : 0;
        pixels[o + 3] = 255 - seen;
      }
    }
  }

  function bindOpacityTexture(next) {
    if (!material) return;
    setStandardOpacityTexture(material, next);
    material.opacityFromRGB = false;
    // Blend, don't cutoff — bilinear then fades the tile stairs for free.
    if ('alphaCutOff' in material) material.alphaCutOff = 0;
    markMaterialUboDirty?.(material);
  }

  function uploadTexture() {
    if (!engine || !pixels || !texW || !texH) return;
    paintPixels();
    if (texture && tryWriteTexture(engine, texture, pixels, texW, texH)) return;
    const next = createTexture2DFromPixels(engine, pixels, texW, texH, {
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
    disposeTexture(texture);
    texture = next;
    bindOpacityTexture(next);
    next.sampler = getOrCreateSampler(engine, {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });
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
    mesh = createMeshFromData(
      engine,
      'fog-of-war',
      pos,
      normals,
      new Uint32Array(indices),
      new Float32Array(uvs),
    );
    material = createStandardMaterial();
    material.diffuseColor = [0.05, 0.07, 0.1];
    material.emissiveColor = [0.03, 0.04, 0.06];
    material.ambientColor = [0, 0, 0];
    material.specularColor = [0, 0, 0];
    material.disableLighting = true;
    material.alpha = FOG_MESH_ALPHA;
    material.backFaceCulling = true;
    mesh.material = material;
    mesh.pickable = false;
    mesh.receiveShadows = false;
    mesh.visible = enabled;
    addToScene(scene, mesh);
    uploadTexture();
  }

  function detachOverlay() {
    if (mesh) softDetachMesh(scene, mesh);
    mesh = null;
    material = null;
    disposeTexture(texture);
    texture = null;
    pixels = null;
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
    buildOverlayMesh();
  }

  function syncOverlay() {
    if (!mesh || !material) return;
    mesh.visible = enabled;
    if (!enabled) return;
    uploadTexture();
  }

  return {
    reset,
    stamp,
    isEnabled: () => enabled,
    isWorldVisible,
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
