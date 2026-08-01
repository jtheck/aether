// render/ — Babylon Lite view layer.
//
// Units are thin-instanced GLB meshes (one draw call per type × owner in KOTH).
// Villagers use Lite VAT (baked idle/walk) on the same thin-instance path.

import {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  createHemisphericLight,
  createDirectionalLight,
  createSphere,
  createGround,
  createCylinder,
  createStandardMaterial,
  addToScene,
  setThinInstances,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceColor,
  onBeforeRender,
  registerSceneWithShadowSupport,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
  createCsmDirectionalShadowGenerator,
  setShadowTaskCasterMeshes,
} from '../vendor/lite/liteVendor.js';
import { getUnitDef } from '../sim/unitTypes.js';
import { MAX_PROJECTILES, PROJECTILE_DESPAWN } from '../sim/projectiles.js';
import { PROJECTILE, PROJECTILE_MESH } from '../sim/projectileTypes.js';
import { HEIGHT_AMPLITUDE, WORLD_HALF_F } from '../sim/field.js';
import { kothMaxUnitsOfType, KOTH_MAX_SLOTS } from '../sim/worldSetup.js';
import {
  UNIT_MODEL_URLS,
  hasUnitModel,
  loadBakedUnitMesh,
  loadBakedUnitMeshParts,
  unitModelTypeIds,
} from './unitModels.js';
import {
  fillVatInstanceParams,
  isVatUnitType,
  loadVatUnitTemplate,
  maxVatInstancesPerBatch,
  VAT_UNIT_DEFS,
  writeVatSlotParams,
} from './vatUnits.js';
import { createTerrainFromField, createTileGridOverlay, surfaceHeightAt } from './terrain.js';
import { createCameraController } from './cameraController.js';
import { createProjectileRenderer } from './projectiles.js';
import { createArrowTrails } from './arrowTrails.js';
import { createParticleSystem } from './particleSystem.js';
import { createHealthBars } from './healthBars.js';

/** Change active instance count without shrinking GPU buffer capacity. */
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
  // Lite still records drawIndexed(..., 0) into render bundles — WebGPU warns.
  mesh.visible = count > 0;
}

// Column-major mat4 * vec4.
function matVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

function pickingRay(canvasX, canvasY, vp, width, height) {
  const inv = mat4Invert(vp);
  if (!inv) return null;
  const ndcX = (2 * canvasX) / width - 1;
  const ndcY = 1 - (2 * canvasY) / height;
  const near = unproject(inv, ndcX, ndcY, 1);
  const far = unproject(inv, ndcX, ndcY, 0);
  const dx = far[0] - near[0];
  const dy = far[1] - near[1];
  const dz = far[2] - near[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-10) return null;
  return {
    ox: near[0],
    oy: near[1],
    oz: near[2],
    dx: dx / len,
    dy: dy / len,
    dz: dz / len,
  };
}

function unproject(inv, ndcX, ndcY, depth) {
  const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * depth + inv[12];
  const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * depth + inv[13];
  const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * depth + inv[14];
  const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * depth + inv[15];
  const iw = 1 / w;
  return [x * iw, y * iw, z * iw];
}

function rayHitSphere(ray, cx, cy, cz, radius) {
  const lx = ray.ox - cx;
  const ly = ray.oy - cy;
  const lz = ray.oz - cz;
  const b = 2 * (ray.dx * lx + ray.dy * ly + ray.dz * lz);
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  let t = (-b - root) * 0.5;
  if (t < 0) t = (-b + root) * 0.5;
  return t >= 0 ? t : null;
}

function rayHitGround(ray) {
  if (Math.abs(ray.dy) < 1e-8) return null;
  const t = -ray.oy / ray.dy;
  if (t < 0) return null;
  return { x: ray.ox + ray.dx * t, y: 0, z: ray.oz + ray.dz * t };
}

/**
 * Ray × heightfield. y=0 plane picks read "further away" on slopes — units and
 * markers must share this hit or the ping won't sit under the cursor.
 * @param {(x: number, z: number) => number} heightAt
 */
function rayHitTerrain(ray, heightAt) {
  if (!heightAt) return rayHitGround(ray);
  const maxH = HEIGHT_AMPLITUDE + 1;
  const minH = -0.5;
  // Looking down: march from sky band to below min surface.
  let t0 = 0;
  let t1 = 8000;
  if (Math.abs(ray.dy) > 1e-8) {
    const tTop = (maxH - ray.oy) / ray.dy;
    const tBot = (minH - ray.oy) / ray.dy;
    t0 = Math.max(0, Math.min(tTop, tBot));
    t1 = Math.max(tTop, tBot);
  }
  if (!(t1 > t0)) return rayHitGround(ray);

  const steps = 56;
  let prevT = t0;
  let prevAbove = null;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const x = ray.ox + ray.dx * t;
    const y = ray.oy + ray.dy * t;
    const z = ray.oz + ray.dz * t;
    const above = y >= heightAt(x, z);
    if (prevAbove === true && !above) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) * 0.5;
        const mx = ray.ox + ray.dx * mid;
        const my = ray.oy + ray.dy * mid;
        const mz = ray.oz + ray.dz * mid;
        if (my >= heightAt(mx, mz)) lo = mid;
        else hi = mid;
      }
      const ht = (lo + hi) * 0.5;
      const hx = ray.ox + ray.dx * ht;
      const hz = ray.oz + ray.dz * ht;
      return { x: hx, y: heightAt(hx, hz), z: hz };
    }
    prevAbove = above;
    prevT = t;
  }
  // Fallback: still return a plane hit so orders aren't dropped.
  return rayHitGround(ray);
}

function initThinInstances(mesh, activeCount, gpuCapacity) {
  const cap = Math.max(activeCount, gpuCapacity, 1);
  const matrices = new Float32Array(cap * 16);
  setThinInstances(mesh, matrices, cap);
  if (activeCount < cap) setThinInstanceCount(mesh, activeCount);
  const colors = new Float32Array(cap * 4);
  for (let s = 0; s < cap; s++) {
    colors[s * 4] = 1;
    colors[s * 4 + 1] = 1;
    colors[s * 4 + 2] = 1;
    colors[s * 4 + 3] = 1;
  }
  setThinInstanceColors(mesh, colors);
  return { matrices, colors, gpuCapacity: cap };
}

/** Small clearance above sampled terrain (GLB soles are at local y=0). */
const FOOT_CLEARANCE = 0.06;

