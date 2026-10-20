// Static v1-style tree/rock sprites, batched with Lite thin instances.

import {
  addToScene,
  cloneTransformNode,
  createMeshFromData,
  createStandardMaterial,
  flushThinInstances,
  getOrCreateSampler,
  loadGltf,
  loadTexture2D,
  setPbrEmissive,
  setStandardOpacityTexture,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { SCENERY, ROCK_MESH_WIDTH, rockLayerScale, rockStackCount } from '../sim/scenery.js';
import { TILE_SIZE_F, worldHalfFFromField, worldHalfZFFromField } from '../sim/field.js';
import {
  TREE_BURN_DAMAGE,
  TREE_BURN_DAMAGE_INTERVAL,
  TREE_STAGE_GROVE_MAX,
  TREE_STAGE_MAX,
  treeBurnsToDeath,
  treeScaleForStage,
  treeStageFromStock,
} from '../sim/trees.js';
import { capacityFor } from '../sim/capacity.js';
import { SCENERY_LOD_ROCK, SCENERY_LOD_TREE } from './lodDistances.js';
import { hasBakedMesh } from './bakedAssets.js';
import { boundsOfPositions } from './bakeMerge.js';
import { nearestMeshInstanceHit, pickPartsFromMeshes } from './meshPick.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { softDetachMesh } from './meshLifecycle.js';
import { SCALE_BOUNCE_MS, stageDropScale } from './scaleBounce.js';
import { treeFireHeight } from './treeFire.js';

const ATLAS_URL = '/assets/textures/atlas-hd.png';
const ATLAS_GRID = 8;
const CELL_INSET = 0.0015;
const PLANE_SIZE = 3;
const LOD_UPDATE_MS = 120;
const LOD_MOVE_THRESHOLD_SQ = 16;
/** Initial scenery batch size; grows by powers of two. */
const SCENERY_INITIAL = 32;
/** Grow-in from sapling (spore / revive). */
const TREE_GROW_IN_MS = 1600;
/** Stage-to-stage shrink (fire / chip) — bump, undershoot, settle. */
const TREE_SHRINK_MS = SCALE_BOUNCE_MS;
/** Full fell → vanish (after drip beat). */
const TREE_FELL_MS = 1400;
/** Hold full size while ink drips, then melt. */
const TREE_FELL_DELAY_MS = 850;
/** Charred tree lowers into the ground once the fire is out. Full size the whole way. */
const TREE_BURN_SINK_MS = 1200;
/** Extra bury past the crown so the tip clears the surface. */
const TREE_BURN_SINK_MARGIN = 0.35;
/** Never-seen trees/rocks — match the heavier shroud. */
const FOG_DIM = 0.16;
/** Visited trees/rocks — mid step, darker than sight, lighter than wilderness. */
const VISITED_DIM = 0.50;
/** Matches fogOfWar VISITED_ALPHA / 255 so the mid step lands on explored tiles. */
const VISITED_FOG_T = 110 / 255;
/** Current sight matches unfogged albedo — the overlay hole is already clear. */
const SIGHT_LIFT = 1;
/** How long a gather-click flash lasts on the targeted tree / rock. */
const HARVEST_PING_MS = 280;
/** 0.5 → one peak then rest. */
const HARVEST_PULSES = 0.5;
/** Peak albedo scale on top of fog dim (trees sit at ~0.24). */
const HARVEST_PEAK = 2.15;
/** Time to full lean + char once a tree will burn down. */
const TREE_BURN_CHAR_MS = 6200;
/** Near-black charcoal (keep a hair of warmth so they don't vanish). */
const TREE_CHAR_RGB = [0.032, 0.02, 0.016];

function fogAlbedoScale(t) {
  if (t <= 0) return SIGHT_LIFT;
  if (t >= 1) return FOG_DIM;
  if (t <= VISITED_FOG_T) {
    return SIGHT_LIFT + (t / VISITED_FOG_T) * (VISITED_DIM - SIGHT_LIFT);
  }
  return VISITED_DIM + ((t - VISITED_FOG_T) / (1 - VISITED_FOG_T)) * (FOG_DIM - VISITED_DIM);
}

/** 1 = full leaf color (current sight), 0 = gray (visited / unseen). */
function fogChroma(t) {
  if (t <= 0) return 1;
  if (t >= VISITED_FOG_T) return 0;
  return 1 - t / VISITED_FOG_T;
}

/**
 * Dark (never-seen) tiles still read leafy — gray instance color × green albedo.
 * Mid/visited stays as-is; peak the green-kill on the shroud.
 */
function unseenGreenKill(t) {
  if (t <= VISITED_FOG_T) return 0;
  if (t >= 1) return 1;
  return (t - VISITED_FOG_T) / (1 - VISITED_FOG_T);
}
/**
 * Untextured PBR + outdoor key / 2.15 exposure reads as a chalk wash.
 * Thin-instance color multiplies albedo (same path as fog). Tree cards
 * upload a compressed gray; rocks use BILLBOARD_ROCK_LIFT.
 */
const TREE_ALBEDO_DIM = 0.24;
const ROCK_ALBEDO_DIM = 0.30;
/** Atlas cards share the mesh tint’s brightness. The tint itself is a green
 *  push for the untextured GLB, and on the painted card that push goes neon. */
const BILLBOARD_ROCK_LIFT = 2.5;
/** Gray multiply for a tree card. Mature sight sits at MID; saplings ease to HI.
 *  A floor at 0.58 lifted rim giants (luma ~0.05) onto the same gray as a
 *  normal card, and the sun clamp then blew that limb out on the board edge. */
const BILLBOARD_TREE_LO = 0.26;
const BILLBOARD_TREE_MID = 0.655;
const BILLBOARD_TREE_HI = 0.72;
/** Mature in-sight luma. Darker than this is a rim giant, not a fogged sapling. */
const BILLBOARD_LUMA_PIVOT = 0.13;
const BILLBOARD_LUMA_HI = 0.38;
/** How far past the mesh ring a card eases up to full billboard brightness. */
const BILLBOARD_EDGE_BAND = 0.14;
/** Brightness of a card sitting on the mesh ring, relative to a far card. */
const BILLBOARD_EDGE_SCALE = 0.62;
/** Dull sheen. A wide highlight on seen ground and the vision edge reads as chrome. */
const TREE_SPEC_SIGHT = { color: [0.03, 0.032, 0.035], power: 48 };
/** Sapling — brighter leaf green. Same multiply range as TREE_ALBEDO_DIM. */
const TREE_TINT_SMALL = [0.26, 0.48, 0.16];
/** Mature canopy — same green, much darker. */
const TREE_TINT_BIG = [0.07, 0.12, 0.045];
/** Grove / table-rim giants — deeper pine past the natural cap. */
const TREE_TINT_GROVE = [0.042, 0.078, 0.052];
/** Same-stage trees scatter this far along the size→tint axis (0–1). */
const TREE_TINT_JITTER = 0.55;
/** Extra yellow ↔ pine wander once a tree outgrows the natural scale. */
const TREE_GROVE_HUE_JITTER = 0.22;
const TREE_SCALE_LO = treeScaleForStage(1);
const TREE_SCALE_HI = treeScaleForStage(TREE_STAGE_MAX);
const TREE_SCALE_GROVE = treeScaleForStage(TREE_STAGE_GROVE_MAX);

function treeTintHash(tileIndex) {
  return ((Math.imul(tileIndex | 0, 1103515245) + 12345) >>> 16) / 65535;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** World-Y drop that puts the crown under the surface. Scale stays put. */
export function treeBurnSinkDepth(stockScale) {
  return treeFireHeight(stockScale) + TREE_BURN_SINK_MARGIN;
}

/** Ease-out drop: starts immediately, settles under the ground. */
export function treeBurnSinkDrop(t, depth) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 2;
  return depth * u;
}

function resetBurnVisual(p) {
  p.lean = 0;
  p.char = 0;
  p.burnT = 0;
  p.burnLeanSign = 0;
  p.burnLeanMax = 0;
  p.burnDurMs = 0;
  p.burnFlushLean = 0;
  p.burnFlushChar = 0;
  p.sinking = false;
  p.sinkT = 0;
  p.sink = 0;
  p.sinkDepth = 0;
}

function burnDownMs(stock, burn) {
  const hits = Math.floor((burn - 1) / TREE_BURN_DAMAGE_INTERVAL);
  const need = Math.ceil(stock / TREE_BURN_DAMAGE);
  const left = Math.min(hits, need);
  return Math.max(1600, left * TREE_BURN_DAMAGE_INTERVAL * 50);
}

function initBurnVisual(p) {
  const h = treeTintHash(p.tileIndex);
  const h2 = treeTintHash((p.tileIndex | 0) ^ 0x9e3779b9);
  p.burnLeanSign = h < 0.5 ? -1 : 1;
  p.burnLeanMax = ((30 + h2 * 10) * Math.PI) / 180;
  p.burnDurMs = Math.min(TREE_BURN_CHAR_MS, burnDownMs(p.stock, p.burn));
}

function treeDoomed(p) {
  return p.burn > 0 && treeBurnsToDeath(p.stock, p.burn);
}

/** Ease-in so they stay upright at first, then list as they charcoal. */
function advanceBurnVisual(p, dt) {
  if (treeDoomed(p)) {
    if (!p.burnLeanSign) initBurnVisual(p);
    const nextT = Math.min(1, (p.burnT ?? 0) + dt / (p.burnDurMs || TREE_BURN_CHAR_MS));
    if (nextT === (p.burnT ?? 0)) return false;
    p.burnT = nextT;
    const ease = nextT * nextT;
    p.lean = ease * p.burnLeanMax * p.burnLeanSign;
    p.char = ease;
    const moved =
      Math.abs(p.lean - (p.burnFlushLean ?? 0)) > 0.012
      || Math.abs(p.char - (p.burnFlushChar ?? 0)) > 0.025;
    if (moved) {
      p.burnFlushLean = p.lean;
      p.burnFlushChar = p.char;
    }
    return moved;
  }
  if ((p.char ?? 0) > 0 && p.stock <= 0) return false;
  if ((p.char ?? 0) > 0 && p.burn === 0 && p.stock > 0) {
    resetBurnVisual(p);
    return true;
  }
  return false;
}

export function treeTintRgb(scale, tileIndex) {
  const span = TREE_SCALE_HI - TREE_SCALE_LO || 1;
  const jitter = (treeTintHash(tileIndex) - 0.5) * TREE_TINT_JITTER;
  const t = (scale - TREE_SCALE_LO) / span + jitter;
  if (t <= 1) return lerp3(TREE_TINT_SMALL, TREE_TINT_BIG, clamp01(t));

  const groveSpan = TREE_SCALE_GROVE - TREE_SCALE_HI || 1;
  const u = clamp01((t - 1) * span / groveSpan);
  const eased = u * u * (3 - 2 * u);
  const rgb = lerp3(TREE_TINT_BIG, TREE_TINT_GROVE, eased);
  const hue = (treeTintHash((tileIndex | 0) ^ 0x9e3779b9) - 0.5) * TREE_GROVE_HUE_JITTER * eased;
  return [
    clamp01(rgb[0] + hue * 0.55),
    clamp01(rgb[1] + hue * 0.10),
    clamp01(rgb[2] - hue * 0.40),
  ];
}
const placementScratch = new Float64Array(16);

function setThinInstanceCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  if (count > ti._capacity) {
    throw new Error(`thin-instance count ${count} exceeds capacity ${ti._capacity}`);
  }
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
  mesh.visible = count > 0;
}

