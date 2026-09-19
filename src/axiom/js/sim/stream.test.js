import assert from 'node:assert/strict';
import {
  chunkSphereHitsFrustum,
  chunkWanted,
  chunkHitsView,
  chunkLookDepth,
  chunkCameraDist,
  chunkBounds,
  estimateHotChunks,
  frustumRushTarget,
  lookQuant,
  poseAxes,
  streamDistanceScale,
  STREAM_DENSITY_FAR,
  STREAM_DENSITY_NEAR,
  STREAM_FRUSTUM_MIN_FRAC,
} from './chunks.js';
import { KIND_POINT, boxSphereOverlapFraction } from './store.js';
import { waveChunkNearEmitter, waveEmitterKeepR } from './behaviors.js';
import { createWorld } from './world.js';

{
  const bounds = { minX: 0, minY: 0, minZ: 0, size: 16 };
  const sphere = { x: 8, y: 8, z: 20, r: 12 };
  const a = boxSphereOverlapFraction(bounds, sphere);
  const b = boxSphereOverlapFraction(bounds, sphere);
  assert.equal(a, b, 'overlap frac must be stable');
  assert.ok(a > 0 && a < 1, `expected grazing frac, got ${a}`);
}

{
  const lookNegZ = {
    x: 0,
    y: 0,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  };
  const lookPosZ = { ...lookNegZ, forward: { x: 0, y: 0, z: 1 } };
  assert.equal(chunkSphereHitsFrustum(0, 0, -2, 16, lookNegZ, { far: 80 }), true);
  assert.equal(chunkSphereHitsFrustum(0, 0, 2, 16, lookNegZ, { far: 80 }), false);
  assert.equal(chunkSphereHitsFrustum(0, 0, 2, 16, lookPosZ, { far: 80 }), true);
  const focus = { cx: 0, cy: 0, cz: 0 };
  assert.equal(chunkWanted(0, 0, 0, focus, lookNegZ, 16, 5), true, 'core');
  assert.equal(chunkWanted(0, 0, -3, focus, lookNegZ, 16, 5), true, 'ahead');
  assert.equal(chunkWanted(0, 0, 3, focus, lookNegZ, 16, 5), false, 'behind beyond core');
}

{
  const a = poseAxes({
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  });
  assert.ok(a.fz < 0, 'default look −Z');
  assert.notEqual(lookQuant(0, 0, -1), lookQuant(0, 0, 1));
  assert.ok(estimateHotChunks(5) < 700);
  assert.ok(estimateHotChunks(5) > 80);
}

