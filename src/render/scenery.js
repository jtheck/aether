// Static v1-style tree/rock sprites, batched with Lite thin instances.

import {
  cloneTransformNode,
  createMeshFromData,
  createStandardMaterial,
  flushThinInstances,
  getOrCreateSampler,
  loadGltf,
  loadTexture2D,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { SCENERY } from '../sim/scenery.js';
import { TILE_SIZE_F, WORLD_HALF_F } from '../sim/field.js';
import { treeScaleForStage, treeStageFromStock } from '../sim/trees.js';

const ATLAS_URL = '/assets/textures/atlas-hd.png';
const ATLAS_GRID = 8;
const CELL_INSET = 0.0015;
const PLANE_SIZE = 3;
const LOD_UPDATE_MS = 120;
const LOD_MOVE_THRESHOLD_SQ = 16;
const placementScratch = new Float64Array(16);

const VARIANTS = [
  {
    kind: SCENERY.TREE,
    name: 'trees',
    cell: 0,
    modelUrl: '/assets/models/trees.glb',
    modelScale: 0.9,
    billboardScale: 2.4,
    billboardYOffset: -0.6,
    lodDistance: 480,
  },
  {
    kind: SCENERY.ROCK_PLAIN,
    name: 'rocks-plain',
    cell: 1,
    modelUrl: '/assets/models/rocks_plain.glb',
    modelScale: 3,
    billboardScale: 3,
    billboardYOffset: -0.8,
    lodDistance: 520,
  },
  {
    kind: SCENERY.ROCK_MOSS,
    name: 'rocks-moss',
    cell: 2,
    modelUrl: '/assets/models/rocks_moss.glb',
    modelScale: 7.5,
    billboardScale: 5.9,
    billboardYOffset: -0.8,
    lodDistance: 520,
  },
  {
    kind: SCENERY.ROCK_SNOW,
    name: 'rocks-snow',
    cell: 3,
    modelUrl: '/assets/models/rocks_snow.glb',
    modelScale: 11.5,
    billboardScale: 7.5,
    billboardYOffset: -0.8,
    lodDistance: 520,
  },
];

/** @type {WeakMap<object, Promise<object>>} */
const atlasByEngine = new WeakMap();
/** @type {WeakMap<object, Map<string, Promise<object>>>} */
const modelContainersByEngine = new WeakMap();

/**
 * @param {object} engine
 * @param {object} field
 * @param {(field: object, x: number, z: number) => number} surfaceHeightAt
 * @param {object} camera
 * @param {{ emitFire?: (x: number, y: number, z: number, scale: number) => void }} [opts]
 */
export async function createSceneryFromField(engine, field, surfaceHeightAt, camera, opts = {}) {
  if (!field?.sceneryType) {
    return { meshes: [], update() {}, applyTreeUpdates() {} };
  }
  const atlas = await getAtlas(engine);
  const meshes = [];
  const batches = [];
  /** @type {Map<number, { batch: object, index: number }>} */
  const treeByTile = new Map();

  for (const variant of VARIANTS) {
    const instances = collectInstances(field, variant, surfaceHeightAt);
    if (instances.length === 0) continue;

    const billboardMesh = createBillboardMesh(engine, variant, atlas);
    const billboardMatrices = new Float32Array(instances.length * 16);
    setThinInstances(billboardMesh, billboardMatrices, instances.length);
    billboardMesh.pickable = false;
    meshes.push(billboardMesh);

    const modelParts = await loadModelParts(engine, variant);
    for (const part of modelParts) {
      part.matrices = new Float32Array(instances.length * 16);
      setThinInstances(part.mesh, part.matrices, instances.length);
      part.mesh.pickable = false;
      meshes.push(part.mesh);
    }

    const batch = {
      variant,
      instances,
      billboardMesh,
      billboardMatrices,
      modelParts,
      dirty: true,
    };
    batches.push(batch);
    if (variant.kind === SCENERY.TREE) {
      for (let i = 0; i < instances.length; i++) {
        treeByTile.set(instances[i].tileIndex, { batch, index: i });
      }
    }
  }

  let elapsed = LOD_UPDATE_MS;
  let fireElapsed = 0;
  let lastCameraX = Infinity;
  let lastCameraY = Infinity;
  let lastCameraZ = Infinity;

  function update(activeCamera = camera, deltaMs = LOD_UPDATE_MS, force = false) {
    if (!activeCamera) return;
    elapsed += deltaMs;
    fireElapsed += deltaMs;
    const cameraPos = cameraPosition(activeCamera);
    const movedSq =
      (cameraPos.x - lastCameraX) ** 2 +
      (cameraPos.y - lastCameraY) ** 2 +
      (cameraPos.z - lastCameraZ) ** 2;
    const lodDue = force || elapsed >= LOD_UPDATE_MS || movedSq >= LOD_MOVE_THRESHOLD_SQ;
    let anyDirty = false;
    for (let b = 0; b < batches.length; b++) {
      if (batches[b].dirty) { anyDirty = true; break; }
    }
    if (lodDue || anyDirty) {
      if (lodDue) {
        elapsed = 0;
        lastCameraX = cameraPos.x;
        lastCameraY = cameraPos.y;
        lastCameraZ = cameraPos.z;
      }
      for (const batch of batches) {
        if (!batch.dirty && !lodDue) continue;
        updateBatchLod(batch, cameraPos);
        batch.dirty = false;
      }
    }
    if (opts.emitFire && fireElapsed >= 48) {
      fireElapsed = 0;
      for (const batch of batches) {
        if (batch.variant.kind !== SCENERY.TREE) continue;
        for (let i = 0; i < batch.instances.length; i++) {
          const p = batch.instances[i];
          if (!(p.burn > 0) || p.stock <= 0) continue;
          // Full-tree spray — emitter spreads wisps from trunk to crown.
          opts.emitFire(p.x, p.y, p.z, Math.max(0.65, p.stockScale));
        }
      }
    }
  }

  function applyTreeUpdates(updates) {
    if (!updates?.tiles?.length) return;
    const { tiles, stock, burn } = updates;
    for (let i = 0; i < tiles.length; i++) {
      const ref = treeByTile.get(tiles[i]);
      if (!ref) continue;
      const p = ref.batch.instances[ref.index];
      p.stock = stock[i];
      p.burn = burn[i];
      const stage = treeStageFromStock(p.stock);
      p.stockScale = treeScaleForStage(stage);
      ref.batch.dirty = true;
    }
  }

  update(camera, LOD_UPDATE_MS, true);
  return { meshes, update, applyTreeUpdates };
}

async function getAtlas(engine) {
  let promise = atlasByEngine.get(engine);
  if (promise) return promise;
  promise = loadTexture2D(engine, ATLAS_URL, {
    srgb: true,
    mipMaps: true,
    invertY: false,
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
  }).then((texture) => {
    texture.sampler = getOrCreateSampler(engine, {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'linear',
      maxAnisotropy: 4,
    });
    return texture;
  });
  atlasByEngine.set(engine, promise);
  return promise;
}

async function loadModelParts(engine, variant) {
  let cache = modelContainersByEngine.get(engine);
  if (!cache) {
    cache = new Map();
    modelContainersByEngine.set(engine, cache);
  }
  let promise = cache.get(variant.modelUrl);
  if (!promise) {
    promise = loadGltf(engine, variant.modelUrl);
    cache.set(variant.modelUrl, promise);
  }
  const container = await promise;
  // Cloning the hierarchy assigns real parent links and computes the node
  // world matrices; the raw asset container only stores child arrays.
  const root = cloneTransformNode(container.entities[0]);
  const sources = [];
  collectRenderableMeshes(root, sources);
  if (sources.length === 0) throw new Error(`no scenery mesh in ${variant.modelUrl}`);
  return sources.map((source, index) => {
    // Bake authored hierarchy transforms once. Required for trees: their GLB
    // node supplies the upright orientation and most of their height.
    const mesh = bakeModelMesh(
      engine,
      source,
      source.worldMatrix,
      `scenery-model-${variant.name}-${index}`,
      variant.kind === SCENERY.TREE,
    );
    const baseMatrix = identityMatrix();
    return { mesh, baseMatrix, matrices: null };
  });
}

function bakeModelMesh(engine, source, world, name, isTree = false) {
  const srcPositions = source._cpuPositions;
  const srcIndices = source._cpuIndices;
  if (!srcPositions || !srcIndices) {
    throw new Error(`scenery mesh "${source.name}" has no CPU geometry`);
  }

  const positions = new Float32Array(srcPositions.length);
  for (let i = 0; i < srcPositions.length; i += 3) {
    const x = srcPositions[i];
    const y = srcPositions[i + 1];
    const z = srcPositions[i + 2];
    positions[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    positions[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    positions[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }

  // trees.glb is authored at scale ~[-1, -5.8, -1.2]. Transforming sourced
  // normals through that (either M or M^{-T}) inverts / flattens lighting.
  // Rebuild from baked triangles so N matches the final mesh + Lite's LH winding.
  const indices = new Uint32Array(srcIndices);
  const normals = computeSmoothNormalsLH(positions, indices);

  const mesh = createMeshFromData(
    engine,
    name,
    positions,
    normals,
    indices,
    source._cpuUvs ? new Float32Array(source._cpuUvs) : undefined,
  );
  mesh.material = prepareSceneryMaterial(source.material, isTree);
  mesh.pickable = false;
  // Recomputed normals assume CW fronts (Lite LH); show CW faces.
  mesh._reverseWinding = true;
  return mesh;
}

/**
 * Match v1: kill emissive. Untextured tree green blows out under outdoor sun
 * without tonemap — pull that albedo down harder than rock greys.
 */
function prepareSceneryMaterial(sourceMat, isTree) {
  if (!sourceMat) return sourceMat;
  const mat = sourceMat;
  if (mat.emissiveColor) mat.emissiveColor = [0, 0, 0];
  if (mat.emissiveIntensity != null) mat.emissiveIntensity = 0;
  const f = mat.baseColorFactor;
  if (isTree && Array.isArray(f) && f.length >= 3) {
    const k = 0.42;
    mat.baseColorFactor = [f[0] * k, f[1] * k, f[2] * k, f[3] ?? 1];
  }
  mat._renderFeatures = undefined;
  mat._uboVersion = (mat._uboVersion ?? 0) + 1;
  return mat;
}

/** Smooth normals for Lite left-handed / CW front faces (AC × AB). */
function computeSmoothNormalsLH(positions, indices) {
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

function collectRenderableMeshes(node, out) {
  if (node?.material) out.push(node);
  for (const child of node?.children ?? []) collectRenderableMeshes(child, out);
}

function createBillboardMesh(engine, variant, atlas) {
  const half = PLANE_SIZE * 0.5;
  const positions = new Float32Array([
    -half, 0, 0, half, 0, 0, half, PLANE_SIZE, 0, -half, PLANE_SIZE, 0,
    0, 0, -half, 0, 0, half, 0, PLANE_SIZE, half, 0, PLANE_SIZE, -half,
  ]);
  const normals = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  const cellSize = 1 / ATLAS_GRID;
  const u0 = variant.cell * cellSize + CELL_INSET;
  const u1 = (variant.cell + 1) * cellSize - CELL_INSET;
  const v0 = CELL_INSET;
  const v1 = cellSize - CELL_INSET;
  const uvs = new Float32Array([
    u0, v1, u1, v1, u1, v0, u0, v0,
    u0, v1, u1, v1, u1, v0, u0, v0,
  ]);
  const mesh = createMeshFromData(
    engine,
    `scenery-${variant.name}`,
    positions,
    normals,
    indices,
    uvs,
  );
  const mat = createStandardMaterial();
  mat.diffuseTexture = atlas;
  mat.opacityTexture = atlas;
  mat.opacityFromRGB = false;
  mat.alphaCutOff = 0.35;
  mat.diffuseColor = [1, 1, 1];
  mat.ambientColor = [0.7, 0.7, 0.65];
  mat.emissiveColor = [0.12, 0.12, 0.1];
  mat.specularColor = [0, 0, 0];
  mat.backFaceCulling = false;
  mesh.material = mat;
  return mesh;
}

function collectInstances(field, variant, surfaceHeightAt) {
  const out = [];
  const { width, height, seed, sceneryType, treeStock } = field;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (sceneryType[i] !== variant.kind) continue;
      const placement = deterministicPlacement(tx, tz, seed, variant.kind);
      const x = (tx + 0.5) * TILE_SIZE_F - WORLD_HALF_F + placement.offsetX;
      const z = (tz + 0.5) * TILE_SIZE_F - WORLD_HALF_F + placement.offsetZ;
      const groundY = surfaceHeightAt(field, x, z);
      const stock = variant.kind === SCENERY.TREE
        ? (treeStock?.[i] ?? TREE_STAGE_FALLBACK_STOCK)
        : 0;
      const stockScale = variant.kind === SCENERY.TREE
        ? treeScaleForStage(treeStageFromStock(stock))
        : 1;
      out.push({
        tileIndex: i,
        x,
        y: groundY,
        z,
        yaw: placement.yaw,
        stock,
        burn: 0,
        stockScale,
      });
    }
  }
  return out;
}

// Fallback if an older snapshot omits treeStock (full-size tree).
const TREE_STAGE_FALLBACK_STOCK = 42;

function updateBatchLod(batch, cameraPos) {
  const {
    variant,
    instances,
    billboardMesh,
    billboardMatrices,
    modelParts,
  } = batch;
  const lodDistanceSq = variant.lodDistance * variant.lodDistance;
  for (let i = 0; i < instances.length; i++) {
    const p = instances[i];
    const stockScale = p.stockScale ?? 1;
    if (variant.kind === SCENERY.TREE && stockScale <= 0) {
      for (const part of modelParts) writeHiddenMatrix(part.matrices, i);
      writeHiddenMatrix(billboardMatrices, i);
      continue;
    }
    const modelScale = variant.modelScale * stockScale;
    const billboardScale = variant.billboardScale * stockScale;
    const dx = cameraPos.x - p.x;
    const dy = cameraPos.y - p.y;
    const dz = cameraPos.z - p.z;
    const near = dx * dx + dy * dy + dz * dz <= lodDistanceSq;
    if (near) {
      for (const part of modelParts) {
        writeModelInstanceMatrix(
          part.matrices,
          i,
          p.x,
          p.y,
          p.z,
          p.yaw,
          modelScale,
          part.baseMatrix,
        );
      }
      writeHiddenMatrix(billboardMatrices, i);
    } else {
      for (const part of modelParts) writeHiddenMatrix(part.matrices, i);
      writeInstanceMatrix(
        billboardMatrices,
        i,
        p.x,
        p.y + variant.billboardYOffset * billboardScale,
        p.z,
        p.yaw,
        billboardScale,
      );
    }
  }
  for (const part of modelParts) flushThinInstances(part.mesh);
  flushThinInstances(billboardMesh);
}

function cameraPosition(camera) {
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
    return {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };
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

function deterministicPlacement(tx, tz, seed, kind) {
  let hash = kind === SCENERY.TREE
    ? seed + tx * 13579 + tz * 24680
    : seed + tx * 73856093 + tz * 19349663;
  hash = (hash * 1664525 + 1013904223) >>> 0;
  const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
  hash = (hash * 1664525 + 1013904223) >>> 0;
  const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
  hash = (hash * 1664525 + 1013904223) >>> 0;
  return { offsetX, offsetZ, yaw: (hash % 628) / 100 };
}

function writeHiddenMatrix(matrices, slot) {
  const o = slot * 16;
  for (let i = 0; i < 16; i++) matrices[o + i] = 0;
}

function writeModelInstanceMatrix(
  matrices,
  slot,
  x,
  y,
  z,
  yaw,
  scale,
  baseMatrix,
) {
  writeInstanceMatrix(placementScratch, 0, x, y, z, yaw, scale);
  const o = slot * 16;
  // Column-major placement × authored GLB transform. This keeps negative/model
  // scales on geometry without mirroring the world-space instance translation.
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let k = 0; k < 4; k++) {
        value += placementScratch[k * 4 + row] * baseMatrix[col * 4 + k];
      }
      matrices[o + col * 4 + row] = value;
    }
  }
}

function writeInstanceMatrix(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  matrices[o] = c * scale;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * scale;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = scale;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * scale;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * scale;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function identityMatrix() {
  const out = new Float64Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}
