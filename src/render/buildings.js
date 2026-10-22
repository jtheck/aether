// Thin-instanced placeable buildings + ghost preview + building selection collar.
// Selection collar is S/M/L only (not the agora build menu).

import {
  addToScene,
  cloneTransformNode,
  createCylinder,
  createShaderMaterial,
  createStandardMaterial,
  flushThinInstances,
  markMaterialUboDirty,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts, prefetchBakedMesh } from './unitModels.js';
import { meshRoofY, roofChipLift, DEFAULT_BUILDING_ROOF } from './healthBars.js';
import { BUILDING_FOOTPRINTS, BUILDING_MODEL_URLS, PLACEABLE_BUILDINGS, buildingMeshGroundCenter, buildingMeshOrigin } from '../sim/buildings.js';
import { TILE_SIZE_F } from '../sim/field.js';
import { SCALE_RISE_MS, stageRiseScale } from './scaleBounce.js';
import { MODEL_BASE_SCALE } from './modelScale.js';
import { constructionVisualStage } from '../sim/construction.js';
import { capacityFor } from '../sim/capacity.js';
import { USE_GPU_PICK } from './pickMode.js';
import { ownerTint } from './ownerTints.js';
import { isTeamColorMaterial, prepareTeamColorMaterial, sceneTeamRgb } from './teamColor.js';
import { nearestMeshInstanceHit, pickPartsFromMeshes } from './meshPick.js';

/** Start small; grow by powers of two when place() needs more. */
const INITIAL_CAPACITY = 32;
const GHOST_ALPHA = 0.62;
const GHOST_VALID_EMISSIVE = [0.15, 0.55, 0.22];
const GHOST_INVALID_EMISSIVE = [1.0, 0.05, 0.02];
const GHOST_VALID_DIFFUSE = [0.35, 0.85, 0.45];
const GHOST_INVALID_DIFFUSE = [1.0, 0.08, 0.04];
const GHOST_INVALID_ALPHA = 0.72;
const SELECTION_COLLAR_URL = '/assets/models/collar.glb';
const FOOT_CLEARANCE = 0.06;
/** Thicker than the old paper-thin squash. */
const COLLAR_Y_SCALE = 0.32;
const COLLAR_Y_LIFT = 0.9;
const COLLAR_ALPHA = 0.82;
/**
 * Opaque pass order. Terrain stays at the default (100). The selection ring
 * blends next, without writing depth, and the building draws after it so the
 * model covers the ring instead of the near arc painting over the walls.
 */
const COLLAR_RENDER_ORDER = 110;
const BUILDING_RENDER_ORDER = 120;
/** Unfinished sites sit smaller until villagers raise them. */
const SITE_SCALE = 0.58;
/** First work - a small pop off the foundation. */
const WORK_START_SCALE = 0.70;
/** Near-done (~2/3 progress) - most of the way to full size. */
const NEAR_DONE_SCALE = 0.88;
const CONSTRUCT_STAGE_SCALE = [SITE_SCALE, WORK_START_SCALE, NEAR_DONE_SCALE];
/** Collapse when a building leaves the sim list. */
const FALL_MS = 520;

/** Building selection sizes - same idea as unit S / caster / vehicle collars. */
export const BUILDING_SEL_SIZE = /** @type {const} */ ({
  s: 4.2,
  m: 7.0,
  l: 11.5,
});

const MODEL_URLS = BUILDING_MODEL_URLS;

/** Yield a painted frame so GLB decode / pipeline compile cannot pin the tab. */
function afterPaint() {
  return new Promise((resolve) => {
    const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
    raf(() => setTimeout(resolve, 0));
  });
}

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

/** @param {number} cap @param {readonly number[]} tint */
function makeColors(cap, tint) {
  const colors = new Float32Array(cap * 4);
  for (let i = 0; i < cap; i++) {
    colors[i * 4] = tint[0];
    colors[i * 4 + 1] = tint[1];
    colors[i * 4 + 2] = tint[2];
    colors[i * 4 + 3] = 1;
  }
  return colors;
}

/** Keep authored PBR colors on non-TeamColor building parts. */
function makeWhiteColors(cap) {
  return makeColors(cap, [1, 1, 1]);
}

/** Per-instance TeamColor / harvest wash. */
function writeSlotColor(colors, slot, rgb, boost = 1) {
  const o = slot * 4;
  colors[o] = rgb[0] * boost;
  colors[o + 1] = rgb[1] * boost;
  colors[o + 2] = rgb[2] * boost;
  colors[o + 3] = 1;
}

function writeOwnerColor(colors, slot, owner, boost = 1) {
  writeSlotColor(colors, slot, sceneTeamRgb(ownerTint(owner)), boost);
}

function writeMatrix(matrices, slot, x, y, z, yaw, sx, sy = sx, sz = sx) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
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
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function buildingKey(type, x, z) {
  return `${type}:${x.toFixed(2)}:${z.toFixed(2)}`;
}

/**
 * Which meshes stay, which followed a move, and which collapse.
 * A building still in the list is not a collapse. A same-type mesh whose
 * old spot is empty and whose type just appeared somewhere else moved.
 * `pending` keys are in the snapshot but the model is not loaded yet.
 * @param {{ key: string, type: string }[]} existing
 * @param {{ key: string, type: string }[]} incoming
 * @param {Set<string> | null | undefined} pending
 */