{
  const poseAhead = {
    x: 0,
    y: 4,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
  };
  const poseBack = { ...poseAhead, forward: { x: 0, y: 0, z: 1 } };
  const world = createWorld({
    capacity: 800,
    initialCount: 240,
    startCount: 240,
    chunkSize: 16,
    chunkRadius: 4,
    startRadius: 4,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  world.tick(1 / 60, poseAhead);
  const ahead = world.chunkCount;
  const keysAhead = new Set(world.getChunkBounds().map((c) => c.key));
  for (let i = 0; i < 24; i++) world.tick(1 / 60, poseBack);
  const keysBack = new Set(world.getChunkBounds().map((c) => c.key));
  assert.ok(ahead > 8, `hot set too small (${ahead})`);
  let onlyAhead = 0;
  for (const k of keysAhead) if (!keysBack.has(k)) onlyAhead++;
  assert.ok(onlyAhead > 0, 'look flip should drop back-hemisphere chunks');
}

{
  const world = createWorld({
    capacity: 400,
    initialCount: 160,
    startCount: 160,
    chunkSize: 16,
    chunkRadius: 1,
    startRadius: 1,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  const pose = { x: 0, y: 4, z: 0, forward: { x: 0, y: 0, z: -1 }, fov: 60, aspect: 1 };
  world.tick(1 / 60, pose);
  const c0 = world.count;
  assert.ok(c0 > 0);
  world.setTargetCount(Math.max(1, c0 - 80));
  assert.equal(world.count, c0, 'caps only — no instant dump');
  world.tick(1 / 60, pose);
  assert.ok(world.count < c0, 'ease should shed a little');
  assert.ok(world.count > c0 - 80, 'must not dump the whole bite in one frame');
}

{
  const world = createWorld({
    capacity: 600,
    initialCount: 200,
    startCount: 200,
    chunkSize: 16,
    chunkRadius: 3,
    startRadius: 3,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  world.tick(1 / 60, {
    x: 0,
    y: 4,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
  });
  const pts = world.getRenderSpecies('points');
  const r = (3 + 0.5) * 16;
  const cx = 8;
  const cy = 8;
  const cz = 8;
  let outside = 0;
  for (let i = 0; i < pts.count; i++) {
    const dx = pts.positions[i * 3] - cx;
    const dy = pts.positions[i * 3 + 1] - cy;
    const dz = pts.positions[i * 3 + 2] - cz;
    if (dx * dx + dy * dy + dz * dz > (r + 2.3) * (r + 2.3)) outside++;
  }
  assert.equal(outside, 0, `sphere cull leaked ${outside} / ${pts.count}`);
}

{
  assert.equal(frustumRushTarget(0), 0);
  assert.equal(frustumRushTarget(3), 3);
  assert.equal(frustumRushTarget(100), Math.round(100 * STREAM_FRUSTUM_MIN_FRAC));
  const look = {
    x: 0,
    y: 4,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
  };
  assert.equal(chunkHitsView(0, 0, -2, 16, look, 4), true);
  assert.equal(chunkHitsView(0, 0, 2, 16, look, 4), false);
  assert.ok(chunkLookDepth(0, 0, -1, 16, look) < chunkLookDepth(0, 0, -3, 16, look));
  assert.equal(streamDistanceScale(0, 16, 4), STREAM_DENSITY_NEAR);
  assert.ok(streamDistanceScale(32, 16, 4) < streamDistanceScale(16, 16, 4));
  assert.ok(Math.abs(streamDistanceScale(200, 16, 4) - STREAM_DENSITY_FAR) < 1e-6);
  assert.ok(chunkCameraDist(0, 0, -1, 16, look) < chunkCameraDist(0, 0, -3, 16, look));
}

{
  const poseAt = (z) => ({
    x: 0,
    y: 4,
    z,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  });
  const inView = (pts, pose) => {
    const a = poseAxes(pose);
    const halfV = Math.tan((a.fov * Math.PI) / 360);
    const halfH = halfV * a.aspect;
    let n = 0;
    for (let i = 0; i < pts.count; i++) {
      const dx = pts.positions[i * 3] - a.x;
      const dy = pts.positions[i * 3 + 1] - a.y;
      const dz = pts.positions[i * 3 + 2] - a.z;
      const depth = dx * a.fx + dy * a.fy + dz * a.fz;
      if (depth < 0.05) continue;
      const sx = dx * a.rx + dy * a.ry + dz * a.rz;
      const sy = dx * a.ux + dy * a.uy + dz * a.uz;
      if (Math.abs(sx) <= depth * halfH && Math.abs(sy) <= depth * halfV) n++;
    }
    return n;
  };
  const world = createWorld({
    capacity: 8000,
    initialCount: 2400,
    startCount: 2400,
    chunkSize: 16,
    chunkRadius: 4,
    startRadius: 4,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  const settled = poseAt(0);
  for (let i = 0; i < 20; i++) world.tick(1 / 60, settled);
  const jumped = poseAt(-64);
  world.tick(1 / 60, jumped);
  const seen = inView(world.getRenderSpecies('points'), jumped);
  assert.ok(seen > 180, `frustum should rush min density after a look-ahead jump (got ${seen})`);
}

{
  const pose = {
    x: 0,
    y: 4,
    z: 0,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  };
  const band = (pts, lo, hi) => {
    const a = poseAxes(pose);
    let n = 0;
    for (let i = 0; i < pts.count; i++) {
      const dx = pts.positions[i * 3] - a.x;
      const dy = pts.positions[i * 3 + 1] - a.y;
      const dz = pts.positions[i * 3 + 2] - a.z;
      const depth = dx * a.fx + dy * a.fy + dz * a.fz;
      if (depth >= lo && depth < hi) n++;
    }
    return n;
  };
  const world = createWorld({
    capacity: 8000,
    initialCount: 2400,
    startCount: 2400,
    chunkSize: 16,
    chunkRadius: 4,
    startRadius: 4,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  for (let i = 0; i < 24; i++) world.tick(1 / 60, pose);
  const pts = world.getRenderSpecies('points');
  const near = band(pts, 4, 24);
  const far = band(pts, 40, 72);
  const nearDens = near / 20;
  const farDens = far / 32;
  assert.ok(
    nearDens > farDens * 1.15,
    `near should out-density far (near ${nearDens.toFixed(1)} vs far ${farDens.toFixed(1)})`,
  );

  const far0 = far;
  const back = { ...pose, z: 28 };
  for (let i = 0; i < 3; i++) world.tick(1 / 60, back);
  const farAfter = band(world.getRenderSpecies('points'), 40, 72);
  assert.ok(farAfter < far0 * 0.72, `backing up should shed far dots (was ${far0}, now ${farAfter})`);
}

{
  const keepR = waveEmitterKeepR(16);
  assert.equal(waveChunkNearEmitter(chunkBounds(0, 0, 0, 16), keepR), true);
  assert.equal(waveChunkNearEmitter(chunkBounds(0, 0, -6, 16), keepR), false);
}

{
  const pose = {
    x: 0,
    y: 4,
    z: -48,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  };
  const world = createWorld({
    capacity: 8000,
    initialCount: 2400,
    startCount: 2400,
    chunkSize: 16,
    chunkRadius: 4,
    startRadius: 4,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  world.tick(1 / 60, pose);
  const keys = new Set(world.getChunkBounds().map((c) => c.key));
  assert.ok(keys.has('0,0,0'), 'emitter cube should stay streamed behind the camera');
  let around = 0;
  const pts = world.getRenderSpecies('points');
  for (let i = 0; i < pts.count; i++) {
    const x = pts.positions[i * 3];
    const y = pts.positions[i * 3 + 1];
    const z = pts.positions[i * 3 + 2];
    if (x * x + y * y + z * z < 18 * 18) around++;
  }
  assert.ok(around > 40, `emitter neighborhood should stay dense (got ${around})`);
}

console.log('stream.test.js ok');
