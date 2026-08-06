// Render-only GLB paths per sim unit type.
// Hierarchy transforms are baked (same idea as scenery) so multi-mesh assets
// like collar.glb keep every part, and glTF root mirroring is preserved.

import {
  cloneTransformNode,
  createMeshFromData,
  loadGltf,
} from '../vendor/lite/liteVendor.js';
import { UNIT } from '../sim/unitTypes.js';
import { isVatUnitType, VAT_UNIT_DEFS } from './vatUnits.js';

/** Static (non-VAT) thin-instance templates. */
/** @type {Readonly<Record<number, string>>} */
export const UNIT_MODEL_URLS = {
  [UNIT.WARRIOR]: '/assets/models/warrior.glb',
  [UNIT.ARCHER]: '/assets/models/archer.glb',
  [UNIT.WARLOCK]: '/assets/models/warlock.glb',
  [UNIT.PRIEST]: '/assets/models/priest.glb',
  [UNIT.MYCO]: '/assets/models/myco.glb',
  [UNIT.SHAMAN]: '/assets/models/shaman.glb',
  [UNIT.WIZARD]: '/assets/models/wizard.glb',
  [UNIT.MONK]: '/assets/models/monk.glb',
  [UNIT.ENGINEER]: '/assets/models/engineer.glb',
  [UNIT.WAGON]: '/assets/models/wagon.glb',
  [UNIT.DIRIGIBLE]: '/assets/models/dirigible.glb',
  [UNIT.APC]: '/assets/models/apc.glb',
};

export function hasUnitModel(typeId) {
  return typeId in UNIT_MODEL_URLS || isVatUnitType(typeId);
}

/** All thin-instanced unit type ids (static + VAT). */
export function unitModelTypeIds() {
  const ids = new Set([
    ...Object.keys(UNIT_MODEL_URLS).map(Number),
    ...Object.keys(VAT_UNIT_DEFS).map(Number),
  ]);
  return [...ids];
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

export function collectRenderableMeshes(node, out = []) {
  if (node?.material) out.push(node);
  for (const child of node?.children ?? []) collectRenderableMeshes(child, out);
  return out;
}

function gltfNodeBaseName(node) {
  // cloneTransformNode appends "_clone"; strip before matching.
  return (node?.name ?? '').replace(/_clone$/i, '');
}

/**
 * Blender FX empties / marker cubes — not part of the visible unit.
 * Bare "Cube" is only treated as a helper when the asset also has *anchor*
 * sockets (e.g. warlock). target.glb is itself named Cube and must render.
 *
 * @param {object} node
 * @param {{ hideBareCube?: boolean }} [opts]
 */
export function isFxSocketNode(node, opts = {}) {
  const name = gltfNodeBaseName(node);
  if (/anchor/i.test(name)) return true;
  if (opts.hideBareCube && name === 'Cube') return true;
  return false;
}

function collectFxSockets(node, out = []) {
  if (/anchor/i.test(gltfNodeBaseName(node))) {
    const w = node.worldMatrix;
    if (w) {
      out.push({
        name: gltfNodeBaseName(node),
        x: w[12],
        y: w[13],
        z: w[14],
      });
    }
  }
  for (const child of node?.children ?? []) collectFxSockets(child, out);
  return out;
}

/** Union local AABBs across a loaded glTF hierarchy (node translations only). */
export function computeHierarchyBounds(root) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;

  function visit(node, ox, oy, oz) {
    const tx = ox + (node.position?.x ?? 0);
    const ty = oy + (node.position?.y ?? 0);
    const tz = oz + (node.position?.z ?? 0);
    if (node.boundMin && node.boundMax) {
      any = true;
      min[0] = Math.min(min[0], tx + node.boundMin[0]);
      min[1] = Math.min(min[1], ty + node.boundMin[1]);
      min[2] = Math.min(min[2], tz + node.boundMin[2]);
      max[0] = Math.max(max[0], tx + node.boundMax[0]);
      max[1] = Math.max(max[1], ty + node.boundMax[1]);
      max[2] = Math.max(max[2], tz + node.boundMax[2]);
    }
    for (const child of node.children ?? []) visit(child, tx, ty, tz);
  }

  visit(root, 0, 0, 0);
  return any ? { min, max } : null;
}

