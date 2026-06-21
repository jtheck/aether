// Render-only GLB paths per sim unit type (military roster for demo armies).

import { UNIT } from '../sim/unitTypes.js';

/** v1 glTF units were authored oversized; game/units.js used scale ~0.5. */
export const LEGACY_MODEL_SCALE = 1;

/** @type {Readonly<Record<number, string>>} */
export const UNIT_MODEL_URLS = {
  [UNIT.WARRIOR]: '/assets/models/warrior.glb',
  [UNIT.ARCHER]: '/assets/models/archer.glb',
  [UNIT.SPEARMAN]: '/assets/models/monk.glb',
  [UNIT.SCOUT]: '/assets/models/brigand.glb',
  [UNIT.CAVALRY]: '/assets/models/engineer.glb',
};

export function hasUnitModel(typeId) {
  return typeId in UNIT_MODEL_URLS;
}

/** Depth-first — first mesh with geometry/material in a loaded glTF hierarchy. */
export function findFirstMesh(node) {
  if (node?.material) return node;
  for (const child of node?.children ?? []) {
    const mesh = findFirstMesh(child);
    if (mesh) return mesh;
  }
  return null;
}

/** Feet on y=0, XZ centered — legacy uniform scale only (no per-type resize). */
export function prepareLegacyModel(mesh, scale = LEGACY_MODEL_SCALE) {
  const min = mesh.boundMin ?? [-0.5, 0, -0.5];
  const max = mesh.boundMax ?? [0.5, 1, 0.5];
  const centerX = (min[0] + max[0]) * 0.5;
  const footY = min[1];
  const centerZ = (min[2] + max[2]) * 0.5;
  mesh.scaling.x = scale;
  mesh.scaling.y = scale;
  mesh.scaling.z = scale;
  mesh.position.x = -centerX * scale;
  mesh.position.y = -footY * scale;
  mesh.position.z = -centerZ * scale;
}
