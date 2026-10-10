// Stone material for procedural curtain walls. Geometry lives in wallGeom.js.

import {
  createMeshFromData,
  createStandardMaterial,
  createTexture2DFromPixels,
  getOrCreateSampler,
} from '../vendor/lite/liteVendor.js';

const textures = new WeakMap();
const brickTextures = new WeakMap();
const woodTextures = new WeakMap();

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

/** Vertical oak planks. One repeat across is one board; grain runs up V. */
export function doorWoodPixels(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  const plank = 32;
  const seam = 3;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const grain = Math.sin(v * Math.PI * 10) * 0.55
      + Math.sin(v * Math.PI * 23 + 1.7) * 0.3
      + Math.sin(v * Math.PI * 47) * 0.15;
    for (let x = 0; x < size; x++) {
      const sx = x % plank;
      const inSeam = sx < seam || sx > plank - 2;
      const n = hash01((x / plank) | 0, 3);
      const o = (y * size + x) * 4;
      if (inSeam) {
        pixels[o] = 62;
        pixels[o + 1] = 38;
        pixels[o + 2] = 22;
      } else {
        const tone = (n - 0.5) * 18 + grain * 16;
        pixels[o] = clamp8(148 + tone);
        pixels[o + 1] = clamp8(96 + tone * 0.72);
        pixels[o + 2] = clamp8(52 + tone * 0.4);
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

export function createWallMaterials(engine) {
  const castleTex = stoneTexture(engine);
  const dungeonTex = brickTexture(engine);
  return {
    castle: stoneMaterial(castleTex, false, [1.08, 1.02, 0.94]),
    dungeon: stoneMaterial(dungeonTex, false, [1, 0.99, 0.97]),
    castleGhost: stoneMaterial(castleTex, true, [0.85, 0.92, 0.8]),
    dungeonGhost: stoneMaterial(dungeonTex, true, [0.78, 0.8, 0.78]),
    wood: stoneMaterial(doorWoodTexture(engine), false, [0.92, 0.78, 0.58]),
    iron: flatMaterial([0.34, 0.36, 0.38], [0.12, 0.13, 0.14], [0.28, 0.28, 0.3]),
  };
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
  return mesh;
}
