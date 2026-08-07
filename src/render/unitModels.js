// Render-only GLB paths per sim unit type.
// Hierarchy transforms are baked (same idea as scenery) so multi-mesh assets
// like collar.glb keep every part, and glTF root mirroring is preserved.
// Prefer /assets/baked/meshes/* when present (see npm run prebake).

import {
  cloneTransformNode,
  createMeshFromData,
  loadGltf,
} from '../vendor/lite/liteVendor.js';
import { UNIT } from '../sim/unitTypes.js';
import { isVatUnitType, VAT_UNIT_DEFS } from './vatUnits.js';
import {
  bakedMeshBinUrl,
  bakedMeshJsonUrl,
  float32Slice,
  hasBakedMesh,
  tryFetch,
  uint32Slice,
} from './bakedAssets.js';
import { materialsFromBakeMeta } from './bakedMaterials.js';

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

export function collectFxSockets(node, out = []) {
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

/**
 * Live GLB hierarchy bake (CPU). Also used by prebake to dump packages.
 * @returns {Promise<{ parts: object[], sockets: { name: string, x: number, y: number, z: number }[], sources: object[] }>}
 */
export async function bakeGltfParts(engine, url) {
  const container = await loadGltf(engine, url);
  const root = cloneTransformNode(container.entities[0]);
  const sockets = collectFxSockets(root);
  const hideBareCube = sockets.length > 0;
  const sources = collectRenderableMeshes(root).filter(
    (n) => !isFxSocketNode(n, { hideBareCube }),
  );
  if (sources.length === 0) throw new Error(`no mesh in ${url}`);
  const parts = sources.map((source) => bakeSourceGeometry(source, source.worldMatrix));
  return { parts, sockets, sources };
}

/**
 * @typedef {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   uvs: Float32Array | null,
 *   material: object | null,
 *   reverseWinding: boolean,
 * }} CpuMeshPart
 */

/** @type {Map<string, Promise<{ parts: CpuMeshPart[], sockets: { name: string, x: number, y: number, z: number }[] }>>} */
const meshCpuCache = new Map();

/** Materials (and CPU geo fallback) from one GLB load per URL. */
/** @type {Map<string, Promise<object[]>>} */
const glbMaterialSourcesCache = new Map();

function loadMaterialSources(engine, url, hideBareCube) {
  let pending = glbMaterialSourcesCache.get(url);
  if (!pending) {
    pending = (async () => {
      const container = await loadGltf(engine, url);
      const root = cloneTransformNode(container.entities[0]);
      return collectRenderableMeshes(root).filter(
        (n) => !isFxSocketNode(n, { hideBareCube }),
      );
    })();
    glbMaterialSourcesCache.set(url, pending);
  }
  return pending;
}

async function loadCpuMeshPackage(engine, url) {
  let pending = meshCpuCache.get(url);
  if (!pending) {
    pending = (async () => {
      // VAT units use /vat/* dumps — never probe /meshes/ (avoids villager.json 404 RTT).
      // Skinning still needs the live GLB; mesh packages are for static models only.
      if (Object.values(VAT_UNIT_DEFS).some((d) => d.url === url)) {
        const { parts: baked, sockets } = await bakeGltfParts(engine, url);
        return cpuPackageFromLive(baked, sockets);
      }

      // Only hit the network for bake artifacts we know exist (manifest).
      if (await hasBakedMesh(url)) {
        const [jsonRes, binRes] = await Promise.all([
          tryFetch(bakedMeshJsonUrl(url)),
          tryFetch(bakedMeshBinUrl(url)),
        ]);
        if (jsonRes && binRes) {
          const meta = await jsonRes.json();
          const bin = await binRes.arrayBuffer();

          // v2+: materials + textures in bake — no GLB load.
          if ((meta.version | 0) >= 2 && Array.isArray(meta.materials)) {
            const materials = await materialsFromBakeMeta(engine, url, meta);
            const parts = (meta.parts ?? []).map((part) => {
              const mi = part.materialIndex ?? 0;
              return {
                positions: float32Slice(bin, part.positions),
                normals: float32Slice(bin, part.normals),
                indices: uint32Slice(bin, part.indices),
                uvs: part.uvs ? float32Slice(bin, part.uvs) : null,
                material: materials[mi] ?? materials[0] ?? null,
                reverseWinding: part.reverseWinding !== false,
              };
            });
            return {
              parts,
              sockets: (meta.sockets ?? []).map((s) => ({
                name: s.name,
                x: s.x,
                y: s.y,
                z: s.z,
              })),
            };
          }

          // Legacy bake: geo only — pull materials from GLB.
          const hideBareCubeGuess = true;
          const sources = await loadMaterialSources(engine, url, hideBareCubeGuess);
          const parts = (meta.parts ?? []).map((part, index) => {
            const src = sources[part.materialIndex] ?? sources[index] ?? sources[0];
            return {
              positions: float32Slice(bin, part.positions),
              normals: float32Slice(bin, part.normals),
              indices: uint32Slice(bin, part.indices),
              uvs: part.uvs ? float32Slice(bin, part.uvs) : null,
              material: src?.material ?? null,
              reverseWinding: part.reverseWinding !== false,
            };
          });
          return {
            parts,
            sockets: (meta.sockets ?? []).map((s) => ({
              name: s.name,
              x: s.x,
              y: s.y,
              z: s.z,
            })),
          };
        }
      }

      const { parts: baked, sockets } = await bakeGltfParts(engine, url);
      return cpuPackageFromLive(baked, sockets);
    })();
    meshCpuCache.set(url, pending);
  }
  return pending;
}

function cpuPackageFromLive(baked, sockets) {
  return {
    parts: baked.map((p) => ({
      positions: p.positions,
      normals: p.normals,
      indices: p.indices instanceof Uint32Array ? p.indices : new Uint32Array(p.indices),
      uvs: p.uvs,
      material: p.material,
      reverseWinding: p.reverseWinding,
    })),
    sockets,
  };
}

function meshesFromCpuPackage(engine, url, pkg) {
  const meshes = pkg.parts.map((part, index) => {
    const mesh = createMeshFromData(
      engine,
      `${url}#${index}`,
      part.positions,
      part.normals,
      part.indices,
      part.uvs ?? undefined,
    );
    mesh.material = part.material;
    mesh.pickable = false;
    mesh._reverseWinding = part.reverseWinding;
    const b = boundsOfPositions(part.positions);
    mesh.boundMin = b.min;
    mesh.boundMax = b.max;
    mesh.scaling.x = 1;
    mesh.scaling.y = 1;
    mesh.scaling.z = 1;
    mesh.position.x = 0;
    mesh.position.y = 0;
    mesh.position.z = 0;
    return mesh;
  });
  if (meshes[0]) {
    meshes[0].fxSockets = pkg.sockets.map((s) => ({ ...s }));
  }
  return meshes;
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
 * no foot rebasing or resize. Uses offline bake when present; session-cached.
 *
 * @returns {Promise<object[]>}
 */
export async function loadBakedUnitMeshParts(engine, url) {
  const pkg = await loadCpuMeshPackage(engine, url);
  return meshesFromCpuPackage(engine, url, pkg);
}

/**
 * Load a glTF, bake hierarchy world matrices, merge all meshes into one
 * thin-instance template. Authored origin and scale are kept.
 * Prefer {@link loadBakedUnitMeshParts} when materials must stay separate.
 */
export async function loadBakedUnitMesh(engine, url) {
  const pkg = await loadCpuMeshPackage(engine, url);
  if (pkg.parts.length === 1) {
    return meshesFromCpuPackage(engine, url, pkg)[0];
  }

  let vertCount = 0;
  let indexCount = 0;
  let hasUvs = false;
  const cpu = pkg.parts;
  for (const part of cpu) {
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
  for (const part of cpu) {
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
  mesh.material = cpu[0]?.material ?? null;
  mesh.pickable = false;
  mesh._reverseWinding = cpu.some((p) => p.reverseWinding);
  const b = boundsOfPositions(positions);
  mesh.boundMin = b.min;
  mesh.boundMax = b.max;
  mesh.scaling.x = 1;
  mesh.scaling.y = 1;
  mesh.scaling.z = 1;
  mesh.position.x = 0;
  mesh.position.y = 0;
  mesh.position.z = 0;
  mesh.fxSockets = pkg.sockets.map((s) => ({
    name: s.name,
    x: s.x,
    y: s.y,
    z: s.z,
  }));
  return mesh;
}
