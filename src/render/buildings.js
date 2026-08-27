// Thin-instanced placeable buildings + ghost preview + building selection collar.
// Selection collar is S/M/L only (not the agora build menu).

import {
  addToScene,
  cloneTransformNode,
  createCylinder,
  createStandardMaterial,
  flushThinInstances,
  markMaterialUboDirty,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { meshRoofY, roofChipLift, DEFAULT_BUILDING_ROOF } from './healthBars.js';
import { BUILDING_MODEL_URLS } from '../sim/buildings.js';
import { capacityFor } from '../sim/capacity.js';
import { USE_GPU_PICK } from './pickMode.js';
import { ownerTint } from './ownerTints.js';
import { isTeamColorMaterial, prepareTeamColorMaterial } from './teamColor.js';

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

/** Building selection sizes — same idea as unit S / caster / vehicle collars. */
export const BUILDING_SEL_SIZE = /** @type {const} */ ({
  s: 4.2,
  m: 7.0,
  l: 11.5,
});

const MODEL_URLS = BUILDING_MODEL_URLS;

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

function batchKey(typeId, owner) {
  return `${typeId}:${owner | 0}`;
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

/** @param {number} cap @param {number} owner */
function makeOwnerColors(cap, owner) {
  return makeColors(cap, ownerTint(owner));
}

/** Keep authored PBR colors on non-TeamColor building parts. */
function makeWhiteColors(cap) {
  return makeColors(cap, [1, 1, 1]);
}

function writeMatrix(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sc = scale;
  matrices[o] = c * sc;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sc;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * sc;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
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
  const mat = createStandardMaterial();
  mat.diffuseColor = [0.35, 0.95, 1];
  mat.emissiveColor = [0.2, 0.55, 0.7];
  mat.alpha = COLLAR_ALPHA;
  applyUnlit(mat);
  return mat;
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
 * @param {object | null | undefined} mat
 * @param {boolean} valid
 */
function applyGhostValidityTint(mat, valid) {
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
  return BUILDING_SEL_SIZE[key];
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createBuildingProps(engine, scene, groundYAt) {
  /** @type {Map<string, { parts: object[], fxSockets: { name: string, x: number, y: number, z: number }[] }>} typeId → template */
  const templates = new Map();
  /** Types whose template meshes were claimed by the first owner batch. */
  const templateClaimed = new Set();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[], capacity: number, typeId: string, owner: number, fxSockets: { name: string, x: number, y: number, z: number }[] }>} */
  const byKey = new Map();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[] }>} */
  const ghostByType = new Map();
  /** @type {Map<object, string>} mesh → batch key */
  const pickMeshes = new Map();
  /** @type {Map<string, number[]>} */
  const slotToIndex = new Map();
  /** @type {Map<string, Promise<boolean>>} */
  const typeInflight = new Map();

  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array | null }[]} */
  let selParts = [];
  try {
    const parts = await loadBakedUnitMeshParts(engine, SELECTION_COLLAR_URL);
    for (const mesh of parts) {
      mesh.material = makeCollarMaterial();
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
    const mat = createStandardMaterial();
    mat.diffuseColor = [0.2, 0.95, 1];
    mat.emissiveColor = [0.15, 0.7, 0.85];
    mat.alpha = COLLAR_ALPHA;
    applyUnlit(mat);
    mesh.material = mat;
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
  /** @type {{ x: number, z: number, size: 's' | 'm' | 'l' }[]} */
  let selAnchors = [];
  let selCapacity = 1;
  let placeGen = 0;
  let ghostGen = 0;

  /**
   * Load template + ghost for one building type (first place / ghost need).
   * @param {string} typeId
   * @returns {Promise<boolean>}
   */
  function ensureType(typeId) {
    if (templates.has(typeId) && ghostByType.has(typeId)) return Promise.resolve(true);
    let pending = typeInflight.get(typeId);
    if (pending) return pending;
    pending = (async () => {
      const url = MODEL_URLS[typeId];
      if (!url) return false;
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
        templates.set(typeId, { parts, fxSockets, roofY: meshRoofY(parts) });

        /** @type {{ mesh: object, matrices: Float32Array }[]} */
        const layers = [];
        for (const src of parts) {
          const mesh = cloneTransformNode(src);
          mesh.pickable = false;
          // Dedicated StandardMaterial so ghost tint/alpha can't touch authored mats.
          mesh.material = makeGhostMaterial();
          const matrices = new Float32Array(16);
          setThinInstances(mesh, matrices, 1);
          setThinInstanceCount(mesh, 0);
          addToScene(scene, mesh);
          layers.push({ mesh, matrices });
        }
        ghostByType.set(typeId, { layers });
        return true;
      } catch (err) {
        console.warn(`[buildings] ${typeId} failed`, err);
        return false;
      } finally {
        typeInflight.delete(typeId);
      }
    })();
    typeInflight.set(typeId, pending);
    return pending;
  }

  function hideAllGhosts() {
    for (const batch of ghostByType.values()) {
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
      }
    }
    ghostType = null;
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
   * Fixed S/M/L world size — does not HUD-scale with camera (menu does that).
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
   * @param {string} typeId
   * @param {number} owner
   */
  function ensureBatch(typeId, owner) {
    const key = batchKey(typeId, owner);
    let batch = byKey.get(key);
    if (batch) return batch;
    const template = templates.get(typeId);
    if (!template) return null;
    const { parts, fxSockets } = template;

    /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[]} */
    const layers = [];
    const ownerColors = makeOwnerColors(INITIAL_CAPACITY, owner);
    const whiteColors = makeWhiteColors(INITIAL_CAPACITY);
    const claimTemplate = !templateClaimed.has(typeId);
    if (claimTemplate) templateClaimed.add(typeId);
    for (let i = 0; i < parts.length; i++) {
      const src = parts[i];
      // First owner batch for this type reuses the template mesh; later owners clone.
      const mesh = claimTemplate ? src : cloneTransformNode(src);
      mesh.pickable = USE_GPU_PICK;
      const isTeamColor = isTeamColorMaterial(mesh.material);
      const colors = isTeamColor ? ownerColors : whiteColors;
      const matrices = new Float32Array(INITIAL_CAPACITY * 16);
      setThinInstances(mesh, matrices, INITIAL_CAPACITY);
      setThinInstanceColors(mesh, colors);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      layers.push({ mesh, matrices, colors, isTeamColor });
      pickMeshes.set(mesh, key);
    }
    batch = {
      layers,
      capacity: INITIAL_CAPACITY,
      typeId,
      owner: owner | 0,
      fxSockets,
    };
    byKey.set(key, batch);
    slotToIndex.set(key, []);
    return batch;
  }

  /**
   * Grow thin-instance buffers to next power of two when needed.
   * @param {{ layers: { mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[], capacity: number, owner: number }} batch
   * @param {number} needed
   */
  function ensureCapacity(batch, needed) {
    if (needed <= batch.capacity) return;
    const cap = capacityFor(needed, { initial: INITIAL_CAPACITY });
    const ownerColors = makeOwnerColors(cap, batch.owner);
    const whiteColors = makeWhiteColors(cap);
    for (const layer of batch.layers) {
      const colors = layer.isTeamColor ? ownerColors : whiteColors;
      const matrices = new Float32Array(cap * 16);
      setThinInstances(layer.mesh, matrices, cap);
      setThinInstanceColors(layer.mesh, colors);
      layer.matrices = matrices;
      layer.colors = colors;
    }
    batch.capacity = cap;
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, owner?: number }[]} list
   */
  function applyPlace(list) {
    /** @type {Map<string, { globalIndex: number, x: number, z: number, yaw: number, owner: number }[]>} */
    const groups = new Map();
    for (const key of byKey.keys()) {
      slotToIndex.set(key, []);
    }
    const all = list ?? [];
    for (let gi = 0; gi < all.length; gi++) {
      const b = all[gi];
      const owner = b.owner | 0;
      const key = batchKey(b.type, owner);
      let g = groups.get(key);
      if (!g) {
        g = [];
        groups.set(key, g);
      }
      g.push({
        globalIndex: gi,
        x: b.x,
        z: b.z,
        yaw: b.yaw ?? 0,
        owner,
      });
    }

    /** @type {Set<string>} */
    const used = new Set();
    for (const [key, items] of groups) {
      const owner = items[0]?.owner | 0;
      const typeId = key.slice(0, key.lastIndexOf(':'));
      const batch = ensureBatch(typeId, owner);
      if (!batch) continue;
      used.add(key);
      const n = items.length;
      ensureCapacity(batch, n);
      const slots = [];
      for (let i = 0; i < n; i++) {
        const b = items[i];
        slots.push(b.globalIndex);
        const y = groundYAt(b.x, b.z);
        for (const layer of batch.layers) {
          writeMatrix(layer.matrices, i, b.x, y, b.z, b.yaw, 1);
        }
      }
      slotToIndex.set(key, slots);
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, n);
        // Color buffers were created while count was zero. Rebind after count
        // grows so every newly active slot is uploaded instead of reading 0/black.
        setThinInstanceColors(layer.mesh, layer.colors);
        flushThinInstances(layer.mesh);
      }
    }
    for (const [key, batch] of byKey) {
      if (used.has(key)) continue;
      slotToIndex.set(key, []);
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
      }
    }
  }

  /**
   * Ensure types then place. Stale generations drop if a newer place() wins.
   * @param {{ type: string, x: number, z: number, yaw?: number, owner?: number }[]} list
   */
  async function place(list) {
    const snapshot = list ?? [];
    const gen = ++placeGen;
    const types = new Set();
    for (let i = 0; i < snapshot.length; i++) types.add(snapshot[i].type);
    await Promise.all([...types].map((t) => ensureType(t)));
    if (gen !== placeGen) return;
    applyPlace(snapshot);
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, valid?: boolean }} pos
   */
  function applyGhost(pos) {
    if (ghostType && ghostType !== pos.type) hideAllGhosts();
    const batch = ghostByType.get(pos.type);
    if (!batch) {
      hideAllGhosts();
      return;
    }
    ghostType = pos.type;
    const y = groundYAt(pos.x, pos.z);
    const yaw = pos.yaw ?? 0;
    const valid = pos.valid !== false;
    for (const layer of batch.layers) {
      writeMatrix(layer.matrices, 0, pos.x, y, pos.z, yaw, 1);
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
    await ensureType(want.type);
    if (gen !== ghostGen) return;
    applyGhost(want);
  }

  function isPickMesh(mesh) {
    return pickMeshes.has(mesh);
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
    for (const batch of byKey.values()) {
      const sockets = batch.fxSockets;
      if (!sockets?.length) continue;
      const layer = batch.layers[0];
      if (!layer) continue;
      const count = layer.mesh?.thinInstances?.count ?? 0;
      const m = layer.matrices;
      for (let slot = 0; slot < count; slot++) {
        const o = slot * 16;
        if (!(m[o + 15] > 0)) continue;
        fn(batch.typeId, m, slot, sockets);
      }
    }
  }

  /** Live placed building meshes (not ghosts / selection). */
  function forEachShadowMesh(fn) {
    for (const batch of byKey.values()) {
      for (const layer of batch.layers) {
        const mesh = layer.mesh;
        if (!mesh) continue;
        const count = mesh.thinInstances?.count ?? 0;
        if (count > 0) fn(mesh);
      }
    }
  }

  function refreshTeamColors() {
    for (const batch of byKey.values()) {
      const ownerColors = makeOwnerColors(batch.capacity, batch.owner);
      for (const layer of batch.layers) {
        if (!layer.isTeamColor) continue;
        layer.colors = ownerColors;
        setThinInstanceColors(layer.mesh, ownerColors);
      }
    }
  }

  function chipHeight(typeId) {
    const roof = templates.get(typeId)?.roofY;
    return roofChipLift(roof, DEFAULT_BUILDING_ROOF);
  }

  return {
    place,
    refreshTeamColors,
    setGhost,
    setSelectionHighlight,
    updateSelectionHighlight,
    clear,
    isPickMesh,
    resolvePick,
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
