// Rewrite existing v2 mesh packages to v3 (merged parts + baked AABBs).
// No WebGPU — reads assets/baked/meshes and writes in place.

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { packBinary, float32Slice, uint32Slice } from '../render/bakedAssets.js';
import {
  BAKE_MESH_VERSION,
  compactImages,
  mergeSlicedParts,
} from '../render/bakeMerge.js';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const MESHES = join(ROOT, '..', 'assets', 'baked', 'meshes');

function slicePart(bin, part) {
  return {
    positions: float32Slice(bin, part.positions),
    normals: float32Slice(bin, part.normals),
    indices: uint32Slice(bin, part.indices),
    uvs: part.uvs ? float32Slice(bin, part.uvs) : null,
    reverseWinding: part.reverseWinding !== false,
    materialIndex: part.materialIndex ?? 0,
    materialName: part.materialName,
  };
}

function packParts(mergedParts) {
  const entries = [];
  for (let i = 0; i < mergedParts.length; i++) {
    const p = mergedParts[i];
    const prefix = `p${i}`;
    entries.push({ key: `${prefix}_pos`, data: p.positions });
    entries.push({ key: `${prefix}_nrm`, data: p.normals });
    entries.push({ key: `${prefix}_idx`, data: p.indices });
    if (p.uvs) entries.push({ key: `${prefix}_uvs`, data: p.uvs });
  }
  const { buffer, spans } = packBinary(entries);
  const parts = mergedParts.map((p, i) => {
    const prefix = `p${i}`;
    return {
      materialName: p.materialName,
      materialIndex: p.materialIndex,
      reverseWinding: p.reverseWinding,
      boundMin: p.boundMin,
      boundMax: p.boundMax,
      positions: spans[`${prefix}_pos`],
      normals: spans[`${prefix}_nrm`],
      indices: spans[`${prefix}_idx`],
      uvs: spans[`${prefix}_uvs`] || null,
    };
  });
  return { buffer, parts };
}

const names = (await readdir(MESHES)).filter((n) => n.endsWith('.json'));
let changed = 0;
let partsBefore = 0;
let partsAfter = 0;
for (const name of names) {
  const jsonPath = join(MESHES, name);
  const binPath = jsonPath.replace(/\.json$/i, '.bin');
  const meta = JSON.parse(await readFile(jsonPath, 'utf8'));
  const bin = (await readFile(binPath)).buffer;
  const before = (meta.parts ?? []).length;
  partsBefore += before;
  const sliced = (meta.parts ?? []).map((p) => slicePart(bin, p));
  const merged = mergeSlicedParts(sliced, meta.materials ?? []);
  const compacted = compactImages(merged.materials, meta.images ?? []);
  const packed = packParts(merged.parts);
  partsAfter += packed.parts.length;
  const next = {
    ...meta,
    version: BAKE_MESH_VERSION,
    materials: compacted.materials,
    images: compacted.images,
    parts: packed.parts,
  };
  await writeFile(jsonPath, `${JSON.stringify(next, null, 2)}\n`);
  await writeFile(binPath, Buffer.from(packed.buffer));
  if (before !== packed.parts.length) {
    console.log(`${name}: ${before} → ${packed.parts.length} parts`);
  }
  changed += 1;
}
console.log(`repacked ${changed} meshes, parts ${partsBefore} → ${partsAfter}`);
