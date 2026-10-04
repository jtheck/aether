import assert from 'node:assert/strict';
import {
  applyChannels,
  computeTopoOrder,
  evaluateSampler,
  fillRestTrs,
  isCarryOverlayBoneName,
  mat4InvertTo,
  overlayNodeIndices,
  recomputeOverlayWorlds,
  rigidPropMeshMatrix,
  skinNormals,
  skinPositions,
  transformNormalsByMat4,
  transformPointsByMat4,
} from './vatBakeCpu.js';

function overlayNames() {
  assert.equal(isCarryOverlayBoneName('Arm.L'), true);
  assert.equal(isCarryOverlayBoneName('Shoulder.R'), true);
  assert.equal(isCarryOverlayBoneName('Armature'), false);
  assert.equal(isCarryOverlayBoneName('Torso'), false);
  assert.equal(isCarryOverlayBoneName('Head'), false);
}

function overlayNodesFromCarryTargets() {
  const idx = overlayNodeIndices({
    targetedAnimations: [
      { nodeIndex: 5, targetName: 'Torso' },
      { nodeIndex: 2, targetName: 'Shoulder.L' },
      { nodeIndex: 1, targetName: 'Arm.L' },
      { nodeIndex: 11, targetName: 'Armature' },
    ],
  });
  assert.deepEqual([...idx].sort((a, b) => a - b), [1, 2]);
}

function oneKeyCarryWritesRotation() {
  const clip = {
    channels: [{ samplerIdx: 0, nodeIdx: 1, path: 1 }],
    samplers: [{
      input: new Float32Array([0]),
      output: new Float32Array([0, 0.7071, 0, 0.7071]),
      interpolation: 0,
    }],
  };
  const nodes = [
    { parentIdx: -1, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 },
    { parentIdx: 0, tx: 1, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 },
  ];
  const trs = new Float32Array(nodes.length * 12);
  fillRestTrs(nodes, trs);
  applyChannels(clip, 0, trs, new Set([1]));
  assert.ok(Math.abs(trs[12 + 3 + 1] - 0.7071) < 1e-3);
  assert.ok(Math.abs(trs[3] - 0) < 1e-6, 'parent rest rotation stays');
}

function overlayChildFollowsWalkedParent() {
  const nodes = [
    { parentIdx: -1, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 },
    { parentIdx: 0, tx: 1, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 },
  ];
  const world = new Float32Array(32);
  // Parent yawed 90° (column-major, Y-up): +X maps to +Z.
  world.set([
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 2, 0, 1,
  ], 0);
  // Frozen carry-world child sitting at rest +X — what a skin-matrix stamp leaves.
  world.set([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 1,
  ], 16);

  const trs = new Float32Array(24);
  fillRestTrs(nodes, trs);
  const local = new Float32Array(16);
  recomputeOverlayWorlds(nodes, world, trs, [1], computeTopoOrder(nodes), local);

  const x = world[16 + 12];
  const y = world[16 + 13];
  const z = world[16 + 14];
  assert.ok(Math.abs(x) < 1e-5, `child x ${x}`);
  assert.ok(Math.abs(y - 2) < 1e-5, `child y ${y}`);
  assert.ok(Math.abs(z + 1) < 1e-5, `child z ${z}`);
}

function samplerPicksSingleKey() {
  const out = new Float32Array(3);
  evaluateSampler({
    input: new Float32Array([0]),
    output: new Float32Array([4, 5, 6]),
    interpolation: 0,
  }, 0, 3, false, out, 0);
  assert.deepEqual([...out], [4, 5, 6]);
}

function ident(tx = 0, ty = 0, tz = 0) {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function rigidPropStaysOnTheBone() {
  const ibm = ident();
  const bone = ident(0, 1, 0);
  const prop = ident(0.5, 1, 0);
  const into = rigidPropMeshMatrix(ibm, 0, bone, prop);
  const local = transformPointsByMat4(into, new Float32Array([0, 0, 0]));
  assert.ok(Math.abs(local[0] - 0.5) < 1e-5, `local x ${local[0]}`);
  assert.ok(Math.abs(local[1]) < 1e-5, `local y ${local[1]}`);
  const posed = transformPointsByMat4(ident(0, 2, 0), local);
  assert.ok(Math.abs(posed[0] - 0.5) < 1e-5, `posed x ${posed[0]}`);
  assert.ok(Math.abs(posed[1] - 2) < 1e-5, `posed y ${posed[1]}`);
  const n = transformNormalsByMat4(into, new Float32Array([0, 1, 0]));
  assert.ok(Math.abs(n[1] - 1) < 1e-5, `normal y ${n[1]}`);
}

function invertRoundTrips() {
  const m = ident(3, -2, 4);
  const inv = new Float32Array(16);
  assert.equal(mat4InvertTo(inv, 0, m, 0), true);
  const back = transformPointsByMat4(m, transformPointsByMat4(inv, new Float32Array([1, 2, 3])));
  assert.ok(Math.abs(back[0] - 1) < 1e-5);
  assert.ok(Math.abs(back[1] - 2) < 1e-5);
  assert.ok(Math.abs(back[2] - 3) < 1e-5);
}

function skinOneBoneMovesTheVertex() {
  const mats = new Float32Array(16);
  mats[0] = mats[5] = mats[10] = mats[15] = 1;
  mats[13] = 2;
  const joints = new Uint32Array([0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0]);
  const dst = skinPositions(mats, joints, weights, new Float32Array([1, 0, 0]));
  assert.ok(Math.abs(dst[0] - 1) < 1e-5);
  assert.ok(Math.abs(dst[1] - 2) < 1e-5);
  assert.ok(Math.abs(dst[2]) < 1e-5);
  const n = skinNormals(mats, joints, weights, new Float32Array([0, 1, 0]));
  assert.ok(Math.abs(n[1] - 1) < 1e-5);
}

overlayNames();
overlayNodesFromCarryTargets();
oneKeyCarryWritesRotation();
overlayChildFollowsWalkedParent();
samplerPicksSingleKey();
rigidPropStaysOnTheBone();
invertRoundTrips();
skinOneBoneMovesTheVertex();
console.log('vatBakeCpu.test.js ok');
