// Thin-instanced placeable buildings + ghost preview + building selection collar.
// Selection collar is S/M/L only (not the agora build menu).

import {
  addToScene,
  createCylinder,
  createStandardMaterial,
  flushThinInstances,
  markMaterialUboDirty,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { PLACEABLE_BUILDINGS } from '../sim/buildings.js';

/** Start small; grow in 64-instance chunks when place() needs more. */
const INITIAL_CAPACITY = 64;
const CAPACITY_CHUNK = 64;
const GHOST_ALPHA = 0.42;
const GHOST_VALID_EMISSIVE = [0.25, 0.45, 0.7];
const GHOST_INVALID_EMISSIVE = [1.0, 0.05, 0.02];
const GHOST_VALID_DIFFUSE = [0.45, 0.65, 0.95];
const GHOST_INVALID_DIFFUSE = [1.0, 0.08, 0.04];
const GHOST_INVALID_ALPHA = 0.62;
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

const MODEL_URLS = {
  barracks: '/assets/models/barracks.glb',
  farm: '/assets/models/farm.glb',
  church: '/assets/models/church.glb',
  tavern: '/assets/models/tavern.glb',
  perch: '/assets/models/perch.glb',
};

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

/** @param {number} needed */
function capacityFor(needed) {
  if (needed <= INITIAL_CAPACITY) return INITIAL_CAPACITY;
  return Math.ceil(needed / CAPACITY_CHUNK) * CAPACITY_CHUNK;
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

function tintGhostMaterial(mat) {
  if (!mat) return;
  mat.alpha = GHOST_ALPHA;
  mat.diffuseColor = [...GHOST_VALID_DIFFUSE];
  mat.emissiveColor = [...GHOST_VALID_EMISSIVE];
  applyUnlit(mat);
  markMaterialUboDirty(mat);
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
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[], capacity: number }>} */
  const byType = new Map();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[] }>} */
  const ghostByType = new Map();
  /** @type {Map<object, string>} */
  const pickMeshes = new Map();
  /** @type {Map<string, number[]>} */
  const slotToIndex = new Map();

  for (const def of PLACEABLE_BUILDINGS) {
    const url = MODEL_URLS[def.id];
    if (!url) continue;
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      /** @type {{ mesh: object, matrices: Float32Array }[]} */
      const layers = [];
      for (const mesh of parts) {
        mesh.pickable = true;
        const matrices = new Float32Array(INITIAL_CAPACITY * 16);
        setThinInstances(mesh, matrices, INITIAL_CAPACITY);
        setThinInstanceCount(mesh, 0);
        addToScene(scene, mesh);
        layers.push({ mesh, matrices });
        pickMeshes.set(mesh, def.id);
      }
      byType.set(def.id, { layers, capacity: INITIAL_CAPACITY });
      slotToIndex.set(def.id, []);
    } catch (err) {
      console.warn(`[buildings] ${def.id} failed`, err);
    }

    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      /** @type {{ mesh: object, matrices: Float32Array }[]} */
      const layers = [];
      for (const mesh of parts) {
        mesh.pickable = false;
        tintGhostMaterial(mesh.material);
        const matrices = new Float32Array(16);
        setThinInstances(mesh, matrices, 1);
        setThinInstanceCount(mesh, 0);
        addToScene(scene, mesh);
        layers.push({ mesh, matrices });
      }
      ghostByType.set(def.id, { layers });
    } catch (err) {
      console.warn(`[buildings] ghost ${def.id} failed`, err);
    }
  }

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
  /** @type {{ x: number, z: number, size: 's' | 'm' | 'l' } | null} */
  let selAnchor = null;

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

  /**
   * Grow thin-instance buffers in CAPACITY_CHUNK steps when needed.
   * @param {{ layers: { mesh: object, matrices: Float32Array }[], capacity: number }} batch
   * @param {number} needed
   */
  function ensureCapacity(batch, needed) {
    if (needed <= batch.capacity) return;
    const cap = capacityFor(needed);
    for (const layer of batch.layers) {
      const matrices = new Float32Array(cap * 16);
      setThinInstances(layer.mesh, matrices, cap);
      layer.matrices = matrices;
    }
    batch.capacity = cap;
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number }[]} list
   */
  function place(list) {
    /** @type {Map<string, { globalIndex: number, x: number, z: number, yaw: number }[]>} */
    const groups = new Map();
    for (const def of PLACEABLE_BUILDINGS) {
      groups.set(def.id, []);
      slotToIndex.set(def.id, []);
    }
    const all = list ?? [];
    for (let gi = 0; gi < all.length; gi++) {
      const b = all[gi];
      const g = groups.get(b.type);
      if (!g) continue;
      g.push({
        globalIndex: gi,
        x: b.x,
        z: b.z,
        yaw: b.yaw ?? 0,
      });
    }
    for (const [typeId, batch] of byType) {
      const items = groups.get(typeId) ?? [];
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
      slotToIndex.set(typeId, slots);
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, n);
        flushThinInstances(layer.mesh);
      }
    }
  }

  /**
   * Fixed S/M/L world size — does not HUD-scale with camera (menu does that).
   */
  function applySelectionHighlight() {
    if (!selAnchor) return;
    const gy = groundYAt(selAnchor.x, selAnchor.z);
    const scale = resolveSelScale(selAnchor.size);
    for (const part of selParts) {
      writeFlatCollar(part.matrices, 0, selAnchor.x, selAnchor.z, scale, gy);
      setThinInstanceCount(part.mesh, 1);
      flushThinInstances(part.mesh);
      part.mesh.visible = true;
    }
    selVisible = true;
  }

  /**
   * @param {{ x: number, z: number, size?: 's' | 'm' | 'l' } | null} pos
   */
  function setSelectionHighlight(pos) {
    if (!pos) {
      selAnchor = null;
      for (const part of selParts) {
        clearMatrix(part.matrices, 0);
        flushThinInstances(part.mesh);
        part.mesh.visible = false;
      }
      selVisible = false;
      return;
    }
    const size = pos.size === 's' || pos.size === 'l' ? pos.size : 'm';
    selAnchor = { x: pos.x, z: pos.z, size };
    applySelectionHighlight();
  }

  function updateSelectionHighlight() {
    if (!selVisible || !selAnchor) return;
    applySelectionHighlight();
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number, valid?: boolean } | null} pos
   */
  function setGhost(pos) {
    if (!pos?.type) {
      hideAllGhosts();
      return;
    }
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

  function isPickMesh(mesh) {
    return pickMeshes.has(mesh);
  }

  /**
   * @param {object} mesh
   * @param {number} thinInstanceIndex
   * @returns {{ kind: 'building', index: number } | null}
   */
  function resolvePick(mesh, thinInstanceIndex) {
    const type = pickMeshes.get(mesh);
    if (!type) return null;
    const slots = slotToIndex.get(type);
    if (!slots || thinInstanceIndex < 0 || thinInstanceIndex >= slots.length) return null;
    return { kind: 'building', index: slots[thinInstanceIndex] };
  }

  function clear() {
    place([]);
    setGhost(null);
    setSelectionHighlight(null);
  }

  return {
    place,
    setGhost,
    setSelectionHighlight,
    updateSelectionHighlight,
    clear,
    isPickMesh,
    resolvePick,
    BUILDING_SEL_SIZE,
    get ghostVisible() {
      return ghostVisible;
    },
    get selectionVisible() {
      return selVisible;
    },
  };
}
