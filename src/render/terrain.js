// Lite terrain — atlas tile quads from a sim field snapshot.
// Sim owns generation; this module only builds meshes.

import {
  createMeshFromData,
  createTexture2DFromPixels,
  getOrCreateSampler,
  loadTexture2D as loadLiteTexture2D,
  createStandardMaterial,
  addToScene,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';
import {
  ATLAS,
  HEIGHT_AMPLITUDE,
  TERRAIN,
  TILE_SIZE_F,
  WORLD_HALF_F,
} from '../sim/field.js';
import { createSceneryFromField } from './scenery.js';

const ATLAS_URLS = {
  [ATLAS.GRASS_DIRT]: '/assets/textures/atlas-grass-dirt.png',
  [ATLAS.GRASS_WATER]: '/assets/textures/atlas-grass-water.png',
};

const ATLAS_GRID = 4;
const UV_SCALE = 1 / ATLAS_GRID;
const UV_INSET = 0.01;
const FRAME_THICKNESS = 5.5;
const FRAME_BOTTOM_Y = -9;
const FRAME_TOP_RISE = 0.8;
const FRAME_UV_WORLD_SIZE = 18;

/** @type {WeakMap<object, object>} */
const woodTextures = new WeakMap();

/**
 * @param {import('@babylonjs/lite').EngineContext} engine
 * @param {object} scene
 * @param {{ width: number, height: number, heightMap: Float32Array, terrainTypes: Uint8Array, tileType: Uint8Array, atlasId: Uint8Array }} field
 * @param {object} camera
 * @returns {Promise<{ meshes: object[], update: (camera: object, deltaMs: number) => void, dispose: () => void }>}
 */
export async function createTerrainFromField(engine, scene, field, camera) {
  const textures = await loadAtlasTextures(engine);
  const scenery = await createSceneryFromField(engine, field, surfaceHeightAt, camera);
  const active = createActiveCellLookup(field);
  const built = [
    ...buildEnvironmentMeshes(engine, field),
    ...buildTableFrameMeshes(engine, field, active),
    ...buildAtlasMeshes(engine, field, textures, active),
    ...scenery.meshes,
  ];
  for (const mesh of built) addToScene(scene, mesh);
  return {
    meshes: built,
    update(activeCamera, deltaMs) {
      scenery.update(activeCamera, deltaMs);
    },
    dispose() {
      const list = scene?.meshes;
      if (Array.isArray(list)) {
        for (const mesh of built) {
          const idx = list.indexOf(mesh);
          if (idx >= 0) list.splice(idx, 1);
          mesh.visible = false;
        }
      }
      built.length = 0;
    },
  };
}

async function loadAtlasTextures(engine) {
  /** @type {Map<number, object>} */
  const out = new Map();
  for (const [id, url] of Object.entries(ATLAS_URLS)) {
    out.set(Number(id), await loadTexture2D(engine, url));
  }
  return out;
}

async function loadTexture2D(engine, url) {
  // Mipmaps remove minification shimmer; anisotropy keeps oblique terrain sharp.
  // UVs use image-space V, so preserve the PNG's top-to-bottom orientation.
  const texture = await loadLiteTexture2D(engine, url, {
    srgb: true,
    mipMaps: true,
    invertY: false,
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  texture.sampler = getOrCreateSampler(engine, {
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
  return texture;
}

function buildAtlasMeshes(engine, field, textures, active) {
  const { width, height, heightMap, terrainTypes, tileType, atlasId } = field;
  const buckets = {
    [ATLAS.GRASS_DIRT]: emptyBucket(),
    [ATLAS.GRASS_WATER]: emptyBucket(),
  };

  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (!active(tx, tz)) continue;
      const i = tz * width + tx;
      const aid = atlasId[i];
      const bucket = buckets[aid] ?? buckets[ATLAS.GRASS_DIRT];
      pushTileQuad(bucket, tx, tz, tileType[i], heightMap, terrainTypes, width, height);
    }
  }

  const meshes = [];
  for (const aid of [ATLAS.GRASS_DIRT, ATLAS.GRASS_WATER]) {
    const b = buckets[aid];
    if (b.count === 0) continue;
    const positions = new Float32Array(b.positions);
    const uvs = new Float32Array(b.uvs);
    const indices = new Uint32Array(b.indices);
    // Lite is left-handed (CW front faces). Quads are CW from +Y; normals stay +Y for lighting.
    const normals = flatUpNormals(positions.length / 3);
    const mesh = createMeshFromData(engine, `terrain-${aid}`, positions, normals, indices, uvs);
    const mat = createStandardMaterial();
    mat.diffuseColor = [1.2, 1.2, 1.14];
    // Keep ambient low so sun shadows read on grass (ambient bypasses shadowFactors).
    mat.ambientColor = [0.12, 0.12, 0.1];
    mat.emissiveColor = [0.01, 0.01, 0.008];
    mat.specularColor = [0.06, 0.06, 0.05];
    mat.specularPower = 32;
    mat.diffuseTexture = textures.get(aid) ?? null;
    mat.backFaceCulling = true;
    mesh.material = mat;
    mesh.pickable = false;
    mesh.receiveShadows = true;
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Supports the current rectangular field plus optional future/custom shape masks.
 * A tile mask takes priority; v1-style chunk masks are expanded when present.
 */
function createActiveCellLookup(field) {
  const { width, height } = field;
  const tileMask = field.activeMask ?? field.tileMask ?? field.enabledMask;
  if (tileMask && tileMask.length >= width * height) {
    return (tx, tz) => (
      tx >= 0 && tz >= 0 && tx < width && tz < height &&
      tileMask[tz * width + tx] !== 0
    );
  }

  const chunkMask = field.chunkMask;
  const chunkSize = Number(field.chunkSize) || 16;
  if (chunkMask && typeof chunkMask.get === 'function') {
    return (tx, tz) => {
      if (tx < 0 || tz < 0 || tx >= width || tz >= height) return false;
      const cx = Math.floor(tx / chunkSize);
      const cz = Math.floor(tz / chunkSize);
      return chunkMask.get(`${cx},${cz}`) !== false;
    };
  }

  return (tx, tz) => tx >= 0 && tz >= 0 && tx < width && tz < height;
}

function buildTableFrameMeshes(engine, field, active) {
  const { width, height, heightMap, terrainTypes } = field;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const cornerPositions = [];
  const cornerNormals = [];
  const cornerUvs = [];
  const cornerIndices = [];
  const boundaryEdges = [];
  let highestBoundary = 0;

  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (!active(tx, tz)) continue;
      const x0 = tx * TILE_SIZE_F - WORLD_HALF_F;
      const x1 = x0 + TILE_SIZE_F;
      const z0 = tz * TILE_SIZE_F - WORLD_HALF_F;
      const z1 = z0 + TILE_SIZE_F;

      if (!active(tx, tz - 1)) {
        const ah = sampleHeight(heightMap, terrainTypes, width, height, tx, tz);
        const bh = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz);
        boundaryEdges.push([x0, z0, x1, z0, 0, -1]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx + 1, tz)) {
        const ah = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz);
        const bh = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz + 1);
        boundaryEdges.push([x1, z0, x1, z1, 1, 0]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx, tz + 1)) {
        const ah = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz + 1);
        const bh = sampleHeight(heightMap, terrainTypes, width, height, tx, tz + 1);
        boundaryEdges.push([x1, z1, x0, z1, 0, 1]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx - 1, tz)) {
        const ah = sampleHeight(heightMap, terrainTypes, width, height, tx, tz + 1);
        const bh = sampleHeight(heightMap, terrainTypes, width, height, tx, tz);
        boundaryEdges.push([x0, z1, x0, z0, -1, 0]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
    }
  }

  // A pool-table frame is rigid: every rail and corner shares one horizontal top.
  const frameInnerY = highestBoundary + 0.12;
  for (const edge of mergeBoundaryEdges(boundaryEdges)) {
    pushFrameSegment(positions, normals, uvs, indices, ...edge, frameInnerY);
  }

  // Distinct corner blocks retain v1's board-game silhouette and close rail joins.
  for (let cz = 0; cz <= height; cz++) {
    for (let cx = 0; cx <= width; cx++) {
      const nw = active(cx - 1, cz - 1);
      const ne = active(cx, cz - 1);
      const se = active(cx, cz);
      const sw = active(cx - 1, cz);
      const count = Number(nw) + Number(ne) + Number(se) + Number(sw);
      if (count !== 1 && count !== 3) continue;
      const x = cx * TILE_SIZE_F - WORLD_HALF_F;
      const z = cz * TILE_SIZE_F - WORLD_HALF_F;
      const top = frameInnerY + FRAME_TOP_RISE * 1.35;
      pushBox(
        cornerPositions, cornerNormals, cornerUvs, cornerIndices,
        x, z, FRAME_THICKNESS * 2.1, top, FRAME_BOTTOM_Y,
      );
    }
  }

  const meshes = [];
  const wood = getWoodTexture(engine);
  if (positions.length > 0) {
    const mesh = createMeshFromData(
      engine,
      'table-frame-edges',
      new Float32Array(positions),
      new Float32Array(normals),
      new Uint32Array(indices),
      new Float32Array(uvs),
    );
    mesh.material = createWoodMaterial(wood, false);
    mesh.pickable = false;
    meshes.push(mesh);
  }
  if (cornerPositions.length > 0) {
    const mesh = createMeshFromData(
      engine,
      'table-frame-corners',
      new Float32Array(cornerPositions),
      new Float32Array(cornerNormals),
      new Uint32Array(cornerIndices),
      new Float32Array(cornerUvs),
    );
    mesh.material = createWoodMaterial(wood, true);
    mesh.pickable = false;
    meshes.push(mesh);
  }
  return meshes;
}

/** Collapse tile-sized boundary pieces into one mesh segment per straight run. */
function mergeBoundaryEdges(edges) {
  const groups = new Map();
  for (const [ax, az, bx, bz, ox, oz] of edges) {
    const horizontal = az === bz;
    const fixed = horizontal ? az : ax;
    const start = horizontal ? Math.min(ax, bx) : Math.min(az, bz);
    const end = horizontal ? Math.max(ax, bx) : Math.max(az, bz);
    const key = `${horizontal ? 'h' : 'v'}:${fixed}:${ox}:${oz}`;
    let group = groups.get(key);
    if (!group) {
      group = { horizontal, fixed, ox, oz, spans: [] };
      groups.set(key, group);
    }
    group.spans.push([start, end]);
  }

  const merged = [];
  for (const group of groups.values()) {
    group.spans.sort((a, b) => a[0] - b[0]);
    let start = group.spans[0][0];
    let end = group.spans[0][1];
    const emit = () => {
      if (group.horizontal) {
        if (group.oz < 0) merged.push([start, group.fixed, end, group.fixed, group.ox, group.oz]);
        else merged.push([end, group.fixed, start, group.fixed, group.ox, group.oz]);
      } else if (group.ox > 0) {
        merged.push([group.fixed, start, group.fixed, end, group.ox, group.oz]);
      } else {
        merged.push([group.fixed, end, group.fixed, start, group.ox, group.oz]);
      }
    };
    for (let i = 1; i < group.spans.length; i++) {
      const span = group.spans[i];
      if (span[0] <= end + 1e-6) {
        end = Math.max(end, span[1]);
      } else {
        emit();
        start = span[0];
        end = span[1];
      }
    }
    emit();
  }
  return merged;
}

function pushFrameSegment(pos, norm, uv, idx, ax, az, bx, bz, ox, oz, topY) {
  const base = pos.length / 3;
  const len = Math.hypot(bx - ax, bz - az);
  const outerTop = topY + FRAME_TOP_RISE;
  const aox = ax + ox * FRAME_THICKNESS;
  const aoz = az + oz * FRAME_THICKNESS;
  const box = boxLikeSegmentVertices(
    ax, topY, az, bx, topY, bz,
    aox, outerTop, aoz, bx + ox * FRAME_THICKNESS, outerTop, bz + oz * FRAME_THICKNESS,
  );
  pos.push(...box);

  // Four independent quads: bevel top, outer wall, inner wall, underside.
  pushFaceNormals(norm, 0, 1, 0);
  pushFaceNormals(norm, ox, 0, oz);
  pushFaceNormals(norm, -ox, 0, -oz);
  pushFaceNormals(norm, 0, -1, 0);
  const uLen = len / FRAME_UV_WORLD_SIZE;
  uv.push(
    0, 0, uLen, 0, uLen, 1, 0, 1,
    0, 0, uLen, 0, uLen, 0.65, 0, 0.65,
    0, 0, uLen, 0, uLen, 0.65, 0, 0.65,
    0, 0, uLen, 0, uLen, 1, 0, 1,
  );
  for (let face = 0; face < 4; face++) {
    const o = base + face * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
}

function boxLikeSegmentVertices(ax, ay, az, bx, by, bz, aox, aoy, aoz, box, boy, boz) {
  return [
    // top
    ax, ay, az, bx, by, bz, box, boy, boz, aox, aoy, aoz,
    // outer
    aox, aoy, aoz, box, boy, boz, box, FRAME_BOTTOM_Y, boz, aox, FRAME_BOTTOM_Y, aoz,
    // inner
    bx, by, bz, ax, ay, az, ax, FRAME_BOTTOM_Y, az, bx, FRAME_BOTTOM_Y, bz,
    // underside
    aox, FRAME_BOTTOM_Y, aoz, box, FRAME_BOTTOM_Y, boz,
    bx, FRAME_BOTTOM_Y, bz, ax, FRAME_BOTTOM_Y, az,
  ];
}

function pushFaceNormals(normals, x, y, z) {
  for (let i = 0; i < 4; i++) normals.push(x, y, z);
}

function pushBox(pos, norm, uv, idx, x, z, size, top, bottom) {
  const h = top - bottom;
  const half = size * 0.5;
  const x0 = x - half;
  const x1 = x + half;
  const z0 = z - half;
  const z1 = z + half;
  const base = pos.length / 3;
  const faces = [
    [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [0, 1, 0]],
    [[x1, top, z0], [x0, top, z0], [x0, bottom, z0], [x1, bottom, z0], [0, 0, -1]],
    [[x1, top, z1], [x1, top, z0], [x1, bottom, z0], [x1, bottom, z1], [1, 0, 0]],
    [[x0, top, z1], [x1, top, z1], [x1, bottom, z1], [x0, bottom, z1], [0, 0, 1]],
    [[x0, top, z0], [x0, top, z1], [x0, bottom, z1], [x0, bottom, z0], [-1, 0, 0]],
  ];
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    for (let v = 0; v < 4; v++) pos.push(...face[v]);
    pushFaceNormals(norm, ...face[4]);
    const u = size / FRAME_UV_WORLD_SIZE;
    const v = (f === 0 ? size : h) / FRAME_UV_WORLD_SIZE;
    uv.push(0, 0, u, 0, u, v, 0, v);
    const o = base + f * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
}

function getWoodTexture(engine) {
  let texture = woodTextures.get(engine);
  if (texture) return texture;
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const broad = Math.sin(v * 5 + Math.sin(u) * 1.4 + Math.sin(u * 3) * 0.35);
      const fine = Math.sin(v * 17 + Math.sin(u * 2) * 2.2) * 0.28;
      const knot = Math.exp(-18 * (
        Math.sin(u * 0.5) ** 2 + Math.sin(v * 0.5 - u * 0.12) ** 2
      ));
      const grain = broad * 0.55 + fine - knot * 0.8;
      const o = (y * size + x) * 4;
      pixels[o] = Math.max(0, Math.min(255, 126 + grain * 34));
      pixels[o + 1] = Math.max(0, Math.min(255, 67 + grain * 20));
      pixels[o + 2] = Math.max(0, Math.min(255, 31 + grain * 11));
      pixels[o + 3] = 255;
    }
  }
  texture = createTexture2DFromPixels(engine, pixels, size, size, {
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

function createWoodMaterial(texture, dark) {
  const mat = createStandardMaterial();
  mat.diffuseTexture = texture;
  mat.diffuseColor = dark ? [0.68, 0.49, 0.32] : [0.9, 0.72, 0.5];
  mat.ambientColor = dark ? [0.24, 0.14, 0.08] : [0.34, 0.21, 0.12];
  mat.emissiveColor = [0.025, 0.012, 0.006];
  mat.specularColor = [0.16, 0.11, 0.07];
  mat.specularPower = 48;
  mat.backFaceCulling = false;
  return mat;
}

function buildEnvironmentMeshes(engine, field) {
  const worldWidth = field.width * TILE_SIZE_F;
  const worldHeight = field.height * TILE_SIZE_F;
  const boardRadius = Math.hypot(worldWidth, worldHeight) * 0.5;
  return [buildMountainRing(engine, field.seed ?? 0, boardRadius)];
}

function buildMountainRing(engine, seed, boardRadius) {
  const segments = 112;
  const radii = [boardRadius * 1.38, boardRadius * 1.85, boardRadius * 2.7, boardRadius * 3.5];
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring < radii.length; ring++) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const wave =
        Math.sin(a * 7 + seed * 0.017) * 0.48 +
        Math.sin(a * 13 - seed * 0.011) * 0.27 +
        Math.cos(a * 23 + seed * 0.007) * 0.13;
      let y = -84;
      if (ring === 1) y = -18 + wave * 82;
      else if (ring === 2) y = 18 + wave * 142;
      else if (ring === 3) y = -8 + wave * 105;
      const radius = radii[ring] * (1 + wave * 0.045);
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      uvs.push(s / 12, ring / (radii.length - 1));
    }
  }
  const stride = segments + 1;
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = ring * stride + s;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.push(a, b, c, a, c, d);
    }
  }
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const normals = computeSmoothNormals(pos, idx);
  const mesh = createMeshFromData(
    engine,
    'distant-mountains',
    pos,
    normals,
    idx,
    new Float32Array(uvs),
  );
  const mat = createStandardMaterial();
  mat.diffuseColor = [0.11, 0.18, 0.19];
  mat.ambientColor = [0.09, 0.15, 0.17];
  mat.emissiveColor = [0.018, 0.04, 0.045];
  mat.specularColor = [0.025, 0.04, 0.045];
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

function computeSmoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    // Lite is left-handed; use AC × AB so normals match its clockwise front faces.
    const nx = acy * abz - acz * aby;
    const ny = acz * abx - acx * abz;
    const nz = acx * aby - acy * abx;
    for (const o of [ia, ib, ic]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

function emptyBucket() {
  return { positions: [], uvs: [], indices: [], count: 0 };
}

function pushTileQuad(bucket, tx, tz, atlasCell, heightMap, terrainTypes, width, height) {
  const col = atlasCell % ATLAS_GRID;
  const row = (atlasCell / ATLAS_GRID) | 0;
  // Image-space UVs: row 0 is top of PNG (V=0), matching pixel upload.
  const u1 = col * UV_SCALE + UV_INSET;
  const u2 = (col + 1) * UV_SCALE - UV_INSET;
  const vTop = row * UV_SCALE + UV_INSET;
  const vBot = (row + 1) * UV_SCALE - UV_INSET;

  const x1 = tx * TILE_SIZE_F - WORLD_HALF_F;
  const x2 = (tx + 1) * TILE_SIZE_F - WORLD_HALF_F;
  const z1 = tz * TILE_SIZE_F - WORLD_HALF_F;
  const z2 = (tz + 1) * TILE_SIZE_F - WORLD_HALF_F;

  const y00 = sampleHeight(heightMap, terrainTypes, width, height, tx, tz);
  const y10 = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz);
  const y11 = sampleHeight(heightMap, terrainTypes, width, height, tx + 1, tz + 1);
  const y01 = sampleHeight(heightMap, terrainTypes, width, height, tx, tz + 1);

  const base = bucket.count * 4;
  // BL, BR, TR, TL — CW from +Y (Lite left-handed front faces).
  bucket.positions.push(x1, y00, z1, x2, y10, z1, x2, y11, z2, x1, y01, z2);
  bucket.uvs.push(u1, vBot, u2, vBot, u2, vTop, u1, vTop);
  bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  bucket.count++;
}

