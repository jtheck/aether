// Safe mesh teardown for match field swaps.
//
// Lite's removeFromScene() runs mesh disposables that destroy thin-instance GPU
// buffers immediately. If a flush/submit is already queued for that mesh, WebGPU
// reports "Buffer thin-instance-matrices used in submit while destroyed."
// Soft-detach first (leave draws), then destroy a few frames later.

import { removeFromScene } from '../vendor/lite/liteVendor.js';

/** @type {{ scene: object, mesh: object, left: number }[]} */
const gpuDisposeQueue = [];

/**
 * Stop a mesh from drawing / flushing without destroying GPU buffers.
 * @param {object | null | undefined} scene
 * @param {object | null | undefined} mesh
 */
export function softDetachMesh(scene, mesh) {
  if (!mesh) return;
  mesh.visible = false;
  const ti = mesh.thinInstances;
  if (ti) {
    ti.count = 0;
    ti._dirtyMin = 0;
    ti._dirtyMax = 0;
  }
  if (!scene) return;

  try {
    const tasks = scene._frameGraph?._tasks;
    if (Array.isArray(tasks)) {
      for (let i = 0; i < tasks.length; i++) tasks[i]?._removeMesh?.(mesh);
    }
  } catch { /* vendor shape drift */ }

  const list = scene.meshes;
  if (Array.isArray(list)) {
    const idx = list.indexOf(mesh);
    if (idx >= 0) list.splice(idx, 1);
  }

  const renderables = scene._renderables;
  if (Array.isArray(renderables)) {
    let removed = false;
    for (let i = renderables.length - 1; i >= 0; i--) {
      if (renderables[i]?.mesh === mesh) {
        renderables.splice(i, 1);
        removed = true;
      }
    }
    if (removed) scene._renderableVersion = (scene._renderableVersion | 0) + 1;
  }

  try {
    const groups = scene._groups;
    if (groups?.values) {
      for (const group of groups.values()) {
        const u = group.indexOf(mesh);
        if (u >= 0) group.splice(u, 1);
      }
    }
  } catch { /* vendor shape drift */ }

  try {
    const swap = scene._materialSwapQueue;
    if (Array.isArray(swap)) {
      const l = swap.indexOf(mesh);
      if (l >= 0) swap.splice(l, 1);
    }
  } catch { /* ignore */ }

  mesh.parent = null;
}

/**
 * Queue Lite removeFromScene (GPU destroy) after `delayFrames` pumps.
 * @param {object | null | undefined} scene
 * @param {object | null | undefined} mesh
 * @param {number} [delayFrames]
 */
export function scheduleMeshGpuDispose(scene, mesh, delayFrames = 4) {
  if (!scene || !mesh) return;
  gpuDisposeQueue.push({ scene, mesh, left: Math.max(1, delayFrames | 0) });
}

/** Call once per frame from the renderer. */
export function pumpMeshGpuDisposeQueue() {
  if (gpuDisposeQueue.length === 0) return;
  for (let i = gpuDisposeQueue.length - 1; i >= 0; i--) {
    const e = gpuDisposeQueue[i];
    e.left -= 1;
    if (e.left > 0) continue;
    gpuDisposeQueue.splice(i, 1);
    try {
      removeFromScene(e.scene, e.mesh);
    } catch { /* already gone */ }
  }
}
