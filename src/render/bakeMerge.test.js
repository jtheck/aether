import assert from 'node:assert/strict';
import {
  BAKE_MESH_VERSION,
  boundsOfPositions,
  compactImages,
  concatGeometry,
  dedupeMaterials,
  materialVisualKey,
  mergeSlicedParts,
} from './bakeMerge.js';

function tri(ox = 0) {
  return {
    positions: new Float32Array([ox, 0, 0, ox + 1, 0, 0, ox, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    uvs: null,
    reverseWinding: true,
  };
}

function identicalMatsMerge() {
  const a = { name: 'Material', baseColorFactor: [0.04, 0.02, 0.004, 1], metallicFactor: 0, roughnessFactor: 0.5 };
  const b = { name: 'Material.002', baseColorFactor: [0.04, 0.02, 0.004, 1], metallicFactor: 0, roughnessFactor: 0.5 };
  assert.equal(materialVisualKey(a), materialVisualKey(b));
  const { materials, remap } = dedupeMaterials([a, b]);
  assert.equal(materials.length, 1);
  assert.deepEqual(remap, [0, 0]);
}

function teamColorStaysSeparate() {
  const wood = { name: 'Wood', baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.5 };
  const team = { name: 'TeamColor', baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.5 };
  assert.notEqual(materialVisualKey(wood), materialVisualKey(team));
  const { materials, remap } = dedupeMaterials([wood, team, { name: 'TeamColor.001', baseColorFactor: [1, 0, 0, 1] }]);
  assert.equal(materials.length, 2);
  assert.deepEqual(remap, [0, 1, 1]);
  assert.equal(materials[1].name, 'TeamColor');
}

function campLikeFourteenToOne() {
  const mats = [
    { name: 'Material', baseColorFactor: [0.04, 0.02, 0.004, 1], metallicFactor: 0, roughnessFactor: 0.5, doubleSided: true },
    { name: 'Material.002', baseColorFactor: [0.04, 0.02, 0.004, 1], metallicFactor: 0, roughnessFactor: 0.5, doubleSided: true },
  ];
  const parts = [];
  for (let i = 0; i < 14; i++) {
    parts.push({ ...tri(i * 2), materialIndex: i % 2, materialName: mats[i % 2].name });
  }
  const { materials, parts: merged } = mergeSlicedParts(parts, mats);
  assert.equal(materials.length, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].positions.length, 14 * 9);
  assert.equal(merged[0].indices.length, 14 * 3);
  assert.equal(merged[0].indices[3], 3);
  assert.ok(merged[0].boundMax[0] > 20);
}

function windingFlipMatchesMajority() {
  const a = { ...tri(0), reverseWinding: true };
  const b = {
    ...tri(2),
    reverseWinding: false,
    indices: new Uint32Array([0, 1, 2]),
  };
  const geo = concatGeometry([a, b]);
  assert.equal(geo.reverseWinding, true);
  assert.deepEqual([...geo.indices.slice(3, 6)], [3, 5, 4]);
}

function uvPaddingWhenMixed() {
  const a = { ...tri(0), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) };
  const b = { ...tri(2), uvs: null };
  const geo = concatGeometry([a, b]);
  assert.equal(geo.uvs.length, 12);
  assert.deepEqual([...geo.uvs.slice(0, 6)], [0, 0, 1, 0, 0, 1]);
  assert.deepEqual([...geo.uvs.slice(6)], [0, 0, 0, 0, 0, 0]);
}

function compactDropsUnusedImages() {
  const materials = [
    { name: 'A', baseColorImage: 1, normalImage: null, ormImage: null, emissiveImage: null },
  ];
  const images = [{ file: 'img-0.png' }, { file: 'img-1.png' }, { file: 'img-2.png' }];
  const out = compactImages(materials, images);
  assert.equal(out.images.length, 1);
  assert.equal(out.images[0].file, 'img-1.png');
  assert.equal(out.materials[0].baseColorImage, 0);
}

function boundsFromPositions() {
  const b = boundsOfPositions(new Float32Array([-1, 2, 3, 4, -5, 6]));
  assert.deepEqual(b.min, [-1, -5, 3]);
  assert.deepEqual(b.max, [4, 2, 6]);
}

assert.equal(BAKE_MESH_VERSION, 3);
identicalMatsMerge();
teamColorStaysSeparate();
campLikeFourteenToOne();
windingFlipMatchesMajority();
uvPaddingWhenMixed();
compactDropsUnusedImages();
boundsFromPositions();
console.log('bakeMerge.test.js ok');
