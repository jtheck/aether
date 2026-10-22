// Field-swap mesh teardown without Lite removeFromScene().
//
// removeFromScene runs disposables that destroy GPU buffers (and can kill shared
// atlas/material state still used by the next field). Soft-detach only: hide,
// zero thin-instance count, and unlink from scene lists.

import { addToScene } from '../vendor/lite/liteVendor.js';

/**
 * Drop meshes out of the render lists without destroying GPU buffers.
 * Hidden chunk LOD used to leave every mesh in the scene, and a max board
 * is ~20k of those - Lite still walks them after the game loop returns.
 * @param {object | null | undefined} scene
 * @param {object[]} meshes
 */
export function suspendMeshes(scene, meshes) {
  if (!scene || !meshes?.length) return;
  const drop = new Set(meshes);
  compactList(scene.meshes, drop);
  compactList(scene._renderables, drop, (entry) => entry?.mesh);
  const groups = scene._groups;
  if (groups?.values) {
    for (const group of groups.values()) compactList(group, drop);
  }
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!mesh) continue;
    mesh.visible = false;
    mesh.parent = null;
  }
  scene._renderableVersion = (scene._renderableVersion | 0) + 1;
}

/**
 * Put suspended meshes back on the scene. Lite rebuilds just those renderables.
 * @param {object | null | undefined} scene
 * @param {object[]} meshes
 */
export function resumeMeshes(scene, meshes) {
  if (!scene || !meshes?.length) return;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!mesh) continue;
    mesh.visible = true;
    addToScene(scene, mesh);
  }
}

function compactList(list, drop, itemOf = (entry) => entry) {
  if (!Array.isArray(list) || list.length === 0) return;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    if (!drop.has(itemOf(list[i]))) list[w++] = list[i];
  }
  list.length = w;
}

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
