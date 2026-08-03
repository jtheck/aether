// Thin-instanced agora.glb props at capture spawn points.

import {
  addToScene,
  flushThinInstances,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';

const AGORA_MODEL_URL = '/assets/models/agora.glb';
/** Staging uses 2; leave headroom for future multi-agora maps. */
const MAX_AGORAS = 8;
const AGORA_SCALE = 1;

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

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createAgoraProps(engine, scene, groundYAt) {
  /** @type {{ mesh: object, matrices: Float32Array }[]} */
  const layers = [];
  /** @type {Set<object>} */
  const pickMeshes = new Set();
  let placedCount = 0;

  try {
    const parts = await loadBakedUnitMeshParts(engine, AGORA_MODEL_URL);
    for (let p = 0; p < parts.length; p++) {
      const mesh = parts[p];
      mesh.pickable = true;
      const matrices = new Float32Array(MAX_AGORAS * 16);
      setThinInstances(mesh, matrices, MAX_AGORAS);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      layers.push({ mesh, matrices });
      pickMeshes.add(mesh);
    }
  } catch (err) {
    console.warn('[agoras] agora.glb failed', err);
    return {
      place() {},
      clear() {},
      isPickMesh() {
        return false;
      },
      resolvePick() {
        return null;
      },
    };
  }

  /**
   * @param {{ x: number, z: number, yaw?: number }[]} list
   */
  function place(list) {
    const n = Math.min(MAX_AGORAS, list?.length ?? 0);
    placedCount = n;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const x = a.x;
      const z = a.z;
      const y = groundYAt(x, z);
      const yaw =
        a.yaw != null
          ? a.yaw
          : Math.atan2(-x, -z); // face map center (same idea as v1)
      for (const layer of layers) {
        writeMatrix(layer.matrices, i, x, y, z, yaw, AGORA_SCALE);
      }
    }
    for (const layer of layers) {
      setThinInstanceCount(layer.mesh, n);
      flushThinInstances(layer.mesh);
    }
  }

  function clear() {
    place([]);
  }

  function isPickMesh(mesh) {
    return pickMeshes.has(mesh);
  }

  /**
   * @param {object} mesh
   * @param {number} thinInstanceIndex
   * @returns {{ kind: 'agora', index: number } | null}
   */
  function resolvePick(mesh, thinInstanceIndex) {
    if (!pickMeshes.has(mesh)) return null;
    if (thinInstanceIndex < 0 || thinInstanceIndex >= placedCount) return null;
    return { kind: 'agora', index: thinInstanceIndex };
  }

  return { place, clear, isPickMesh, resolvePick };
}