function sampleHeight(heightMap, terrainTypes, width, height, cx, cz) {
  const tx = cx <= 0 ? 0 : cx >= width ? width - 1 : cx;
  const tz = cz <= 0 ? 0 : cz >= height ? height - 1 : cz;
  const i = tz * width + tx;
  // Keep water slightly lower so shore reads clearly without v1 shoreline snap.
  if (terrainTypes[i] === TERRAIN.WATER) return heightMap[i] * HEIGHT_AMPLITUDE * 0.35;
  return heightMap[i] * HEIGHT_AMPLITUDE;
}

/** World-space surface Y matching terrain mesh corners (bilinear). */
export function surfaceHeightAt(field, x, z) {
  if (!field?.heightMap) return 0;
  const { width, height, heightMap, terrainTypes } = field;
  const fx = (x + WORLD_HALF_F) / TILE_SIZE_F;
  const fz = (z + WORLD_HALF_F) / TILE_SIZE_F;
  const tx0 = Math.floor(fx);
  const tz0 = Math.floor(fz);
  const tx1 = tx0 + 1;
  const tz1 = tz0 + 1;
  const u = fx - tx0;
  const v = fz - tz0;
  const h00 = sampleHeight(heightMap, terrainTypes, width, height, tx0, tz0);
  const h10 = sampleHeight(heightMap, terrainTypes, width, height, tx1, tz0);
  const h01 = sampleHeight(heightMap, terrainTypes, width, height, tx0, tz1);
  const h11 = sampleHeight(heightMap, terrainTypes, width, height, tx1, tz1);
  return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
}

