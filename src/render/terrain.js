// Lite terrain — atlas tile quads from a sim field snapshot.
// Sim owns generation; this module only builds meshes.

import {
  createMeshFromData,
  createTexture2DFromPixels,
  getOrCreateSampler,
  createStandardMaterial,
  createShaderMaterial,
  addToScene,
  setSubtreeVisible,
  setShaderTexture,
  setShaderUniform,
} from '../vendor/lite/liteVendor.js';
import {
  ATLAS,
  DEFAULT_MAP_CHUNKS,
  TERRAIN,
  TILE_SIZE_F,
  tileHeightWorld,
  worldHalfFFromField,
  worldHalfZFFromField,
} from '../sim/field.js';
import {
  CORNER_BLOCK_SIZE,
  plinthCornerRadius,
  plinthHalf,
  loopOutward,
  silhouetteCorners,
  silhouetteLoops,
  tableCenterVertex,
  tableCornerPlinths,
  tableEdgeMidpoints,
  tableHasCenterBlock,
} from '../sim/tableShape.js';
import { createSceneryFromField } from './scenery.js';
import { createDoodadsFromField } from './doodads.js';
import { createBackdropsFromField } from './backdrops.js';
import { EXPOSURE, SKY_HORIZON, SKY_HORIZON_SUN, SKY_ZENITH } from './celestial.js';
import { softDetachMesh } from './meshLifecycle.js';
import { classifyGridTile, placementFillKind, placementGridWindow } from './placementGrid.js';
import { ATLAS_GRID, SHEET_JUNCTION, TERRAIN_LOOK, tileLayer } from './terrainLayers.js';
import { PAGE_BUCKET_BASE, createTerrainMaterials, loadTerrainAtlas } from './terrainAtlas.js';
import * as fx from '../sim/fixed.js';

const UV_SCALE = 1 / ATLAS_GRID;
const UV_INSET = 0.01;
/** Same upsample + bilinear as fog — spec fades across tile borders. */
const SPEC_TEX_SCALE = 2;
const SPEC_TEXEL_ALIGN = 64;
const SPEC_OVERLAY_LIFT = 0.14;

function specRgb8(terrain) {
  const c = TERRAIN_LOOK[terrain]?.specularColor ?? [0, 0, 0];
  return [
    Math.round(c[0] * 255),
    Math.round(c[1] * 255),
    Math.round(c[2] * 255),
  ];
}

const SPEC_RGB_WATER = specRgb8(TERRAIN.WATER);
const SPEC_RGB_GRASS = specRgb8(TERRAIN.GRASS);
const SPEC_RGB_DIRT = specRgb8(TERRAIN.DIRT);
const SPEC_RGB_NONE = [0, 0, 0];
const FRAME_THICKNESS = 5.5;
const FRAME_INNER_OVERLAP = 2.4;
const FRAME_BOTTOM_Y = -9;
const FRAME_TOP_RISE = 0.8;
const PLINTH_TOP_EXTRA = FRAME_TOP_RISE * 2.25;
/** World length of one wood-grain tile. The texture tiles, so this is grain scale. */
const FRAME_UV_WORLD_SIZE = 10;
const FRAME_ARC_MATCH = 0.9;

/** @type {WeakMap<object, object>} */
const woodTextures = new WeakMap();
/** @type {WeakMap<object, object>} */
const endgrainTextures = new WeakMap();

const TERRAIN_LOD_MS = 120;
const TERRAIN_LOD_MOVE_SQ = 16;
/** v1 kept about six chunks of tiles around the view. The rest is the table. */
const TERRAIN_KEEP_CHUNKS = 6;
/** Dark green felt, just under the tiles. Matches v1's table floor. */
const TABLE_FLOOR_Y = -0.75;

function lodCameraPosition(camera) {
  if (
    Number.isFinite(camera?.worldMatrix?.[12]) &&
    Number.isFinite(camera?.worldMatrix?.[13]) &&
    Number.isFinite(camera?.worldMatrix?.[14])
  ) {
    return {
      x: camera.worldMatrix[12],
      y: camera.worldMatrix[13],
      z: camera.worldMatrix[14],
    };
  }
  if (
    Number.isFinite(camera?.position?.x) &&
    Number.isFinite(camera?.position?.y) &&
    Number.isFinite(camera?.position?.z)
  ) {
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  }
  const target = camera?.target ?? { x: 0, z: 0 };
  const alpha = camera?.alpha ?? 0;
  const beta = camera?.beta ?? Math.PI / 3;
  const radius = camera?.radius ?? 600;
  const horizontal = radius * Math.sin(beta);
  return {
    x: (target.x ?? 0) + Math.cos(alpha) * horizontal,
    y: (target.y ?? 0) + radius * Math.cos(beta),
    z: (target.z ?? 0) + Math.sin(alpha) * horizontal,
  };
}

function lodLookAt(camera) {
  const t = camera?.target;
  if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: t.x, z: t.z };
  const eye = lodCameraPosition(camera);
  return { x: eye.x, z: eye.z };
}

/**
 * Boards larger than the normal map keep a ring of real tiles around the
 * camera and show the dark table under the rest. Small matches stay one draw.
 */
function createTerrainChunkLod(engine, scene, field, chunkSize, atlasByChunk) {
  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const span = chunkSize * TILE_SIZE_F;
  const chunks = [];
  const byKey = new Map();
  for (const [key, meshes] of atlasByChunk) {
    const [cx, cz] = key.split(',').map(Number);
    const chunk = {
      cx,
      cz,
      meshes,
      x: (cx + 0.5) * span - halfX,
      z: (cz + 0.5) * span - halfZ,
      far: false,
    };
    chunks.push(chunk);
    byKey.set(key, chunk);
  }
  let floor = null;
  let elapsed = TERRAIN_LOD_MS;
  let lastX = Infinity;
  let lastZ = Infinity;
  const keep = TERRAIN_KEEP_CHUNKS * span;
  const keepSq = keep * keep;

  function showChunk(chunk, on) {
    for (let m = 0; m < chunk.meshes.length; m++) {
      const mesh = chunk.meshes[m];
      mesh.visible = on;
      setSubtreeVisible(mesh, on);
    }
  }

  function buildFloor() {
    const y = TABLE_FLOOR_Y;
    const positions = new Float32Array([
      -halfX, y, -halfZ,
      halfX, y, -halfZ,
      halfX, y, halfZ,
      -halfX, y, halfZ,
    ]);
    const mesh = createMeshFromData(
      engine,
      'table-floor',
      positions,
      flatUpNormals(4),
      new Uint32Array([0, 1, 2, 0, 2, 3]),
    );
    const mat = createStandardMaterial();
    mat.diffuseColor = [0.1, 0.3, 0.1];
    mat.ambientColor = [0.04, 0.1, 0.04];
    mat.emissiveColor = [0.012, 0.03, 0.012];
    mat.specularColor = [0.02, 0.02, 0.02];
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.pickable = false;
    mesh.receiveShadows = false;
    addToScene(scene, mesh);
    floor = mesh;
  }

  function apply(camera) {
    const look = lodLookAt(camera);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const dx = look.x - chunk.x;
      const dz = look.z - chunk.z;
      const far = dx * dx + dz * dz > keepSq;
      if (far === chunk.far) continue;
      chunk.far = far;
      showChunk(chunk, !far);
    }
  }

  buildFloor();

  return {
    noteChunkMeshes(key, meshes) {
      const chunk = byKey.get(key);
      if (!chunk) return;
      chunk.meshes = meshes;
      showChunk(chunk, !chunk.far);
    },
    update(camera, deltaMs = TERRAIN_LOD_MS) {
      if (!camera) return;
      elapsed += deltaMs;
      const look = lodLookAt(camera);
      const moved = (look.x - lastX) ** 2 + (look.z - lastZ) ** 2;
      if (elapsed < TERRAIN_LOD_MS && moved < TERRAIN_LOD_MOVE_SQ) return;
      elapsed = 0;
      lastX = look.x;
      lastZ = look.z;
      apply(camera);
    },
    dispose() {
      if (floor) softDetachMesh(scene, floor);
      floor = null;
      for (let i = 0; i < chunks.length; i++) showChunk(chunks[i], true);
    },
  };
}

/**
 * @param {import('@babylonjs/lite').EngineContext} engine
 * @param {object} scene
 * @param {{ width: number, height: number, heightMap: Float32Array, terrainTypes: Uint8Array, tileType: Uint8Array, atlasId: Uint8Array }} field
 * @param {object} camera
 * @returns {Promise<{ meshes: object[], update: (camera: object, deltaMs: number) => void, dispose: () => void }>}
 */