const VARIANTS = [
  {
    kind: SCENERY.TREE,
    name: 'trees',
    cell: 0,
    modelUrl: '/assets/models/trees.glb',
    modelScale: 0.9,
    billboardScale: 2.4,
    billboardYOffset: -0.6,
    lodDistance: SCENERY_LOD_TREE,
  },
  {
    kind: SCENERY.ROCK_PLAIN,
    name: 'rocks-plain',
    cell: 1,
    modelUrl: '/assets/models/rocks_plain.glb',
    modelScale: ROCK_MESH_WIDTH[SCENERY.ROCK_PLAIN],
    stackLift: ROCK_MESH_WIDTH[SCENERY.ROCK_PLAIN] * 0.42,
    billboardScale: 3,
    billboardYOffset: -0.8,
    lodDistance: SCENERY_LOD_ROCK,
  },
  {
    kind: SCENERY.ROCK_MOSS,
    name: 'rocks-moss',
    cell: 2,
    modelUrl: '/assets/models/rocks_moss.glb',
    modelScale: ROCK_MESH_WIDTH[SCENERY.ROCK_MOSS],
    stackLift: ROCK_MESH_WIDTH[SCENERY.ROCK_MOSS] * 0.42,
    billboardScale: 5.9,
    billboardYOffset: -0.8,
    lodDistance: SCENERY_LOD_ROCK,
  },
  {
    kind: SCENERY.ROCK_SNOW,
    name: 'rocks-snow',
    cell: 3,
    modelUrl: '/assets/models/rocks_snow.glb',
    modelScale: ROCK_MESH_WIDTH[SCENERY.ROCK_SNOW],
    stackLift: ROCK_MESH_WIDTH[SCENERY.ROCK_SNOW] * 0.42,
    billboardScale: 7.5,
    billboardYOffset: -0.8,
    lodDistance: SCENERY_LOD_ROCK,
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
 * @param {object} [opts]
 */
export async function createSceneryFromField(engine, field, surfaceHeightAt, camera, opts = {}) {
  if (!field?.sceneryType) {
    return {
      meshes: [],
      modelsReady: Promise.resolve(),
      update() {},
      forEachBurningTree() {},
      applyTreeUpdates() {},
      applyRockUpdates() {},
      applyAuthoredTiles() {},
      applyFogDim() {},
      applyFogTiles() {},
      pingHarvest() { return false; },
      dispose() {},
    };
  }
  const atlas = await getAtlas(engine);
  // Beyond this XZ radius from the look-at point, resources are hidden outright
  // (mesh and billboard). Terrain passes its keep ring here so trees/rocks drop
  // with the tiles under them instead of floating over the bare table.
  // Infinity (default) keeps every resource — the right call when terrain is one
  // full draw (normal maps).
  const resourceDropSq = Number.isFinite(opts.resourceDrop) && opts.resourceDrop > 0
    ? opts.resourceDrop * opts.resourceDrop
    : Infinity;
  // Inside this XZ radius from the look point, trees/rocks stay full meshes.
  // Between it and resourceDrop they are billboards. Infinity keeps the old
  // eye-distance swap (normal boards).
  const resourceMeshSq = Number.isFinite(opts.resourceMesh) && opts.resourceMesh > 0
    ? opts.resourceMesh * opts.resourceMesh
    : Infinity;
  const meshes = [];
  let shown = true;
  function applyShown() {
    if (shown) return;
    for (let i = 0; i < meshes.length; i++) meshes[i].visible = false;
  }
  function setShown(on) {
    shown = on !== false;
    if (shown) {
      for (let i = 0; i < meshes.length; i++) {
        const n = meshes[i].thinInstances?.count ?? 0;
        meshes[i].visible = n > 0;
      }
      return;
    }
    applyShown();
  }
  const batches = [];
  /** @type {Map<number, object>} */
  const batchByKind = new Map();
  /** @type {Promise<void>[]} */
  const modelJobs = [];
  /** Set by dispose() so late GLB jobs never re-add to the scene. */
  let disposed = false;
  /** @type {Map<number, { batch: object, index: number }>} */
  const treeByTile = new Map();
  /** Trees + rocks, for gather-click flashes. */
  /** @type {Map<number, { batch: object, index: number }>} */
  const instanceByTile = new Map();
  /** tile → every layer of a stacked rock, bottom first. */
  const rockLayers = new Map();
  /** tile → start time (ms). */
  /** @type {Map<number, number>} */
  const harvestPings = new Map();
  /** @type {number[]} unused tree instance indices (headroom). */
  const treeFreeSlots = [];
  /** @type {object | null} */
  let treeBatch = null;

  function attachModelParts(batch) {
    modelJobs.push(
      loadModelParts(engine, batch.variant)
        .then((parts) => {
          if (disposed) {
            for (const part of parts) softDetachMesh(opts.scene, part.mesh);
            return;
          }
          for (const part of parts) {
            if (disposed) {
              softDetachMesh(opts.scene, part.mesh);
              continue;
            }
            const cap = batch.capacity;
            part.matrices = new Float32Array(cap * 16);
            setThinInstances(part.mesh, part.matrices, cap);
            setThinInstanceColors(part.mesh, batch.colors);
            setThinInstanceCount(part.mesh, cap);
            part.mesh.pickable = false;
            if (opts.scene) addToScene(opts.scene, part.mesh);
            meshes.push(part.mesh);
            batch.modelParts.push(part);
            for (let i = 0; i < cap; i++) {
              if ((batch.instances[i].stockScale ?? 0) <= 0) writeHiddenMatrix(part.matrices, i);
            }
            // terrain.meshes is a snapshot unless it listens — notify so CSM can catch up.
            opts.onModelMesh?.(part.mesh);
          }
          batch.pickParts = pickPartsFromMeshes(batch.modelParts.map((part) => part.mesh));
          if (!disposed) {
            batch.dirty = true;
            applyShown();
          }
        })
        .catch((err) => {
          if (!disposed) console.warn(`[scenery] model ${batch.variant.modelUrl} failed`, err);
        }),
    );
  }

  function createBatch(variant, live, { notify = false } = {}) {
    const isTree = variant.kind === SCENERY.TREE;
    const capacity = capacityFor(live.length, { initial: SCENERY_INITIAL });
    const instances = live.slice();
    while (instances.length < capacity) {
      instances.push(makeEmptyTreeInstance());
    }

    const billboardMesh = createBillboardMesh(engine, variant, atlas);
    const billboardMatrices = new Float32Array(capacity * 16);
    const colors = makeDimColors(capacity, albedoDimFor(variant.kind));
    setThinInstances(billboardMesh, billboardMatrices, capacity);
    setThinInstanceCount(billboardMesh, capacity);
    billboardMesh.pickable = false;
    meshes.push(billboardMesh);

    const freeSlots = isTree ? treeFreeSlots : [];
    for (let i = live.length; i < capacity; i++) {
      writeHiddenMatrix(billboardMatrices, i);
    }
    // Slots are claimed with pop(), and the draw count is the highest occupied
    // slot — so hand out the lowest index first to keep the range compact.
    for (let i = capacity - 1; i >= live.length; i--) {
      freeSlots.push(i);
    }

    /** @type {{ mesh: object, baseMatrix: Float32Array, matrices: Float32Array | null }[]} */
    const modelParts = [];
    const batch = {
      variant,
      instances,
      billboardMesh,
      billboardMatrices,
      colors,
      billboardColors: null,
      modelParts,
      freeSlots,
      dirty: true,
      capacity,
    };
    uploadBillboardColors(batch);
    batches.push(batch);
    batchByKind.set(variant.kind, batch);
    if (isTree) {
      treeBatch = batch;
      for (let i = 0; i < live.length; i++) {
        const ref = { batch, index: i };
        treeByTile.set(instances[i].tileIndex, ref);
        instanceByTile.set(instances[i].tileIndex, ref);
      }
    } else {
      for (let i = 0; i < live.length; i++) {
        const tile = instances[i].tileIndex;
        const ref = { batch, index: i };
        let list = rockLayers.get(tile);
        if (!list) {
          list = [];
          rockLayers.set(tile, list);
          instanceByTile.set(tile, ref);
        }
        list.push(ref);
      }
    }
    if (notify) {
      if (opts.scene) addToScene(opts.scene, billboardMesh);
      opts.onModelMesh?.(billboardMesh);
    }
    attachModelParts(batch);
    return batch;
  }

  for (const variant of VARIANTS) {
    const live = collectInstances(field, variant, surfaceHeightAt);
    // Trees always get a batch (even if empty) so spore growth can claim slots.
    if (live.length === 0 && variant.kind !== SCENERY.TREE) continue;
    createBatch(variant, live);
  }

  // After 3D models land, force a LOD rewrite — the boot pass (LOD off) hides
  // billboards immediately, so without this a field rebuild can stay empty until
  // something else dirties the batch.
  const modelsReady = Promise.all(modelJobs).then(() => {
    if (disposed) return;
    update(camera, 0, true);
    if (fogFactor) applyFogDim(fogFactor);
  });

  function growBatch(batch, needed) {
    if (!batch || needed <= batch.capacity) return;
    const cap = capacityFor(needed, { initial: SCENERY_INITIAL });
    const oldCap = batch.capacity;
    const billboardMatrices = new Float32Array(cap * 16);
    billboardMatrices.set(batch.billboardMatrices.subarray(0, oldCap * 16));
    const colors = makeDimColors(cap, albedoDimFor(batch.variant.kind));
    if (batch.colors) colors.set(batch.colors.subarray(0, oldCap * 4));
    setThinInstances(batch.billboardMesh, billboardMatrices, cap);
    setThinInstanceCount(batch.billboardMesh, cap);
    batch.billboardMatrices = billboardMatrices;
    batch.colors = colors;
    batch.billboardColors = null;
    uploadBillboardColors(batch);
    for (const part of batch.modelParts) {
      const matrices = new Float32Array(cap * 16);
      matrices.set(part.matrices.subarray(0, oldCap * 16));
      setThinInstances(part.mesh, matrices, cap);
      setThinInstanceColors(part.mesh, colors);
      setThinInstanceCount(part.mesh, cap);
      part.matrices = matrices;
    }
    for (let i = oldCap; i < cap; i++) {
      batch.instances.push(makeEmptyTreeInstance());
      batch.freeSlots.push(i);
      writeHiddenMatrix(billboardMatrices, i);
      for (const part of batch.modelParts) writeHiddenMatrix(part.matrices, i);
    }
    batch.freeSlots.sort((a, b) => b - a);
    batch.capacity = cap;
    batch.dirty = true;
    if (fogFactor) applyFogDim(fogFactor);
  }

  function ensureTreeCapacity(needed) {
    growBatch(treeBatch, needed);
  }

  function variantForKind(kind) {
    for (let i = 0; i < VARIANTS.length; i++) {
      if (VARIANTS[i].kind === kind) return VARIANTS[i];
    }
    return null;
  }

  function authoredKindAt(tileIndex) {
    const kind = field.sceneryType?.[tileIndex] ?? SCENERY.NONE;
    if (kind === SCENERY.TREE) {
      return (field.treeStock?.[tileIndex] | 0) > 0 ? SCENERY.TREE : SCENERY.NONE;
    }
    if (kind >= SCENERY.ROCK_PLAIN) {
      return (field.rockStock?.[tileIndex] | 0) > 0 ? kind : SCENERY.NONE;
    }
    return SCENERY.NONE;
  }

  function authoredStockAt(tileIndex, kind) {
    if (kind === SCENERY.TREE) return field.treeStock?.[tileIndex] | 0;
    return field.rockStock?.[tileIndex] | 0;
  }

  function placeAuthoredInstance(p, kind, tileIndex, stock, layer = 0) {
    const width = field.width;
    const tz = Math.floor(tileIndex / width);
    const tx = tileIndex - tz * width;
    const placement = deterministicPlacement(tx, tz, field.seed, kind);
    const x = (tx + 0.5) * TILE_SIZE_F - worldHalfFFromField(field) + placement.offsetX;
    const z = (tz + 0.5) * TILE_SIZE_F - worldHalfZFFromField(field) + placement.offsetZ;
    const groundY = surfaceHeightAt(field, x, z);
    const variant = variantForKind(kind);
    const stockScale = kind === SCENERY.TREE
      ? treeScaleForStage(treeStageFromStock(stock))
      : rockLayerScale(kind, stock, layer);
    const lift = kind >= SCENERY.ROCK_PLAIN ? (variant?.stackLift || 0) * layer : 0;
    p.tileIndex = tileIndex;
    p.layer = layer;
    p.x = x;
    p.y = groundY + lift;
    p.z = z;
    p.yaw = placement.yaw;
    p.stock = stock;
    p.burn = 0;
    p.stockScale = stockScale;
    p.targetScale = stockScale;
    p.scaleFrom = stockScale;
    p.scaleT = 1;
    p.scaleDur = TREE_SHRINK_MS;
    p.scaleMode = 'lerp';
    p.scaling = false;
    p.fellDelayMs = 0;
    resetBurnVisual(p);
  }

  function releaseAuthoredInstance(ref) {
    if (!ref) return;
    const { batch, index } = ref;
    const p = batch.instances[index];
    const tile = p.tileIndex;
    const mates = rockLayers.get(tile);
    if (mates) {
      const next = mates.filter((m) => m.batch !== batch || m.index !== index);
      if (next.length) rockLayers.set(tile, next);
      else rockLayers.delete(tile);
    }
    const mapped = instanceByTile.get(tile);
    if (mapped && mapped.batch === batch && mapped.index === index) {
      const left = rockLayers.get(tile);
      if (left?.length) instanceByTile.set(tile, left[0]);
      else instanceByTile.delete(tile);
    }
    if (batch.variant.kind === SCENERY.TREE) treeByTile.delete(tile);
    const blank = makeEmptyTreeInstance();
    for (const key of Object.keys(blank)) p[key] = blank[key];
    writeHiddenMatrix(batch.billboardMatrices, index);
    for (const part of batch.modelParts) writeHiddenMatrix(part.matrices, index);
    batch.freeSlots.push(index);
    batch.freeSlots.sort((a, b) => b - a);
    batch.dirty = true;
  }

  function claimAuthoredSlot(kind, tileIndex, stock, layer = 0) {
    const variant = variantForKind(kind);
    if (!variant || disposed) return null;
    let batch = batchByKind.get(kind);
    if (!batch) batch = createBatch(variant, [], { notify: true });
    if (batch.freeSlots.length === 0) growBatch(batch, batch.capacity + 1);
    if (batch.freeSlots.length === 0) return null;
    const index = batch.freeSlots.pop();
    const p = batch.instances[index];
    placeAuthoredInstance(p, kind, tileIndex, stock, layer);
    const ref = { batch, index };
    if (kind >= SCENERY.ROCK_PLAIN) {
      const list = rockLayers.get(tileIndex);
      if (list) list.push(ref);
      else rockLayers.set(tileIndex, [ref]);
      instanceByTile.set(tileIndex, rockLayers.get(tileIndex)[0]);
    } else {
      instanceByTile.set(tileIndex, ref);
      if (kind === SCENERY.TREE) treeByTile.set(tileIndex, ref);
    }
    writeFogColor(batch, index);
    flushBatchColors(batch);
    batch.dirty = true;
    return ref;
  }

  function syncRockTile(tileIndex, animate) {
    const kind = field.sceneryType?.[tileIndex] ?? SCENERY.NONE;
    const stock = field.rockStock?.[tileIndex] | 0;
    const count = kind >= SCENERY.ROCK_PLAIN ? rockStackCount(kind, stock) : 0;
    if (count === 0) {
      const refs = (rockLayers.get(tileIndex) || []).slice();
      while (refs.length > 1) releaseAuthoredInstance(refs.pop());
      const last = refs[0];
      if (!last) return;
      const p = last.batch.instances[last.index];
      const prevScale = p.stockScale ?? 0;
      p.stock = 0;
      p.fellDelayMs = 0;
      if (prevScale <= 0.001 && !p.scaling) {
        releaseAuthoredInstance(last);
        return;
      }
      beginScaleAnim(p, 0, TREE_SHRINK_MS, 'stageDrop');
      last.batch.dirty = true;
      return;
    }
    const existing = rockLayers.get(tileIndex) || [];
    while (existing.length > count) {
      releaseAuthoredInstance(existing.pop());
    }
    while ((rockLayers.get(tileIndex)?.length || 0) < count) {
      const layer = rockLayers.get(tileIndex)?.length || 0;
      if (!claimAuthoredSlot(kind, tileIndex, stock, layer)) break;
    }
    const refs = rockLayers.get(tileIndex) || [];
    for (let layer = 0; layer < refs.length; layer++) {
      const ref = refs[layer];
      const p = ref.batch.instances[ref.index];
      const scale = rockLayerScale(kind, stock, layer);
      const top = layer === refs.length - 1;
      if (animate && top) {
        const prevScale = p.stockScale ?? 0;
        placeAuthoredInstance(p, kind, tileIndex, stock, layer);
        p.stockScale = prevScale;
        p.scaling = false;
        if (stock <= 0) {
          p.stock = 0;
          p.fellDelayMs = 0;
          if (prevScale <= 0.001) {
            releaseAuthoredInstance(ref);
            continue;
          }
          beginScaleAnim(p, 0, TREE_SHRINK_MS, 'stageDrop');
        } else if (Math.abs(scale - prevScale) > 0.001) {
          p.fellDelayMs = 0;
          beginScaleAnim(
            p,
            scale,
            scale < prevScale ? TREE_SHRINK_MS : TREE_GROW_IN_MS,
            scale < prevScale ? 'stageDrop' : 'lerp',
          );
        }
      } else {
        placeAuthoredInstance(p, kind, tileIndex, stock, layer);
      }
      writeFogColor(ref.batch, ref.index);
      flushBatchColors(ref.batch);
      ref.batch.dirty = true;
    }
  }

  function syncAuthoredTile(tileIndex) {
    const raw = field.sceneryType?.[tileIndex] ?? SCENERY.NONE;
    if (raw >= SCENERY.ROCK_PLAIN) {
      syncRockTile(tileIndex, false);
      return;
    }
    // A tree painted over a rock used to stop here: the rock slot was still
    // recorded, so the rock mesh was dropped and the tree was never claimed.
    if (rockLayers.has(tileIndex)) {
      if (raw === SCENERY.NONE) {
        syncRockTile(tileIndex, false);
        return;
      }
      const refs = (rockLayers.get(tileIndex) || []).slice();
      for (let i = 0; i < refs.length; i++) releaseAuthoredInstance(refs[i]);
    }
    const kind = authoredKindAt(tileIndex);
    let ref = instanceByTile.get(tileIndex);
    if (kind === SCENERY.NONE) {
      releaseAuthoredInstance(ref);
      return;
    }
    if (ref && ref.batch.variant.kind !== kind) {
      releaseAuthoredInstance(ref);
      ref = null;
    }
    const stock = authoredStockAt(tileIndex, kind);
    if (!ref) {
      claimAuthoredSlot(kind, tileIndex, stock);
      return;
    }
    placeAuthoredInstance(ref.batch.instances[ref.index], kind, tileIndex, stock);
    writeFogColor(ref.batch, ref.index);
    flushBatchColors(ref.batch);
    ref.batch.dirty = true;
  }

  function applyAuthoredTiles(nextField, tiles) {
    if (disposed || !nextField || !tiles?.length) return;
    field = nextField;
    const width = field.width;
    const height = field.height;
    const seen = new Set();
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const x = t.x ?? t.tx ?? 0;
      const z = t.z ?? t.tz ?? 0;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      const tileIndex = z * width + x;
      if (seen.has(tileIndex)) continue;
      seen.add(tileIndex);
      syncAuthoredTile(tileIndex);
    }
    update(camera, 0, true);
  }

  let elapsed = LOD_UPDATE_MS;
  let growElapsed = 0;
  /** @type {((x: number, z: number) => number) | null} */
  let fogFactor = null;
  let lastCameraX = Infinity;
  let lastCameraY = Infinity;
  let lastCameraZ = Infinity;

  function beginScaleAnim(p, nextTarget, durationMs, mode = 'lerp') {
    // Compare against visible scale — targetScale may already be set during fell delay.
    if (Math.abs((p.stockScale ?? 0) - nextTarget) < 0.001 && !p.scaling) {
      p.targetScale = nextTarget;
      p.scaleMode = mode;
      return;
    }
    p.scaleFrom = p.stockScale ?? 0;
    p.targetScale = nextTarget;
    p.scaleT = 0;
    p.scaleDur = Math.max(1, durationMs);
    p.scaleMode = mode;
    p.scaling = true;
  }

  function advanceInstanceScale(p, dt) {
    if (p.fellDelayMs > 0) {
      p.fellDelayMs -= dt;
      if (p.fellDelayMs <= 0) {
        p.fellDelayMs = 0;
        beginScaleAnim(p, 0, TREE_FELL_MS, 'lerp');
      }
      return true;
    }
    if (!p.scaling) return false;
    p.scaleT = Math.min(1, p.scaleT + dt / (p.scaleDur || TREE_SHRINK_MS));
    const from = p.scaleFrom ?? 0;
    const to = p.targetScale ?? 0;
    p.stockScale = p.scaleMode === 'stageDrop'
      ? stageDropScale(from, to, p.scaleT)
      : from + (to - from) * (1 - (1 - p.scaleT) ** 3);
    if (p.scaleT >= 1) {
      p.scaling = false;
      p.stockScale = to;
    }
    return true;
  }

  function beginTreeSink(p) {
    if (p.sinking) return;
    const scale = (p.stockScale ?? 0) > 0.001 ? p.stockScale : (p.targetScale || 1);
    p.stockScale = scale;
    p.scaleFrom = scale;
    p.targetScale = scale;
    p.scaling = false;
    p.fellDelayMs = 0;
    p.sinking = true;
    p.sinkT = 0;
    p.sink = 0;
    p.sinkDepth = treeBurnSinkDepth(scale);
  }

  function advanceTreeSink(p, dt) {
    if (!p.sinking) return false;
    p.sinkT = Math.min(1, (p.sinkT ?? 0) + dt / TREE_BURN_SINK_MS);
    p.sink = treeBurnSinkDrop(p.sinkT, p.sinkDepth ?? 0);
    if (p.sinkT >= 1) {
      p.sinking = false;
      p.stockScale = 0;
      p.targetScale = 0;
    }
    return true;
  }

  function placeTreeInstance(p, tileIndex, stock, burn) {
    const width = field.width;
    const tz = Math.floor(tileIndex / width);
    const tx = tileIndex - tz * width;
    const placement = deterministicPlacement(tx, tz, field.seed, SCENERY.TREE);
    const x = (tx + 0.5) * TILE_SIZE_F - worldHalfFFromField(field) + placement.offsetX;
    const z = (tz + 0.5) * TILE_SIZE_F - worldHalfZFFromField(field) + placement.offsetZ;
    const groundY = surfaceHeightAt(field, x, z);
    const stage = treeStageFromStock(stock);
    const targetScale = treeScaleForStage(stage);
    p.tileIndex = tileIndex;
    p.x = x;
    p.y = groundY;
    p.z = z;
    p.yaw = placement.yaw;
    p.stock = stock;
    p.burn = burn;
    p.stockScale = targetScale > 0 ? targetScale * 0.12 : 0;
    p.scaleFrom = p.stockScale;
    p.targetScale = targetScale;
    p.scaleT = 0;
    p.scaleDur = TREE_GROW_IN_MS;
    p.scaleMode = 'lerp';
    p.scaling = targetScale > 0;
    p.fellDelayMs = 0;
    resetBurnVisual(p);
    if (treeDoomed(p)) initBurnVisual(p);
  }

  function claimTreeSlot(tileIndex, stock, burn) {
    if (!treeBatch) return null;
    if (treeFreeSlots.length === 0) {
      ensureTreeCapacity(treeBatch.capacity + 1);
    }
    if (treeFreeSlots.length === 0) return null;
    const index = treeFreeSlots.pop();
    const p = treeBatch.instances[index];
    placeTreeInstance(p, tileIndex, stock, burn);
    const ref = { batch: treeBatch, index };
    treeByTile.set(tileIndex, ref);
    instanceByTile.set(tileIndex, ref);
    treeBatch.dirty = true;
    writeFogColor(treeBatch, index);
    flushBatchColors(treeBatch);
    return ref;
  }

  function update(activeCamera = camera, deltaMs = LOD_UPDATE_MS, force = false) {
    if (!activeCamera) return;
    elapsed += deltaMs;
    growElapsed += deltaMs;

    // Advance scale (sprout, stage-drop, fell melt) and burn-down sink on every batch.
    if (growElapsed > 0) {
      const dt = Math.min(100, growElapsed);
      growElapsed = 0;
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        let moved = false;
        const tintTrees = batch.variant.kind === SCENERY.TREE;
        const rocks = batch.variant.kind >= SCENERY.ROCK_PLAIN;
        let tinted = false;
        const release = [];
        for (let i = 0; i < batch.instances.length; i++) {
          const p = batch.instances[i];
          const scaled = advanceInstanceScale(p, dt);
          const burned = tintTrees && advanceBurnVisual(p, dt);
          const sunk = tintTrees && advanceTreeSink(p, dt);
          if (rocks && (p.stock | 0) <= 0 && (p.stockScale ?? 0) <= 0 && !p.scaling && p.tileIndex >= 0) {
            release.push(i);
          }
          if (!scaled && !burned && !sunk) continue;
          moved = true;
          if (tintTrees && (scaled || burned)) {
            writeFogColor(batch, i);
            tinted = true;
          }
        }
        for (let r = 0; r < release.length; r++) {
          releaseAuthoredInstance({ batch, index: release[r] });
          moved = true;
        }
        if (moved) batch.dirty = true;
        if (tinted) flushBatchColors(batch);
      }
    }

    const cameraPos = cameraPosition(activeCamera);
    // Drop ring is measured from the look-at point (same reference terrain uses
    // to cull chunks) so resources vanish exactly where the tiles do.
    const lookXZ = cameraLookAt(activeCamera);
    // Refresh the mesh/billboard split when the camera moves. A full thin-instance
    // flush is the expensive part, so it waits out the interval. A move check
    // without that wait rewrites every tree while panning.
    let anyDirty = false;
    for (let b = 0; b < batches.length; b++) {
      if (batches[b].dirty) { anyDirty = true; break; }
    }
    const movedSq =
      (cameraPos.x - lastCameraX) ** 2 +
      (cameraPos.y - lastCameraY) ** 2 +
      (cameraPos.z - lastCameraZ) ** 2;
    const lodDue = force || (
      elapsed >= LOD_UPDATE_MS &&
      (lastCameraX === Infinity || movedSq >= LOD_MOVE_THRESHOLD_SQ)
    );
    if (lodDue || anyDirty) {
      if (lodDue) {
        elapsed = 0;
        lastCameraX = cameraPos.x;
        lastCameraY = cameraPos.y;
        lastCameraZ = cameraPos.z;
      }
      for (const batch of batches) {
        if (!batch.dirty && !lodDue) continue;
        updateBatchLod(batch, cameraPos, lookXZ, resourceDropSq, resourceMeshSq);
        batch.dirty = false;
      }
    }
    tickHarvestPings();
    applyShown();
  }

  function applyTreeUpdates(updates) {
    if (!updates?.tiles?.length) return;
    const { tiles, stock, burn } = updates;
    for (let i = 0; i < tiles.length; i++) {
      const ti = tiles[i];
      let ref = treeByTile.get(ti);
      const nextStock = stock[i];
      const nextBurn = burn[i];
      if (!ref) {
        if (nextStock <= 0) continue;
        ref = claimTreeSlot(ti, nextStock, nextBurn);
        continue;
      }
      const p = ref.batch.instances[ref.index];
      const wasDead = !(p.stock > 0);
      const prevScale = p.stockScale ?? 0;
      const prevBurn = p.burn;
      p.stock = nextStock;
      p.burn = nextBurn;
      if (treeDoomed(p)) {
        if (!p.burnLeanSign) initBurnVisual(p);
      } else if (nextStock > 0 && nextBurn === 0) {
        resetBurnVisual(p);
      }
      const stage = treeStageFromStock(p.stock);
      const nextTarget = treeScaleForStage(stage);
      const heldScale = p.targetScale ?? prevScale;
      if (nextStock <= 0) {
        if (p.sinking || (p.sink ?? 0) > 0) {
          // Already going under, or buried.
        } else if (prevBurn > 0 || (p.char ?? 0) > 0) {
          if (!p.burnLeanSign) initBurnVisual(p);
          p.burnT = 1;
          p.lean = p.burnLeanMax * p.burnLeanSign;
          p.char = 1;
          // Size was held through the fire. Lower the whole tree into the ground.
          beginTreeSink(p);
        } else {
          // Chop: ink drips first, then melt. Don't snap-hide under the blobs.
          p.scaling = false;
          p.fellDelayMs = TREE_FELL_DELAY_MS;
          p.targetScale = 0;
        }
      } else if (nextBurn > 0 && nextTarget <= heldScale + 0.001) {
        // Keep the lit size. Stock still falls; the sink waits until the fire is out.
        if (p.scaling && (p.targetScale ?? 0) < (p.stockScale ?? prevScale) - 0.001) {
          const visible = p.stockScale ?? prevScale;
          p.scaling = false;
          p.stockScale = visible;
          p.scaleFrom = visible;
          p.targetScale = visible;
        }
      } else if (wasDead) {
        p.fellDelayMs = 0;
        p.sinking = false;
        p.sink = 0;
        p.sinkT = 0;
        p.stockScale = nextTarget * 0.12;
        resetBurnVisual(p);
        if (treeDoomed(p)) initBurnVisual(p);
        beginScaleAnim(p, nextTarget, TREE_GROW_IN_MS);
      } else if (Math.abs(nextTarget - (p.targetScale ?? prevScale)) > 0.001) {
        p.fellDelayMs = 0;
        beginScaleAnim(
          p,
          nextTarget,
          nextTarget < prevScale ? TREE_SHRINK_MS : TREE_GROW_IN_MS,
          nextTarget < prevScale ? 'stageDrop' : 'lerp',
        );
      } else {
        p.targetScale = nextTarget;
      }
      ref.batch.dirty = true;
    }
  }

  function findInstanceRef(tile) {
    const mapped = instanceByTile.get(tile);
    if (mapped) return mapped;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const instances = batch.instances;
      for (let i = 0; i < instances.length; i++) {
        if (instances[i].tileIndex === tile) return { batch, index: i };
      }
    }
    return null;
  }

  function applyRockUpdates(updates) {
    if (!updates?.tiles?.length) return;
    const { tiles } = updates;
    for (let i = 0; i < tiles.length; i++) syncRockTile(tiles[i], true);
  }

  update(camera, LOD_UPDATE_MS, true);

  function harvestBoost(tile, now) {
    const started = harvestPings.get(tile);
    if (started == null) return 1;
    const t = now - started;
    if (t >= HARVEST_PING_MS) return 1;
    const u = t / HARVEST_PING_MS;
    const wave = Math.abs(Math.cos(u * Math.PI * HARVEST_PULSES));
    return 1 + wave * wave * HARVEST_PEAK;
  }

  function writeFogColor(batch, index) {
    const colors = batch.colors;
    if (!colors) return;
    const p = batch.instances[index];
    const t = fogFactor ? fogFactor(p.x, p.z) : 0;
    p.fogT = t;
    const fogMul = (fogFactor ? fogAlbedoScale(t) : 1) * harvestBoost(p.tileIndex, performance.now());
    const o = index * 4;
    if (batch.variant.kind === SCENERY.TREE) {
      let [r, g, b] = treeTintRgb(p.stockScale ?? 0, p.tileIndex);
      if (fogFactor) {
        const chroma = fogChroma(t);
        const luma = r * 0.3 + g * 0.59 + b * 0.11;
        r = luma + (r - luma) * chroma;
        g = luma + (g - luma) * chroma;
        b = luma + (b - luma) * chroma;
        g *= 1 - 0.62 * unseenGreenKill(t);
      }
      const ch = p.char ?? 0;
      if (ch > 0) {
        r = r * (1 - ch) + TREE_CHAR_RGB[0] * ch;
        g = g * (1 - ch) + TREE_CHAR_RGB[1] * ch;
        b = b * (1 - ch) + TREE_CHAR_RGB[2] * ch;
      }
      colors[o] = r * fogMul;
      colors[o + 1] = g * fogMul;
      colors[o + 2] = b * fogMul;
    } else {
      const c = ROCK_ALBEDO_DIM * fogMul;
      colors[o] = c;
      colors[o + 1] = c;
      colors[o + 2] = c;
    }
    colors[o + 3] = 1;
  }

  function tickHarvestPings() {
    if (harvestPings.size === 0) return;
    const now = performance.now();
    const flushed = new Set();
    for (const [tile, started] of harvestPings) {
      const expired = now - started >= HARVEST_PING_MS;
      const ref = instanceByTile.get(tile);
      if (ref) {
        writeFogColor(ref.batch, ref.index);
        flushed.add(ref.batch);
      }
      if (expired) harvestPings.delete(tile);
    }
    for (const batch of flushed) flushBatchColors(batch);
  }

  /**
   * Nearest tree or rock whose drawn mesh the ray hits.
   * Null when the models are not loaded yet. -1 is a real miss.
   * @param {object | null} ray
   * @param {number} [maxT]
   * @returns {number | null}
   */
  function pickGatherOnRay(ray, maxT = Infinity) {
    if (!ray) return null;
    let tested = false;
    let bestTile = -1;
    let limit = maxT;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const parts = batch.pickParts;
      const matrices = batch.modelParts[0]?.matrices;
      const count = batch.modelParts[0]?.mesh?.thinInstances?.count ?? 0;
      if (!parts?.length || !matrices || count <= 0) continue;
      tested = true;
      const hit = nearestMeshInstanceHit(ray, parts, matrices, count, (slot) => {
        const inst = batch.instances[slot];
        return !!inst && inst.tileIndex >= 0 && (inst.stock | 0) > 0;
      }, limit);
      if (!hit) continue;
      bestTile = batch.instances[hit.slot].tileIndex;
      limit = hit.t;
    }
    if (!tested) return null;
    return bestTile;
  }

  function pingHarvest(tile) {
    const t = tile | 0;
    if (t < 0) return false;
    harvestPings.set(t, performance.now());
    const ref = instanceByTile.get(t);
    if (!ref) return false;
    writeFogColor(ref.batch, ref.index);
    flushBatchColors(ref.batch);
    return true;
  }

  function flushBatchColors(batch) {
    if (!batch.colors) return;
    uploadBillboardColors(batch);
    for (let p = 0; p < batch.modelParts.length; p++) {
      setThinInstanceColors(batch.modelParts[p].mesh, batch.colors);
    }
  }

  function recolorAllFog() {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (!batch.colors) continue;
      for (let i = 0; i < batch.instances.length; i++) writeFogColor(batch, i);
      flushBatchColors(batch);
    }
  }

  function applyFogDim(factorAt) {
    const next = typeof factorAt === 'function' ? factorAt : null;
    fogFactor = next;
    recolorAllFog();
  }

  function applyFogTiles(forEachTile) {
    if (!fogFactor || typeof forEachTile !== 'function') return;
    const flushed = new Set();
    forEachTile((tileIndex) => {
      const ref = instanceByTile.get(tileIndex);
      if (!ref) return;
      writeFogColor(ref.batch, ref.index);
      flushed.add(ref.batch);
    });
    for (const batch of flushed) flushBatchColors(batch);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const scene = opts.scene;
    // Soft-detach only — Lite's removeFromScene disposables can destroy shared
    // atlas/material GPU state still used by the next field's scenery.
    for (const mesh of meshes) softDetachMesh(scene, mesh);
    meshes.length = 0;
    batches.length = 0;
    treeByTile.clear();
    instanceByTile.clear();
    harvestPings.clear();
    treeFreeSlots.length = 0;
    treeBatch = null;
  }

  function forEachBurningTree(fn) {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (batch.variant.kind !== SCENERY.TREE) continue;
      const instances = batch.instances;
      for (let i = 0; i < instances.length; i++) {
        const p = instances[i];
        const sinking = p.sinking && (p.stockScale ?? 0) > 0;
        if (!((p.burn > 0 && p.stock > 0) || sinking)) continue;
        fn({
          x: p.x,
          y: p.y - (p.sink ?? 0),
          z: p.z,
          stockScale: p.stockScale || 1,
          lean: p.lean ?? 0,
          yaw: p.yaw ?? 0,
          char: p.char ?? 0,
        });
      }
    }
  }

  return {
    meshes,
    modelsReady,
    update,
    forEachBurningTree,
    applyTreeUpdates,
    applyRockUpdates,
    applyAuthoredTiles,
    setShown,
    applyFogDim,
    applyFogTiles,
    pingHarvest,
    pickGatherOnRay,
    dispose,
  };
}

