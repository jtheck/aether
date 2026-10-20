// Stone material for procedural curtain walls. Geometry lives in wallGeom.js.

import {
  createMeshFromData,
  createStandardMaterial,
  createTexture2DFromPixels,
  getOrCreateSampler,
  loadTexture2D,
  markMaterialUboDirty,
} from '../vendor/lite/liteVendor.js';
import { buildWallGeometry } from './wallGeom.js';
import { softDetachMesh } from './meshLifecycle.js';

const CASTLE_URL = '/assets/textures/castle.png';
const DUNGEON_URL = '/assets/textures/dungeon.png';

const textures = new WeakMap();
const brickTextures = new WeakMap();
const woodTextures = new WeakMap();
const paintedTextures = new WeakMap();
const paintedReady = new WeakMap();
const meshesByMaterial = new WeakMap();

function clamp8(n) {
  const v = n < 0 ? 0 : n > 255 ? 255 : n;
  return v | 0;
}

function hash01(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967296;
}

/** Repeating ashlar. 128² tiles on a 32px block so the mortar meets at the edges. */
export function stonePixels(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  const block = 32;
  const mortar = 3;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / block);
    const stagger = (row & 1) ? (block >> 1) : 0;
    const inCourse = (y % block) < mortar;
    for (let x = 0; x < size; x++) {
      const sx = (x + stagger) % block;
      const joint = inCourse || sx < mortar;
      const o = (y * size + x) * 4;
      if (joint) {
        pixels[o] = 98;
        pixels[o + 1] = 90;
        pixels[o + 2] = 76;
      } else {
        const n = hash01(Math.floor((x + stagger) / block), row);
        const lift = (n - 0.5) * 30;
        const warm = n > 0.84 ? 12 : 0;
        pixels[o] = clamp8(170 + lift + warm);
        pixels[o + 1] = clamp8(158 + lift * 0.82);
        pixels[o + 2] = clamp8(134 + lift * 0.5);
      }
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

function stoneTexture(engine) {
  let texture = textures.get(engine);
  if (texture) return texture;
  const size = 128;
  texture = createTexture2DFromPixels(engine, stonePixels(size), size, size, {
    srgb: true,
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  texture.sampler = getOrCreateSampler(engine, {
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
  textures.set(engine, texture);
  return texture;
}

function stoneMaterial(texture, ghost, diffuse) {
  const mat = createStandardMaterial();
  mat.diffuseTexture = texture;
  mat.diffuseColor = diffuse;
  mat.ambientColor = ghost ? [0.35, 0.32, 0.28] : [0.34, 0.31, 0.26];
  mat.emissiveColor = ghost ? [0.08, 0.06, 0.04] : [0.02, 0.016, 0.012];
  mat.specularColor = [0.04, 0.04, 0.035];
  mat.specularPower = 24;
  mat.backFaceCulling = true;
  if (ghost) mat.alpha = 0.55;
  return mat;
}

/** Two oak boards across the texture. Grain runs the full height, once. */
export function doorWoodPixels(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  const plank = size >> 1;
  const seam = 5;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const grain = Math.sin(v * Math.PI * 7) * 0.45
      + Math.sin(v * Math.PI * 18 + 0.7) * 0.35
      + Math.sin(v * Math.PI * 3) * 0.2;
    for (let x = 0; x < size; x++) {
      const board = (x / plank) | 0;
      const sx = x - board * plank;
      const inSeam = sx < seam || sx >= plank - seam;
      const n = hash01(board, 11);
      const o = (y * size + x) * 4;
      if (inSeam) {
        pixels[o] = 48;
        pixels[o + 1] = 28;
        pixels[o + 2] = 16;
      } else {
        const tone = (n - 0.5) * 28 + grain * 22;
        const warm = board ? 8 : 0;
        pixels[o] = clamp8(132 + tone + warm);
        pixels[o + 1] = clamp8(78 + tone * 0.55);
        pixels[o + 2] = clamp8(36 + tone * 0.28);
      }
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

function doorWoodTexture(engine) {
  let texture = woodTextures.get(engine);
  if (texture) return texture;
  const size = 128;
  texture = createTexture2DFromPixels(engine, doorWoodPixels(size), size, size, {
    srgb: true,
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  texture.sampler = getOrCreateSampler(engine, {
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
  woodTextures.set(engine, texture);
  return texture;
}

function flatMaterial(diffuse, ambient, specular = [0.05, 0.04, 0.03]) {
  const mat = createStandardMaterial();
  mat.diffuseColor = diffuse;
  mat.ambientColor = ambient;
  mat.emissiveColor = [0.02, 0.015, 0.01];
  mat.specularColor = specular;
  mat.specularPower = 18;
  mat.backFaceCulling = true;
  return mat;
}

/** Smaller grey stone courses. 128² tiles on a 32×16 block. */
export function brickPixels(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  const bw = 32;
  const bh = 16;
  const mortar = 2;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / bh);
    const stagger = (row & 1) ? (bw >> 1) : 0;
    const inCourse = (y % bh) < mortar;
    for (let x = 0; x < size; x++) {
      const sx = (x + stagger) % bw;
      const joint = inCourse || sx < mortar;
      const o = (y * size + x) * 4;
      if (joint) {
        pixels[o] = 72;
        pixels[o + 1] = 70;
        pixels[o + 2] = 66;
      } else {
        const n = hash01(Math.floor((x + stagger) / bw), row);
        const lift = (n - 0.5) * 22;
        const soot = n > 0.92 ? -16 : 0;
        pixels[o] = clamp8(124 + lift + soot);
        pixels[o + 1] = clamp8(120 + lift + soot);
        pixels[o + 2] = clamp8(112 + lift * 0.9 + soot);
      }
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

function brickTexture(engine) {
  let texture = brickTextures.get(engine);
  if (texture) return texture;
  const size = 128;
  texture = createTexture2DFromPixels(engine, brickPixels(size), size, size, {
    srgb: true,
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  texture.sampler = getOrCreateSampler(engine, {
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
  brickTextures.set(engine, texture);
  return texture;
}

function wallRepeatSampler(engine) {
  return getOrCreateSampler(engine, {
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
}

function loadWallPaint(engine) {
  let pending = paintedTextures.get(engine);
  if (pending) return pending;
  const sampler = wallRepeatSampler(engine);
  const load = (url) => loadTexture2D(engine, url, {
    srgb: true,
    mipMaps: true,
    invertY: false,
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
  }).then((texture) => {
    texture.sampler = sampler;
    return texture;
  });
  pending = Promise.all([load(CASTLE_URL), load(DUNGEON_URL)]).then(([castle, dungeon]) => {
    const paint = { castle, dungeon };
    paintedReady.set(engine, paint);
    return paint;
  });
  paintedTextures.set(engine, pending);
  pending.catch(() => paintedTextures.delete(engine));
  return pending;
}

function trackWallMesh(material, mesh) {
  if (!material || !mesh) return;
  let bound = meshesByMaterial.get(material);
  if (!bound) {
    bound = new Set();
    meshesByMaterial.set(material, bound);
  }
  bound.add(mesh);
}

/**
 * The bind group keeps the texture it saw when the mesh was first drawn.
 * Swapping diffuseTexture on that same material leaves the generated stone
 * on screen, so a mesh that already exists gets a new material.
 */
function usePaint(mat, texture) {
  if (!mat || !texture || mat.diffuseTexture === texture) return;
  mat.diffuseTexture = texture;
  markMaterialUboDirty?.(mat);
  const bound = meshesByMaterial.get(mat);
  if (!bound?.size) return;
  const next = stoneMaterial(texture, mat.alpha < 1, mat.diffuseColor.slice());
  next.ambientColor = mat.ambientColor;
  next.emissiveColor = mat.emissiveColor;
  next.specularColor = mat.specularColor;
  next.specularPower = mat.specularPower;
  next.alpha = mat.alpha;
  next.backFaceCulling = mat.backFaceCulling;
  for (const mesh of bound) {
    if (mesh.visible === false) {
      bound.delete(mesh);
      continue;
    }
    if (mesh.material !== mat) continue;
    mesh.material = next;
  }
  if (!bound.size) {
    meshesByMaterial.delete(mat);
    return;
  }
  meshesByMaterial.delete(mat);
  meshesByMaterial.set(next, bound);
}

export function createWallMaterials(engine) {
  const ready = paintedReady.get(engine);
  const castleTex = ready?.castle ?? stoneTexture(engine);
  const dungeonTex = ready?.dungeon ?? brickTexture(engine);
  const mats = {
    castle: stoneMaterial(castleTex, false, [1, 1, 1]),
    dungeon: stoneMaterial(dungeonTex, false, [1, 1, 1]),
    castleGhost: stoneMaterial(castleTex, true, [0.85, 0.92, 0.8]),
    dungeonGhost: stoneMaterial(dungeonTex, true, [0.78, 0.8, 0.78]),
    wood: stoneMaterial(doorWoodTexture(engine), false, [0.92, 0.78, 0.58]),
    iron: flatMaterial([0.34, 0.36, 0.38], [0.12, 0.13, 0.14], [0.28, 0.28, 0.3]),
  };
  if (!ready) {
    loadWallPaint(engine).then((paint) => {
      usePaint(mats.castle, paint.castle);
      usePaint(mats.castleGhost, paint.castle);
      usePaint(mats.dungeon, paint.dungeon);
      usePaint(mats.dungeonGhost, paint.dungeon);
    }).catch((err) => {
      console.warn('[walls] castle/dungeon textures failed', err);
    });
  }
  return mats;
}

export function createWallMesh(engine, name, geometry, material, { shadows = false } = {}) {
  if (!geometry?.positions?.length) return null;
  const mesh = createMeshFromData(
    engine,
    name,
    geometry.positions,
    geometry.normals,
    geometry.indices,
    geometry.uvs,
  );
  mesh.material = material;
  mesh.pickable = false;
  mesh.receiveShadows = shadows;
  trackWallMesh(material, mesh);
  return mesh;
}

const WALL_PARTS = [
  ['wall-castle', 'castle', 'castle'],
  ['wall-dungeon', 'dungeon', 'dungeon'],
  ['wall-wood', 'wood', 'wood'],
  ['wall-iron', 'iron', 'iron'],
];

/**
 * Match meshes for field.walls. The forge draws its own copies and passes skipWalls.
 * @param {object} engine
 * @param {object | null | undefined} scene
 * @param {object | null | undefined} field
 * @param {(x: number, z: number) => number} [sampleHeight]
 */
export async function createCurtainWalls(engine, scene, field, sampleHeight) {
  const runs = field?.walls?.runs;
  if (!engine || !runs?.length) return { meshes: [], dispose() {} };
  try {
    await loadWallPaint(engine);
  } catch (err) {
    console.warn('[walls] castle/dungeon textures failed', err);
  }
  const geom = buildWallGeometry(runs, field.walls.style, sampleHeight);
  const mats = createWallMaterials(engine);
  const meshes = [];
  let woodMesh = null;
  for (let i = 0; i < WALL_PARTS.length; i++) {
    const [name, part, mat] = WALL_PARTS[i];
    const mesh = createWallMesh(engine, name, geom[part], mats[mat], { shadows: true });
    if (!mesh) continue;
    meshes.push(mesh);
    if (name === 'wall-wood') woodMesh = mesh;
  }
  let disposed = false;
  return {
    meshes,
    /** Rebuild the door leaves after a shut door is broken open. */
    syncWood(nextField) {
      if (disposed) return null;
      const runsNow = nextField?.walls?.runs;
      if (!runsNow?.length) return woodMesh;
      const next = buildWallGeometry(runsNow, nextField.walls.style, sampleHeight);
      if (woodMesh) {
        softDetachMesh(scene, woodMesh);
        const at = meshes.indexOf(woodMesh);
        if (at >= 0) meshes.splice(at, 1);
        woodMesh = null;
      }
      woodMesh = createWallMesh(engine, 'wall-wood', next.wood, mats.wood, { shadows: true });
      if (woodMesh) meshes.push(woodMesh);
      return woodMesh;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = 0; i < meshes.length; i++) softDetachMesh(scene, meshes[i]);
      meshes.length = 0;
      woodMesh = null;
    },
  };
}
