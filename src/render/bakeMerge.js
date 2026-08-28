// Offline + runtime mesh-package collapse.
// Prebake writes version 3 (one part per visual material). Runtime still
// merges older v2 dumps so a stale bake folder gets the same GPU mesh count.
// Texture atlas merge is reserved for later — current roster bakes are
// factor-only (no images), so packing albedos would be a no-op.

export const BAKE_MESH_VERSION = 3;

function isTeamColorName(name) {
  return String(name ?? '').toLowerCase().includes('teamcolor');
}

function q(n, digits = 4) {
  const x = Number(n);
  return Number.isFinite(x) ? +x.toFixed(digits) : 0;
}

function qv(arr, n, fallback) {
  const src = arr ?? fallback;
  const out = [];
  for (let i = 0; i < n; i++) out.push(q(src[i] ?? fallback[i]));
  return out;
}

function texKey(mat, imageField, liveField) {
  if (mat[imageField] != null) return mat[imageField] | 0;
  const live = mat[liveField];
  if (live == null) return null;
  return live._id ?? live.label ?? live;
}

/**
 * Visual identity for a bake material desc or a live Lite PBR mat.
 * TeamColor parts always share one bucket (instance tint is per-slot).
 * @param {object | null | undefined} mat
 */
export function materialVisualKey(mat) {
  if (!mat) return 'null';
  if (isTeamColorName(mat.name)) return 'teamcolor';
  return JSON.stringify({
    f: qv(mat.baseColorFactor, 4, [1, 1, 1, 1]),
    met: q(mat.metallicFactor ?? 1),
    r: q(mat.roughnessFactor ?? 1),
    e: qv(mat.emissiveFactor, 3, [0, 0, 0]),
    ds: !!mat.doubleSided,
    a: mat.alphaMode ?? 'OPAQUE',
    ac: q(mat.alphaCutoff ?? 0.5),
    bc: texKey(mat, 'baseColorImage', 'baseColorTexture'),
    n: texKey(mat, 'normalImage', 'normalTexture'),
    o: texKey(mat, 'ormImage', 'ormTexture'),
    em: texKey(mat, 'emissiveImage', 'emissiveTexture'),
  });
}

/**
 * @param {Float32Array} positions
 * @returns {{ min: number[], max: number[] }}
 */
export function boundsOfPositions(positions) {
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
 * Drop unused / duplicate-by-look materials. TeamColor stays its own slot.
 * @param {object[]} materials
 * @returns {{ materials: object[], remap: number[] }}
 */
export function dedupeMaterials(materials) {
  /** @type {object[]} */
  const next = [];
  /** @type {Map<string, number>} */
  const keyTo = new Map();
  const remap = [];
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i] ?? {};
    const key = materialVisualKey(mat);
    let idx = keyTo.get(key);
    if (idx == null) {
      idx = next.length;
      keyTo.set(key, idx);
      const copy = { ...mat };
      if (key === 'teamcolor') copy.name = 'TeamColor';
      next.push(copy);
    }
    remap[i] = idx;
  }
  return { materials: next, remap };
}

/**
 * Remap image indices after unused images are dropped.
 * @param {object[]} materials
 * @param {{ file?: string, mimeType?: string, bytes?: Uint8Array }[]} images
 */
export function compactImages(materials, images) {
  if (!images?.length) return { materials, images: images ?? [] };
  const used = new Set();
  for (const m of materials) {
    for (const k of ['baseColorImage', 'normalImage', 'ormImage', 'emissiveImage']) {
      if (m[k] != null) used.add(m[k] | 0);
    }
  }
  /** @type {Map<number, number>} */
  const oldToNew = new Map();
  const nextImgs = [];
  for (let i = 0; i < images.length; i++) {
    if (!used.has(i)) continue;
    oldToNew.set(i, nextImgs.length);
    nextImgs.push(images[i]);
  }
  if (nextImgs.length === images.length) return { materials, images };
  const nextMats = materials.map((m) => {
    const copy = { ...m };
    for (const k of ['baseColorImage', 'normalImage', 'ormImage', 'emissiveImage']) {
      if (copy[k] == null) continue;
      copy[k] = oldToNew.has(copy[k] | 0) ? oldToNew.get(copy[k] | 0) : null;
    }
    return copy;
  });
  return { materials: nextMats, images: nextImgs };
}

/**
 * Concatenate CPU parts that already share a material.
 * @param {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   uvs: Float32Array | null,
 *   reverseWinding?: boolean,
 * }[]} group
 */
export function concatGeometry(group) {
  let vertCount = 0;
  let indexCount = 0;
  let hasUvs = false;
  let reverseVotes = 0;
  for (const p of group) {
    vertCount += p.positions.length / 3;
    indexCount += p.indices.length;
    if (p.uvs) hasUvs = true;
    if (p.reverseWinding !== false) reverseVotes += 1;
  }
  const wantReverse = reverseVotes * 2 >= group.length;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(indexCount);
  const uvs = hasUvs ? new Float32Array(vertCount * 2) : null;
  let vBase = 0;
  let iBase = 0;
  for (const p of group) {
    const n = p.positions.length / 3;
    positions.set(p.positions, vBase * 3);
    normals.set(p.normals, vBase * 3);
    if (uvs) {
      if (p.uvs) uvs.set(p.uvs, vBase * 2);
    }
    const flip = (p.reverseWinding !== false) !== wantReverse;
    const idx = p.indices;
    if (!flip) {
      for (let i = 0; i < idx.length; i++) indices[iBase + i] = idx[i] + vBase;
    } else {
      for (let i = 0; i < idx.length; i += 3) {
        indices[iBase + i] = idx[i] + vBase;
        indices[iBase + i + 1] = idx[i + 2] + vBase;
        indices[iBase + i + 2] = idx[i + 1] + vBase;
      }
    }
    vBase += n;
    iBase += idx.length;
  }
  const b = boundsOfPositions(positions);
  return {
    positions,
    normals,
    indices,
    uvs,
    reverseWinding: wantReverse,
    boundMin: b.min,
    boundMax: b.max,
  };
}

/**
 * One GPU mesh per visual material. Preserves first-seen group order.
 * @param {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   uvs?: Float32Array | null,
 *   reverseWinding?: boolean,
 *   materialIndex?: number,
 *   materialName?: string,
 *   material?: object | null,
 * }[]} parts
 * @param {object[]} [materials]
 */
export function mergeSlicedParts(parts, materials = []) {
  const { materials: compactMats, remap } = dedupeMaterials(materials);
  /** @type {Map<string, typeof parts>} */
  const groups = new Map();
  const order = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const mi = p.materialIndex ?? 0;
    const mat = compactMats[remap[mi] ?? 0] ?? p.material ?? null;
    const key = materialVisualKey(mat);
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      order.push(key);
    }
    g.push(p);
  }
  const merged = [];
  for (const key of order) {
    const g = groups.get(key);
    const geo = concatGeometry(g);
    const src0 = g[0];
    const oldMi = src0.materialIndex ?? 0;
    const materialIndex = remap[oldMi] ?? 0;
    const mat = compactMats[materialIndex] ?? src0.material ?? null;
    merged.push({
      ...geo,
      materialIndex,
      materialName: key === 'teamcolor' ? 'TeamColor' : (mat?.name || src0.materialName || `part${merged.length}`),
      material: src0.material ?? mat ?? null,
    });
  }
  return { materials: compactMats, parts: merged };
}