export async function createTerrainFromField(engine, scene, field, camera, opts = {}) {
  const atlas = await loadTerrainAtlas(engine);
  const active = createActiveCellLookup(field);
  const cell = Math.max(1, field.tableShape?.cellSize || field.chunkSize || 16);
  const chunksAcross = Math.max(
    Math.ceil(field.width / cell),
    Math.ceil(field.height / cell),
  );
  // Normal matches stay one draw. Larger boards split so far chunks can drop out.
  const chunkSize = (opts.chunkedAtlas || chunksAcross > DEFAULT_MAP_CHUNKS) ? cell : 0;
  const terrainLodOn = chunkSize > 0 && chunksAcross > DEFAULT_MAP_CHUNKS;
  // Chunk repaints composite junction cells synchronously, so keep pixels resident.
  let holdsAtlasSource = false;
  try {
    if (chunkSize) {
      await atlas.retainSource();
      holdsAtlasSource = true;
    }
    await atlas.prepareJunctions(junctionKeysOf(field, active));
  } catch (err) {
    console.warn('[terrain] junction cells unavailable', err);
  }
  const releaseAtlasSource = () => {
    if (!holdsAtlasSource) return;
    holdsAtlasSource = false;
    atlas.releaseSource();
  };
  /** @type {Map<string, object[]>} */
  const atlasByChunk = new Map();
  const specMap = createGroundSpecMap(engine);
  specMap.rebuild(field);
  const atlasLook = { atlas, materials: createTerrainMaterials(atlas, specMap.texture) };
  const specGlint = createGroundSpecGlint(engine, scene);
  specGlint.rebuild(field, active, specMap.texture, specMap.uv, { addToScene: false });
  let atlasRev = 0;
  const atlasMeshes = chunkSize
    ? buildChunkedAtlasMeshes(engine, field, atlasLook, active, chunkSize, atlasByChunk, atlasRev, specMap.uv)
    : buildAtlasMeshes(engine, field, atlasLook, active, specMap.uv);
  const terrainLod = terrainLodOn
    ? createTerrainChunkLod(engine, scene, field, chunkSize, atlasByChunk)
    : null;
  const backdrop = buildEnvironmentMeshes(engine, scene, field);
  const built = [
    ...backdrop.meshes,
    ...buildTableFrameMeshes(engine, field, active),
    ...atlasMeshes,
    ...(specGlint.mesh ? [specGlint.mesh] : []),
  ];
  let disposed = false;
  let liveField = field;
  /** @type {((x: number, z: number) => number) | null} */
  let fogFactor = null;
  const emptyDoodads = () => ({
    meshes: [],
    update() {},
    syncFromField() {},
    applyTreeUpdates() {},
    applyFogDim() {},
    applyFogTiles() {},
    dispose() {},
  });
  let doodads = emptyDoodads();
  const doodadsReady = opts.skipScenery
    ? Promise.resolve()
    : createDoodadsFromField(
      engine,
      scene,
      field,
      (x, z) => surfaceHeightAt(liveField, x, z),
    ).then((d) => {
      if (disposed) {
        d.dispose();
        return;
      }
      doodads = d;
      for (const mesh of d.meshes) {
        if (built.indexOf(mesh) < 0) built.push(mesh);
      }
      if (fogFactor) d.applyFogDim(fogFactor);
    }).catch((err) => {
      console.warn('[doodads] failed', err);
    });
  const emptyBackdrops = () => ({ meshes: [], dispose() {} });
  let backdrops = emptyBackdrops();
  const backdropsReady = opts.skipScenery
    ? Promise.resolve()
    : createBackdropsFromField(engine, scene, field).then((b) => {
      if (disposed) {
        b.dispose();
        return;
      }
      backdrops = b;
      for (const mesh of b.meshes) {
        if (built.indexOf(mesh) < 0) built.push(mesh);
      }
    }).catch((err) => {
      console.warn('[backdrops] failed', err);
    });
  let scenery = opts.skipScenery
    ? { meshes: [], modelsReady: Promise.resolve(), update() {}, applyAuthoredTiles() {}, dispose() {} }
    : await createSceneryFromField(
      engine,
      field,
      surfaceHeightAt,
      camera,
      {
        ...opts,
        scene,
        onModelMesh(mesh) {
          if (disposed) {
            softDetachMesh(scene, mesh);
            return;
          }
          if (built.indexOf(mesh) < 0) built.push(mesh);
          opts.onModelMesh?.(mesh);
        },
      },
    );
  if (opts.signal?.aborted) {
    disposed = true;
    releaseAtlasSource();
    specGlint.dispose();
    specMap.dispose();
    scenery.dispose?.();
    terrainLod?.dispose();
    for (const mesh of built) softDetachMesh(scene, mesh);
    built.length = 0;
    doodads.dispose();
    backdrops.dispose();
    return {
      meshes: [],
      modelsReady: Promise.resolve(),
      update() {},
      forEachBurningTree() {},
      applyTreeUpdates() {},
      applyRockUpdates() {},
      applyAuthoredSceneryTiles() {},
      applyFogDim() {},
      applyFogTiles() {},
      pingHarvest() { return false; },
      pickGatherOnRay() { return null; },
      dispose() {},
    };
  }
  for (const mesh of scenery.meshes) {
    if (built.indexOf(mesh) < 0) built.push(mesh);
  }
  for (const mesh of built) addToScene(scene, mesh);
  return {
    meshes: built,
    /** Resolves when 3D tree/rock models have replaced billboards (or failed). */
    modelsReady: Promise.all([
      scenery.modelsReady ?? Promise.resolve(),
      doodadsReady,
      backdropsReady,
    ]),
    update(activeCamera, deltaMs) {
      if (disposed) return;
      specGlint.update();
      backdrop.update();
      scenery.update(activeCamera, deltaMs);
      terrainLod?.update(activeCamera, deltaMs);
      doodads.update(deltaMs);
    },
    forEachBurningTree(fn) {
      if (!disposed) scenery.forEachBurningTree?.(fn);
    },
    applyTreeUpdates(updates) {
      if (disposed) return;
      scenery.applyTreeUpdates?.(updates);
      doodads.applyTreeUpdates(liveField, updates);
    },
    applyRockUpdates(updates) {
      if (!disposed) scenery.applyRockUpdates?.(updates);
    },
    applyAuthoredSceneryTiles(nextField, tiles) {
      if (disposed) return;
      liveField = nextField ?? liveField;
      scenery.applyAuthoredTiles?.(nextField, tiles);
      doodads.syncFromField(liveField, true);
    },
    pingHarvest(tile) {
      if (disposed) return false;
      return scenery.pingHarvest?.(tile) ?? false;
    },
    pickGatherOnRay(ray, maxT) {
      if (disposed) return null;
      return scenery.pickGatherOnRay?.(ray, maxT) ?? null;
    },
    applyFogDim(isVisible) {
      if (disposed) return;
      fogFactor = typeof isVisible === 'function' ? isVisible : null;
      scenery.applyFogDim?.(isVisible);
      doodads.applyFogDim(fogFactor);
    },
    applyFogTiles(forEachTile) {
      if (disposed) return;
      scenery.applyFogTiles?.(forEachTile);
      doodads.applyFogTiles?.(forEachTile);
    },
    rebuildAtlasChunks(nextField, chunkKeys) {
      if (disposed || !chunkSize) return false;
      const keys = chunkKeys instanceof Set ? chunkKeys : new Set(chunkKeys ?? []);
      if (!keys.size) return false;
      specMap.rebuild(nextField);
      atlasLook.materials.bindSpecMap(specMap.texture);
      const prevGlint = specGlint.mesh;
      if (prevGlint) {
        const gidx = built.indexOf(prevGlint);
        if (gidx >= 0) built.splice(gidx, 1);
      }
      const nextActive = createActiveCellLookup(nextField);
      atlasRev += 1;
      for (const key of keys) {
        const prev = atlasByChunk.get(key) ?? [];
        for (const mesh of prev) {
          const idx = built.indexOf(mesh);
          if (idx >= 0) built.splice(idx, 1);
          softDetachMesh(scene, mesh);
        }
        const [cx, cz] = String(key).split(',').map(Number);
        const next = buildAtlasMeshesInRect(
          engine,
          nextField,
          atlasLook,
          nextActive,
          cx * chunkSize,
          cz * chunkSize,
          Math.min(nextField.width, (cx + 1) * chunkSize),
          Math.min(nextField.height, (cz + 1) * chunkSize),
          `-${cx}-${cz}-r${atlasRev}`,
          specMap.uv,
        );
        for (const mesh of next) {
          addToScene(scene, mesh);
          built.push(mesh);
        }
        atlasByChunk.set(key, next);
        terrainLod?.noteChunkMeshes(key, next);
      }
      specGlint.rebuild(nextField, nextActive, specMap.texture, specMap.uv, { addToScene: true });
      if (specGlint.mesh) built.push(specGlint.mesh);
      return true;
    },
    async rebuildScenery(nextField, nextCamera) {
      if (disposed || opts.skipScenery) return false;
      liveField = nextField ?? liveField;
      const prev = scenery;
      const prevSet = new Set(prev.meshes ?? []);
      prev.dispose?.();
      for (let i = built.length - 1; i >= 0; i--) {
        if (prevSet.has(built[i])) built.splice(i, 1);
      }
      scenery = await createSceneryFromField(
        engine,
        nextField,
        surfaceHeightAt,
        nextCamera ?? camera,
        {
          ...opts,
          scene,
          onModelMesh(mesh) {
            if (disposed) {
              softDetachMesh(scene, mesh);
              return;
            }
            if (built.indexOf(mesh) < 0) built.push(mesh);
            opts.onModelMesh?.(mesh);
          },
        },
      );
      for (const mesh of scenery.meshes) {
        if (built.indexOf(mesh) < 0) built.push(mesh);
        addToScene(scene, mesh);
      }
      doodads.syncFromField(liveField, true);
      if (fogFactor) doodads.applyFogDim(fogFactor);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseAtlasSource();
      specGlint.dispose();
      specMap.dispose();
      // Scenery owns its meshes (and late model jobs); don't double-detach.
      const scenerySet = new Set(scenery.meshes ?? []);
      const doodadSet = new Set(doodads.meshes ?? []);
      const backdropSet = new Set(backdrops.meshes ?? []);
      scenery.dispose?.();
      terrainLod?.dispose();
      doodads.dispose();
      backdrops.dispose();
      for (const mesh of built) {
        if (!mesh || scenerySet.has(mesh) || doodadSet.has(mesh) || backdropSet.has(mesh) || mesh === specGlint.mesh) continue;
        softDetachMesh(scene, mesh);
      }
      built.length = 0;
    },
  };
}

