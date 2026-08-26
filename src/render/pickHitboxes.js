// Debug visualization for CPU ray-vs-sphere pick volumes.
// Copied from the working projectiles.js Lite thin-instance path — not the old
// inline pickDebug mesh in renderer.js (that path was dead for a long time).

import {
  addToScene,
  createSphere,
  createStandardMaterial,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';

/**
 * Keep GPU draw count at buffer capacity. Lite drops instances if `ti.count`
 * grows after the first upload (same reason unit batches prealloc and hide
 * unused slots with zero matrices).
 */
function setPoolDrawCount(mesh, liveCount) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  const cap = ti._capacity | 0;
  if (cap > 0 && ti.count !== cap) {
    ti.count = cap;
    ti._version++;
    ti._dirtyMin = 0;
    ti._dirtyMax = cap;
  }
  mesh.visible = liveCount > 0;
}

function hideMatrix(matrices, slot) {
  const offset = slot * 16;
  for (let i = 0; i < 16; i++) matrices[offset + i] = 0;
}

/** Mesh diameter is 2 → uniform scale equals world radius. */
function writeSphere(matrices, slot, x, y, z, radius) {
  const offset = slot * 16;
  if (!(radius > 0)) {
    hideMatrix(matrices, slot);
    return;
  }
  const s = radius;
  matrices[offset] = s;
  matrices[offset + 1] = 0;
  matrices[offset + 2] = 0;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = 0;
  matrices[offset + 5] = s;
  matrices[offset + 6] = 0;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = 0;
  matrices[offset + 9] = 0;
  matrices[offset + 10] = s;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = x;
  matrices[offset + 13] = y;
  matrices[offset + 14] = z;
  matrices[offset + 15] = 1;
}

/**
 * Lazy pool: mesh is created on first enable, after the scene has registered.
 * Creating at count=0 before registerScene left the old debug spheres undrawable.
 *
 * @param {object} engine
 * @param {object} scene
 * @param {number} capacity
 * @param {{
 *   startVisible?: boolean,
 *   name?: string,
 *   segments?: number,
 *   renderOrder?: number,
 *   depthWrite?: boolean,
 *   diffuseColor?: [number, number, number],
 *   emissiveColor?: [number, number, number],
 *   alpha?: number,
 * }} [opts]
 */
export function createPickHitboxRenderer(engine, scene, capacity, opts = {}) {
  const cap = Math.max(1, capacity | 0);
  const diffuseColor = opts.diffuseColor ?? [0.82, 0.32, 0.4];
  const emissiveColor = opts.emissiveColor ?? [0.36, 0.1, 0.14];
  const alpha = Number.isFinite(opts.alpha) ? opts.alpha : 0.2;
  const segments = Math.max(6, opts.segments ?? 10);

  /** @type {object | null} */
  let mesh = null;
  /** @type {object | null} */
  let material = null;
  /** @type {Float32Array | null} */
  let matrices = null;
  let previousCount = 0;
  let enabled = !!opts.startVisible;

  function ensureMesh() {
    if (mesh) return;
    mesh = createSphere(engine, { diameter: 2, segments });
    mesh.pickable = false;
    if (opts.name) mesh.name = opts.name;
    if (Number.isFinite(opts.renderOrder)) mesh.renderOrder = opts.renderOrder;
    material = createStandardMaterial();
    material.diffuseColor = diffuseColor;
    material.emissiveColor = emissiveColor;
    material.specularColor = [0, 0, 0];
    material.disableLighting = true;
    // Any alpha < 1 keeps Lite on the per-frame transparent path (not a frozen
    // opaque bundle). Instance color alpha stays 1 so this doesn't stack down.
    material.alpha = alpha;
    material.backFaceCulling = false;
    if (opts.depthWrite === false) material.depthWrite = false;
    mesh.material = material;

    matrices = new Float32Array(cap * 16);
    const colors = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) {
      colors[i * 4] = 1;
      colors[i * 4 + 1] = 1;
      colors[i * 4 + 2] = 1;
      colors[i * 4 + 3] = 1;
    }
    // Same order as projectiles: instances → colors → scene. Leave count at
    // capacity (zero matrices); first sync sets the live draw count.
    setThinInstances(mesh, matrices, cap);
    setThinInstanceColors(mesh, colors);
    if (mesh.thinInstances) mesh.thinInstances._gpuCullingEnabled = false;
    addToScene(scene, mesh);
    previousCount = 0;
  }

  function clear() {
    if (!mesh || !matrices) return;
    for (let slot = 0; slot < previousCount; slot++) hideMatrix(matrices, slot);
    previousCount = 0;
    setPoolDrawCount(mesh, 0);
  }

  return {
    setVisible(on) {
      enabled = !!on;
      if (!enabled) clear();
      return enabled;
    },

    getVisible() {
      return enabled;
    },

    toggle() {
      return this.setVisible(!enabled);
    },

    /**
     * @param {{ x: number, y: number, z: number, r: number }[] | null | undefined} spheres
     */
    sync(spheres) {
      if (!enabled) return;
      const n = Math.min(spheres?.length ?? 0, cap);
      // Don't spawn an empty pool — Lite can freeze a count=0 thin-instance mesh
      // so later uploads never show (same class of bug as pre-registerScene debug).
      if (n === 0) {
        if (mesh) clear();
        return;
      }
      ensureMesh();
      for (let i = 0; i < n; i++) {
        const sp = spheres[i];
        writeSphere(matrices, i, sp.x, sp.y, sp.z, sp.r ?? 0);
      }
      for (let slot = n; slot < previousCount; slot++) hideMatrix(matrices, slot);
      previousCount = n;
      setPoolDrawCount(mesh, n);
    },

    commit() {
      if (!enabled || !mesh) return;
      flushThinInstances(mesh);
    },

    clear,

    debug() {
      const ti = mesh?.thinInstances;
      const sample = [];
      if (matrices) {
        for (let i = 0; i < Math.min(previousCount, 3); i++) {
          const o = i * 16;
          sample.push({
            s: matrices[o],
            x: matrices[o + 12],
            y: matrices[o + 13],
            z: matrices[o + 14],
          });
        }
      }
      return {
        flag: enabled,
        meshReady: !!mesh,
        meshVisible: mesh ? mesh.visible !== false : false,
        count: previousCount,
        tiCount: ti?.count ?? -1,
        tiVersion: ti?._version ?? -1,
        tiGpuVersion: ti?._gpuVersion ?? -1,
        alpha: material?.alpha ?? null,
        sample,
      };
    },
  };
}
