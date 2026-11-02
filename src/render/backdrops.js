// Large off-board / surround GLBs. Poses come from field.backdrops.

import { addToScene, cloneTransformNode } from '../vendor/lite/liteVendor.js';
import { BACKDROP_DEFS, normalizeBackdrops } from '../sim/backdrops.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { softDetachMesh } from './meshLifecycle.js';

function emptyBackdrops() {
  return {
    meshes: [],
    apply(raw) { return normalizeBackdrops(raw).length === 0; },
    dispose() {},
  };
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
export async function createBackdropsFromField(engine, scene, field, backdropOpts = {}) {
  const poses = normalizeBackdrops(field?.backdrops);
  if (!poses.length) return emptyBackdrops();

  /** @type {Map<string, object[]>} */
  const templates = new Map();
  /** @type {string[]} */
  const needed = [];
  for (let i = 0; i < poses.length; i++) {
    if (!needed.includes(poses[i].type)) needed.push(poses[i].type);
  }
  await Promise.all(needed.map(async (type) => {
    const url = BACKDROP_DEFS[type]?.url;
    if (!url) return;
    try {
      templates.set(type, await loadBakedUnitMeshParts(engine, url));
    } catch (err) {
      console.warn(`[backdrops] ${type} failed`, err);
      templates.set(type, []);
    }
  }));

  const meshes = [];
  const groups = [];
  const types = [];
  const usedTemplates = new Set();
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const parts = templates.get(pose.type) ?? [];
    const group = [];
    for (let p = 0; p < parts.length; p++) {
      const src = parts[p];
      const mesh = usedTemplates.has(src) ? cloneTransformNode(src) : src;
      usedTemplates.add(src);
      mesh.name = `backdrop-${pose.type}-${i}-${p}`;
      mesh.pickable = false;
      mesh.receiveShadows = false;
      poseMesh(mesh, pose);
      if (backdropOpts.deferScene !== true) addToScene(scene, mesh);
      meshes.push(mesh);
      group.push(mesh);
    }
    groups.push(group);
    types.push(pose.type);
  }

  let disposed = false;
  return {
    meshes,
    apply(raw) {
      const next = normalizeBackdrops(raw);
      if (next.length !== groups.length) return false;
      for (let i = 0; i < next.length; i++) {
        if (next[i].type !== types[i]) return false;
        for (const mesh of groups[i]) poseMesh(mesh, next[i]);
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) softDetachMesh(scene, mesh);
      meshes.length = 0;
    },
  };
}