export function specLookAt(types, width, height, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return SPEC_RGB_NONE;
  const t = types[tz * width + tx];
  if (t === TERRAIN.WATER) return SPEC_RGB_WATER;
  if (t === TERRAIN.GRASS) return SPEC_RGB_GRASS;
  if (t === TERRAIN.DIRT) return SPEC_RGB_DIRT;
  return SPEC_RGB_NONE;
}

export function sampleSpecLook(types, width, height, fx, fz) {
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const c00 = specLookAt(types, width, height, x0, z0);
  const c10 = specLookAt(types, width, height, x0 + 1, z0);
  const c01 = specLookAt(types, width, height, x0, z0 + 1);
  const c11 = specLookAt(types, width, height, x0 + 1, z0 + 1);
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  return [
    c00[0] * w00 + c10[0] * w10 + c01[0] * w01 + c11[0] * w11,
    c00[1] * w00 + c10[1] * w10 + c01[1] * w01 + c11[1] * w11,
    c00[2] * w00 + c10[2] * w10 + c01[2] * w01 + c11[2] * w11,
  ];
}

/** Water cover 0–255. Overlay alpha; land stays dry so grass spec stays on the atlas. */
export function wetnessAt(types, width, height, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= width || tz >= height) return 0;
  return types[tz * width + tx] === TERRAIN.WATER ? 255 : 0;
}

export function sampleWetness(types, width, height, fx, fz) {
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const c00 = wetnessAt(types, width, height, x0, z0);
  const c10 = wetnessAt(types, width, height, x0 + 1, z0);
  const c01 = wetnessAt(types, width, height, x0, z0 + 1);
  const c11 = wetnessAt(types, width, height, x0 + 1, z0 + 1);
  return (c00 * (1 - tx) + c10 * tx) * (1 - tz) + (c01 * (1 - tx) + c11 * tx) * tz;
}

function tileNeedsWaterGlint(active, types, width, height, tx, tz) {
  if (wetnessAt(types, width, height, tx, tz) > 0) return true;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (!active(x, z)) continue;
      if (wetnessAt(types, width, height, x, z) > 0) return true;
    }
  }
  return false;
}

function gpuTextureOf(tex) {
  return tex?._gpu?.texture ?? tex?._gpuTexture ?? tex?.gpuTexture ?? tex?.texture ?? null;
}

function disposeGpuTexture(tex) {
  if (!tex) return;
  try {
    tex.dispose?.();
  } catch { /* vendor shape drift */ }
  try {
    gpuTextureOf(tex)?.destroy?.();
  } catch { /* vendor shape drift */ }
}

function padSpecTexWidth(w) {
  return Math.max(SPEC_TEXEL_ALIGN, Math.ceil(w / SPEC_TEXEL_ALIGN) * SPEC_TEXEL_ALIGN);
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
 * World-space spec map. RGB is the Phong color; bilinear upsample fades
 * water/grass/dirt so glint is not a stair of tiles. Sampled on UV2.
 */
function createGroundSpecMap(engine) {
  let texture = null;
  let pixels = null;
  let texW = 0;
  let texH = 0;

  function detach() {
    disposeGpuTexture(texture);
    texture = null;
    pixels = null;
    texW = 0;
    texH = 0;
  }

  function paintPixels(field) {
    if (!pixels) return;
    pixels.fill(0);
    const { width, height, terrainTypes } = field;
    const srcH = height * SPEC_TEX_SCALE;
    const srcW = width * SPEC_TEX_SCALE;
    for (let sz = 0; sz < srcH; sz++) {
      const dstRow = sz * texW;
      const fz = (sz + 0.5) / SPEC_TEX_SCALE - 0.5;
      for (let sx = 0; sx < srcW; sx++) {
        const fx = (sx + 0.5) / SPEC_TEX_SCALE - 0.5;
        const rgb = sampleSpecLook(terrainTypes, width, height, fx, fz);
        const o = (dstRow + sx) * 4;
        pixels[o] = rgb[0];
        pixels[o + 1] = rgb[1];
        pixels[o + 2] = rgb[2];
        pixels[o + 3] = sampleWetness(terrainTypes, width, height, fx, fz);
      }
    }
  }

  function rebuild(field) {
    if (!field) {
      detach();
      return;
    }
    const nextW = padSpecTexWidth(field.width * SPEC_TEX_SCALE);
    const nextH = Math.max(1, field.height * SPEC_TEX_SCALE);
    if (!pixels || nextW !== texW || nextH !== texH) {
      disposeGpuTexture(texture);
      texture = null;
      texW = nextW;
      texH = nextH;
      pixels = new Uint8Array(texW * texH * 4);
    }
    paintPixels(field);
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
    disposeGpuTexture(texture);
    texture = next;
  }

  return {
    get texture() {
      return texture;
    },
    get uv() {
      return {
        invW: texW ? 1 / texW : 0,
        invH: texH ? 1 / texH : 0,
      };
    },
    rebuild,
    dispose: detach,
  };
}

function readSunDir(scene) {
  const lights = scene?.lights;
  if (!lights?.length) return [0.45, -0.72, 0.35];
  let best = null;
  let bestI = -1;
  for (const light of lights) {
    if (light.lightType && light.lightType !== 'directional') continue;
    const intensity = Number(light.intensity) || 0;
    if (intensity < bestI) continue;
    const d = light.direction;
    if (!d) continue;
    bestI = intensity;
    best = [d.x ?? d[0] ?? 0, d.y ?? d[1] ?? -1, d.z ?? d[2] ?? 0];
  }
  return best ?? [0.45, -0.72, 0.35];
}

/**
 * Additive water glint on a welded sheet. Atlas stays on the tile mesh;
 * this pass only adds Phong so pond squares and milky film both stay off.
 */
function createGroundSpecGlint(engine, scene) {
  let mesh = null;
  let material = null;

  function detach() {
    if (mesh) softDetachMesh(scene, mesh);
    mesh = null;
    material = null;
  }

  function rebuild(field, active, texture, specUv, opts = {}) {
    detach();
    if (!field || !texture) return;
    const { width, height, terrainTypes } = field;
    const half = worldHalfFFromField(field);
    const halfZ = worldHalfZFFromField(field);
    const positions = [];
    const uvs = [];
    const indices = [];
    const cornerAt = new Map();
    const corner = (tx, tz) => {
      const key = tx + ',' + tz;
      let i = cornerAt.get(key);
      if (i != null) return i;
      const x = tx * TILE_SIZE_F - half;
      const z = tz * TILE_SIZE_F - halfZ;
      i = positions.length / 3;
      positions.push(x, surfaceHeightAt(field, x, z) + SPEC_OVERLAY_LIFT, z);
      uvs.push(tx * SPEC_TEX_SCALE * (specUv?.invW ?? 0), tz * SPEC_TEX_SCALE * (specUv?.invH ?? 0));
      cornerAt.set(key, i);
      return i;
    };
    let count = 0;
    for (let tz = 0; tz < height; tz++) {
      for (let tx = 0; tx < width; tx++) {
        if (!active(tx, tz)) continue;
        if (!tileNeedsWaterGlint(active, terrainTypes, width, height, tx, tz)) continue;
        const a = corner(tx, tz);
        const b = corner(tx + 1, tz);
        const c = corner(tx + 1, tz + 1);
        const d = corner(tx, tz + 1);
        indices.push(a, b, c, a, c, d);
        count++;
      }
    }
    if (count === 0) return;
    const pos = new Float32Array(positions);
    mesh = createMeshFromData(
      engine,
      'terrain-water-glint',
      pos,
      flatUpNormals(pos.length / 3),
      new Uint32Array(indices),
      new Float32Array(uvs),
    );
    material = createShaderMaterial({
      name: 'terrain-water-glint',
      attributes: ['position', 'normal', 'uv'],
      uniforms: [
        'world',
        'viewProjection',
        'cameraPosition',
        { name: 'sunDir', type: 'vec3<f32>', defaultValue: [0.45, -0.72, 0.35] },
        { name: 'specColor', type: 'vec3<f32>', defaultValue: [0.38, 0.50, 0.62] },
        { name: 'specPower', type: 'f32', defaultValue: 28 },
        { name: 'specGain', type: 'f32', defaultValue: 0.42 },
      ],
      samplers: ['wetness'],
      needAlphaBlending: true,
      blendMode: 'additive',
      depthWrite: false,
      backFaceCulling: true,
      vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let worldPos4 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.position = shaderSystem.viewProjection * worldPos4;
  out.uv = input.uv;
  return out;
}`,
      fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let w = textureSample(wetness, wetnessSampler, input.uv).a;
  if (w < 0.004) { discard; }
  let N = vec3<f32>(0.0, 1.0, 0.0);
  let L = normalize(-shaderUniforms.sunDir);
  let V = normalize(shaderSystem.cameraPosition - input.worldPos);
  let H = normalize(V + L);
  let spec = pow(max(dot(N, H), 0.0), max(shaderUniforms.specPower, 1.0)) * shaderUniforms.specGain;
  return vec4<f32>(shaderUniforms.specColor * spec, w);
}`,
    });
    setShaderTexture(material, 'wetness', texture);
    setShaderUniform(material, 'sunDir', readSunDir(scene));
    mesh.material = material;
    mesh.pickable = false;
    mesh.receiveShadows = false;
    if (opts.addToScene) addToScene(scene, mesh);
  }

  function update() {
    if (!material) return;
    setShaderUniform(material, 'sunDir', readSunDir(scene));
  }

  return {
    get mesh() {
      return mesh;
    },
    rebuild,
    update,
    dispose: detach,
  };
}

/** Junction composites a field needs, so they can be built before meshing. */
function junctionKeysOf(field, active) {
  const { width, height, terrainTypes } = field;
  const keys = new Set();
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (!active(tx, tz)) continue;
      const layer = tileLayer(terrainTypes, width, height, tx, tz);
      if (layer >> 8 === SHEET_JUNCTION) keys.add(layer & 255);
    }
  }
  return keys;
}