/** Y-rotation so local +Z faces (sin θ, 0, cos θ) — matches atan2(dx, dz). */
function writeUnitMatrix(matrices, slot, x, z, uniformScale, yaw, moving, groundY = 0) {
  const o = slot * 16;
  if (uniformScale <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const stretch = moving ? 1.08 : 1;
  const narrow = moving ? 0.94 : 1;
  const sx = uniformScale * narrow;
  const sy = uniformScale;
  const sz = uniformScale * stretch;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Column0 (local +X) = (cos, 0, -sin); column2 (local +Z) = (sin, 0, cos).
  matrices[o] = c * sx;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * sx;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sy;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * sz;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * sz;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = groundY + FOOT_CLEARANCE;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function writeFlatRing(matrices, i, x, z, diameter, ringDiam, ringH, groundY = 0) {
  const o = i * 16;
  if (diameter <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const s = diameter / ringDiam;
  const y = groundY + ringH * 0.5;
  matrices[o] = s;
  matrices[o + 1] = 0;
  matrices[o + 2] = 0;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = 1;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = 0;
  matrices[o + 9] = 0;
  matrices[o + 10] = s;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

/** Uniform scale + Y spin; `yOffset` is added above ground / foot clearance. */
function writeGroundSpinMarker(matrices, i, x, z, scale, spinYaw, yOffset, groundY = 0) {
  const o = i * 16;
  if (scale <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const c = Math.cos(spinYaw);
  const s = Math.sin(spinYaw);
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
  matrices[o + 13] = groundY + FOOT_CLEARANCE + yOffset;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

/** v1 collar.glb — uniform scale + Y spin at feet. */
function writeSelectionCollar(matrices, i, x, z, scale, spinYaw, groundY = 0) {
  // Match game/units.js SELECTION_INDICATOR_Y_OFFSET * TILE (TILE≈4 → 0.14).
  writeGroundSpinMarker(matrices, i, x, z, scale, spinYaw, 0.14, groundY);
}

/** Instance tint: white = authored GLB colors; red/yellow = order feedback. */
const RING_TINT = {
  white: [1, 1, 1, 1],
  cyan: [0.15, 1, 1, 1],
  red: [1, 0.12, 0.08, 1],
  yellow: [1, 0.9, 0.12, 1],
};

/** @param {'white' | 'cyan' | 'red' | 'yellow'} [mode] */
function writeSelectionRingColors(colors, count, mode = 'white') {
  const c = RING_TINT[mode] ?? RING_TINT.white;
  for (let i = 0; i < count; i++) {
    colors[i * 4] = c[0];
    colors[i * 4 + 1] = c[1];
    colors[i * 4 + 2] = c[2];
    colors[i * 4 + 3] = c[3];
  }
}

function writeSelectionRingColorAt(colors, i, mode = 'white') {
  const c = RING_TINT[mode] ?? RING_TINT.white;
  const o = i * 4;
  colors[o] = c[0];
  colors[o + 1] = c[1];
  colors[o + 2] = c[2];
  colors[o + 3] = c[3];
}

function applyUnlitHudMaterial(mat) {
  if (!mat) return;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
}

const SELECTION_COLLAR_URL = '/assets/models/collar.glb';
/** v1: max(0.12, TILE * 0.22) with TILE=4. */
const SELECTION_COLLAR_SCALE = 0.88;

/** v1 click-command marker (`game/ui.js` createTargetMarker). */
const ORDER_MARKER_URL = '/assets/models/target.glb';
/**
 * Park this far along eye→hit (clamped). Same screen XY as the click, in front
 * of world geo. Scale tracks placeDist so apparent size stays steady.
 */
const ORDER_MARKER_HUD_DIST = 55;
const ORDER_MARKER_BASE_SCALE = 2.2;
const ORDER_POP_MS = 125;
const ORDER_HOLD_MS = 250;
const ORDER_FADE_MS = 200;
const ORDER_TOTAL_MS = ORDER_POP_MS + ORDER_HOLD_MS + ORDER_FADE_MS;
/** Radians of Y spin during pop (settles to camera-facing). Was 1.35π; punched to 2.4π — midpoint. */
const ORDER_SPIN_RAD = Math.PI * 1.875;

/** Max thin-instance slots per army for a unit type (KOTH). */
function kothPerArmyCap(typeId) {
  const max = kothMaxUnitsOfType(typeId);
  return max > 0 ? max / KOTH_MAX_SLOTS : 0;
}

function vatPartMeshes(batch) {
  if (batch.vatParts?.length) return batch.vatParts.map((p) => p.mesh);
  return [batch.mesh];
}

function resizeTypeBatch(batch, entityIds, opts = {}) {
  const prealloc = opts.preallocKoth ?? false;
  const newSize = entityIds.length;
  if (newSize > batch.gpuCapacity) {
    throw new Error(`type batch overflow: ${newSize} > ${batch.gpuCapacity}`);
  }
  // Keep GPU draw count at capacity for KOTH — Lite fails when ti.count grows after boot.
  // Shadow casters key off mappedSize; empty prealloc batches stay at full ti.count but do not cast.
  const drawCount = prealloc ? Math.max(batch.gpuCapacity, 1) : newSize;
  for (const mesh of vatPartMeshes(batch)) setThinInstanceCount(mesh, drawCount);
  batch.entityIds = entityIds;
  batch.mappedSize = newSize;
  if (prealloc && newSize < batch.gpuCapacity) {
    for (let s = newSize; s < batch.gpuCapacity; s++) {
      const o = s * 16;
      for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
    }
  }
  if (batch.vatParts?.length) {
    for (const part of batch.vatParts) {
      setThinInstanceColors(part.mesh, part.isTeamColor ? batch.colors : batch.vatWhiteColors);
    }
  } else {
    setThinInstanceColors(batch.mesh, batch.colors);
  }
  for (const mesh of vatPartMeshes(batch)) flushThinInstances(mesh);
}

async function loadUnitMeshTemplate(engine, url) {
  return loadBakedUnitMesh(engine, url);
}

/**
 * @param {object} engine
 * @param {number} typeId
 * @param {number} activeCount
 * @param {number} gpuCap
 */
async function createTypeBatch(engine, typeId, activeCount, gpuCap) {
  if (isVatUnitType(typeId)) {
    const def = VAT_UNIT_DEFS[typeId];
    const vat = await loadVatUnitTemplate(engine, def);
    const cap = Math.max(activeCount, gpuCap, 1);
    const matrices = new Float32Array(cap * 16);
    const colors = new Float32Array(cap * 4);
    const vatWhiteColors = new Float32Array(cap * 4);
    for (let s = 0; s < cap; s++) {
      colors[s * 4] = 1;
      colors[s * 4 + 1] = 1;
      colors[s * 4 + 2] = 1;
      colors[s * 4 + 3] = 1;
      vatWhiteColors[s * 4] = 1;
      vatWhiteColors[s * 4 + 1] = 1;
      vatWhiteColors[s * 4 + 2] = 1;
      vatWhiteColors[s * 4 + 3] = 1;
    }

    const vatParams = new Float32Array(cap * 4);
    const vatMoving = new Uint8Array(cap);
    const vatPhase = new Float32Array(cap);
    for (let s = 0; s < cap; s++) {
      vatPhase[s] = (s * 17 + 3) % Math.max(1, vat.idleClip.frameCount);
    }
    fillVatInstanceParams(vatParams, cap, vat.idleClip, vat.walkClip, vatMoving);

    // Shared matrices across primitives; TeamColor part alone takes owner tint.
    // setInstances must run before registerScene for the thin-instance VAT path.
    for (const part of vat.parts) {
      setThinInstances(part.mesh, matrices, cap);
      if (activeCount < cap) setThinInstanceCount(part.mesh, activeCount);
      setThinInstanceColors(part.mesh, part.isTeamColor ? colors : vatWhiteColors);
      part.handle.setInstances(vatParams);
    }

    return {
      mesh: vat.mesh,
      matrices,
      colors,
      vatWhiteColors,
      baseSize: 1,
      entityIds: [],
      gpuCapacity: cap,
      mappedSize: 0,
      vatHandle: vat.handle,
      vatParts: vat.parts,
      vatRoot: vat.root,
      vatContainer: vat.container,
      vatParams,
      vatMoving,
      vatPhase,
      idleClip: vat.idleClip,
      walkClip: vat.walkClip,
      vatScale: vat.instanceScale,
      vatFootLift: vat.footLift,
      vatDirty: false,
    };
  }

  const mesh = await loadUnitMeshTemplate(engine, UNIT_MODEL_URLS[typeId]);
  const { matrices, colors, gpuCapacity: cap } = initThinInstances(mesh, activeCount, gpuCap);
  return {
    mesh,
    matrices,
    colors,
    baseSize: 1,
    entityIds: [],
    gpuCapacity: cap,
    mappedSize: 0,
    fxSockets: mesh.fxSockets ?? [],
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} capacity
 * @param {{ types?: Int8Array | Uint8Array | number[], gpuCapacity?: number, field?: object | null, onAnimLoadProgress?: (done: number, total: number) => void }} [opts]
 */
export async function createRenderer(canvas, capacity, opts = {}) {
  const types = opts.types;
  const gpuCapacity = opts.gpuCapacity ?? capacity;
  const preallocKoth = gpuCapacity > capacity;
  const engine = await createEngine(canvas, { msaaSamples: 1 });
  const scene = createSceneContext(engine);
  if (opts.field && scene.clearColor) {
    scene.clearColor.r = 0.06;
    scene.clearColor.g = 0.11;
    scene.clearColor.b = 0.16;
    scene.clearColor.a = 1;
  }

  const camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, WORLD_HALF_F * 1.55, {
    x: 0,
    y: 0,
    z: 0,
  });
  // Lite calls Babylon's maxZ equivalent `farPlane`. The default 1000 clips
  // the environment ring and even parts of the board at wide zoom levels.
  camera.farPlane = 40000;
  scene.camera = camera;
  // Camera input is owned by cameraController (v1 mouse/keyboard). Do not attachControl —
  // Lite would still register wheel/touch handlers that fight our hub.
  const cameraController = createCameraController(camera, canvas);

  // Hemi is unshadowed fill — too high and tree "dark" sides stay brighter than
  // sun-cast ground shadows. Keep it low; let the directional carry the look.
  const sky = createHemisphericLight([0.2, 1, 0.1], opts.field ? 0.2 : 0.7);
  sky.diffuseColor = [0.78, 0.86, 1];
  sky.groundColor = [0.1, 0.08, 0.06];
  addToScene(scene, sky);
  // ~30° elevation (was ~60° / near-noon) — longer unit/tree shadows, more contrast.
  const sun = createDirectionalLight([-0.78, -0.48, -0.52], opts.field ? 1.55 : 1.15);
  sun.diffuse = [1, 0.94, 0.84];
  // Place the directional light "above" the board so ortho near/far contain casters.
  {
    const d = sun.direction;
    const dist = WORLD_HALF_F * 2.75;
    sun.position.x = -d.x * dist;
    sun.position.y = -d.y * dist;
    sun.position.z = -d.z * dist;
  }
  addToScene(scene, sun);

  // CSM: fits cascades from thin-instance world AABBs + camera (ESM only fits
  // mesh.world × local bounds, so board-scale TI units vanish or become ~2 texels).
  // Keep worldSpaceBias tiny — unit height is ~1–2; 0.15+ eats character contact shadows.
  // Note: Lite keeps darkness / worldSpaceBias on an internal csmCfg, not sg._config.
  const shadowOpts = {
    mapSize: 2048,
    numCascades: 4,
    lambda: 0.85,
    cascadeBlendPercentage: 0.08,
    stabilizeCascades: true,
    shadowMaxZ: WORLD_HALF_F * 2.75,
    worldSpaceBias: 0.02,
    // 0 = black in shadow, 1 = no shadow (PCF mixes darkness→1 by lit factor).
    darkness: 0.08,
    frustumEdgeFalloff: 0.08,
    forceRefreshEveryFrame: true,
  };
  const shadowGen = createCsmDirectionalShadowGenerator(engine, sun, shadowOpts);
  sun.shadowGenerator = shadowGen;
  let shadowsEnabled = true;
  /** Stable list so shadow task state is not rebuilt every flush. */
  let shadowCasterList = [];
  const SHADOW_CASTERS_OFF = [];

  /** @type {{ meshes: object[], update?: (camera: object, deltaMs: number) => void, applyTreeUpdates?: Function, dispose: () => void } | null} */
  let terrain = null;
  /** @type {{ setVisible: (on: boolean) => void, dispose: () => void } | null} */
  let tileGrid = null;
  let tileGridVisible = false;
  let ground = null;
  /** @type {object | null} */
  let fieldSnap = opts.field ?? null;
  /** Late-bound so scenery can emit before the particle system exists. */
  const treeFireEmit = { fn: null };

  function sceneryOpts() {
    return {
      emitFire(x, y, z, scale) {
        treeFireEmit.fn?.(x, y, z, scale);
      },
    };
  }

  function groundYAt(x, z) {
    return fieldSnap ? surfaceHeightAt(fieldSnap, x, z) : 0;
  }

  function rebuildTileGrid(snap) {
    tileGrid?.dispose?.();
    tileGrid = null;
    if (!snap) return;
    tileGrid = createTileGridOverlay(engine, scene, snap);
    // Apply current toggle after rebuild (mesh starts hidden / off-scene).
    tileGrid.setVisible(tileGridVisible);
  }

  if (opts.field) {
    terrain = await createTerrainFromField(engine, scene, opts.field, camera, sceneryOpts());
    rebuildTileGrid(opts.field);
  } else {
    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.18, 0.28, 0.16];
    ground = createGround(engine, { width: WORLD_HALF_F * 2, height: WORLD_HALF_F * 2 });
    ground.material = groundMat;
    addToScene(scene, ground);
  }

  const entitySlot = new Int32Array(Math.max(capacity, gpuCapacity));
  entitySlot.fill(-1);
  /** Per-entity batch map key (VAT shards use `${typeId}#${shard}`). */
  /** @type {(string | number | null)[]} */
  const entityBatchKey = new Array(entitySlot.length).fill(null);

  /** @type {Map<string | number, object>} */
  const typeBatches = new Map();
  const fallbackEntities = [];
  const vatInstanceCap = maxVatInstancesPerBatch(engine);

  function batchKey(typeId, owner = 0) {
    return preallocKoth ? `${typeId}:${owner}` : typeId;
  }

  function vatShardKey(typeId, shard) {
    return `${typeId}#${shard}`;
  }

  function chunkIds(ids, maxPer) {
    const out = [];
    for (let i = 0; i < ids.length; i += maxPer) out.push(ids.slice(i, i + maxPer));
    return out.length ? out : [[]];
  }

  async function addVatShards(typeId, entityIds) {
    const chunks = chunkIds(entityIds, vatInstanceCap);
    for (let shard = 0; shard < chunks.length; shard++) {
      const slice = chunks[shard];
      const key = chunks.length === 1 ? typeId : vatShardKey(typeId, shard);
      const batch = await createTypeBatch(engine, typeId, slice.length, slice.length);
      batch.entityIds = slice;
      batch.mappedSize = slice.length;
      batch.vatShard = shard;
      batch.vatShardBase = typeId;
      if (batch.vatContainer) addToScene(scene, batch.vatContainer);
      else if (batch.vatRoot) addToScene(scene, batch.vatRoot);
      else for (const mesh of vatPartMeshes(batch)) addToScene(scene, mesh);
      refineVatFootLift(batch);
      typeBatches.set(key, batch);
      for (let s = 0; s < slice.length; s++) {
        entitySlot[slice[s]] = s;
        entityBatchKey[slice[s]] = key;
      }
      opts.onAnimLoadProgress?.(shard + 1, chunks.length);
    }
    return chunks.length;
  }

  /** After addToScene — soles sit near instance Y (VAT×mesh.world cancels armature). */
  function refineVatFootLift(batch) {
    if (!batch?.vatParts?.length) return;
    // Do NOT subtract mesh.worldY*scale — that double-counts and buries units.
    batch.vatFootLift = 0.08;
  }

  if (opts.onAnimLoadProgress && types) {
    let vatTotal = 0;
    for (let i = 0; i < capacity; i++) if (isVatUnitType(types[i])) vatTotal++;
    if (vatTotal > 0) {
      const shardHint = Math.max(1, Math.ceil(vatTotal / vatInstanceCap));
      opts.onAnimLoadProgress(0, shardHint);
    }
  }

  if (preallocKoth) {
    // One thin-instance mesh per (type, owner) so solo→2 never grows a batch 10→20
    // (Lite fails to render instances beyond the solo active count on the same mesh).
    for (const typeId of unitModelTypeIds()) {
      const perArmy = kothPerArmyCap(typeId);
      if (perArmy <= 0) continue;
      for (let owner = 0; owner < KOTH_MAX_SLOTS; owner++) {
        let batchSize = 0;
        if (types && owner === 0) {
          for (let i = 0; i < capacity; i++) if (types[i] === typeId) batchSize++;
        }
        const initActive = owner === 0 ? batchSize : perArmy;
        const batch = await createTypeBatch(engine, typeId, initActive, perArmy);
        if (owner > 0) {
          for (let s = 0; s < perArmy; s++) {
            const o = s * 16;
            for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
          }
        }
        if (batch.vatContainer) addToScene(scene, batch.vatContainer);
        else if (batch.vatRoot) addToScene(scene, batch.vatRoot);
        else for (const mesh of vatPartMeshes(batch)) addToScene(scene, mesh);
        refineVatFootLift(batch);
        const key = batchKey(typeId, owner);
        const entityIds = [];
        if (types && owner === 0) {
          for (let i = 0; i < capacity; i++) {
            if (types[i] === typeId) {
              entityIds.push(i);
              entitySlot[i] = entityIds.length - 1;
            }
          }
        }
        batch.entityIds = entityIds;
        batch.mappedSize = owner === 0 ? batchSize : 0;
        typeBatches.set(key, batch);
        for (let s = 0; s < entityIds.length; s++) {
          entityBatchKey[entityIds[s]] = key;
        }
      }
    }
  } else {
    const typeEntities = new Map();
    if (types) {
      for (let i = 0; i < capacity; i++) {
        const type = types[i];
        if (!typeEntities.has(type)) typeEntities.set(type, []);
        typeEntities.get(type).push(i);
      }
    }

    for (const [typeId, entityIds] of typeEntities) {
      const batchSize = entityIds.length;
      if (batchSize === 0) continue;

      if (isVatUnitType(typeId)) {
        // Split past Lite's 1-row VAT instance-param texture width.
        await addVatShards(typeId, entityIds);
      } else if (hasUnitModel(typeId)) {
        const typeGpuCap = Math.max(batchSize, 1);
        const batch = await createTypeBatch(engine, typeId, batchSize, typeGpuCap);
        batch.entityIds = entityIds;
        batch.mappedSize = batchSize;
        addToScene(scene, batch.mesh);
        typeBatches.set(typeId, batch);
        for (let s = 0; s < entityIds.length; s++) {
          entitySlot[entityIds[s]] = s;
          entityBatchKey[entityIds[s]] = typeId;
        }
      } else {
        fallbackEntities.push(...entityIds);
      }
    }
  }

  if (opts.onAnimLoadProgress) opts.onAnimLoadProgress(1, 1);

  const BASE_DIAMETER = 6;
  let fallback = null;
  const fallbackCap = Math.max(gpuCapacity, capacity, 1);
  if (fallbackEntities.length > 0 || preallocKoth) {
    const mesh = createSphere(engine, { diameter: BASE_DIAMETER, segments: capacity > 500 ? 6 : 10 });
    const material = createStandardMaterial();
    material.diffuseColor = [1, 1, 1];
    mesh.material = material;
    const fbInitCount = fallbackEntities.length;
    const { matrices, colors, gpuCapacity: cap } = initThinInstances(mesh, fbInitCount, fallbackCap);
    addToScene(scene, mesh);
    for (let s = 0; s < fallbackEntities.length; s++) {
      entitySlot[fallbackEntities[s]] = s;
      entityBatchKey[fallbackEntities[s]] = null;
    }
    fallback = { mesh, matrices, colors, baseSize: BASE_DIAMETER, entityIds: [...fallbackEntities], gpuCapacity: cap, mappedSize: fbInitCount };
  }

  const RING_DIAM = 1;
  const RING_H = 0.12;
  const ringCap = Math.max(capacity, gpuCapacity, 1);
  /** @type {object[]} */
  let selRingParts = [];
  let useCollar = false;
  try {
    // Keep red/white/yellow bands as separate draws (merge would paint all red).
    selRingParts = await loadBakedUnitMeshParts(engine, SELECTION_COLLAR_URL);
    useCollar = selRingParts.length > 0;
    for (const mesh of selRingParts) applyUnlitHudMaterial(mesh.material);
  } catch (err) {
    console.warn('Selection collar model failed (using disc):', SELECTION_COLLAR_URL, err);
    const selRing = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 24 });
    const ringMat = createStandardMaterial();
    ringMat.diffuseColor = [0, 1, 1];
    ringMat.emissiveColor = [0, 0.5, 0.5];
    ringMat.alpha = 0.9;
    selRing.material = ringMat;
    selRingParts = [selRing];
  }
  const ringMatrices = new Float32Array(ringCap * 16);
  const ringColors = new Float32Array(ringCap * 4);
  writeSelectionRingColors(ringColors, ringCap, useCollar ? 'white' : 'cyan');
  for (const mesh of selRingParts) {
    setThinInstances(mesh, ringMatrices, ringCap);
    setThinInstanceCount(mesh, capacity);
    setThinInstanceColors(mesh, ringColors);
    addToScene(scene, mesh);
  }

  let orderMarker;
  let useOrderTarget = false;
  /** Local-space Y of the arrow tip (placed on the click ray). */
  let orderTipLocalY = 0;
  try {
    orderMarker = await loadUnitMeshTemplate(engine, ORDER_MARKER_URL);
    useOrderTarget = true;
    const mat = orderMarker.material;
    if (mat) {
      applyUnlitHudMaterial(mat);
      if ('alpha' in mat) mat.alpha = 1;
      // Leave authored albedo; instance tint sets order color (red / yellow).
      if (mat.emissiveColor) mat.emissiveColor = [0, 0, 0];
    }
    // Tip = lowest geometry Y (points at the ground click). Clear mesh.position
    // from prepareLegacyModel and bake the tip offset into the instance matrix.
    orderTipLocalY = orderMarker.boundMin?.[1] ?? 0;
    if (orderMarker.position) {
      orderMarker.position.x = 0;
      orderMarker.position.y = 0;
      orderMarker.position.z = 0;
      orderMarker.markLocalDirty?.();
    }
  } catch (err) {
    console.warn('Order marker model failed (using disc):', ORDER_MARKER_URL, err);
    orderMarker = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 32 });
    const orderMat = createStandardMaterial();
    orderMat.diffuseColor = [0.35, 0.75, 1];
    orderMat.emissiveColor = [0.2, 0.55, 1];
    orderMat.alpha = 1;
    orderMarker.material = orderMat;
    orderTipLocalY = 0;
  }
  const orderMatrices = new Float32Array(16);
  setThinInstances(orderMarker, orderMatrices, 1);
  setThinInstanceColors(orderMarker, new Float32Array([1, 1, 1, 0]));
  addToScene(scene, orderMarker);
  /** @type {{ x: number, y: number, z: number, started: number, tint: string, spinDir: number } | null} */
  let orderPing = null;
  /** Alternate pop spin direction each new ping. */
  let nextOrderSpinDir = 1;

  // Debug: unit pick proxies are spheres (pickRadius @ pickHeight), not mesh tris.
  const pickDebugCap = Math.max(capacity, gpuCapacity, 1);
  const pickDebugMesh = createSphere(engine, { diameter: 2, segments: 10 });
  const pickDebugMat = createStandardMaterial();
  pickDebugMat.diffuseColor = [1, 0.2, 0.85];
  pickDebugMat.emissiveColor = [0.7, 0.1, 0.55];
  pickDebugMat.alpha = 0.28;
  pickDebugMesh.material = pickDebugMat;
  pickDebugMesh.visible = false;
  const pickDebugMatrices = new Float32Array(pickDebugCap * 16);
  const pickDebugColors = new Float32Array(pickDebugCap * 4);
  for (let s = 0; s < pickDebugCap; s++) {
    pickDebugColors[s * 4] = 1;
    pickDebugColors[s * 4 + 1] = 0.35;
    pickDebugColors[s * 4 + 2] = 0.9;
    pickDebugColors[s * 4 + 3] = 0.35;
  }
  setThinInstances(pickDebugMesh, pickDebugMatrices, pickDebugCap);
  setThinInstanceCount(pickDebugMesh, 0);
  setThinInstanceColors(pickDebugMesh, pickDebugColors);
  addToScene(scene, pickDebugMesh);
  let pickDebugVisible = false;
  let pickDebugCount = 0;
  const particles = createParticleSystem(engine, scene, { capacity: 16384 });
  /** Wide at the base, then pull inward while climbing (column, not fountain). */
  treeFireEmit.fn = (x, groundY, z, scale = 1) => {
    const s = Math.max(0.65, scale);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.35 + Math.random() * 1.35) * s;
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      const px = x + ox;
      const pz = z + oz;
      // Keep births near the roots / lower trunk.
      const py = groundY + 0.15 + Math.random() * 0.9 * s;
      const roll = Math.random();
      const color =
        roll > 0.62
          ? [1, 0.88, 0.35, 0.36]
          : roll > 0.28
            ? [1, 0.48, 0.08, 0.4]
            : [0.95, 0.18, 0.02, 0.32];
      const w = (0.28 + Math.random() * 0.38) * s;
      const h = (0.65 + Math.random() * 0.85) * s;
      // Inward toward trunk + mostly up. Outer sparks die sooner.
      const pull = 0.55 + Math.random() * 0.45;
      const life = 1.1 + Math.random() * 0.7 + (1.1 - Math.min(1, rad / (1.7 * s))) * 0.8;
      particles.emit({
        position: [px, py, pz],
        velocity: [
          -ox * pull,
          2.4 + Math.random() * 2.6 * s,
          -oz * pull,
        ],
        gravity: [0, 1.5, 0],
        color,
        lifetime: life,
        startSize: [w, h],
        endSize: [w * 0.15, h * 0.35],
        drag: 0.95,
      });
    }
    for (let i = 0; i < 2; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.2 + Math.random() * 0.7) * s;
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      particles.emit({
        position: [x + ox, groundY + 0.2 + Math.random() * 0.5 * s, z + oz],
        velocity: [
          -ox * 0.7,
          2.8 + Math.random() * 2.2,
          -oz * 0.7,
        ],
        gravity: [0, 1.2, 0],
        color: [1, 0.7, 0.2, 0.5],
        lifetime: 1.6 + Math.random() * 0.8,
        startSize: 0.16 * s,
        endSize: 0.03,
        drag: 0.45,
      });
    }
  };
  // Match entity capacity — a 512 cap made mass-select / stress only show chips
  // on the first N entity indices (later selected units looked "unhealthy-less").
  const healthBars = createHealthBars(engine, scene, {
    capacity: Math.max(capacity, gpuCapacity, 1),
  });
  const trailGenerations = new Uint32Array(MAX_PROJECTILES);
  const trailLastEmitMs = new Float64Array(MAX_PROJECTILES);
  /** Generation last splashed — avoids double FX if a dead slot lingers. */
  const fireballSplashSeen = new Uint32Array(MAX_PROJECTILES);
  let particleClockMs = 0;

  function emitFireballGroundSplashes(prev, cur) {
    if (!cur) return;
    const n = cur.highWater ?? 0;
    for (let i = 0; i < n; i++) {
      if (cur.alive[i]) continue;
      if (cur.type[i] !== PROJECTILE.FIREBALL) continue;
      const reason = cur.despawnReason?.[i] ?? PROJECTILE_DESPAWN.NONE;
      if (
        reason !== PROJECTILE_DESPAWN.HIT &&
        reason !== PROJECTILE_DESPAWN.MISS &&
        reason !== PROJECTILE_DESPAWN.TERRAIN
      ) {
        continue;
      }
      const gen = cur.generation[i];
      if (!gen || fireballSplashSeen[i] === gen) continue;
      const wasAlive =
        prev && i < prev.highWater && prev.alive[i] && prev.generation[i] === gen;
      if (!wasAlive) continue;
      fireballSplashSeen[i] = gen;
      const x = cur.x[i];
      const z = cur.z[i];
      const y = groundYAt(x, z) + 0.25;
      // Ground splash: wide burst of wisps + sparks.
      for (let n = 0; n < 36; n++) {
        const ang = (n / 36) * Math.PI * 2 + Math.random() * 0.35;
        const speed = 6 + Math.random() * 8;
        const roll = Math.random();
        particles.emit({
          position: [x, y + Math.random() * 0.55, z],
          velocity: [
            Math.cos(ang) * speed,
            4 + Math.random() * 8,
            Math.sin(ang) * speed,
          ],
          gravity: [0, -16, 0],
          color:
            roll > 0.5
              ? [1, 0.8, 0.3, 0.5]
              : [1, 0.4, 0.06, 0.55],
          lifetime: 0.5 + Math.random() * 0.45,
          startSize: [
            1.3 + Math.random() * 1.6,
            2.2 + Math.random() * 2.4,
          ],
          endSize: [0.25, 0.55],
          drag: 1.15,
        });
      }
      for (let n = 0; n < 20; n++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 3.5 + Math.random() * 7;
        particles.emit({
          position: [x, y, z],
          velocity: [
            Math.cos(ang) * speed,
            6 + Math.random() * 9,
            Math.sin(ang) * speed,
          ],
          gravity: [0, -10, 0],
          color: [1, 0.65, 0.15, 0.7],
          lifetime: 0.55 + Math.random() * 0.55,
          startSize: 0.55,
          endSize: 0.06,
          drag: 0.45,
        });
      }
      // Soft bloom at the impact point.
      particles.emit({
        position: [x, y + 0.4, z],
        velocity: [0, 3.5, 0],
        gravity: [0, 1.2, 0],
        color: [1, 0.55, 0.1, 0.4],
        lifetime: 0.45,
        startSize: 7.5,
        endSize: 2.2,
        drag: 1.0,
      });
    }
  }
  const arrowTrails = createArrowTrails(engine, scene);
  const projectileRenderer = createProjectileRenderer(
    engine,
    scene,
    groundYAt,
    (slot, generation, x, y, z, vx, vz, def, vy = 0) => {
      const isFireball = def.id === PROJECTILE.FIREBALL;
      const isArrow = def.mesh === PROJECTILE_MESH.ARROW;
      const emitGapMs = isFireball ? 18 : isArrow ? 22 : 32;
      if (
        trailGenerations[slot] === generation &&
        particleClockMs - trailLastEmitMs[slot] < emitGapMs
      ) {
        return;
      }
      trailGenerations[slot] = generation;
      trailLastEmitMs[slot] = particleClockMs;
      if (isArrow) {
        // World-oriented dashes (not camera billboards) so they follow travel.
        arrowTrails.emit(x, y, z, vx, vy, vz);
        return;
      }
      const speed = Math.hypot(vx, vz);
      const offset = speed > 1e-6 ? 0.55 / speed : 0;
      const px = x - vx * offset;
      const pz = z - vz * offset;
      if (isFireball) {
        // Fat near the ball, taper off behind — trail shrink handles the fade.
        const trailVy = -vy * 0.35 + 0.15;
        particles.emit({
          position: [px, y, pz],
          velocity: speed > 1e-6 ? [-vx * 0.18, trailVy, -vz * 0.18] : [0, trailVy, 0],
          gravity: [0, -1.2, 0],
          color: [1, 0.42, 0.05, 0.9],
          lifetime: 0.32,
          startSize: 3.4,
          endSize: 0.4,
          drag: 1.1,
        });
        particles.emit({
          position: [px, y, pz],
          velocity: speed > 1e-6 ? [-vx * 0.1, trailVy + 0.35, -vz * 0.1] : [0, trailVy + 0.35, 0],
          gravity: [0, -0.4, 0],
          color: [1, 0.78, 0.2, 0.8],
          lifetime: 0.24,
          startSize: 2.2,
          endSize: 0.12,
          drag: 0.6,
        });
        return;
      }
    },
  );

  function isRenderableMesh(node) {
    return !!(node && '_gpu' in node && 'material' in node && node.material);
  }

  function forEachMesh(root, fn) {
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (isRenderableMesh(node)) fn(node);
      const kids = node.children;
      if (kids?.length) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }

  function collectShadowCasters() {
    /** @type {object[]} */
    const casters = [];
    const pushMesh = (mesh) => {
      if (!isRenderableMesh(mesh)) return;
      if (mesh.visible === false) return;
      const ti = mesh.thinInstances;
      if (ti && !(ti.count > 0)) return;
      casters.push(mesh);
    };
    for (const batch of typeBatches.values()) {
      // KOTH keeps empty owner batches at full ti.count with zero matrices — skip those.
      if (!(batch.mappedSize > 0)) continue;
      for (const mesh of vatPartMeshes(batch)) pushMesh(mesh);
    }
    if (fallback?.mappedSize > 0) pushMesh(fallback.mesh);
    if (terrain?.meshes) {
      for (const root of terrain.meshes) {
        // GLB scenery only — billboard impostors are flat cards and cast junk.
        const name = root.name || '';
        if (typeof name === 'string' && name.startsWith('scenery-model-')) {
          forEachMesh(root, pushMesh);
        }
      }
    }
    return casters;
  }

  function isBackdropMesh(mesh) {
    return (mesh?.name || '') === 'distant-mountains';
  }

  function markShadowReceivers(on) {
    const recv = !!on;
    if (ground) ground.receiveShadows = recv;
    if (terrain?.meshes) {
      for (const root of terrain.meshes) {
        forEachMesh(root, (m) => {
          m.receiveShadows = recv && !isBackdropMesh(m);
        });
      }
    }
    for (const batch of typeBatches.values()) {
      for (const mesh of vatPartMeshes(batch)) mesh.receiveShadows = recv;
    }
    if (fallback?.mesh) fallback.mesh.receiveShadows = recv;
  }

  function sameCasterList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function applyShadowState() {
    // Keep the generator on the light so shadow-capable pipelines stay valid.
    // Off = empty caster list → cleared depth maps → fully lit receivers.
    if (!shadowsEnabled) {
      shadowCasterList = SHADOW_CASTERS_OFF;
      setShadowTaskCasterMeshes(shadowGen, shadowCasterList);
      return;
    }
    const next = collectShadowCasters();
    if (!sameCasterList(shadowCasterList, next)) shadowCasterList = next;
    setShadowTaskCasterMeshes(shadowGen, shadowCasterList);
  }

  // Receivers must be flagged before register so Lite builds shadow sampling in.
  markShadowReceivers(true);
  applyShadowState();

  let frameCb = null;
  let unitFxElapsed = 0;
  // 1 particle/unit @ ~12Hz — much cheaper than the old 3× @ 25Hz, still visible in armies.
  const UNIT_FX_INTERVAL_MS = 80;
  onBeforeRender(scene, (deltaMs) => {
    terrain?.update?.(camera, deltaMs);
    particleClockMs += Math.min(100, Math.max(0, deltaMs));
    unitFxElapsed += deltaMs;
    if (unitFxElapsed >= UNIT_FX_INTERVAL_MS) {
      unitFxElapsed = 0;
      emitUnitSocketFire();
    }
    particles.update(deltaMs);
    arrowTrails.update(deltaMs);
    arrowTrails.commit();
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    for (const batch of typeBatches.values()) {
      if (batch.vatParts?.length) {
        for (const part of batch.vatParts) part.handle.update(dt);
      } else {
        batch.vatHandle?.update?.(dt);
      }
    }
    if (frameCb) frameCb(deltaMs);
  });

  /** Constant little fire at particle_anchor / torch_anchor sockets. */
  function emitUnitSocketFire() {
    for (const batch of typeBatches.values()) {
      const sockets = batch.fxSockets;
      if (!sockets?.length) continue;
      const count = batch.mesh?.thinInstances?.count ?? 0;
      const m = batch.matrices;
      for (let slot = 0; slot < count; slot++) {
        const o = slot * 16;
        if (!(m[o + 15] > 0)) continue;
        for (let s = 0; s < sockets.length; s++) {
          const sock = sockets[s];
          const lx = sock.x;
          const ly = sock.y;
          const lz = sock.z;
          const wx = m[o + 12] + m[o] * lx + m[o + 8] * lz;
          const wy = m[o + 13] + m[o + 5] * ly;
          const wz = m[o + 14] + m[o + 2] * lx + m[o + 10] * lz;
          const torch = /torch/i.test(sock.name);
          emitSocketFlame(wx, wy, wz, torch ? 0.55 : 0.8, torch ? 'torch' : 'mage');
        }
      }
    }
  }

  function emitSocketFlame(x, y, z, scale, style) {
    const s = scale;
    const mage = style === 'mage';
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.1 * s;
    particles.emit({
      position: [
        x + Math.cos(ang) * rad,
        y + Math.random() * 0.06 * s,
        z + Math.sin(ang) * rad,
      ],
      velocity: [
        (Math.random() - 0.5) * (mage ? 0.1 : 0.12),
        0.45 + Math.random() * 0.55,
        (Math.random() - 0.5) * (mage ? 0.1 : 0.12),
      ],
      gravity: [0, mage ? 0.45 : 0.8, 0],
      color: mage
        ? Math.random() > 0.4
          ? [0.85, 0.95, 1, 0.6]
          : [1, 1, 1, 0.55]
        : Math.random() > 0.45
          ? [1, 0.75, 0.2, 0.55]
          : [1, 0.4, 0.06, 0.5],
      lifetime: 0.5 + Math.random() * 0.25,
      startSize: [0.22 * s, 0.42 * s],
      endSize: [0.05 * s, 0.12 * s],
      drag: mage ? 0.9 : 1.2,
    });
  }

  await registerSceneWithShadowSupport(scene);

  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth;
    const height = rect.height || canvas.clientHeight;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width,
      height,
      aspect: width / height,
    };
  }

  function flushVatParams(batch) {
    if (!batch.vatDirty) return;
    if (!batch.vatHandle && !batch.vatParts?.length) return;
    const n = batch.mesh.thinInstances?.count ?? batch.gpuCapacity;
    const params = batch.vatParams.subarray(0, n * 4);
    if (batch.vatParts?.length) {
      for (const part of batch.vatParts) part.handle.setInstances(params);
    } else {
      batch.vatHandle.setInstances(params);
    }
    batch.vatDirty = false;
  }

  function cameraEyePos() {
    const wm = camera.worldMatrix;
    if (wm && Number.isFinite(wm[12])) return { x: wm[12], y: wm[13], z: wm[14] };
    const p = camera.position;
    return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
  }

  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }

  function easeOutBack(t) {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  function clearOrderMatrix(matrices) {
    for (let k = 0; k < 16; k++) matrices[k] = 0;
  }

  function writeSpinAt(matrices, x, y, z, scale, spinYaw) {
    if (scale <= 1e-4) {
      clearOrderMatrix(matrices);
      return;
    }
    const c = Math.cos(spinYaw);
    const s = Math.sin(spinYaw);
    matrices[0] = c * scale;
    matrices[1] = 0;
    matrices[2] = -s * scale;
    matrices[3] = 0;
    matrices[4] = 0;
    matrices[5] = scale;
    matrices[6] = 0;
    matrices[7] = 0;
    matrices[8] = s * scale;
    matrices[9] = 0;
    matrices[10] = c * scale;
    matrices[11] = 0;
    matrices[12] = x;
    matrices[13] = y;
    matrices[14] = z;
    matrices[15] = 1;
  }

  function hideOrderMarker() {
    clearOrderMatrix(orderMatrices);
    setThinInstanceColor(orderMarker, 0, 1, 1, 1, 0);
  }

  /**
   * Slam / pop / shrink. Tip on the eye→hit ray (click screen XY) near the camera.
   * World scale ∝ placeDist → steady on-screen size at any zoom / click distance.
   */
  function updateOrderMarker() {
    if (!orderPing) {
      hideOrderMarker();
      return;
    }
    const elapsed = performance.now() - orderPing.started;
    if (elapsed >= ORDER_TOTAL_MS) {
      orderPing = null;
      hideOrderMarker();
      return;
    }

    const x = orderPing.x;
    const z = orderPing.z;
    const gy = (Number.isFinite(orderPing.y) ? orderPing.y : groundYAt(x, z)) + FOOT_CLEARANCE;
    const eye = cameraEyePos();

    let animScale = 1;
    // Relative spin during pop; settles to 0 so the face stays camera-facing.
    const spinDir = orderPing.spinDir || 1;
    let spinOffset = 0;

    if (elapsed < ORDER_POP_MS) {
      const u = elapsed / ORDER_POP_MS;
      const pop = easeOutBack(Math.min(1, u));
      animScale = 2.4 - 1.4 * pop;
      // Ease-out spin into face — more turns + longer pop reads clearly.
      spinOffset = spinDir * (1 - easeOutCubic(u)) * ORDER_SPIN_RAD;
    } else if (elapsed < ORDER_POP_MS + ORDER_HOLD_MS) {
      animScale = 1;
      spinOffset = 0;
    } else {
      const u = (elapsed - ORDER_POP_MS - ORDER_HOLD_MS) / ORDER_FADE_MS;
      animScale = Math.max(0, 1 - u * u);
      spinOffset = spinDir * u * 0.45;
    }

    const dx = x - eye.x;
    const dy = gy - eye.y;
    const dz = z - eye.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const placeDist = Math.min(ORDER_MARKER_HUD_DIST, dist * 0.45);
    // scale / placeDist is constant → same pixels whether zoomed in or out.
    const scale = Math.max(
      0,
      animScale * ORDER_MARKER_BASE_SCALE * (placeDist / ORDER_MARKER_HUD_DIST),
    );
    if (scale <= 1e-4) {
      hideOrderMarker();
      return;
    }

    const inv = 1 / dist;
    const tipX = eye.x + dx * inv * placeDist;
    const tipY = eye.y + dy * inv * placeDist;
    const tipZ = eye.z + dz * inv * placeDist;
    // Origin so the tip vertex lands on the ray (Y spin only — tip is on local Y).
    const ox = tipX;
    const oy = tipY - orderTipLocalY * scale;
    const oz = tipZ;

    if (useOrderTarget) {
      // target.glb is flat on YZ (thin on X) — yaw so local +X faces the camera.
      const faceYaw = Math.atan2(-(eye.z - oz), eye.x - ox);
      writeSpinAt(orderMatrices, ox, oy, oz, scale, faceYaw + spinOffset);
    } else {
      writeFlatRing(orderMatrices, 0, tipX, tipZ, 10 * scale, RING_DIAM, RING_H, tipY);
    }
    const tint = RING_TINT[orderPing.tint] ?? RING_TINT.white;
    setThinInstanceColor(orderMarker, 0, tint[0], tint[1], tint[2], 1);
  }

  function flushAllBatches() {
    updateOrderMarker();
    for (const batch of typeBatches.values()) {
      flushVatParams(batch);
      for (const mesh of vatPartMeshes(batch)) flushThinInstances(mesh);
    }
    if (fallback) flushThinInstances(fallback.mesh);
    pushSelRingColors();
    for (const mesh of selRingParts) flushThinInstances(mesh);
    flushThinInstances(orderMarker);
    if (pickDebugVisible) flushThinInstances(pickDebugMesh);
    projectileRenderer.commit();
    arrowTrails.commit();
    if (shadowsEnabled) applyShadowState();
  }

  function setSelRingCount(n) {
    for (const mesh of selRingParts) setThinInstanceCount(mesh, n);
  }

  function pushSelRingColors() {
    for (const mesh of selRingParts) setThinInstanceColors(mesh, ringColors);
  }

  function writePickDebugSphere(slot, x, y, z, radius) {
    const o = slot * 16;
    if (radius <= 0) {
      for (let k = 0; k < 16; k++) pickDebugMatrices[o + k] = 0;
      return;
    }
    // Mesh diameter is 2 → uniform scale equals radius.
    const s = radius;
    pickDebugMatrices[o] = s;
    pickDebugMatrices[o + 1] = 0;
    pickDebugMatrices[o + 2] = 0;
    pickDebugMatrices[o + 3] = 0;
    pickDebugMatrices[o + 4] = 0;
    pickDebugMatrices[o + 5] = s;
    pickDebugMatrices[o + 6] = 0;
    pickDebugMatrices[o + 7] = 0;
    pickDebugMatrices[o + 8] = 0;
    pickDebugMatrices[o + 9] = 0;
    pickDebugMatrices[o + 10] = s;
    pickDebugMatrices[o + 11] = 0;
    pickDebugMatrices[o + 12] = x;
    pickDebugMatrices[o + 13] = y;
    pickDebugMatrices[o + 14] = z;
    pickDebugMatrices[o + 15] = 1;
  }

  function writeInstanceAt(i, typeId, owner, x, z, diameter, yaw = 0, moving = false) {
    const slot = entitySlot[i];
    if (slot < 0) return false;
    const key = entityBatchKey[i] ?? batchKey(typeId, owner);
    const batch = typeBatches.get(key) ?? fallback;
    if (!batch) return false;
    const tiCount = batch.mesh.thinInstances?.count ?? 0;
    if (slot >= tiCount) return false;
    writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, batch === fallback);
    return true;
  }

  function mapEntitySlots(count, typesArr, ownersArr) {
    entitySlot.fill(-1);
    entityBatchKey.fill(null);
    const nextByBase = new Map();
    for (let i = 0; i < count; i++) {
      const type = Number(typesArr[i]);
      const owner = ownersArr ? Number(ownersArr[i]) : 0;
      const key = batchKey(type, owner);
      if (!nextByBase.has(key)) nextByBase.set(key, []);
      nextByBase.get(key).push(i);
    }

    /** @type {Set<string | number>} */
    const usedKeys = new Set();

    for (const [baseKey, entityIds] of nextByBase) {
      // VAT shards: typeId#0, typeId#1, … created at boot when count > vatInstanceCap.
      const sharded = typeBatches.has(vatShardKey(baseKey, 0))
        || (typeof baseKey === 'number' && typeBatches.has(vatShardKey(baseKey, 0)));
      if (sharded || (isVatUnitType(Number(baseKey)) && !typeBatches.has(baseKey))) {
        const chunks = chunkIds(entityIds, vatInstanceCap);
        for (let shard = 0; shard < chunks.length; shard++) {
          const key = chunks.length === 1 && typeBatches.has(baseKey)
            ? baseKey
            : vatShardKey(baseKey, shard);
          const batch = typeBatches.get(key);
          if (!batch) continue;
          usedKeys.add(key);
          const slice = chunks[shard];
          resizeTypeBatch(batch, slice, { preallocKoth });
          for (let s = 0; s < slice.length; s++) {
            entitySlot[slice[s]] = s;
            entityBatchKey[slice[s]] = key;
          }
          if (batch.vatHandle) {
            batch.vatDirty = true;
            flushVatParams(batch);
          }
        }
        continue;
      }

      const batch = typeBatches.get(baseKey);
      if (batch) {
        usedKeys.add(baseKey);
        resizeTypeBatch(batch, entityIds, { preallocKoth });
        for (let s = 0; s < entityIds.length; s++) {
          entitySlot[entityIds[s]] = s;
          entityBatchKey[entityIds[s]] = baseKey;
        }
        if (batch.vatHandle) {
          batch.vatDirty = true;
          flushVatParams(batch);
        }
      }
    }

    for (const [key, batch] of typeBatches) {
      if (!usedKeys.has(key)) {
        batch.entityIds = [];
        batch.mappedSize = 0;
        if (preallocKoth) {
          resizeTypeBatch(batch, [], { preallocKoth: true });
        } else {
          for (const mesh of vatPartMeshes(batch)) setThinInstanceCount(mesh, 0);
        }
      }
    }

    const unmapped = [];
    for (let i = 0; i < count; i++) {
      if (entitySlot[i] < 0) unmapped.push(i);
    }

    if (unmapped.length > 0 && fallback) {
      const fbIds = unmapped.slice();
      resizeTypeBatch(fallback, fbIds, { preallocKoth: false });
      for (let s = 0; s < fbIds.length; s++) {
        entitySlot[fbIds[s]] = s;
        entityBatchKey[fbIds[s]] = null;
      }
    }

    return unmapped.filter((i) => entitySlot[i] < 0);
  }

  function viewProjection() {
    const { aspect } = canvasCoords(0, 0);
    return getViewProjectionMatrix(camera, aspect);
  }

  function writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, useSphereY) {
    const gy = groundYAt(x, z);
    if (useSphereY) {
      const scale = diameter / batch.baseSize;
      const o = slot * 16;
      if (scale <= 0) {
        for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
        return;
      }
      const stretch = moving ? 1.14 : 1;
      const narrow = moving ? 0.9 : 1;
      const sx = scale * narrow;
      const sy = scale;
      const sz = scale * stretch;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const y = gy + FOOT_CLEARANCE + diameter * 0.5;
      batch.matrices[o] = c * sx;
      batch.matrices[o + 1] = 0;
      batch.matrices[o + 2] = -s * sx;
      batch.matrices[o + 3] = 0;
      batch.matrices[o + 4] = 0;
      batch.matrices[o + 5] = sy;
      batch.matrices[o + 6] = 0;
      batch.matrices[o + 7] = 0;
      batch.matrices[o + 8] = s * sz;
      batch.matrices[o + 9] = 0;
      batch.matrices[o + 10] = c * sz;
      batch.matrices[o + 11] = 0;
      batch.matrices[o + 12] = x;
      batch.matrices[o + 13] = y;
      batch.matrices[o + 14] = z;
      batch.matrices[o + 15] = 1;
    } else if (diameter <= 0) {
      writeUnitMatrix(batch.matrices, slot, x, z, 0, yaw, false, gy);
    } else {
      const scale = batch.vatScale ?? 1;
      const lift = batch.vatFootLift ?? 0;
      writeUnitMatrix(batch.matrices, slot, x, z, scale, yaw, false, gy + lift);
    }

    if (batch.vatHandle && slot < batch.vatMoving.length) {
      const want = diameter > 0 && moving ? 1 : 0;
      if (batch.vatMoving[slot] !== want) {
        batch.vatMoving[slot] = want;
        const clip = want ? batch.walkClip : batch.idleClip;
        writeVatSlotParams(batch.vatParams, slot, clip, batch.vatPhase[slot]);
        batch.vatDirty = true;
      }
    }
  }

  return {
    engine,
    scene,
    camera,
    cameraController,

    setCount(n) {
      setSelRingCount(n);
      writeSelectionRingColors(ringColors, n, useCollar ? 'white' : 'cyan');
      pushSelRingColors();
    },

    /** Swap flat ground for atlas terrain (or rebuild after world reset). */
    async setField(snap) {
      terrain?.dispose?.();
      terrain = null;
      fieldSnap = snap ?? null;
      if (ground) {
        const list = scene?.meshes;
        if (Array.isArray(list)) {
          const idx = list.indexOf(ground);
          if (idx >= 0) list.splice(idx, 1);
        }
        ground.visible = false;
        ground = null;
      }
      if (!snap) {
        rebuildTileGrid(null);
        applyShadowState();
        return;
      }
      terrain = await createTerrainFromField(engine, scene, snap, camera, sceneryOpts());
      markShadowReceivers(true);
      applyShadowState();
      rebuildTileGrid(snap);
    },

    applyTreeUpdates(updatesList) {
      if (!updatesList?.length) return;
      for (let i = 0; i < updatesList.length; i++) {
        terrain?.applyTreeUpdates?.(updatesList[i]);
      }
    },

    setTileGridVisible(on) {
      tileGridVisible = !!on;
      tileGrid?.setVisible(tileGridVisible);
      return tileGridVisible;
    },

    getTileGridVisible() {
      return tileGridVisible;
    },

    toggleTileGrid() {
      return this.setTileGridVisible(!tileGridVisible);
    },

    setShadowsEnabled(on) {
      shadowsEnabled = !!on;
      applyShadowState();
      return shadowsEnabled;
    },

    getShadowsEnabled() {
      return shadowsEnabled;
    },

    toggleShadows() {
      return this.setShadowsEnabled(!shadowsEnabled);
    },

    /** Console helper: renderer.debugShadows() */
    debugShadows() {
      const parts = [];
      for (const batch of typeBatches.values()) {
        if (!(batch.mappedSize > 0)) continue;
        for (const mesh of vatPartMeshes(batch)) {
          const fam = mesh.material?._buildGroup?._materialFamily ?? '?';
          parts.push({
            name: mesh.name || '(unit)',
            mapped: batch.mappedSize,
            ti: mesh.thinInstances?.count ?? 0,
            visible: mesh.visible !== false,
            vat: !!mesh.vat,
            fam,
            recv: !!mesh.receiveShadows,
            bmin: mesh.boundMin,
            bmax: mesh.boundMax,
          });
        }
      }
      return {
        enabled: shadowsEnabled,
        type: shadowGen?._shadowType,
        darkness: shadowOpts.darkness,
        worldSpaceBias: shadowOpts.worldSpaceBias,
        depthBias: shadowGen?._config?._bias,
        casters: shadowCasterList.length,
        unitParts: parts,
        unitPartCount: parts.length,
      };
    },

    setPickHitboxesVisible(on) {
      pickDebugVisible = !!on;
      pickDebugMesh.visible = pickDebugVisible;
      if (!pickDebugVisible) {
        pickDebugCount = 0;
        setThinInstanceCount(pickDebugMesh, 0);
      }
      return pickDebugVisible;
    },

    getPickHitboxesVisible() {
      return pickDebugVisible;
    },

    togglePickHitboxes() {
      return this.setPickHitboxesVisible(!pickDebugVisible);
    },

    /**
     * Sync debug spheres to the same proxies `rayPickSpheres` uses:
     * `{ x, y, z, r }[]` with center at pickHeight and radius pickRadius.
     */
    syncPickHitboxes(spheres) {
      if (!pickDebugVisible) return;
      const n = Math.min(spheres?.length ?? 0, pickDebugCap);
      pickDebugCount = n;
      for (let i = 0; i < n; i++) {
        const sp = spheres[i];
        writePickDebugSphere(i, sp.x, sp.y, sp.z, sp.r);
      }
      setThinInstanceCount(pickDebugMesh, n);
    },

    resetCamera() {
      cameraController.reset();
    },

    groundYAt(x, z) {
      return groundYAt(x, z);
    },

    /** Rebuild type-batch mapping when entity count/types change (e.g. sandbox → live). */
    rebuildFromTypes(count, typesArr, ownersArr) {
      setSelRingCount(count);
      const stillUnmapped = mapEntitySlots(count, typesArr, ownersArr);
      flushAllBatches();
      return stillUnmapped;
    },

    /** Write instance transforms from sim/world positions (avoids origin flash after rebuild). */
    syncInstances(count, typesArr, positions, options = {}) {
      const alive = options.alive;
      const owners = options.owners;
      let unmapped = 0;
      for (let i = 0; i < count; i++) {
        const owner = owners ? owners[i] : 0;
        const def = getUnitDef(typesArr[i]);
        if (alive && !alive[i]) {
          writeInstanceAt(i, typesArr[i], owner, 0, 0, 0);
          continue;
        }
        if (!writeInstanceAt(i, typesArr[i], owner, positions.x[i], positions.z[i], def.size)) unmapped++;
      }
      flushAllBatches();
      return unmapped;
    },

    setColors(allColors) {
      for (const batch of typeBatches.values()) {
        for (let s = 0; s < batch.entityIds.length; s++) {
          const i = batch.entityIds[s];
          batch.colors[s * 4] = allColors[i * 4];
          batch.colors[s * 4 + 1] = allColors[i * 4 + 1];
          batch.colors[s * 4 + 2] = allColors[i * 4 + 2];
          batch.colors[s * 4 + 3] = allColors[i * 4 + 3];
        }
        if (batch.vatParts?.length) {
          // Shirt (TeamColor) gets owner tint; body/pants/shoes stay authored colors.
          for (const part of batch.vatParts) {
            setThinInstanceColors(part.mesh, part.isTeamColor ? batch.colors : batch.vatWhiteColors);
          }
        } else {
          setThinInstanceColors(batch.mesh, batch.colors);
        }
      }
      if (fallback) {
        for (let s = 0; s < fallback.entityIds.length; s++) {
          const i = fallback.entityIds[s];
          fallback.colors[s * 4] = allColors[i * 4];
          fallback.colors[s * 4 + 1] = allColors[i * 4 + 1];
          fallback.colors[s * 4 + 2] = allColors[i * 4 + 2];
          fallback.colors[s * 4 + 3] = allColors[i * 4 + 3];
        }
        setThinInstanceColors(fallback.mesh, fallback.colors);
      }
    },

    writeInstance(i, typeId, owner, x, z, diameter, yaw = 0, moving = false) {
      return writeInstanceAt(i, typeId, owner, x, z, diameter, yaw, moving);
    },

    debugBatches(count, typesArr, ownersArr) {
      const unmapped = [];
      const byType = {};
      for (let i = 0; i < count; i++) {
        const type = typesArr[i];
        byType[type] = (byType[type] ?? 0) + 1;
        if (entitySlot[i] < 0) unmapped.push(i);
      }
      const batches = {};
      for (const [key, batch] of typeBatches) {
        batches[key] = {
          entities: batch.entityIds.length,
          capacity: batch.gpuCapacity,
          tiCount: batch.mesh.thinInstances?.count ?? 0,
        };
      }
      if (fallback) {
        batches.fallback = {
          entities: fallback.entityIds.length,
          capacity: fallback.gpuCapacity,
          tiCount: fallback.mesh.thinInstances?.count ?? 0,
        };
      }
      return { count, byType, batches, unmapped };
    },

    commit() {
      flushAllBatches();
    },

    syncProjectiles(prev, cur, alpha) {
      emitFireballGroundSplashes(prev, cur);
      return projectileRenderer.sync(prev, cur, alpha);
    },

    clearProjectiles() {
      projectileRenderer.clear();
      arrowTrails.clear();
      particles.clear();
      trailGenerations.fill(0);
      trailLastEmitMs.fill(0);
      fireballSplashSeen.fill(0);
      projectileRenderer.commit();
      arrowTrails.commit();
    },

    emitParticle(init) {
      return particles.emit(init);
    },

    emitParticleBurst(init) {
      return particles.emitBurst(init);
    },

    clearParticles() {
      particles.clear();
    },

    particleStats() {
      return particles.stats();
    },

    /**
     * Selection cursor. With collar.glb: `spinYaw` rotates in place.
     * Fallback disc: `unitSize` is treated as ground diameter (legacy).
     * @param {'white' | 'red' | 'yellow' | 'cyan'} [tint] white = authored collar colors
     */
    writeSelectionRing(i, x, z, unitSize, spinYaw = 0, tint = 'white') {
      const gy = groundYAt(x, z);
      if (useCollar) {
        const scale = unitSize > 0 ? SELECTION_COLLAR_SCALE : 0;
        writeSelectionCollar(ringMatrices, i, x, z, scale, spinYaw, gy);
      } else {
        writeFlatRing(ringMatrices, i, x, z, unitSize, RING_DIAM, RING_H, gy);
      }
      writeSelectionRingColorAt(ringColors, i, useCollar ? tint : (tint === 'white' ? 'cyan' : tint));
    },

    beginHealthBars() {
      healthBars.begin();
    },

    /** v1-style chips below the selection collar. flags: { armor?, holy? }. */
    writeHealthBar(x, z, unitSize, ratio, flags) {
      const gy = groundYAt(x, z);
      // Just above terrain; screen-space "below unit" is the toward-camera XZ offset.
      const y = gy + FOOT_CLEARANCE + 0.04;
      healthBars.write(x, y, z, unitSize, ratio, flags);
    },

    endHealthBars() {
      healthBars.end();
    },

    /**
     * Start a click-command ping at ground (x, z).
     * Attack-move = red; force-move = authored/white. Particles stay cyan.
     * Force-move adds a wider splash; double-tap upgrades without restarting.
     * @param {'white' | 'red' | 'yellow'} [tint]
     * @param {{ forceMove?: boolean }} [opts]
     */
    pingOrderMarker(x, z, y, tint = 'white', opts = {}) {
      const now = performance.now();
      const gy = Number.isFinite(y) ? y : groundYAt(x, z);
      const mode = tint === 'red' || tint === 'yellow' ? tint : 'white';
      const forceMove = !!opts.forceMove;
      const eye = cameraEyePos();
      const dist = Math.hypot(x - eye.x, gy - eye.y, z - eye.z) || 1;
      const zoom = Math.min(3.5, Math.max(0.8, dist / 200));
      const burstColor = [0.45, 0.95, 1, 0.95];

      // Double-tap force-move upgrades the pending attack-move arrow — don't restart.
      const upgrade =
        forceMove &&
        !!orderPing &&
        now - orderPing.started < ORDER_TOTAL_MS;

      if (upgrade) {
        orderPing.x = x;
        orderPing.y = gy;
        orderPing.z = z;
        orderPing.tint = mode;
      } else {
        const spinDir = nextOrderSpinDir;
        nextOrderSpinDir = -nextOrderSpinDir;
        orderPing = { x, y: gy, z, started: now, tint: mode, spinDir };
        particles.emitBurst({
          position: [x, gy + 0.35 * zoom, z],
          color: burstColor,
          count: 14,
          speed: 8 * zoom,
          verticalSpeed: 6 * zoom,
          gravity: [0, -35 * zoom, 0],
          drag: 2.5,
          lifetime: 0.28,
          startSize: 1.4 * zoom,
          endSize: 0.12 * zoom,
        });
      }
      if (forceMove) {
        particles.emitBurst({
          position: [x, gy + 0.18 * zoom, z],
          color: burstColor,
          count: 22,
          speed: 16 * zoom,
          verticalSpeed: 3.5 * zoom,
          gravity: [0, -42 * zoom, 0],
          drag: 2.0,
          lifetime: 0.4,
          startSize: 2.0 * zoom,
          endSize: 0.06 * zoom,
        });
      }
      updateOrderMarker();
    },

    /** @deprecated use pingOrderMarker */
    showOrderMarker(x, z, y, tint) {
      if (x || z) this.pingOrderMarker(x, z, y, tint);
      else {
        orderPing = null;
        hideOrderMarker();
      }
    },

    onFrame(cb) {
      frameCb = cb;
    },

    worldToScreen(x, y, z) {
      const { width, height } = canvasCoords(0, 0);
      const c = matVec4(viewProjection(), x, y, z, 1);
      if (Math.abs(c[3]) < 1e-8) return null;
      const iw = 1 / c[3];
      const ndcX = c[0] * iw;
      const ndcY = c[1] * iw;
      return {
        x: (ndcX * 0.5 + 0.5) * width,
        y: (1 - ndcY) * 0.5 * height,
      };
    },

    rayPickSpheres(clientX, clientY, spheres) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      if (!ray) return -1;
      let best = -1;
      let bestT = Infinity;
      for (let s = 0; s < spheres.length; s++) {
        const sp = spheres[s];
        const t = rayHitSphere(ray, sp.x, sp.y, sp.z, sp.r);
        if (t !== null && t < bestT) {
          bestT = t;
          best = sp.id;
        }
      }
      return best;
    },

    screenToGround(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      if (!ray) return null;
      return fieldSnap ? rayHitTerrain(ray, (x, z) => groundYAt(x, z)) : rayHitGround(ray);
    },

    canvasCoords,

    start() {
      return startEngine(engine);
    },
  };
}