function bakeSourceGeometry(source, world) {
  const srcPositions = source._cpuPositions;
  const srcIndices = source._cpuIndices;
  if (!srcPositions || !srcIndices) {
    throw new Error(`mesh "${source.name}" has no CPU geometry`);
  }

  const positions = new Float32Array(srcPositions.length);
  for (let i = 0; i < srcPositions.length; i += 3) {
    const x = srcPositions[i];
    const y = srcPositions[i + 1];
    const z = srcPositions[i + 2];
    positions[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    positions[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    positions[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }

  // Rebuild normals from baked triangles (same LH / CW convention as scenery).
  const indices = srcIndices instanceof Uint32Array
    ? srcIndices
    : new Uint32Array(srcIndices);
  const normals = computeSmoothNormalsLH(positions, indices);

  return {
    positions,
    normals,
    indices,
    uvs: source._cpuUvs ? new Float32Array(source._cpuUvs) : null,
    material: source.material,
    reverseWinding: true,
  };
}

/** Smooth normals for Lite left-handed / CW front faces (AC × AB). */
function computeSmoothNormalsLH(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = acy * abz - acz * aby;
    const ny = acz * abx - acx * abz;
    const nz = acx * aby - acy * abx;
    for (const o of [ia, ib, ic]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

async function bakeGltfParts(engine, url) {
  const container = await loadGltf(engine, url);
  const root = cloneTransformNode(container.entities[0]);
  const sockets = collectFxSockets(root);
  const hideBareCube = sockets.length > 0;
  const sources = collectRenderableMeshes(root).filter(
    (n) => !isFxSocketNode(n, { hideBareCube }),
  );
  if (sources.length === 0) throw new Error(`no mesh in ${url}`);
  const parts = sources.map((source) => bakeSourceGeometry(source, source.worldMatrix));
  return { parts, sockets };
}

function boundsOfPositions(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Load a glTF, bake hierarchy world matrices into verts, one mesh per source
 * primitive (preserves multi-material). Authored origin and scale are kept —
 * no foot rebasing or resize.
 *
 * @returns {Promise<object[]>}
 */
export async function loadBakedUnitMeshParts(engine, url) {
  const { parts: baked, sockets } = await bakeGltfParts(engine, url);

  const meshes = baked.map((part, index) => {
    const positions = part.positions;
    const mesh = createMeshFromData(
      engine,
      `${url}#${index}`,
      positions,
      part.normals,
      part.indices instanceof Uint32Array ? part.indices : new Uint32Array(part.indices),
      part.uvs ?? undefined,
    );
    mesh.material = part.material;
    mesh.pickable = false;
    mesh._reverseWinding = part.reverseWinding;
    const b = boundsOfPositions(positions);
    mesh.boundMin = b.min;
    mesh.boundMax = b.max;
    // Identity mesh transform — placement lives in thin-instance matrices.
    mesh.scaling.x = 1;
    mesh.scaling.y = 1;
    mesh.scaling.z = 1;
    mesh.position.x = 0;
    mesh.position.y = 0;
    mesh.position.z = 0;
    return mesh;
  });
  if (meshes[0]) {
    meshes[0].fxSockets = sockets.map((s) => ({
      name: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
    }));
  }
  return meshes;
}

/**
 * Load a glTF, bake hierarchy world matrices, merge all meshes into one
 * thin-instance template. Authored origin and scale are kept.
 * Prefer {@link loadBakedUnitMeshParts} when materials must stay separate.
 */
export async function loadBakedUnitMesh(engine, url) {
  const { parts: baked, sockets } = await bakeGltfParts(engine, url);

  let vertCount = 0;
  let indexCount = 0;
  let hasUvs = false;
  for (const part of baked) {
    vertCount += part.positions.length / 3;
    indexCount += part.indices.length;
    if (part.uvs) hasUvs = true;
  }

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(indexCount);
  const uvs = hasUvs ? new Float32Array(vertCount * 2) : undefined;
  let vBase = 0;
  let iBase = 0;
  for (const part of baked) {
    positions.set(part.positions, vBase * 3);
    normals.set(part.normals, vBase * 3);
    if (uvs) {
      if (part.uvs) uvs.set(part.uvs, vBase * 2);
      else {
        for (let i = 0; i < part.positions.length / 3; i++) {
          uvs[(vBase + i) * 2] = 0;
          uvs[(vBase + i) * 2 + 1] = 0;
        }
      }
    }
    const idx = part.indices;
    for (let i = 0; i < idx.length; i++) indices[iBase + i] = idx[i] + vBase;
    vBase += part.positions.length / 3;
    iBase += idx.length;
  }

  const mesh = createMeshFromData(engine, url, positions, normals, indices, uvs);
  mesh.material = baked[0].material;
  mesh.pickable = false;
  mesh._reverseWinding = baked.some((p) => p.reverseWinding);
  const b = boundsOfPositions(positions);
  mesh.boundMin = b.min;
  mesh.boundMax = b.max;
  mesh.scaling.x = 1;
  mesh.scaling.y = 1;
  mesh.scaling.z = 1;
  mesh.position.x = 0;
  mesh.position.y = 0;
  mesh.position.z = 0;
  mesh.fxSockets = sockets.map((s) => ({
    name: s.name,
    x: s.x,
    y: s.y,
    z: s.z,
  }));
  return mesh;
}