function makeEmptyTreeInstance() {
  return {
    tileIndex: -1,
    layer: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    stock: 0,
    burn: 0,
    stockScale: 0,
    targetScale: 0,
    scaleFrom: 0,
    scaleT: 1,
    scaleDur: TREE_SHRINK_MS,
    scaleMode: 'lerp',
    scaling: false,
    fellDelayMs: 0,
    sinking: false,
    sinkT: 0,
    sink: 0,
    sinkDepth: 0,
    lean: 0,
    char: 0,
    burnT: 0,
    burnLeanSign: 0,
    burnLeanMax: 0,
    burnDurMs: 0,
    fogT: 0,
    edgeDim: 0,
  };
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
    promise = (async () => {
      // Prefer offline bake (geo + mats) — skips GLB parse on cold boot.
      if (await hasBakedMesh(variant.modelUrl)) {
        const meshes = await loadBakedUnitMeshParts(engine, variant.modelUrl);
        return meshes.map((mesh, index) => {
          // Must match GLB path + collectShadowCasters filter (`scenery-model-*`).
          mesh.name = `scenery-model-${variant.name}-${index}`;
          mesh.material = prepareSceneryMaterial(mesh.material);
          return { mesh, baseMatrix: identityMatrix(), matrices: null };
        });
      }

      const container = await loadGltf(engine, variant.modelUrl);
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
        );
        return { mesh, baseMatrix: identityMatrix(), matrices: null };
      });
    })();
    cache.set(variant.modelUrl, promise);
  }
  return promise;
}