function buildAtlasMeshes(engine, field, look, active, specUv) {
  return buildAtlasMeshesInRect(
    engine,
    field,
    look,
    active,
    0,
    0,
    field.width,
    field.height,
    '',
    specUv,
  );
}

function buildChunkedAtlasMeshes(engine, field, look, active, chunkSize, atlasByChunk, atlasRev, specUv) {
  const meshes = [];
  const chunksX = Math.ceil(field.width / chunkSize);
  const chunksZ = Math.ceil(field.height / chunkSize);
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const key = `${cx},${cz}`;
      const chunkMeshes = buildAtlasMeshesInRect(
        engine,
        field,
        look,
        active,
        cx * chunkSize,
        cz * chunkSize,
        Math.min(field.width, (cx + 1) * chunkSize),
        Math.min(field.height, (cz + 1) * chunkSize),
        `-${cx}-${cz}-r${atlasRev}`,
        specUv,
      );
      atlasByChunk.set(key, chunkMeshes);
      for (const mesh of chunkMeshes) meshes.push(mesh);
    }
  }
  return meshes;
}

function buildAtlasMeshesInRect(engine, field, look, active, tx0, tz0, tx1, tz1, nameSuffix, specUv) {
  const { width, height, terrainTypes } = field;
  const { atlas, materials } = look;
  /** @type {Map<number, ReturnType<typeof emptyBucket>>} */
  const buckets = new Map();
  const half = worldHalfFFromField(field);

  for (let tz = tz0; tz < tz1; tz++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (!active(tx, tz)) continue;
      const layer = tileLayer(terrainTypes, width, height, tx, tz);
      let bucketId = layer >> 8;
      let cell = layer & 255;
      if (bucketId === SHEET_JUNCTION) {
        const slot = atlas.junctionSlot(cell);
        if (slot) {
          bucketId = PAGE_BUCKET_BASE + slot.page;
          cell = slot.cell;
        } else {
          // No composite yet: grass shore only, dirt blob missing.
          bucketId = ATLAS.GRASS_WATER;
          cell &= 15;
        }
      }
      pushTileQuad(
        bucketFor(buckets, bucketId),
        tx, tz, cell,
        field, half, specUv,
      );
    }
  }

  const meshes = [];
  for (const [key, b] of buckets) {
    if (b.count === 0) continue;
    const positions = new Float32Array(b.positions);
    const uvs = new Float32Array(b.uvs);
    const specUvs = new Float32Array(b.specUvs);
    const indices = new Uint32Array(b.indices);
    const normals = flatUpNormals(positions.length / 3);
    const mesh = createMeshFromData(
      engine,
      `terrain-${key}${nameSuffix}`,
      positions,
      normals,
      indices,
      uvs,
      specUvs,
    );
    mesh.material = materials.get(key);
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

function buildSilhouetteFrameMeshes(engine, field) {
  const shape = field.tableShape;
  const loops = silhouetteLoops(field, shape);
  const corners = silhouetteCorners(field, shape);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const cornerPositions = [];
  const cornerNormals = [];
  const cornerUvs = [];
  const cornerIndices = [];
  const endgrainPositions = [];
  const endgrainNormals = [];
  const endgrainUvs = [];
  const endgrainIndices = [];
  const { width, height } = field;
  let highestBoundary = 0;
  for (const pts of loops) {
    for (let i = 0; i < pts.length; i++) {
      const halfX = worldHalfFFromField(field);
      const halfZ = worldHalfZFFromField(field);
      const tx = Math.max(0, Math.min(width, Math.round((pts[i].x + halfX) / TILE_SIZE_F)));
      const tz = Math.max(0, Math.min(height, Math.round((pts[i].z + halfZ) / TILE_SIZE_F)));
      highestBoundary = Math.max(
        highestBoundary,
        tileHeightWorld(field, tx, tz),
      );
    }
  }
  const frameInnerY = highestBoundary + 0.12;
  for (const pts of loops) {
    extrudeFrameLoop(positions, normals, uvs, indices, pts, field, shape, corners, frameInnerY);
  }
  const top = frameInnerY + FRAME_TOP_RISE * 1.35;
  const keepHalf = plinthHalf(shape);
  const keepCorner = plinthCornerRadius(shape);
  const plinthTop = top + PLINTH_TOP_EXTRA;
  const endgrain = {
    pos: endgrainPositions,
    norm: endgrainNormals,
    uv: endgrainUvs,
    idx: endgrainIndices,
  };
  const cornerPlinths = tableCornerPlinths(field, shape);
  for (const p of cornerPlinths) {
    pushRoundedPrism(
      cornerPositions, cornerNormals, cornerUvs, cornerIndices,
      p.x, p.z, keepHalf, keepCorner, plinthTop, FRAME_BOTTOM_Y,
      endgrain,
    );
  }
  // Follow the sim's decision — field.tableCenter is set when a plinth was
  // stamped and null when the board has none or a scenario suppressed it
  // (e.g. the skirmish table). Fall back to recompute only when unset (older
  // snapshots / raw fields that never ran stampTableBlocks).
  const centerBlock = field.tableCenter !== undefined
    ? field.tableCenter
    : (tableHasCenterBlock(field, shape) ? tableCenterVertex(field) : null);
  if (centerBlock) {
    pushRoundedPrism(
      cornerPositions, cornerNormals, cornerUvs, cornerIndices,
      centerBlock.x, centerBlock.z, keepHalf, keepCorner, plinthTop, FRAME_BOTTOM_Y,
      endgrain,
    );
  }
  const edgeBlocks = field.tableEdgeBlocks ?? tableEdgeMidpoints(field, shape);
  for (const p of edgeBlocks) {
    pushRoundedPrism(
      cornerPositions, cornerNormals, cornerUvs, cornerIndices,
      p.x, p.z, keepHalf, keepCorner, plinthTop, FRAME_BOTTOM_Y,
      endgrain,
    );
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
  if (endgrainPositions.length > 0) {
    const mesh = createMeshFromData(
      engine,
      'table-frame-endgrain',
      new Float32Array(endgrainPositions),
      new Float32Array(endgrainNormals),
      new Uint32Array(endgrainIndices),
      new Float32Array(endgrainUvs),
    );
    mesh.material = createEndgrainMaterial(getEndgrainTexture(engine));
    mesh.pickable = false;
    meshes.push(mesh);
  }
  return meshes;
}

function buildTableFrameMeshes(engine, field, active) {
  if (field.tableShape?.cellMask) return buildSilhouetteFrameMeshes(engine, field);
  const { width, height } = field;
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
      const x0 = tx * TILE_SIZE_F - worldHalfFFromField(field);
      const x1 = x0 + TILE_SIZE_F;
      const z0 = tz * TILE_SIZE_F - worldHalfZFFromField(field);
      const z1 = z0 + TILE_SIZE_F;

      if (!active(tx, tz - 1)) {
        const ah = tileHeightWorld(field, tx, tz);
        const bh = tileHeightWorld(field, tx + 1, tz);
        boundaryEdges.push([x0, z0, x1, z0, 0, -1]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx + 1, tz)) {
        const ah = tileHeightWorld(field, tx + 1, tz);
        const bh = tileHeightWorld(field, tx + 1, tz + 1);
        boundaryEdges.push([x1, z0, x1, z1, 1, 0]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx, tz + 1)) {
        const ah = tileHeightWorld(field, tx + 1, tz + 1);
        const bh = tileHeightWorld(field, tx, tz + 1);
        boundaryEdges.push([x1, z1, x0, z1, 0, 1]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
      if (!active(tx - 1, tz)) {
        const ah = tileHeightWorld(field, tx, tz + 1);
        const bh = tileHeightWorld(field, tx, tz);
        boundaryEdges.push([x0, z1, x0, z0, -1, 0]);
        highestBoundary = Math.max(highestBoundary, ah, bh);
      }
    }
  }

  // A pool-table frame is rigid: every rail and corner shares one horizontal top.
  const frameInnerY = highestBoundary + 0.12;
  let uCursor = 0;
  for (const edge of mergeBoundaryEdges(boundaryEdges)) {
    const len = Math.hypot(edge[2] - edge[0], edge[3] - edge[1]);
    pushFrameSegment(positions, normals, uvs, indices, ...edge, frameInnerY, uCursor);
    uCursor += len / FRAME_UV_WORLD_SIZE;
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
      const x = cx * TILE_SIZE_F - worldHalfFFromField(field);
      const z = cz * TILE_SIZE_F - worldHalfZFFromField(field);
      const top = frameInnerY + FRAME_TOP_RISE * 1.35;
      pushBox(
        cornerPositions, cornerNormals, cornerUvs, cornerIndices,
        x, z, CORNER_BLOCK_SIZE, top, FRAME_BOTTOM_Y,
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

function cleanClosedLoop(pts) {
  const loop = [];
  const n = pts.length - (pts.length > 1
    && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 1e-4
    ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4) continue;
    loop.push(a);
  }
  return loop;
}

function loopPointOnCorner(x, z, corners) {
  let best = null;
  let bestErr = FRAME_ARC_MATCH;
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    if (c.r <= 0) continue;
    const err = Math.abs(Math.hypot(x - c.cx, z - c.cz) - c.r);
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return best;
}

function offsetLoopPoint(x, z, mx, mz, align, corners, signedOut) {
  const corner = loopPointOnCorner(x, z, corners);
  if (corner) {
    const dx = x - corner.cx;
    const dz = z - corner.cz;
    const d = Math.hypot(dx, dz) || 1;
    const sign = corner.kind === 'convex' ? 1 : -1;
    const nextR = Math.max(0.45, d + sign * signedOut);
    return { x: corner.cx + (dx / d) * nextR, z: corner.cz + (dz / d) * nextR };
  }
  const scale = signedOut / align;
  return { x: x + mx * scale, z: z + mz * scale };
}

function extrudeFrameLoop(pos, norm, uv, idx, pts, field, shape, corners, topY) {
  const loop = cleanClosedLoop(pts);
  if (loop.length < 3) return;
  const edgeOut = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    edgeOut.push(loopOutward(field, shape, a.x, a.z, b.x, b.z, corners));
  }
  const inner = [];
  const outer = [];
  const uAt = [];
  let u = 0;
  for (let i = 0; i < loop.length; i++) {
    const prev = (i + loop.length - 1) % loop.length;
    let mx = edgeOut[prev].ox + edgeOut[i].ox;
    let mz = edgeOut[prev].oz + edgeOut[i].oz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-5) {
      mx = edgeOut[i].ox;
      mz = edgeOut[i].oz;
    } else {
      mx /= ml;
      mz /= ml;
    }
    const align = Math.max(0.28, mx * edgeOut[i].ox + mz * edgeOut[i].oz);
    inner.push(offsetLoopPoint(
      loop[i].x, loop[i].z, mx, mz, align, corners, -FRAME_INNER_OVERLAP,
    ));
    outer.push(offsetLoopPoint(
      loop[i].x, loop[i].z, mx, mz, align, corners, FRAME_THICKNESS,
    ));
    if (i > 0) u += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z) / FRAME_UV_WORLD_SIZE;
    uAt.push(u);
  }
  const closeLen = Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].z - loop[loop.length - 1].z);
  const uEnd = u + closeLen / FRAME_UV_WORLD_SIZE;
  const turns = Math.max(1, Math.round(uEnd));
  const uScale = uEnd > 1e-5 ? turns / uEnd : 1;
  for (let i = 0; i < uAt.length; i++) uAt[i] *= uScale;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    const u0 = uAt[i];
    const u1 = i + 1 === loop.length ? turns : uAt[j];
    pushFrameSpan(
      pos, norm, uv, idx,
      inner[i].x, inner[i].z, inner[j].x, inner[j].z,
      outer[i].x, outer[i].z, outer[j].x, outer[j].z,
      topY, u0, u1,
    );
  }
}