function flatUpNormals(vertexCount) {
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    normals[i * 3 + 1] = 1;
  }
  return normals;
}

const GRID_LIFT = 0.12;
const BLOCK_LIFT = 0.06;
const GRID_HALF = 0.05;
const BLOCK_INSET = 0.15;

/**
 * Dev overlay: cyan tile edges + magenta fills on impassable cells.
 * @returns {{ setVisible: (on: boolean) => void, dispose: () => void }}
 */
export function createTileGridOverlay(engine, scene, field) {
  const { width, height, heightMap, terrainTypes, pass } = field;
  const edgePos = [];
  const edgeIdx = [];
  let ev = 0;
  const blockPos = [];
  const blockIdx = [];
  let bv = 0;

  function heightAtCorner(cx, cz) {
    return sampleHeight(heightMap, terrainTypes, width, height, cx, cz) + GRID_LIFT;
  }

  function blockHeightAtCorner(cx, cz) {
    return sampleHeight(heightMap, terrainTypes, width, height, cx, cz) + BLOCK_LIFT;
  }

  function pushEdge(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * GRID_HALF;
    const pz = (dx / len) * GRID_HALF;
    edgePos.push(
      ax + px, ay, az + pz,
      bx + px, by, bz + pz,
      bx - px, by, bz - pz,
      ax - px, ay, az - pz,
    );
    edgeIdx.push(ev, ev + 1, ev + 2, ev, ev + 2, ev + 3);
    ev += 4;
  }

  function pushBlockedQuad(tx, tz) {
    const x0 = tx * TILE_SIZE_F - WORLD_HALF_F + BLOCK_INSET;
    const x1 = (tx + 1) * TILE_SIZE_F - WORLD_HALF_F - BLOCK_INSET;
    const z0 = tz * TILE_SIZE_F - WORLD_HALF_F + BLOCK_INSET;
    const z1 = (tz + 1) * TILE_SIZE_F - WORLD_HALF_F - BLOCK_INSET;
    const y00 = blockHeightAtCorner(tx, tz);
    const y10 = blockHeightAtCorner(tx + 1, tz);
    const y11 = blockHeightAtCorner(tx + 1, tz + 1);
    const y01 = blockHeightAtCorner(tx, tz + 1);
    // CW from +Y
    blockPos.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
    blockIdx.push(bv, bv + 1, bv + 2, bv, bv + 2, bv + 3);
    bv += 4;
  }

  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const x0 = tx * TILE_SIZE_F - WORLD_HALF_F;
      const x1 = (tx + 1) * TILE_SIZE_F - WORLD_HALF_F;
      const z0 = tz * TILE_SIZE_F - WORLD_HALF_F;
      const z1 = (tz + 1) * TILE_SIZE_F - WORLD_HALF_F;
      const y00 = heightAtCorner(tx, tz);
      const y10 = heightAtCorner(tx + 1, tz);
      const y01 = heightAtCorner(tx, tz + 1);
      const y11 = heightAtCorner(tx + 1, tz + 1);
      pushEdge(x0, y00, z0, x1, y10, z0);
      pushEdge(x0, y00, z0, x0, y01, z1);
      if (tx === width - 1) pushEdge(x1, y10, z0, x1, y11, z1);
      if (tz === height - 1) pushEdge(x0, y01, z1, x1, y11, z1);

      if (pass && pass[tz * width + tx] === 0) pushBlockedQuad(tx, tz);
    }
  }

  const edgeMesh = makeDevMesh(
    engine,
    'tile-grid',
    edgePos,
    edgeIdx,
    [0.15, 0.9, 1],
    [0.35, 0.95, 1],
  );
  addToScene(scene, edgeMesh);
  setSubtreeVisible(edgeMesh, false);

  /** @type {object | null} */
  let blockMesh = null;
  if (bv > 0) {
    blockMesh = makeDevMesh(
      engine,
      'tile-blocked',
      blockPos,
      blockIdx,
      [1, 0.15, 0.55],
      [1, 0.2, 0.65],
    );
    addToScene(scene, blockMesh);
    setSubtreeVisible(blockMesh, false);
  }

  return {
    setVisible(on) {
      const show = !!on;
      setSubtreeVisible(edgeMesh, show);
      if (blockMesh) setSubtreeVisible(blockMesh, show);
    },
    dispose() {
      setSubtreeVisible(edgeMesh, false);
      if (blockMesh) setSubtreeVisible(blockMesh, false);
    },
  };
}

function makeDevMesh(engine, name, positions, indices, diffuse, emissive) {
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const normals = flatUpNormals(pos.length / 3);
  const mesh = createMeshFromData(engine, name, pos, normals, idx);
  const mat = createStandardMaterial();
  mat.diffuseColor = diffuse;
  mat.emissiveColor = emissive;
  mat.ambientColor = emissive;
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  return mesh;
}