function bakeModelMesh(engine, source, world, name) {
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
  mesh.material = prepareSceneryMaterial(source.material);
  mesh.pickable = false;
  mesh.pickPositions = positions;
  mesh.pickIndices = indices;
  const b = boundsOfPositions(positions);
  mesh.boundMin = b.min;
  mesh.boundMax = b.max;
  // Recomputed normals assume CW fronts (Lite LH); show CW faces.
  mesh._reverseWinding = true;
  return mesh;
}

/**
 * Match v1: kill emissive. Albedo pull lives on thin-instance color so it
 * cannot stack with TREE_ALBEDO_DIM / ROCK_ALBEDO_DIM.
 */
function prepareSceneryMaterial(sourceMat) {
  if (!sourceMat) return sourceMat;
  const mat = sourceMat;
  if (mat._emissiveColor) setPbrEmissive(mat, [0, 0, 0]);
  if (mat.emissiveColor) mat.emissiveColor = [0, 0, 0];
  if (mat.emissiveIntensity != null) mat.emissiveIntensity = 0;
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

/**
 * Normal at a point on a crossed card.
 * XZ points back along the vertex, toward the trunk. On these cards that is
 * the direction the key light treats as the sun side: aiming outward lit the
 * shade and left the sunny side dark. Y still rises through the crown so
 * light from above stays on the top.
 */
function crownNormal(x, y, z, faceX, faceY, faceZ, tree) {
  const crownY = PLANE_SIZE * (tree ? 0.58 : 0.42);
  // Wide XZ spread aimed the quad's left and right edges straight at the key
  // light. On the board rim that limb is against the sky, so the card lights up.
  const spread = tree ? 0.22 : 0.35;
  const puff = tree ? 0.8 : 0.55;
  const nx = -(x * spread + faceX * puff);
  const ny = (y - crownY) * (tree ? 0.62 : 0.4) + (tree ? 0.42 : 0.55) + faceY * puff;
  const nz = -(z * spread + faceZ * puff);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** CCW front-face normal (WebGPU frontFace ccw). */
function cardFaceNormal(corners) {
  const ax = corners[1][0] - corners[0][0];
  const ay = corners[1][1] - corners[0][1];
  const az = corners[1][2] - corners[0][2];
  const bx = corners[2][0] - corners[0][0];
  const by = corners[2][1] - corners[0][1];
  const bz = corners[2][2] - corners[0][2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function pushCrownSide(positions, normals, uvs, indices, corners, uv, face, tree, reversed) {
  const base = positions.length / 3;
  const s = reversed ? -1 : 1;
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = corners[i];
    positions.push(x, y, z);
    const n = crownNormal(x, y, z, face[0] * s, face[1] * s, face[2] * s, tree);
    normals.push(n[0], n[1], n[2]);
    uvs.push(uv[i * 2], uv[i * 2 + 1]);
  }
  if (!reversed) {
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

/** Two crossed cards, each with a front and a back so the visible side bulges outward. */
function pushCrownCard(positions, normals, uvs, indices, corners, uv, tree) {
  const face = cardFaceNormal(corners);
  pushCrownSide(positions, normals, uvs, indices, corners, uv, face, tree, false);
  pushCrownSide(positions, normals, uvs, indices, corners, uv, face, tree, true);
}

function createBillboardMesh(engine, variant, atlas) {
  const half = PLANE_SIZE * 0.5;
  const tree = variant.kind === SCENERY.TREE;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const cellSize = 1 / ATLAS_GRID;
  const u0 = variant.cell * cellSize + CELL_INSET;
  const u1 = (variant.cell + 1) * cellSize - CELL_INSET;
  const v0 = CELL_INSET;
  const v1 = cellSize - CELL_INSET;
  const uv = [u0, v1, u1, v1, u1, v0, u0, v0];
  pushCrownCard(positions, normals, uvs, indices, [
    [-half, 0, 0],
    [half, 0, 0],
    [half, PLANE_SIZE, 0],
    [-half, PLANE_SIZE, 0],
  ], uv, tree);
  pushCrownCard(positions, normals, uvs, indices, [
    [0, 0, -half],
    [0, 0, half],
    [0, PLANE_SIZE, half],
    [0, PLANE_SIZE, -half],
  ], uv, tree);
  const mesh = createMeshFromData(
    engine,
    `scenery-${variant.name}`,
    Float32Array.from(positions),
    Float32Array.from(normals),
    Uint32Array.from(indices),
    Float32Array.from(uvs),
  );
  const mat = createStandardMaterial();
  mat.diffuseTexture = atlas;
  setStandardOpacityTexture(mat, atlas);
  mat.opacityFromRGB = false;
  mat.alphaCutOff = 0.35;
  mat.diffuseColor = [1, 1, 1];
  mat.ambientColor = tree ? [0.14, 0.145, 0.13] : [0.28, 0.28, 0.24];
  mat.emissiveColor = [0, 0, 0];
  // Sight and seen stay matte. A wide sheen on those tiers chrome-plates the sun side.
  mat.specularColor = tree ? TREE_SPEC_SIGHT.color : [0, 0, 0];
  mat.specularPower = tree ? TREE_SPEC_SIGHT.power : 1;
  // Each card has its own front and back. Culling keeps the outward bulge
  // that faces you; drawing both would z-fight the lit side against the shade.
  mat.backFaceCulling = true;
  mesh.material = mat;
  // A shadow on the card flattens the sun side down onto the shade.
  mesh.receiveShadows = false;
  mesh._skipShadowReceive = true;
  return mesh;
}

function collectInstances(field, variant, surfaceHeightAt) {
  const out = [];
  const { width, height, seed, sceneryType, treeStock } = field;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (sceneryType[i] !== variant.kind) continue;
      const stock = variant.kind === SCENERY.TREE
        ? (treeStock?.[i] ?? TREE_STAGE_FALLBACK_STOCK)
        : (field.rockStock?.[i] | 0);
      if (stock <= 0) continue;
      const placement = deterministicPlacement(tx, tz, seed, variant.kind);
      const x = (tx + 0.5) * TILE_SIZE_F - worldHalfFFromField(field) + placement.offsetX;
      const z = (tz + 0.5) * TILE_SIZE_F - worldHalfZFFromField(field) + placement.offsetZ;
      const groundY = surfaceHeightAt(field, x, z);
      const layers = variant.kind === SCENERY.TREE ? 1 : rockStackCount(variant.kind, stock);
      const lift = variant.stackLift || 0;
      for (let layer = 0; layer < layers; layer++) {
        const stockScale = variant.kind === SCENERY.TREE
          ? treeScaleForStage(treeStageFromStock(stock))
          : rockLayerScale(variant.kind, stock, layer);
        out.push({
          tileIndex: i,
          layer,
          x,
          y: groundY + lift * layer,
          z,
          yaw: placement.yaw,
          stock,
          burn: 0,
          stockScale,
          targetScale: stockScale,
          scaleFrom: stockScale,
          scaleT: 1,
          scaleDur: TREE_SHRINK_MS,
          scaleMode: 'lerp',
          scaling: false,
          fellDelayMs: 0,
          sinking: false,
          sinkT: 0,
          sink: 0,
          sinkDepth: 0,
          lean: 0,
          char: 0,
          burnT: 0,
          burnLeanSign: 0,
          burnLeanMax: 0,
          burnDurMs: 0,
        });
      }
    }
  }
  return out;
}

// Fallback if an older snapshot omits treeStock (full-size tree).
const TREE_STAGE_FALLBACK_STOCK = 42;

function updateBatchLod(batch, cameraPos, lookXZ, dropSq = Infinity, meshSq = Infinity) {
  const {
    variant,
    instances,
    billboardMesh,
    billboardMatrices,
    modelParts,
  } = batch;
  const lodDistanceSq = variant.lodDistance * variant.lodDistance;
  // Highest slot each bucket actually occupies. Batches are allocated at full
  // capacity with headroom, and with LOD off the billboard bucket stays empty —
  // drawing/flushing all of it every update is pure waste.
  let lastModelSlot = -1;
  let lastBillboardSlot = -1;
  let edgeChanged = false;
  const noteEdge = (p, edge) => {
    // Map-rim cards follow the same fog gray as every other card. Forcing the
    // mesh-seam dim here left a dark outline that did not match the veil.
    if (Math.abs((p.edgeDim || 0) - edge) <= 0.05) return;
    p.edgeDim = edge;
    edgeChanged = true;
  };
  for (let i = 0; i < instances.length; i++) {
    const p = instances[i];
    const stockScale = p.stockScale ?? 1;
    if (stockScale <= 0) {
      for (const part of modelParts) writeHiddenMatrix(part.matrices, i);
      writeHiddenMatrix(billboardMatrices, i);
      noteEdge(p, 0);
      continue;
    }
    // Past the billboard ring, hide both. Between the mesh ring and that,
    // keep a card even where the tiles have already become table.
    let lookDistSq = 0;
    if ((dropSq !== Infinity || meshSq !== Infinity) && lookXZ) {
      const ldx = lookXZ.x - p.x;
      const ldz = lookXZ.z - p.z;
      lookDistSq = ldx * ldx + ldz * ldz;
      if (dropSq !== Infinity && lookDistSq > dropSq) {
        for (const part of modelParts) writeHiddenMatrix(part.matrices, i);
        writeHiddenMatrix(billboardMatrices, i);
        noteEdge(p, 0);
        continue;
      }
    }
    const modelScale = variant.modelScale * stockScale;
    const billboardScale = variant.billboardScale * stockScale;
    const y = p.y - (p.sink ?? 0);
    const dx = cameraPos.x - p.x;
    const dy = cameraPos.y - p.y;
    const dz = cameraPos.z - p.z;
    const pastMesh = meshSq !== Infinity && lookDistSq > meshSq;
    const near = !pastMesh && dx * dx + dy * dy + dz * dz <= lodDistanceSq;
    if (near && modelParts.length) {
      for (const part of modelParts) {
        writeModelInstanceMatrix(
          part.matrices,
          i,
          p.x,
          y,
          p.z,
          p.yaw,
          modelScale,
          part.baseMatrix,
          p.lean ?? 0,
        );
      }
      writeHiddenMatrix(billboardMatrices, i);
      noteEdge(p, 0);
      lastModelSlot = i;
    } else {
      for (const part of modelParts) writeHiddenMatrix(part.matrices, i);
      const eyeDistSq = dx * dx + dy * dy + dz * dz;
      noteEdge(p, billboardEdgeDim(lookDistSq, eyeDistSq, meshSq, lodDistanceSq));
      writeInstanceMatrix(
        billboardMatrices,
        i,
        p.x,
        y + variant.billboardYOffset * billboardScale,
        p.z,
        p.yaw,
        billboardScale,
        p.lean ?? 0,
      );
      lastBillboardSlot = i;
    }
  }
  for (const part of modelParts) {
    setThinInstanceCount(part.mesh, lastModelSlot + 1);
    flushThinInstances(part.mesh);
  }
  setThinInstanceCount(billboardMesh, lastBillboardSlot + 1);
  flushThinInstances(billboardMesh);
  if (edgeChanged && variant.kind === SCENERY.TREE) uploadBillboardColors(batch);
}

/** Ground point the camera looks at (XZ) — matches terrain's chunk-cull ref. */
function cameraLookAt(camera) {
  const t = camera?.target;
  if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: t.x, z: t.z };
  const eye = cameraPosition(camera);
  return { x: eye.x, z: eye.z };
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

function albedoDimFor(kind) {
  return kind === SCENERY.TREE ? TREE_ALBEDO_DIM : ROCK_ALBEDO_DIM;
}

/** Sight and seen share one gray. Cards on the mesh ring are pulled down so
 *  they don't pop brighter than the model they just replaced. Rim giants stay
 *  below the mature card — the old curve floored them next to it. */
export function billboardTreeGray(luma, edgeDim) {
  let base;
  if (luma >= BILLBOARD_LUMA_PIVOT) {
    const t = Math.min(1, (luma - BILLBOARD_LUMA_PIVOT) / (BILLBOARD_LUMA_HI - BILLBOARD_LUMA_PIVOT));
    base = BILLBOARD_TREE_MID + (BILLBOARD_TREE_HI - BILLBOARD_TREE_MID) * t;
  } else {
    const t = BILLBOARD_LUMA_PIVOT > 0 ? Math.max(0, luma / BILLBOARD_LUMA_PIVOT) : 0;
    base = BILLBOARD_TREE_LO + (BILLBOARD_TREE_MID - BILLBOARD_TREE_LO) * t;
  }
  const edge = edgeDim > 0 ? (edgeDim > 1 ? 1 : edgeDim) : 0;
  return base * (BILLBOARD_EDGE_SCALE + (1 - BILLBOARD_EDGE_SCALE) * (1 - edge));
}

/** 1 on the model/card seam, 0 once the card is clearly past it. */
function billboardEdgeDim(lookDistSq, eyeDistSq, meshSq, lodSq) {
  let edge = 0;
  if (meshSq < Infinity && lookDistSq > meshSq) {
    const mesh = Math.sqrt(meshSq);
    const band = Math.max(36, mesh * BILLBOARD_EDGE_BAND);
    const u = (Math.sqrt(lookDistSq) - mesh) / band;
    if (u < 1) edge = 1 - (u < 0 ? 0 : u);
  }
  if (lodSq < Infinity && eyeDistSq > lodSq) {
    const lod = Math.sqrt(lodSq);
    const band = Math.max(48, lod * BILLBOARD_EDGE_BAND);
    const u = (Math.sqrt(eyeDistSq) - lod) / band;
    if (u < 1) edge = Math.max(edge, 1 - (u < 0 ? 0 : u));
  }
  return edge;
}

function uploadBillboardColors(batch) {
  const src = batch.colors;
  if (!src || !batch.billboardMesh) return;
  let dst = batch.billboardColors;
  if (!dst || dst.length !== src.length) {
    dst = new Float32Array(src.length);
    batch.billboardColors = dst;
  }
  const tree = batch.variant.kind === SCENERY.TREE;
  const lift = BILLBOARD_ROCK_LIFT;
  for (let i = 0; i < src.length; i += 4) {
    let r = src[i];
    let g = src[i + 1];
    let b = src[i + 2];
    if (tree) {
      const luma = r * 0.3 + g * 0.59 + b * 0.11;
      const shade = billboardTreeGray(luma, batch.instances[i >> 2]?.edgeDim ?? 0);
      r = shade;
      g = shade;
      b = shade;
    } else {
      r *= lift;
      g *= lift;
      b *= lift;
    }
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = src[i + 3];
  }
  setThinInstanceColors(batch.billboardMesh, dst);
}

function makeDimColors(cap, dim) {
  const colors = new Float32Array(cap * 4);
  for (let i = 0; i < cap; i++) {
    const o = i * 4;
    colors[o] = dim;
    colors[o + 1] = dim;
    colors[o + 2] = dim;
    colors[o + 3] = 1;
  }
  return colors;
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
  lean = 0,
) {
  writeInstanceMatrix(placementScratch, 0, x, y, z, yaw, scale, lean);
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

function writeInstanceMatrix(matrices, slot, x, y, z, yaw, scale, lean = 0) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  // Ry(yaw) * Rz(lean) * scale — lean is a local tip, yaw scatters fall direction.
  matrices[o] = c * cl * scale;
  matrices[o + 1] = sl * scale;
  matrices[o + 2] = -s * cl * scale;
  matrices[o + 3] = 0;
  matrices[o + 4] = -c * sl * scale;
  matrices[o + 5] = cl * scale;
  matrices[o + 6] = s * sl * scale;
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