function pushFrameSegment(pos, norm, uv, idx, ax, az, bx, bz, ox, oz, topY, uStart = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  pushFrameSpan(
    pos, norm, uv, idx,
    ax, az, bx, bz,
    ax + ox * FRAME_THICKNESS, az + oz * FRAME_THICKNESS,
    bx + ox * FRAME_THICKNESS, bz + oz * FRAME_THICKNESS,
    topY, uStart, uStart + len / FRAME_UV_WORLD_SIZE,
  );
}

function pushFrameSpan(pos, norm, uv, idx, ax, az, bx, bz, aox, aoz, box, boz, topY, u0, u1) {
  const base = pos.length / 3;
  const outerTop = topY + FRAME_TOP_RISE;
  const verts = boxLikeSegmentVertices(
    ax, topY, az, bx, topY, bz,
    aox, outerTop, aoz, box, outerTop, boz,
  );
  pos.push(...verts);
  const ox = aox - ax;
  const oz = aoz - az;
  const ol = Math.hypot(ox, oz) || 1;
  pushFaceNormals(norm, 0, 1, 0);
  pushFaceNormals(norm, ox / ol, 0, oz / ol);
  pushFaceNormals(norm, -ox / ol, 0, -oz / ol);
  pushFaceNormals(norm, 0, -1, 0);
  const vInner = (topY - FRAME_BOTTOM_Y) / FRAME_UV_WORLD_SIZE;
  const vOuter = (outerTop - FRAME_BOTTOM_Y) / FRAME_UV_WORLD_SIZE;
  const vTop0 = Math.hypot(aox - ax, aoz - az) / FRAME_UV_WORLD_SIZE;
  const vTop1 = Math.hypot(box - bx, boz - bz) / FRAME_UV_WORLD_SIZE;
  // V walks inner wall → top → outer wall so a grain line crosses the edges.
  // The inner wall's vertex order is reversed; its U follows that order.
  uv.push(
    u0, vInner, u1, vInner, u1, vInner + vTop1, u0, vInner + vTop0,
    u0, vInner + vTop0, u1, vInner + vTop1, u1, vInner + vTop1 + vOuter, u0, vInner + vTop0 + vOuter,
    u1, vInner, u0, vInner, u0, 0, u1, 0,
    u0, 0, u1, 0, u1, vTop1, u0, vTop0,
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

function roundedRectOutline(x, z, half, cornerR, segs = 8) {
  const r = Math.max(0.05, Math.min(half - 0.05, cornerR));
  const inner = half - r;
  const pts = [];
  const add = (px, pz, nx, nz) => pts.push({ x: px, z: pz, nx, nz });
  const arc = (cx, cz, a0, a1) => {
    for (let i = 1; i <= segs; i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      add(cx + nx * r, cz + nz * r, nx, nz);
    }
  };
  add(x + half, z - inner, 1, 0);
  add(x + half, z + inner, 1, 0);
  arc(x + inner, z + inner, 0, Math.PI * 0.5);
  add(x - inner, z + half, 0, 1);
  arc(x - inner, z + inner, Math.PI * 0.5, Math.PI);
  add(x - half, z - inner, -1, 0);
  arc(x - inner, z - inner, Math.PI, Math.PI * 1.5);
  add(x + inner, z - half, 0, -1);
  arc(x + inner, z - inner, Math.PI * 1.5, Math.PI * 2);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.z - last.z) < 1e-4) pts.pop();
  return pts;
}

function pushRoundedPrism(pos, norm, uv, idx, x, z, half, cornerR, top, bottom, topDisc) {
  const ring = roundedRectOutline(x, z, half, cornerR);
  const n = ring.length;
  if (n < 4) return;
  const h = top - bottom;
  const disc = topDisc ?? { pos, norm, uv, idx };
  const uvScale = 1 / (half * 2);
  const discBase = disc.pos.length / 3;
  disc.pos.push(x, top, z);
  disc.norm.push(0, 1, 0);
  disc.uv.push(0.5, 0.5);
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    disc.pos.push(p.x, top, p.z);
    disc.norm.push(0, 1, 0);
    disc.uv.push(0.5 + (p.x - x) * uvScale, 0.5 + (p.z - z) * uvScale);
  }
  for (let i = 0; i < n; i++) {
    disc.idx.push(discBase, discBase + 1 + i, discBase + 1 + ((i + 1) % n));
  }
  const v = h / FRAME_UV_WORLD_SIZE;
  let perimeter = 0;
  const segLens = new Array(n);
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(ring[(i + 1) % n].x - ring[i].x, ring[(i + 1) % n].z - ring[i].z);
    segLens[i] = len;
    perimeter += len;
  }
  // Whole revolutions of the tile, so the strip meets itself without a seam.
  const turns = Math.max(1, Math.round(perimeter / FRAME_UV_WORLD_SIZE));
  const uPer = perimeter > 1e-5 ? turns / perimeter : 0;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const len = segLens[i];
    if (len < 1e-5) continue;
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const u0 = u;
    const u1 = u + len * uPer;
    const o = pos.length / 3;
    pos.push(a.x, top, a.z, b.x, top, b.z, b.x, bottom, b.z, a.x, bottom, a.z);
    norm.push(a.nx, 0, a.nz, b.nx, 0, b.nz, b.nx, 0, b.nz, a.nx, 0, a.nz);
    uv.push(u0, v, u1, v, u1, 0, u0, 0);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    u = u1;
  }
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
  const uTop = size / FRAME_UV_WORLD_SIZE;
  const vSide = h / FRAME_UV_WORLD_SIZE;
  const turns = Math.max(1, Math.round((size * 4) / FRAME_UV_WORLD_SIZE));
  const uF = turns / 4;
  // Side U walks the perimeter and closes on a whole number of tiles.
  const sideUv = [
    [uF, vSide, 0, vSide, 0, 0, uF, 0],
    [uF * 2, vSide, uF, vSide, uF, 0, uF * 2, 0],
    [uF * 3, vSide, uF * 2, vSide, uF * 2, 0, uF * 3, 0],
    [uF * 4, vSide, uF * 3, vSide, uF * 3, 0, uF * 4, 0],
  ];
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    for (let v = 0; v < 4; v++) pos.push(...face[v]);
    pushFaceNormals(norm, ...face[4]);
    if (f === 0) uv.push(0, 0, uTop, 0, uTop, uTop, 0, uTop);
    else uv.push(...sideUv[f - 1]);
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
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Integer cycles only, so the tile meets itself on every edge.
      // One soft wave across the board, plus a quiet finer grain. High-contrast
      // bands read as stripes on the rail sides.
      const along = Math.sin(u * Math.PI * 2);
      const along2 = Math.sin(u * Math.PI * 4);
      const soft = Math.sin((v + along * 0.07) * Math.PI * 2);
      const fine = Math.sin((v * 3 + along2 * 0.04) * Math.PI * 2);
      const grain = soft * 0.42 + fine * 0.16;
      const o = (y * size + x) * 4;
      pixels[o] = Math.max(0, Math.min(255, 108 + grain * 14));
      pixels[o + 1] = Math.max(0, Math.min(255, 62 + grain * 8));
      pixels[o + 2] = Math.max(0, Math.min(255, 30 + grain * 5));
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

