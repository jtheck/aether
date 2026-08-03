// Thin-instanced placeable buildings + ghost preview + flattened selection collar.

import {
  addToScene,
  createCylinder,
  createStandardMaterial,
  flushThinInstances,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { PLACEABLE_BUILDINGS } from '../sim/buildings.js';

const MAX_PER_TYPE = 64;
const GHOST_ALPHA = 0.42;
const SELECTION_COLLAR_URL = '/assets/models/collar.glb';
const FOOT_CLEARANCE = 0.06;
/** Squash factor — collar.glb reads as a flat ring, not a tower. */
const COLLAR_Y_SCALE = 0.1;
/** Lift above ground so the ring reads over the building foot. */
const COLLAR_Y_LIFT = 1.35;
const COLLAR_ALPHA = 0.78;
/** Base collar size at mid-zoom (scaled by camera radius across full zoom range). */
const BUILDING_COLLAR_SCALE = 5.5;
/** Match radial ring radius (~18) so agora selection collar is the menu base. */
const AGORA_COLLAR_SCALE = 18;
const HUD_SCALE_AT_NEAR = 0.28;
const HUD_SCALE_AT_FAR = 2.75;

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

/** Flat collar: full XZ scale, crushed Y. */
function writeFlatCollar(matrices, slot, x, z, scaleXZ, groundY) {
  const o = slot * 16;
  const sx = scaleXZ;
  const sy = scaleXZ * COLLAR_Y_SCALE;
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
  if (mat.diffuseColor) {
    mat.diffuseColor = [
      mat.diffuseColor[0] * 0.55 + 0.35,
      mat.diffuseColor[1] * 0.55 + 0.55,
      mat.diffuseColor[2] * 0.55 + 0.75,
    ];
  }
  mat.emissiveColor = [0.25, 0.45, 0.7];
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createBuildingProps(engine, scene, groundYAt) {
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[] }>} */
  const byType = new Map();
  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array }[] }>} */
  const ghostByType = new Map();
  /** mesh → building type id (solid placed meshes only). */
  /** @type {Map<object, string>} */
  const pickMeshes = new Map();
  /** type → thin-instance slot → global buildings[] index */
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
        const matrices = new Float32Array(MAX_PER_TYPE * 16);
        setThinInstances(mesh, matrices, MAX_PER_TYPE);
        setThinInstanceCount(mesh, 0);
        addToScene(scene, mesh);
        layers.push({ mesh, matrices });
        pickMeshes.set(mesh, def.id);
      }
      byType.set(def.id, { layers });
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
    const mesh = createCylinder(engine, { diameter: 1, height: 0.06, tessellation: 32 });
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
  /** @type {{ x: number, z: number, baseScale: number } | null} */
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
      const n = Math.min(MAX_PER_TYPE, items.length);
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
   * @param {object | null | undefined} camera
   */
  function hudMul(camera) {
    const minR = camera?.lowerRadiusLimit ?? 40;
    const maxR = camera?.upperRadiusLimit ?? 400;
    const r = camera?.radius ?? (minR + maxR) * 0.5;
    const t = Math.min(1, Math.max(0, (r - minR) / Math.max(1e-6, maxR - minR)));
    return HUD_SCALE_AT_NEAR + t * (HUD_SCALE_AT_FAR - HUD_SCALE_AT_NEAR);
  }

  /**
   * @param {object | null | undefined} camera
   */
  function applySelectionHighlight(camera) {
    if (!selAnchor) return;
    const gy = groundYAt(selAnchor.x, selAnchor.z);
    const scale = selAnchor.baseScale * hudMul(camera);
    for (const part of selParts) {
      writeFlatCollar(part.matrices, 0, selAnchor.x, selAnchor.z, scale, gy);
      setThinInstanceCount(part.mesh, 1);
      flushThinInstances(part.mesh);
      part.mesh.visible = true;
    }
    selVisible = true;
  }

  /**
   * @param {{ x: number, z: number, scale?: number, radius?: number } | null} pos
   * @param {object | null} [camera]
   */
  function setSelectionHighlight(pos, camera = null) {
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
    selAnchor = {
      x: pos.x,
      z: pos.z,
      baseScale: pos.scale ?? pos.radius ?? BUILDING_COLLAR_SCALE,
    };
    applySelectionHighlight(camera);
  }

  /** Per-frame: keep selection collar readable across the full zoom range. */
  function updateSelectionHighlight(camera) {
    if (!selVisible || !selAnchor) return;
    applySelectionHighlight(camera);
  }

  /**
   * @param {{ type: string, x: number, z: number, yaw?: number } | null} pos
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
    for (const layer of batch.layers) {
      writeMatrix(layer.matrices, 0, pos.x, y, pos.z, yaw, 1);
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
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
    BUILDING_COLLAR_SCALE,
    AGORA_COLLAR_SCALE,
    get ghostVisible() {
      return ghostVisible;
    },
    get selectionVisible() {
      return selVisible;
    },
  };
}
