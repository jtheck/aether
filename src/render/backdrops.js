// Large off-board / surround GLBs. Poses come from field.backdrops.

import { addToScene, cloneTransformNode } from '../vendor/lite/liteVendor.js';
import { BACKDROP_DEFS, normalizeBackdrops } from '../sim/backdrops.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { softDetachMesh } from './meshLifecycle.js';

function emptyBackdrops() {
  return { meshes: [], dispose() {} };
}

function poseMesh(mesh, pose) {
  mesh.visible = true;
  mesh.position.x = pose.x;
  mesh.position.y = pose.y;
  mesh.position.z = pose.z;
  mesh.scaling.x = pose.scale;
  mesh.scaling.y = pose.scale;
  mesh.scaling.z = pose.scale;
  if (mesh.rotation) mesh.rotation.y = pose.yaw;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {object} field
 */
export async function createBackdropsFromField(engine, scene, field) {
  const poses = normalizeBackdrops(field?.backdrops);
  if (!poses.length) return emptyBackdrops();

  /** @type {Map<string, object[]>} */
  const templates = new Map();
  for (const pose of poses) {
    if (templates.has(pose.type)) continue;
    const url = BACKDROP_DEFS[pose.type]?.url;
    if (!url) continue;
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      templates.set(pose.type, parts);
    } catch (err) {
      console.warn(`[backdrops] ${pose.type} failed`, err);
      templates.set(pose.type, []);
    }
  }

  const meshes = [];
  const usedTemplates = new Set();
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const parts = templates.get(pose.type) ?? [];
    for (let p = 0; p < parts.length; p++) {
      const src = parts[p];
      const mesh = usedTemplates.has(src) ? cloneTransformNode(src) : src;
      usedTemplates.add(src);
      mesh.name = `backdrop-${pose.type}-${i}-${p}`;
      mesh.pickable = false;
      mesh.receiveShadows = false;
      poseMesh(mesh, pose);
      addToScene(scene, mesh);
      meshes.push(mesh);
    }
  }

  let disposed = false;
  return {
    meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) softDetachMesh(scene, mesh);
      meshes.length = 0;
    },
  };
}