function getEndgrainTexture(engine) {
  let texture = endgrainTextures.get(engine);
  if (texture) return texture;
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const pithX = 0.04;
  const pithZ = -0.03;
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1) * 2 - 1;
      const dx = (u - pithX) * 1.06;
      const dy = (v - pithZ) * 0.94;
      const ang = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy);
      const wobble = Math.sin(ang * 3.0) * 0.045 + Math.sin(ang * 7.0 + r * 4) * 0.022;
      const rr = r + wobble;
      const latewood = 0.5 + 0.5 * Math.sin(rr * 46 + Math.sin(ang * 2) * 0.35);
      const band = Math.pow(latewood, 2.4);
      const pith = Math.max(0, 1 - rr * 9);
      const ray = Math.pow(Math.abs(Math.sin(ang * 9 + rr * 1.8)), 18) * 0.12 * Math.min(1, rr * 3);
      const bark = rr > 0.93 ? Math.min(1, (rr - 0.93) * 14) : 0;
      const grain = (1 - band * 0.55) - pith * 0.22 + ray - bark * 0.35;
      const o = (y * size + x) * 4;
      pixels[o] = Math.max(0, Math.min(255, 118 + grain * 48));
      pixels[o + 1] = Math.max(0, Math.min(255, 72 + grain * 28));
      pixels[o + 2] = Math.max(0, Math.min(255, 38 + grain * 14));
      pixels[o + 3] = 255;
    }
  }
  texture = createTexture2DFromPixels(engine, pixels, size, size, {
    srgb: true,
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
  endgrainTextures.set(engine, texture);
  return texture;
}

function createEndgrainMaterial(texture) {
  const mat = createStandardMaterial();
  mat.diffuseTexture = texture;
  mat.diffuseColor = [0.5, 0.38, 0.25];
  mat.ambientColor = [0.1, 0.06, 0.04];
  mat.emissiveColor = [0.012, 0.006, 0.003];
  mat.specularColor = [0.05, 0.035, 0.02];
  mat.specularPower = 28;
  mat.backFaceCulling = false;
  return mat;
}

function createWoodMaterial(texture, dark) {
  const mat = createStandardMaterial();
  mat.diffuseTexture = texture;
  mat.diffuseColor = dark ? [0.38, 0.28, 0.18] : [0.48, 0.38, 0.26];
  mat.ambientColor = dark ? [0.08, 0.05, 0.03] : [0.10, 0.06, 0.04];
  mat.emissiveColor = [0.01, 0.005, 0.003];
  mat.specularColor = [0.05, 0.035, 0.02];
  mat.specularPower = 32;
  mat.backFaceCulling = false;
  return mat;
}

function wgslVec3(rgb) {
  return `vec3<f32>(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function buildEnvironmentMeshes(engine, scene, field) {
  const worldWidth = field.width * TILE_SIZE_F;
  const worldHeight = field.height * TILE_SIZE_F;
  const boardRadius = Math.hypot(worldWidth, worldHeight) * 0.5;
  const seaY = -22;
  const mountains = buildMountainRing(engine, scene, field.seed ?? 0, boardRadius, seaY);
  const sea = buildSea(engine, scene, boardRadius * 10, boardRadius * 3.2, seaY);
  const sky = buildSkyDome(engine, scene);
  return {
    meshes: [sky.mesh, sea.mesh, mountains.mesh],
    update() {
      const sun = readSunDir(scene);
      const exposure = Number(scene?.imageProcessing?.exposure);
      const grade = (Number.isFinite(exposure) ? exposure : EXPOSURE) / EXPOSURE;
      sky.update(sun, grade);
      sea.update(sun, grade);
      mountains.update(sun, grade);
    },
  };
}

function buildSea(engine, scene, radius, shadeRadius, y) {
  const segs = 96;
  const positions = [0, y, 0];
  const indices = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
  }
  for (let i = 1; i <= segs; i++) indices.push(0, i, i + 1);
  const mesh = createMeshFromData(
    engine,
    'backdrop-sea',
    new Float32Array(positions),
    new Float32Array(positions.length),
    new Uint32Array(indices),
  );
  const material = createShaderMaterial({
    name: 'backdrop-sea',
    attributes: ['position'],
    uniforms: [
      'world',
      'viewProjection',
      'cameraPosition',
      { name: 'sunDir', type: 'vec3<f32>', defaultValue: [0.45, -0.72, 0.35] },
      { name: 'grade', type: 'f32', defaultValue: 1 },
      { name: 'radius', type: 'f32', defaultValue: shadeRadius },
    ],
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let worldPos4 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.position = shaderSystem.viewProjection * worldPos4;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let toSun = normalize(-shaderUniforms.sunDir);
  let view = normalize(shaderSystem.cameraPosition - input.worldPos);
  let h = normalize(view + toSun);
  let glint = pow(clamp(h.y, 0.0, 1.0), 64.0);
  let t = clamp(length(input.worldPos.xz) / max(shaderUniforms.radius, 1.0), 0.0, 1.0);
  let near = vec3<f32>(0.05, 0.16, 0.20);
  let far = vec3<f32>(0.025, 0.08, 0.12);
  var col = mix(near, far, t);
  col += vec3<f32>(0.22, 0.30, 0.28) * glint * 0.45;
  return vec4<f32>(col * shaderUniforms.grade, 1.0);
}`,
  });
  mesh.material = material;
  mesh.pickable = false;
  mesh.receiveShadows = false;
  return {
    mesh,
    update(sunDir, grade) {
      setShaderUniform(material, 'sunDir', sunDir);
      setShaderUniform(material, 'grade', grade);
    },
  };
}

function buildSkyDome(engine, scene) {
  const radius = 24000;
  const latSteps = 14;
  const lonSteps = 32;
  const positions = [];
  const indices = [];
  for (let y = 0; y <= latSteps; y++) {
    const phi = (y / latSteps - 0.5) * Math.PI;
    const cy = Math.sin(phi);
    const ring = Math.cos(phi);
    for (let x = 0; x <= lonSteps; x++) {
      const theta = (x / lonSteps) * Math.PI * 2;
      positions.push(Math.cos(theta) * ring * radius, cy * radius, Math.sin(theta) * ring * radius);
    }
  }
  const stride = lonSteps + 1;
  for (let y = 0; y < latSteps; y++) {
    for (let x = 0; x < lonSteps; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      // Camera sits inside, so the shell faces inward.
      indices.push(a, c, b, a, d, c);
    }
  }
  const mesh = createMeshFromData(
    engine,
    'sky-dome',
    new Float32Array(positions),
    new Float32Array(positions.length),
    new Uint32Array(indices),
  );
  const material = createShaderMaterial({
    name: 'sky-dome',
    attributes: ['position'],
    uniforms: [
      'world',
      'viewProjection',
      'cameraPosition',
      { name: 'sunDir', type: 'vec3<f32>', defaultValue: [0.45, -0.72, 0.35] },
      { name: 'grade', type: 'f32', defaultValue: 1 },
    ],
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let worldPos4 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.position = shaderSystem.viewProjection * worldPos4;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let dir = normalize(input.worldPos - shaderSystem.cameraPosition);
  let lift = smoothstep(0.0, 0.22, dir.y);
  let sun = pow(clamp(dot(dir, normalize(-shaderUniforms.sunDir)), 0.0, 1.0), 2.0);
  let horizon = mix(${wgslVec3(SKY_HORIZON)}, ${wgslVec3(SKY_HORIZON_SUN)}, sun);
  let sky = mix(horizon, ${wgslVec3(SKY_ZENITH)}, lift);
  return vec4<f32>(sky * shaderUniforms.grade, 1.0);
}`,
  });
  mesh.material = material;
  mesh.pickable = false;
  mesh.receiveShadows = false;
  return {
    mesh,
    update(sunDir, grade) {
      setShaderUniform(material, 'sunDir', sunDir);
      setShaderUniform(material, 'grade', grade);
    },
  };
}

function buildMountainRing(engine, scene, seed, boardRadius, seaY) {
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
      const crest = Math.min(1, Math.max(0, wave * 0.55 + 0.5));
      // Troughs dip under the sea. Crests stand well above it, or the ring
      // is only the tops of low waves and reads as a flat island.
      let y = seaY - 70;
      if (ring === 1) y = seaY - 8 + crest * 72;
      else if (ring === 2) y = seaY - 12 + crest * 130;
      else if (ring === 3) y = seaY - 6 + crest * 96;
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
  const material = createShaderMaterial({
    name: 'distant-mountains',
    attributes: ['position', 'normal'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'sunDir', type: 'vec3<f32>', defaultValue: [0.45, -0.72, 0.35] },
      { name: 'grade', type: 'f32', defaultValue: 1 },
      { name: 'seaY', type: 'f32', defaultValue: seaY },
    ],
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let worldPos4 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.worldN = (shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz;
  out.position = shaderSystem.viewProjection * worldPos4;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let y = input.worldPos.y;
  if (y < shaderUniforms.seaY) { discard; }
  let n = normalize(input.worldN);
  let toSun = normalize(-shaderUniforms.sunDir);
  let ndl = clamp(dot(n, toSun), 0.0, 1.0);
  let h = smoothstep(0.0, 110.0, y - shaderUniforms.seaY);
  let shade = mix(vec3<f32>(0.11, 0.15, 0.13), vec3<f32>(0.55, 0.56, 0.46), h);
  let col = shade * mix(0.42, 1.25, ndl);
  return vec4<f32>(col * shaderUniforms.grade, 1.0);
}`,
  });
  mesh.material = material;
  mesh.pickable = false;
  mesh.receiveShadows = false;
  return {
    mesh,
    update(sunDir, grade) {
      setShaderUniform(material, 'sunDir', sunDir);
      setShaderUniform(material, 'grade', grade);
    },
  };
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
  return { positions: [], uvs: [], specUvs: [], indices: [], count: 0 };
}

function bucketFor(buckets, key) {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = emptyBucket();
    buckets.set(key, bucket);
  }
  return bucket;
}