export function planBuildingVisuals(existing, incoming, pending) {
  const seen = new Set();
  const keep = [];
  const create = [];
  for (let i = 0; i < incoming.length; i++) {
    const b = incoming[i];
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    if (existing.some((e) => e.key === b.key)) keep.push(b.key);
    else create.push(b.key);
  }
  const loose = [];
  for (let i = 0; i < existing.length; i++) {
    const e = existing[i];
    if (seen.has(e.key) || pending?.has(e.key)) continue;
    loose.push(e);
  }
  const moved = [];
  const stillCreate = [];
  for (let i = 0; i < create.length; i++) {
    const key = create[i];
    const type = incoming.find((b) => b.key === key)?.type;
    const at = loose.findIndex((e) => e.type === type);
    if (at >= 0) {
      moved.push({ from: loose[at].key, to: key });
      loose.splice(at, 1);
    } else stillCreate.push(key);
  }
  return { keep, moved, fall: loose.map((e) => e.key), create: stillCreate };
}

/** Flattened collar: XZ = size, Y crushed but thicker than before. */
function writeFlatCollar(matrices, slot, x, z, scaleXZ, groundY) {
  const o = slot * 16;
  const sx = scaleXZ;
  const sy = Math.max(0.35, scaleXZ * COLLAR_Y_SCALE);
  const sz = scaleXZ;
  matrices[o] = sx;
  matrices[o + 1] = 0;
  matrices[o + 2] = 0;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sy;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = 0;
  matrices[o + 9] = 0;
  matrices[o + 10] = sz;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = groundY + FOOT_CLEARANCE + COLLAR_Y_LIFT;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function clearMatrix(matrices, slot) {
  const o = slot * 16;
  for (let k = 0; k < 16; k++) matrices[o + k] = 0;
}

function applyUnlit(mat) {
  if (!mat) return;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
}

function makeCollarMaterial() {
  // Blended, but kept in the opaque bucket (needAlphaBlending: false) so it
  // draws before the building. Depth is not written, so the building test
  // still sees the ground and replaces every ring pixel it covers.
  return createShaderMaterial({
    name: 'building-selection-collar',
    attributes: ['position'],
    uniforms: ['world', 'viewProjection'],
    needAlphaBlending: false,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let wp = (shaderSystem.world * instanceWorld) * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@fragment fn mainFragment(_input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(0.35, 0.95, 1.0, ${COLLAR_ALPHA});
}`,
  });
}

function makeGhostMaterial() {
  const mat = createStandardMaterial();
  mat.alpha = GHOST_ALPHA;
  mat.diffuseColor = [...GHOST_VALID_DIFFUSE];
  mat.emissiveColor = [...GHOST_VALID_EMISSIVE];
  applyUnlit(mat);
  markMaterialUboDirty(mat);
  return mat;
}

/**
 * Shared by the world ghost and the agora hub placeholder while placing.
 * @param {object | null | undefined} mat
 * @param {boolean} valid
 */
export function applyGhostValidityTint(mat, valid) {
  if (!mat) return;
  if (valid) {
    mat.alpha = GHOST_ALPHA;
    mat.diffuseColor = [...GHOST_VALID_DIFFUSE];
    mat.emissiveColor = [...GHOST_VALID_EMISSIVE];
  } else {
    mat.alpha = GHOST_INVALID_ALPHA;
    mat.diffuseColor = [...GHOST_INVALID_DIFFUSE];
    mat.emissiveColor = [...GHOST_INVALID_EMISSIVE];
  }
  markMaterialUboDirty(mat);
}

/**
 * @param {'s' | 'm' | 'l' | string | undefined} size
 */
function resolveSelScale(size) {
  const key = size === 's' || size === 'm' || size === 'l' ? size : 'm';
  return BUILDING_SEL_SIZE[key] * MODEL_BASE_SCALE;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{ emit?: Function, emitBurst?: Function }} [opts]
 */
export async function createBuildingProps(engine, scene, groundYAt, opts = {}) {
  /** @type {Map<string, { parts: object[], fxSockets: { name: string, x: number, y: number, z: number }[], roofY: number, pickParts: object[] }>} glb url → template */
  const templates = new Map();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[], capacity: number, typeId: string, modelUrl: string, owners: Uint8Array, fxSockets: { name: string, x: number, y: number, z: number }[] }>} model url → live batch */
  const batches = new Map();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[] }>} */
  const ghostByUrl = new Map();
  /** @type {Map<object, string>} mesh → model url (slotToIndex key) */
  const pickMeshes = new Map();
  /** @type {Map<string, number[]>} */
  const slotToIndex = new Map();
  /** @type {Map<string, Promise<boolean>>} */
  const templateInflight = new Map();
  /** @type {Map<string, { x: number, z: number, started: number }>} */
  const harvestPings = new Map();
  /** Live + crumbling instances, keyed by type+position so place() can animate. */
  /** @type {Map<string, object>} */
  const visuals = new Map();

  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array | null }[]} */
  let selParts = [];
  try {
    const parts = await loadBakedUnitMeshParts(engine, SELECTION_COLLAR_URL);
    for (const mesh of parts) {
      mesh.material = makeCollarMaterial();
      mesh.renderOrder = COLLAR_RENDER_ORDER;
      mesh.pickable = false;
      const matrices = new Float32Array(16);
      const colors = new Float32Array([0.35, 0.95, 1, COLLAR_ALPHA]);
      setThinInstances(mesh, matrices, 1);
      setThinInstanceColors(mesh, colors);
      setThinInstanceCount(mesh, 1);
      clearMatrix(matrices, 0);
      flushThinInstances(mesh);
      mesh.visible = false;
      addToScene(scene, mesh);
      selParts.push({ mesh, matrices, colors });
    }
  } catch (err) {
    console.warn('[buildings] selection collar failed; using cyan disc', err);
    const mesh = createCylinder(engine, { diameter: 1, height: 0.2, tessellation: 32 });
    mesh.material = makeCollarMaterial();
    mesh.renderOrder = COLLAR_RENDER_ORDER;
    mesh.pickable = false;
    const matrices = new Float32Array(16);
    setThinInstances(mesh, matrices, 1);
    setThinInstanceCount(mesh, 1);
    clearMatrix(matrices, 0);
    flushThinInstances(mesh);
    mesh.visible = false;
    addToScene(scene, mesh);
    selParts = [{ mesh, matrices, colors: null }];
  }

  let ghostVisible = false;
  let selVisible = false;
  /** @type {string | null} */
  let ghostType = null;
  /** @type {string | null} */
  let ghostUrl = null;
  /** @type {{ x: number, z: number, size: 's' | 'm' | 'l' }[]} */
  let selAnchors = [];
  let selCapacity = 1;
  let placeGen = 0;
  let ghostGen = 0;

  /** @param {string} typeId @param {number} [owner] */
  function modelUrlFor(typeId, owner = 0) {
    const url = opts.resolveModelUrl?.(typeId, owner | 0);
    return url || MODEL_URLS[typeId] || null;
  }

  /** Placement ghost uses the local player's cosmetic pick. */
  function ghostModelUrl(typeId) {
    const owner = opts.localPlayerId ?? 0;
    return modelUrlFor(typeId, owner);
  }

  /**
   * Load the CPU/GPU template for one GLB. Ghost clones stay off the scene
   * until setGhost() - hidden thin-instances still tax writeBuffer.
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  function ensureTemplate(url) {
    if (!url) return Promise.resolve(false);
    if (templates.has(url)) return Promise.resolve(true);
    let pending = templateInflight.get(url);
    if (pending) return pending;
    pending = (async () => {
      try {
        const parts = await loadBakedUnitMeshParts(engine, url);
        // GPU pick path kept; CPU ray-vs-sphere is live (see pickMode.js).
        for (const mesh of parts) {
          mesh.pickable = USE_GPU_PICK;
          if (isTeamColorMaterial(mesh.material)) prepareTeamColorMaterial(engine, mesh);
        }
        const fxSockets = (parts[0]?.fxSockets ?? []).map((s) => ({
          name: s.name,
          x: s.x,
          y: s.y,
          z: s.z,
          scale: Number.isFinite(s.scale) && s.scale > 1e-6 ? s.scale : 1,
        }));
        templates.set(url, {
          parts,
          fxSockets,
          roofY: meshRoofY(parts),
          pickParts: pickPartsFromMeshes(parts),
          groundBounds: groundBoundsOf(parts),
        });
        return true;
      } catch (err) {
        console.warn(`[buildings] ${url} failed`, err);
        return false;
      } finally {
        templateInflight.delete(url);
      }
    })();
    templateInflight.set(url, pending);
    return pending;
  }

  function ensureGhostMeshes(url) {
    if (ghostByUrl.has(url)) return true;
    const template = templates.get(url);
    if (!template) return false;
    /** @type {{ mesh: object, matrices: Float32Array }[]} */
    const layers = [];
    for (const src of template.parts) {
      const mesh = cloneTransformNode(src);
      mesh.pickable = false;
      mesh.material = makeGhostMaterial();
      const matrices = new Float32Array(16);
      setThinInstances(mesh, matrices, 1);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      layers.push({ mesh, matrices });
    }
    ghostByUrl.set(url, { layers });
    return true;
  }

  function hideAllGhosts() {
    for (const batch of ghostByUrl.values()) {
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
      }
    }
    ghostType = null;
    ghostUrl = null;
    ghostVisible = false;
  }

  function writeSelCollarColors(colors, count) {
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      colors[o] = 0.35;
      colors[o + 1] = 0.95;
      colors[o + 2] = 1;
      colors[o + 3] = COLLAR_ALPHA;
    }
  }

  /** @param {number} needed */
  function ensureSelCapacity(needed) {
    if (needed <= selCapacity) return;
    const cap = capacityFor(needed, { initial: 1 });
    for (const part of selParts) {
      const matrices = new Float32Array(cap * 16);
      setThinInstances(part.mesh, matrices, cap);
      part.matrices = matrices;
      if (part.colors) {
        const colors = new Float32Array(cap * 4);
        writeSelCollarColors(colors, cap);
        setThinInstanceColors(part.mesh, colors);
        part.colors = colors;
      }
    }
    selCapacity = cap;
  }

  function clearSelectionHighlight() {
    selAnchors = [];
    for (const part of selParts) {
      clearMatrix(part.matrices, 0);
      setThinInstanceCount(part.mesh, 0);
      flushThinInstances(part.mesh);
      part.mesh.visible = false;
    }
    selVisible = false;
  }

  /**
   * Fixed S/M/L world size - does not HUD-scale with camera (menu does that).
   */
  function applySelectionHighlight() {
    const n = selAnchors.length;
    if (n === 0) {
      clearSelectionHighlight();
      return;
    }
    ensureSelCapacity(n);
    for (const part of selParts) {
      for (let i = 0; i < n; i++) {
        const a = selAnchors[i];
        const gy = groundYAt(a.x, a.z);
        writeFlatCollar(part.matrices, i, a.x, a.z, resolveSelScale(a.size), gy);
      }
      setThinInstanceCount(part.mesh, n);
      if (part.colors) setThinInstanceColors(part.mesh, part.colors);
      flushThinInstances(part.mesh);
      part.mesh.visible = true;
    }
    selVisible = true;
  }

  /**
   * @param {{ x: number, z: number, size?: 's' | 'm' | 'l' } | { x: number, z: number, size?: 's' | 'm' | 'l' }[] | null} pos
   */
  function setSelectionHighlight(pos) {
    if (!pos) {
      clearSelectionHighlight();
      return;
    }
    const list = Array.isArray(pos) ? pos : [pos];
    if (list.length === 0) {
      clearSelectionHighlight();
      return;
    }
    selAnchors = list.map((p) => ({
      x: p.x,
      z: p.z,
      size: p.size === 's' || p.size === 'l' ? p.size : 'm',
    }));
    applySelectionHighlight();
  }

  function updateSelectionHighlight() {
    if (!selVisible || selAnchors.length === 0) return;
    applySelectionHighlight();
  }

  /**
   * One live clone set per building type. Owner tint is per thin-instance slot
   * (same pattern as agora flags) so two sides share the mesh + material.
   * @param {string} typeId
   */
  function ensureBatch(typeId, modelUrl) {
    let batch = batches.get(modelUrl);
    if (batch) return batch;
    const template = templates.get(modelUrl);
    if (!template) return null;
    const { parts, fxSockets } = template;

    /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[]} */
    const layers = [];
    const teamColors = makeWhiteColors(INITIAL_CAPACITY);
    const whiteColors = makeWhiteColors(INITIAL_CAPACITY);
    for (let i = 0; i < parts.length; i++) {
      const src = parts[i];
      // Clone so the unused template keeps its own (unbound) thin-instance state.
      const mesh = cloneTransformNode(src);
      mesh.renderOrder = BUILDING_RENDER_ORDER;
      mesh.pickable = USE_GPU_PICK;
      const isTeamColor = isTeamColorMaterial(mesh.material);
      const colors = isTeamColor ? teamColors : whiteColors;
      const matrices = new Float32Array(INITIAL_CAPACITY * 16);
      setThinInstances(mesh, matrices, INITIAL_CAPACITY);
      setThinInstanceColors(mesh, colors);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      layers.push({ mesh, matrices, colors, isTeamColor });
      pickMeshes.set(mesh, modelUrl);
    }
    batch = {
      layers,
      capacity: INITIAL_CAPACITY,
      typeId,
      modelUrl,
      owners: new Uint8Array(INITIAL_CAPACITY),
      fxSockets,
    };
    batches.set(modelUrl, batch);
    slotToIndex.set(modelUrl, []);
    return batch;
  }

  /**
   * Grow thin-instance buffers to next power of two when needed.
   * @param {{ layers: { mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[], capacity: number, owners: Uint8Array }} batch
   * @param {number} needed
   */
  function ensureCapacity(batch, needed) {
    if (needed <= batch.capacity) return;
    const cap = capacityFor(needed, { initial: INITIAL_CAPACITY });
    const teamColors = makeWhiteColors(cap);
    const whiteColors = makeWhiteColors(cap);
    const owners = new Uint8Array(cap);
    owners.set(batch.owners);
    batch.owners = owners;
    for (const layer of batch.layers) {
      const colors = layer.isTeamColor ? teamColors : whiteColors;
      const matrices = new Float32Array(cap * 16);
      setThinInstances(layer.mesh, matrices, cap);
      setThinInstanceColors(layer.mesh, colors);
      layer.matrices = matrices;
      layer.colors = colors;
    }
    batch.capacity = cap;
  }

  function groundBoundsOf(parts) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const mesh of parts || []) {
      const min = mesh?.boundMin;
      const max = mesh?.boundMax;
      if (!min || !max) continue;
      minX = Math.min(minX, min[0]);
      minZ = Math.min(minZ, min[2]);
      maxX = Math.max(maxX, max[0]);
      maxZ = Math.max(maxZ, max[2]);
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minZ, maxX, maxZ };
  }

  function meshFit(_typeId, url) {
    const bounds = url ? templates.get(url)?.groundBounds : null;
    const { cx, cz } = buildingMeshGroundCenter(bounds);
    return { scale: MODEL_BASE_SCALE, cx, cz };
  }

  function constructScale(b) {
    const base = meshFit(b.type, modelUrlFor(b.type, b.owner | 0)).scale;
    if (b.built !== 0) return base;
    const stage = CONSTRUCT_STAGE_SCALE[constructionVisualStage(b.buildProgress, b.buildTime)] ?? SITE_SCALE;
    return base * stage;
  }

  function constructStage(b) {
    if (b.built !== 0) return 3;
    return constructionVisualStage(b.buildProgress, b.buildTime);
  }

  function makeVisual(b, gi) {
    const built = b.built === 0 ? 0 : 1;
    const stage = constructStage(b);
    const scale = constructScale(b);
    return {
      key: buildingKey(b.type, b.x, b.z),
      type: b.type,
      modelUrl: modelUrlFor(b.type, b.owner | 0),
      x: b.x,
      z: b.z,
      yaw: b.yaw ?? 0,
      owner: b.owner | 0,
      globalIndex: gi,
      built,
      scaleStage: stage,
      visScale: scale,
      scaleFrom: scale,
      targetScale: scale,
      scaleT: 1,
      scaleDur: SCALE_RISE_MS,
      rising: false,
      falling: false,
      fallT: 0,
    };
  }

  function beginRise(s, target = 1) {
    s.scaleFrom = s.visScale;
    s.targetScale = target;
    s.scaleT = 0;
    s.scaleDur = SCALE_RISE_MS;
    s.rising = true;
    s.falling = false;
  }

  function beginFall(s) {
    if (s.falling) return;
    s.rising = false;
    s.falling = true;
    s.fallT = 0;
    emitCollapseDebris(s);
  }

  function emitCollapseDebris(s) {
    const emit = opts.emit;
    const emitBurst = opts.emitBurst;
    if (!emit && !emitBurst) return;
    const gy = groundYAt(s.x, s.z);
    const fp = BUILDING_FOOTPRINTS[s.type];
    const tiles = Math.max(fp?.w ?? 2, fp?.h ?? 2);
    const half = tiles * TILE_SIZE_F * 0.42;
    const dust = [0.52, 0.44, 0.34, 0.62];
    const timber = [0.46, 0.32, 0.18, 0.95];
    const stone = [0.55, 0.52, 0.48, 0.95];
    emitBurst?.({
      position: [s.x, gy + 0.45, s.z],
      color: dust,
      count: 10 + tiles * 5,
      speed: 5 + tiles * 1.4,
      verticalSpeed: 4.5,
      gravity: [0, -22, 0],
      drag: 1.8,
      lifetime: 0.55,
      startSize: 1.1,
      endSize: 0.08,
      blend: 'alpha',
    });
    const chunks = 8 + tiles * 4;
    for (let i = 0; i < chunks; i++) {
      const ang = (i / chunks) * Math.PI * 2 + (i * 0.37);
      const rad = 0.4 + (i % 5) * 0.22 * half;
      const up = 5.5 + (i % 4) * 1.6;
      const wood = (i % 3) !== 0;
      emit?.({
        position: [
          s.x + Math.cos(ang) * rad * 0.35,
          gy + 0.35 + (i % 4) * 0.45,
          s.z + Math.sin(ang) * rad * 0.35,
        ],
        velocity: [Math.cos(ang) * (3.5 + (i % 3)), up, Math.sin(ang) * (3.5 + (i % 3))],
        gravity: [0, -32, 0],
        drag: 1.15,
        color: wood ? timber : stone,
        lifetime: 0.55 + (i % 5) * 0.08,
        startSize: wood ? 0.95 : 1.2,
        endSize: 0.18,
        hard: true,
        blend: 'alpha',
      });
    }
  }

  function poseVisual(s) {
    const gy = groundYAt(s.x, s.z);
    const fit = meshFit(s.type, s.modelUrl);
    const yaw = s.yaw || 0;
    if (!s.falling) {
      const origin = buildingMeshOrigin(s.x, s.z, yaw, s.visScale, fit.cx, fit.cz);
      return { x: origin.x, y: gy, z: origin.z, yaw, sx: s.visScale, sy: s.visScale, sz: s.visScale };
    }
    const t = Math.min(1, s.fallT);
    const ease = t * t;
    const sc = s.visScale * (1 + 0.55 * ease);
    const origin = buildingMeshOrigin(s.x, s.z, yaw + 0.32 * ease, sc, fit.cx, fit.cz);
    return {
      x: origin.x,
      y: gy - 0.7 * ease,
      z: origin.z,
      yaw: yaw + 0.32 * ease,
      sx: sc,
      sy: s.visScale * Math.max(0.04, 1 - 0.94 * ease),
      sz: sc,
    };
  }

  function adoptVisual(s, b, index) {
    // A mesh that already started collapsing stays collapsed forever unless
    // this clears it. The building is in the list again, so stand it back up.
    if (s.falling) {
      s.falling = false;
      s.fallT = 0;
    }
    s.globalIndex = index;
    s.x = b.x;
    s.z = b.z;
    s.yaw = b.yaw ?? 0;
    s.owner = b.owner | 0;
    s.modelUrl = modelUrlFor(b.type, b.owner | 0);
    const built = b.built === 0 ? 0 : 1;
    const stage = constructStage(b);
    if (s.built === 0 && built === 1) beginRise(s, constructScale(b));
    else if (built === 0 && stage > (s.scaleStage | 0)) beginRise(s, constructScale(b));
    s.built = built;
    s.scaleStage = Math.max(s.scaleStage | 0, stage);
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, owner?: number, built?: number, simIndex?: number }[]} list
   * @param {{ pendingKeys?: Set<string> }} [opts]
   */
  function applyPlace(list, opts = {}) {
    const all = list ?? [];
    const incoming = [];
    for (let gi = 0; gi < all.length; gi++) {
      const b = all[gi];
      incoming.push({
        key: buildingKey(b.type, b.x, b.z),
        type: b.type,
        b,
        // Display lists drop fogged and dead buildings, so the loop index is not
        // the sim slot. Clicks have to land on the building that was actually hit.
        index: Number.isInteger(b.simIndex) ? b.simIndex : gi,
      });
    }
    const existing = [];
    for (const [key, s] of visuals) existing.push({ key, type: s.type });
    const plan = planBuildingVisuals(existing, incoming, opts.pendingKeys);
    const byKey = new Map();
    for (let i = 0; i < incoming.length; i++) byKey.set(incoming[i].key, incoming[i]);
    for (let i = 0; i < plan.keep.length; i++) {
      const item = byKey.get(plan.keep[i]);
      const s = item && visuals.get(item.key);
      if (item && s) adoptVisual(s, item.b, item.index);
    }
    for (let i = 0; i < plan.moved.length; i++) {
      const move = plan.moved[i];
      const item = byKey.get(move.to);
      const s = visuals.get(move.from);
      if (!item || !s) continue;
      visuals.delete(move.from);
      s.key = move.to;
      visuals.set(move.to, s);
      adoptVisual(s, item.b, item.index);
    }
    for (let i = 0; i < plan.create.length; i++) {
      const item = byKey.get(plan.create[i]);
      if (!item || visuals.has(item.key)) continue;
      visuals.set(item.key, makeVisual(item.b, item.index));
    }
    for (let i = 0; i < plan.fall.length; i++) {
      const s = visuals.get(plan.fall[i]);
      if (s) beginFall(s);
    }
    flushVisuals();
  }

  function flushVisuals() {
    /** @type {Map<string, object[]>} */
    const groups = new Map();
    for (const modelUrl of batches.keys()) {
      slotToIndex.set(modelUrl, []);
    }
    for (const s of visuals.values()) {
      if (s.falling && s.fallT >= 1) continue;
      const url = s.modelUrl || MODEL_URLS[s.type];
      if (!url) continue;
      let g = groups.get(url);
      if (!g) {
        g = [];
        groups.set(url, g);
      }
      g.push(s);
    }

    /** @type {Set<string>} */
    const used = new Set();
    for (const [modelUrl, items] of groups) {
      const typeId = items[0]?.type;
      if (!typeId) continue;
      const batch = ensureBatch(typeId, modelUrl);
      if (!batch) continue;
      used.add(modelUrl);
      const n = items.length;
      ensureCapacity(batch, n);
      const slots = [];
      for (let i = 0; i < n; i++) {
        const s = items[i];
        slots.push(s.falling ? -1 : s.globalIndex);
        batch.owners[i] = s.owner;
        const pose = poseVisual(s);
        for (const layer of batch.layers) {
          writeMatrix(layer.matrices, i, pose.x, pose.y, pose.z, pose.yaw, pose.sx, pose.sy, pose.sz);
          if (layer.isTeamColor) writeOwnerColor(layer.colors, i, s.owner);
        }
      }
      slotToIndex.set(modelUrl, slots);
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, n);
        setThinInstanceColors(layer.mesh, layer.colors);
        flushThinInstances(layer.mesh);
      }
    }
    for (const [modelUrl, batch] of batches) {
      if (used.has(modelUrl)) continue;
      slotToIndex.set(modelUrl, []);
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
      }
    }
  }

  function update(deltaMs = 16) {
    if (visuals.size === 0) return;
    const dt = Math.min(50, Math.max(0, deltaMs));
    let moved = false;
    for (const [key, s] of visuals) {
      if (s.rising) {
        s.scaleT = Math.min(1, s.scaleT + dt / (s.scaleDur || SCALE_RISE_MS));
        s.visScale = stageRiseScale(s.scaleFrom, s.targetScale, s.scaleT);
        if (s.scaleT >= 1) {
          s.rising = false;
          s.visScale = s.targetScale;
        }
        moved = true;
      }
      if (s.falling) {
        s.fallT = Math.min(1, s.fallT + dt / FALL_MS);
        moved = true;
        if (s.fallT >= 1) visuals.delete(key);
      }
    }
    if (moved) flushVisuals();
  }

  /**
   * Ensure types then place. Already-warm types draw immediately; the rest
   * pop in one type per frame so a tester / first place cannot freeze the tab.
   * Stale generations drop if a newer place() wins.
   * @param {{ type: string, x: number, z: number, yaw?: number, owner?: number, built?: number }[]} list
   */
  function templateReady(b) {
    const url = modelUrlFor(b.type, b.owner | 0);
    return url && templates.has(url);
  }

  function drawReady(snapshot) {
    const pendingKeys = new Set();
    const ready = [];
    for (let i = 0; i < snapshot.length; i++) {
      const b = snapshot[i];
      if (templateReady(b)) ready.push(b);
      else pendingKeys.add(buildingKey(b.type, b.x, b.z));
    }
    applyPlace(ready, { pendingKeys });
  }

  async function place(list) {
    const snapshot = list ?? [];
    const gen = ++placeGen;
    /** @type {string[]} */
    const urls = [];
    const seen = new Set();
    for (let i = 0; i < snapshot.length; i++) {
      const url = modelUrlFor(snapshot[i].type, snapshot[i].owner | 0);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    drawReady(snapshot);
    for (const url of urls) {
      if (templates.has(url)) continue;
      await ensureTemplate(url);
      if (gen !== placeGen) return;
      drawReady(snapshot);
      await afterPaint();
    }
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, valid?: boolean }} pos
   */
  function applyGhost(pos) {
    const url = ghostModelUrl(pos.type);
    if (ghostUrl && ghostUrl !== url) hideAllGhosts();
    const batch = ghostByUrl.get(url);
    if (!batch) {
      hideAllGhosts();
      return;
    }
    ghostType = pos.type;
    ghostUrl = url;
    const y = groundYAt(pos.x, pos.z);
    const yaw = pos.yaw ?? 0;
    const fit = meshFit(pos.type, url);
    const origin = buildingMeshOrigin(pos.x, pos.z, yaw, fit.scale, fit.cx, fit.cz);
    const valid = pos.valid !== false;
    for (const layer of batch.layers) {
      writeMatrix(layer.matrices, 0, origin.x, y, origin.z, yaw, fit.scale);
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
      applyGhostValidityTint(layer.mesh.material, valid);
    }
    ghostVisible = true;
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, valid?: boolean } | null} pos
   */
  async function setGhost(pos) {
    if (!pos?.type) {
      ghostGen++;
      hideAllGhosts();
      return;
    }
    const gen = ++ghostGen;
    const want = pos;
    const url = ghostModelUrl(want.type);
    await ensureTemplate(url);
    if (gen !== ghostGen) return;
    if (!ensureGhostMeshes(url)) return;
    applyGhost(want);
  }

  function isPickMesh(mesh) {
    return pickMeshes.has(mesh);
  }

  /**
   * Nearest live placeable whose mesh the ray hits.
   * @param {object | null} ray
   * @param {(hit: { kind: 'building', index: number }) => boolean} [allow]
   * @param {number} [maxT]
   * @returns {{ kind: 'building', index: number, t: number } | null}
   */
  function pickOnRay(ray, allow, maxT = Infinity) {
    if (!ray) return null;
    let best = null;
    let limit = maxT;
    for (const batch of batches.values()) {
      const parts = templates.get(batch.modelUrl)?.pickParts;
      const layer = batch.layers[0];
      if (!parts?.length || !layer) continue;
      const slots = slotToIndex.get(batch.modelUrl);
      const count = layer.mesh?.thinInstances?.count ?? 0;
      const hit = nearestMeshInstanceHit(ray, parts, layer.matrices, count, (slot) => {
        const index = slots?.[slot];
        if (index == null || index < 0) return false;
        return !allow || allow({ kind: 'building', index });
      }, limit);
      if (!hit) continue;
      best = { kind: 'building', index: slots[hit.slot], t: hit.t };
      limit = hit.t;
    }
    return best;
  }

  /**
   * Touch-rotate test against the placement ghost mesh.
   * Null means the ghost mesh is not ready - caller keeps the footprint box.
   * @param {object | null} ray
   * @param {number} [maxT] ground clip - hits past this are buried
   * @returns {boolean | null}
   */
  function ghostHitOnRay(ray, maxT = Infinity) {
    if (!ray || !ghostVisible || !ghostUrl) return null;
    const parts = templates.get(ghostUrl)?.pickParts;
    const layer = ghostByUrl.get(ghostUrl)?.layers[0];
    const count = layer?.mesh?.thinInstances?.count ?? 0;
    if (!parts?.length || !layer || count <= 0) return null;
    return nearestMeshInstanceHit(ray, parts, layer.matrices, count, undefined, maxT) != null;
  }

  /**
   * @param {object} mesh
   * @param {number} thinInstanceIndex
   * @returns {{ kind: 'building', index: number } | null}
   */
  function resolvePick(mesh, thinInstanceIndex) {
    const key = pickMeshes.get(mesh);
    if (!key) return null;
    const slots = slotToIndex.get(key);
    if (!slots || thinInstanceIndex < 0 || thinInstanceIndex >= slots.length) return null;
    return { kind: 'building', index: slots[thinInstanceIndex] };
  }

  function clear() {
    visuals.clear();
    place([]);
    setGhost(null);
    setSelectionHighlight(null);
  }

  /**
   * Iterate live building instances with baked FX sockets (smoke / spawn / …).
   * @param {(
   *   typeId: string,
   *   matrices: Float32Array,
   *   slot: number,
   *   sockets: { name: string, x: number, y: number, z: number }[],
   * ) => void} fn
   */
  function forEachFxInstance(fn) {
    for (const batch of batches.values()) {
      const sockets = batch.fxSockets;
      if (!sockets?.length) continue;
      const layer = batch.layers[0];
      if (!layer) continue;
      const count = layer.mesh?.thinInstances?.count ?? 0;
      const m = layer.matrices;
      for (let slot = 0; slot < count; slot++) {
        const o = slot * 16;
        if (!(m[o + 15] > 0)) continue;
        // Squashed wrecks are mid-collapse - don't keep smoking.
        if (m[o + 5] < Math.abs(m[o]) * 0.35) continue;
        fn(batch.typeId, m, slot, sockets);
      }
    }
  }

  /** Live placed building meshes (not ghosts / selection). */
  function forEachShadowMesh(fn) {
    for (const batch of batches.values()) {
      for (const layer of batch.layers) {
        const mesh = layer.mesh;
        if (!mesh) continue;
        const count = mesh.thinInstances?.count ?? 0;
        if (count > 0) fn(mesh);
      }
    }
  }

  function refreshTeamColors() {
    for (const batch of batches.values()) {
      const count = batch.layers[0]?.mesh?.thinInstances?.count ?? 0;
      for (const layer of batch.layers) {
        if (!layer.isTeamColor) continue;
        for (let i = 0; i < count; i++) writeOwnerColor(layer.colors, i, batch.owners[i]);
        setThinInstanceColors(layer.mesh, layer.colors);
      }
    }
  }

  function chipHeight(typeId) {
    const url = MODEL_URLS[typeId];
    const roof = url ? templates.get(url)?.roofY : undefined;
    return roofChipLift(roof, DEFAULT_BUILDING_ROOF) * meshFit(typeId, url).scale;
  }

  const HARVEST_PING_MS = 280;
  const HARVEST_PULSES = 0.5;
  const HARVEST_PEAK = 1.35;
  const HARVEST_RANGE2 = 10 * 10;

  function harvestBoost(started, now) {
    const t = now - started;
    if (t >= HARVEST_PING_MS) return 1;
    const u = t / HARVEST_PING_MS;
    const wave = Math.abs(Math.cos(u * Math.PI * HARVEST_PULSES));
    return 1 + wave * wave * HARVEST_PEAK;
  }

  function writeHarvestSlot(batch, slot, boost) {
    const owner = batch.owners?.[slot] ?? 0;
    for (const layer of batch.layers) {
      if (!layer.colors) continue;
      const tint = layer.isTeamColor ? sceneTeamRgb(ownerTint(owner)) : [1, 1, 1];
      writeSlotColor(layer.colors, slot, tint, boost);
      setThinInstanceColors(layer.mesh, layer.colors);
    }
  }

  function findSlotNear(x, z, typeId = null) {
    let best = null;
    let bestD = HARVEST_RANGE2;
    for (const batch of batches.values()) {
      if (typeId && batch.typeId !== typeId) continue;
      const layer = batch.layers[0];
      if (!layer?.matrices) continue;
      const count = layer.mesh?.thinInstances?.count ?? 0;
      const m = layer.matrices;
      for (let slot = 0; slot < count; slot++) {
        const o = slot * 16;
        const dx = m[o + 12] - x;
        const dz = m[o + 14] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = { batch, slot };
        }
      }
    }
    return best;
  }

  function startPingAt(x, z, typeId = null) {
    const found = findSlotNear(x, z, typeId);
    if (!found) return false;
    const id = `${found.batch.typeId}:${found.slot}`;
    harvestPings.set(id, { x, z, typeId: found.batch.typeId, started: performance.now() });
    writeHarvestSlot(found.batch, found.slot, 1 + HARVEST_PEAK);
    return true;
  }

  function pingHarvestAt(x, z) {
    return startPingAt(x, z, 'farm');
  }

  function pingAt(x, z) {
    return startPingAt(x, z, null);
  }

  function updateHarvestPing() {
    if (harvestPings.size === 0) return;
    const now = performance.now();
    for (const [id, ping] of harvestPings) {
      const boost = harvestBoost(ping.started, now);
      const found = findSlotNear(ping.x, ping.z, ping.typeId ?? null);
      if (found) writeHarvestSlot(found.batch, found.slot, boost);
      if (now - ping.started >= HARVEST_PING_MS) harvestPings.delete(id);
    }
  }

  /**
   * Decode remaining placeable GLBs one type per frame without adding meshes.
   * Loading-screen roster: later place() hits the CPU cache and only clones.
   */
  async function prefetchProgressive() {
    /** @type {Set<string>} */
    const urls = new Set();
    for (const b of PLACEABLE_BUILDINGS) {
      const base = MODEL_URLS[b.id];
      if (base) urls.add(base);
      const skin = ghostModelUrl(b.id);
      if (skin) urls.add(skin);
    }
    for (const url of urls) {
      if (templates.has(url)) continue;
      await prefetchBakedMesh(engine, url);
      await afterPaint();
    }
  }

  /** Re-place after cosmetic building skins change (local player mesh swap). */
  async function refreshSkins(list) {
    ghostByUrl.clear();
    ghostUrl = null;
    await place(list ?? []);
  }

  function preloadAll() {
    return prefetchProgressive();
  }

  return {
    place,
    update,
    preloadAll,
    prefetchProgressive,
    preloadProgressive: prefetchProgressive,
    refreshSkins,
    refreshTeamColors,
    setGhost,
    setSelectionHighlight,
    updateSelectionHighlight,
    pingHarvestAt,
    pingAt,
    updateHarvestPing,
    clear,
    isPickMesh,
    resolvePick,
    pickOnRay,
    ghostHitOnRay,
    forEachFxInstance,
    forEachShadowMesh,
    chipHeight,
    BUILDING_SEL_SIZE,
    get ghostVisible() {
      return ghostVisible;
    },
    get selectionVisible() {
      return selVisible;
    },
  };
}