function pushTileQuad(bucket, tx, tz, atlasCell, field, _worldHalfF, specUv) {
  const col = atlasCell % ATLAS_GRID;
  const row = (atlasCell / ATLAS_GRID) | 0;
  // Image-space UVs: row 0 is top of PNG (V=0), matching pixel upload.
  const u1 = col * UV_SCALE + UV_INSET;
  const u2 = (col + 1) * UV_SCALE - UV_INSET;
  const vTop = row * UV_SCALE + UV_INSET;
  const vBot = (row + 1) * UV_SCALE - UV_INSET;

  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const x1 = tx * TILE_SIZE_F - halfX;
  const x2 = (tx + 1) * TILE_SIZE_F - halfX;
  const z1 = tz * TILE_SIZE_F - halfZ;
  const z2 = (tz + 1) * TILE_SIZE_F - halfZ;

  const y00 = tileHeightWorld(field, tx, tz);
  const y10 = tileHeightWorld(field, tx + 1, tz);
  const y11 = tileHeightWorld(field, tx + 1, tz + 1);
  const y01 = tileHeightWorld(field, tx, tz + 1);

  const base = bucket.positions.length / 3;
  // BL, BR, TR, TL — CW from +Y (Lite left-handed front faces).
  bucket.positions.push(x1, y00, z1, x2, y10, z1, x2, y11, z2, x1, y01, z2);
  bucket.uvs.push(u1, vBot, u2, vBot, u2, vTop, u1, vTop);
  const su0 = tx * SPEC_TEX_SCALE * (specUv?.invW ?? 0);
  const su1 = (tx + 1) * SPEC_TEX_SCALE * (specUv?.invW ?? 0);
  const sv0 = tz * SPEC_TEX_SCALE * (specUv?.invH ?? 0);
  const sv1 = (tz + 1) * SPEC_TEX_SCALE * (specUv?.invH ?? 0);
  bucket.specUvs.push(su0, sv0, su1, sv0, su1, sv1, su0, sv1);
  bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  bucket.count++;
}

/** World-space surface Y matching terrain mesh corners (bilinear). */
export function surfaceHeightAt(field, x, z) {
  if (!field?.heightMap) return 0;
  const fx = (x + worldHalfFFromField(field)) / TILE_SIZE_F;
  const fz = (z + worldHalfZFFromField(field)) / TILE_SIZE_F;
  const tx0 = Math.floor(fx);
  const tz0 = Math.floor(fz);
  const tx1 = tx0 + 1;
  const tz1 = tz0 + 1;
  const u = fx - tx0;
  const v = fz - tz0;
  const h00 = tileHeightWorld(field, tx0, tz0);
  const h10 = tileHeightWorld(field, tx1, tz0);
  const h01 = tileHeightWorld(field, tx0, tz1);
  const h11 = tileHeightWorld(field, tx1, tz1);
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
const STRUCT_SLOW_LIFT = 0.055;
const SLOW_LIFT = 0.05;
const CLEAR_LIFT = 0.045;
const GRID_HALF = 0.05;
const BLOCK_INSET = 0.15;

/** Debug-only. Neon on purpose so it never reads as part of the world grade. */
const GRID_INK = {
  edge: { diffuse: [0.15, 0.9, 1], emissive: [0.05, 0.35, 0.4], alpha: 0.5 },
  blocked: { diffuse: [1, 0.08, 0.1], emissive: [0.55, 0.02, 0.04], alpha: 0.42 },
  structure: { diffuse: [1, 0.82, 0.05], emissive: [0.5, 0.35, 0], alpha: 0.4 },
  slow: { diffuse: [1, 0.95, 0.15], emissive: [0.45, 0.4, 0], alpha: 0.36 },
  clear: { diffuse: [0.18, 1, 0.28], emissive: [0.08, 0.62, 0.12], alpha: 0.42 },
};

/**
 * Dev overlay: teal edges, rose blocked, ochre structure-slow, gold tree/shore slow.
 * Edges are static; occupancy fills refresh from live pass/slow/structureSlow masks.
 * @returns {{
 *   setVisible: (on: boolean) => void,
 *   refreshOccupancy: (field: object) => void,
 *   dispose: () => void,
 * }}
 */
export function createTileGridOverlay(engine, scene, field, opts = {}) {
  const { width, height } = field;
  const showEdges = opts.edges !== false;
  const edgePos = [];
  const edgeIdx = [];
  let ev = 0;
  let visible = false;

  /** @type {object | null} */
  let blockMesh = null;
  /** @type {object | null} */
  let structureSlowMesh = null;
  /** @type {object | null} */
  let slowMesh = null;

  function heightAtCorner(cx, cz) {
    return tileHeightWorld(field, cx, cz) + GRID_LIFT;
  }

  function fillHeightAtCorner(cx, cz, lift) {
    return tileHeightWorld(field, cx, cz) + lift;
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

  function pushFillQuad(tx, tz, lift, halfX, halfZ, posOut, idxOut, base) {
    const x0 = tx * TILE_SIZE_F - halfX + BLOCK_INSET;
    const x1 = (tx + 1) * TILE_SIZE_F - halfX - BLOCK_INSET;
    const z0 = tz * TILE_SIZE_F - halfZ + BLOCK_INSET;
    const z1 = (tz + 1) * TILE_SIZE_F - halfZ - BLOCK_INSET;
    const y00 = fillHeightAtCorner(tx, tz, lift);
    const y10 = fillHeightAtCorner(tx + 1, tz, lift);
    const y11 = fillHeightAtCorner(tx + 1, tz + 1, lift);
    const y01 = fillHeightAtCorner(tx, tz + 1, lift);
    // CW from +Y
    posOut.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
    idxOut.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base + 4;
  }

  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const activeMask = field.activeMask;
  if (showEdges) {
    for (let tz = 0; tz < height; tz++) {
      for (let tx = 0; tx < width; tx++) {
        if (activeMask && activeMask[tz * width + tx] === 0) continue;
        const x0 = tx * TILE_SIZE_F - half;
        const x1 = (tx + 1) * TILE_SIZE_F - half;
        const z0 = tz * TILE_SIZE_F - halfZ;
        const z1 = (tz + 1) * TILE_SIZE_F - halfZ;
        const y00 = heightAtCorner(tx, tz);
        const y10 = heightAtCorner(tx + 1, tz);
        const y01 = heightAtCorner(tx, tz + 1);
        const y11 = heightAtCorner(tx + 1, tz + 1);
        pushEdge(x0, y00, z0, x1, y10, z0);
        pushEdge(x0, y00, z0, x0, y01, z1);
        if (tx === width - 1) pushEdge(x1, y10, z0, x1, y11, z1);
        if (tz === height - 1) pushEdge(x0, y01, z1, x1, y11, z1);
      }
    }
  }

  const edgeMesh = showEdges && edgePos.length
    ? makeDevMesh(
      engine,
      'tile-grid',
      edgePos,
      edgeIdx,
      GRID_INK.edge,
    )
    : null;
  if (edgeMesh) {
    addToScene(scene, edgeMesh);
    setSubtreeVisible(edgeMesh, false);
  }

  function disposeDevMesh(mesh) {
    if (!mesh) return;
    softDetachMesh(scene, mesh);
  }

  function applyVisibility() {
    if (edgeMesh) setSubtreeVisible(edgeMesh, visible);
    if (blockMesh) setSubtreeVisible(blockMesh, visible);
    if (structureSlowMesh) setSubtreeVisible(structureSlowMesh, visible);
    if (slowMesh) setSubtreeVisible(slowMesh, visible);
  }

  function refreshOccupancy(snap) {
    if (!snap?.pass) return;
    const { pass, slowMask, structureSlowMask } = snap;
    const fillHalf = worldHalfFFromField(snap);
    const fillHalfZ = worldHalfZFFromField(snap);
    const w = snap.width | 0;
    const h = snap.height | 0;
    const blockPos = [];
    const blockIdx = [];
    let bv = 0;
    const structPos = [];
    const structIdx = [];
    let uv = 0;
    const slowPos = [];
    const slowIdx = [];
    let sv = 0;

    for (let tz = 0; tz < h; tz++) {
      for (let tx = 0; tx < w; tx++) {
        const i = tz * w + tx;
        if (snap.activeMask && snap.activeMask[i] === 0) continue;
        if (pass[i] === 0) {
          bv = pushFillQuad(tx, tz, BLOCK_LIFT, fillHalf, fillHalfZ, blockPos, blockIdx, bv);
        } else if (structureSlowMask?.[i]) {
          uv = pushFillQuad(tx, tz, STRUCT_SLOW_LIFT, fillHalf, fillHalfZ, structPos, structIdx, uv);
        } else if (slowMask?.[i]) {
          sv = pushFillQuad(tx, tz, SLOW_LIFT, fillHalf, fillHalfZ, slowPos, slowIdx, sv);
        }
      }
    }

    disposeDevMesh(blockMesh);
    blockMesh = null;
    disposeDevMesh(structureSlowMesh);
    structureSlowMesh = null;
    disposeDevMesh(slowMesh);
    slowMesh = null;

    if (bv > 0) {
      blockMesh = makeDevMesh(
        engine,
        'tile-blocked',
        blockPos,
        blockIdx,
        GRID_INK.blocked,
      );
      addToScene(scene, blockMesh);
      setSubtreeVisible(blockMesh, visible);
    }
    if (uv > 0) {
      // Ochre — farm / agora / slow buildings (blocks placement).
      structureSlowMesh = makeDevMesh(
        engine,
        'tile-structure-slow',
        structPos,
        structIdx,
        GRID_INK.structure,
      );
      addToScene(scene, structureSlowMesh);
      setSubtreeVisible(structureSlowMesh, visible);
    }
    if (sv > 0) {
      // Gold — trees / shore / rock border (pathing slow, placement OK).
      slowMesh = makeDevMesh(
        engine,
        'tile-slow',
        slowPos,
        slowIdx,
        GRID_INK.slow,
      );
      addToScene(scene, slowMesh);
      setSubtreeVisible(slowMesh, visible);
    }
  }

  refreshOccupancy(field);

  return {
    setVisible(on) {
      visible = !!on;
      applyVisibility();
    },
    refreshOccupancy,
    dispose() {
      disposeDevMesh(edgeMesh);
      disposeDevMesh(blockMesh);
      disposeDevMesh(structureSlowMesh);
      disposeDevMesh(slowMesh);
      blockMesh = null;
      structureSlowMesh = null;
      slowMesh = null;
    },
  };
}

function clampPlacementWindow(field, win) {
  const w = field.width | 0;
  const h = field.height | 0;
  const x0 = Math.max(0, win.x0 | 0);
  const z0 = Math.max(0, win.z0 | 0);
  const x1 = Math.min(w, win.x1 | 0);
  const z1 = Math.min(h, win.z1 | 0);
  if (x1 <= x0 || z1 <= z0) return null;
  return { x0, z0, x1, z1 };
}

function placementOccupancySignature(field, win) {
  let s = `${win.x0},${win.z0},${win.x1},${win.z1}:`;
  for (let tz = win.z0; tz < win.z1; tz++) {
    for (let tx = win.x0; tx < win.x1; tx++) {
      const kind = classifyGridTile(field, tx, tz);
      s += kind ? kind[0] : '-';
    }
  }
  return s;
}

/**
 * Placement-only G-grid: same ink plus green open tiles, clipped to the ghost pad.
 * @returns {{
 *   setFocus: (field: object | null, pos: { type: string, x: number, z: number, valid?: boolean } | null) => void,
 *   dispose: () => void,
 * }}
 */
export function createPlacementGridOverlay(engine, scene) {
  /** @type {object | null} */
  let edgeMesh = null;
  /** @type {object | null} */
  let blockMesh = null;
  /** @type {object | null} */
  let structureSlowMesh = null;
  /** @type {object | null} */
  let slowMesh = null;
  /** @type {object | null} */
  let clearMesh = null;
  let lastSig = '';

  function disposeDevMesh(mesh) {
    if (!mesh) return;
    softDetachMesh(scene, mesh);
  }

  function clearMeshes() {
    disposeDevMesh(edgeMesh);
    disposeDevMesh(blockMesh);
    disposeDevMesh(structureSlowMesh);
    disposeDevMesh(slowMesh);
    disposeDevMesh(clearMesh);
    edgeMesh = null;
    blockMesh = null;
    structureSlowMesh = null;
    slowMesh = null;
    clearMesh = null;
  }

  function hide() {
    lastSig = '';
    clearMeshes();
  }

  function heightAtCorner(field, cx, cz) {
    if (!field.heightMap || !field.terrainTypes) return GRID_LIFT;
    return tileHeightWorld(field, cx, cz) + GRID_LIFT;
  }

  function fillHeightAtCorner(field, cx, cz, lift) {
    if (!field.heightMap || !field.terrainTypes) return lift;
    return tileHeightWorld(field, cx, cz) + lift;
  }

  function pushLocalEdge(ax, ay, az, bx, by, bz, posOut, idxOut, base) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * GRID_HALF;
    const pz = (dx / len) * GRID_HALF;
    posOut.push(
      ax + px, ay, az + pz,
      bx + px, by, bz + pz,
      bx - px, by, bz - pz,
      ax - px, ay, az - pz,
    );
    idxOut.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base + 4;
  }

  function pushLocalFill(field, tx, tz, lift, halfX, halfZ, posOut, idxOut, base) {
    const x0 = tx * TILE_SIZE_F - halfX + BLOCK_INSET;
    const x1 = (tx + 1) * TILE_SIZE_F - halfX - BLOCK_INSET;
    const z0 = tz * TILE_SIZE_F - halfZ + BLOCK_INSET;
    const z1 = (tz + 1) * TILE_SIZE_F - halfZ - BLOCK_INSET;
    const y00 = fillHeightAtCorner(field, tx, tz, lift);
    const y10 = fillHeightAtCorner(field, tx + 1, tz, lift);
    const y11 = fillHeightAtCorner(field, tx + 1, tz + 1, lift);
    const y01 = fillHeightAtCorner(field, tx, tz + 1, lift);
    posOut.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
    idxOut.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base + 4;
  }

  function rebuild(field, win) {
    clearMeshes();
    const half = worldHalfFFromField(field);
    const halfZ = worldHalfZFFromField(field);
    const edgePos = [];
    const edgeIdx = [];
    let ev = 0;
    const blockPos = [];
    const blockIdx = [];
    let bv = 0;
    const structPos = [];
    const structIdx = [];
    let uv = 0;
    const slowPos = [];
    const slowIdx = [];
    let sv = 0;
    const clearPos = [];
    const clearIdx = [];
    let cv = 0;

    for (let tz = win.z0; tz < win.z1; tz++) {
      for (let tx = win.x0; tx < win.x1; tx++) {
        const kind = classifyGridTile(field, tx, tz);
        if (!kind) continue;
        const x0 = tx * TILE_SIZE_F - half;
        const x1 = (tx + 1) * TILE_SIZE_F - half;
        const z0 = tz * TILE_SIZE_F - halfZ;
        const z1 = (tz + 1) * TILE_SIZE_F - halfZ;
        const y00 = heightAtCorner(field, tx, tz);
        const y10 = heightAtCorner(field, tx + 1, tz);
        const y01 = heightAtCorner(field, tx, tz + 1);
        const y11 = heightAtCorner(field, tx + 1, tz + 1);
        ev = pushLocalEdge(x0, y00, z0, x1, y10, z0, edgePos, edgeIdx, ev);
        ev = pushLocalEdge(x0, y00, z0, x0, y01, z1, edgePos, edgeIdx, ev);
        if (tx === win.x1 - 1) ev = pushLocalEdge(x1, y10, z0, x1, y11, z1, edgePos, edgeIdx, ev);
        if (tz === win.z1 - 1) ev = pushLocalEdge(x0, y01, z1, x1, y11, z1, edgePos, edgeIdx, ev);
        const fill = placementFillKind(kind, tx, tz, win);
        if (fill === 'blocked') {
          bv = pushLocalFill(field, tx, tz, BLOCK_LIFT, half, halfZ, blockPos, blockIdx, bv);
        } else if (fill === 'structure') {
          uv = pushLocalFill(field, tx, tz, STRUCT_SLOW_LIFT, half, halfZ, structPos, structIdx, uv);
        } else if (fill === 'slow') {
          sv = pushLocalFill(field, tx, tz, SLOW_LIFT, half, halfZ, slowPos, slowIdx, sv);
        } else if (fill === 'clear') {
          cv = pushLocalFill(field, tx, tz, CLEAR_LIFT, half, halfZ, clearPos, clearIdx, cv);
        }
      }
    }

    if (ev > 0) {
      edgeMesh = makeDevMesh(engine, 'place-grid', edgePos, edgeIdx, GRID_INK.edge);
      addToScene(scene, edgeMesh);
      setSubtreeVisible(edgeMesh, true);
    }
    if (bv > 0) {
      blockMesh = makeDevMesh(engine, 'place-blocked', blockPos, blockIdx, GRID_INK.blocked);
      addToScene(scene, blockMesh);
      setSubtreeVisible(blockMesh, true);
    }
    if (uv > 0) {
      structureSlowMesh = makeDevMesh(
        engine,
        'place-structure-slow',
        structPos,
        structIdx,
        GRID_INK.structure,
      );
      addToScene(scene, structureSlowMesh);
      setSubtreeVisible(structureSlowMesh, true);
    }
    if (sv > 0) {
      slowMesh = makeDevMesh(engine, 'place-slow', slowPos, slowIdx, GRID_INK.slow);
      addToScene(scene, slowMesh);
      setSubtreeVisible(slowMesh, true);
    }
    if (cv > 0) {
      clearMesh = makeDevMesh(engine, 'place-clear', clearPos, clearIdx, GRID_INK.clear);
      addToScene(scene, clearMesh);
      setSubtreeVisible(clearMesh, true);
    }
  }

  return {
    /**
     * @param {object | null} field
     * @param {{ type: string, x: number, z: number, valid?: boolean } | null} pos World-space snapped ghost.
     */
    setFocus(field, pos) {
      if (!field?.pass || !pos?.type) {
        hide();
        return;
      }
      const win = placementGridWindow(pos.type, fx.fromFloat(pos.x), fx.fromFloat(pos.z));
      const clamped = win ? clampPlacementWindow(field, win) : null;
      if (!clamped) {
        hide();
        return;
      }
      const valid = pos.valid !== false;
      const sig = `${pos.type}:${valid ? 1 : 0}:${placementOccupancySignature(field, clamped)}`;
      if (sig === lastSig) return;
      lastSig = sig;
      rebuild(field, {
        ...clamped,
        claimX0: win.claimX0,
        claimZ0: win.claimZ0,
        claimX1: win.claimX1,
        claimZ1: win.claimZ1,
        valid,
      });
    },
    dispose() {
      hide();
    },
  };
}

function makeDevMesh(engine, name, positions, indices, ink) {
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const normals = flatUpNormals(pos.length / 3);
  const mesh = createMeshFromData(engine, name, pos, normals, idx);
  const mat = createStandardMaterial();
  mat.diffuseColor = ink.diffuse;
  mat.emissiveColor = ink.emissive;
  mat.ambientColor = ink.emissive;
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.alpha = ink.alpha ?? 1;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  return mesh;
}
