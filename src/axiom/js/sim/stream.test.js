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
  STREAM_EMITTER_CROWD,
  STREAM_EMITTER_DENSITY_MAX,
  STREAM_EMITTER_DENSITY_MIN,
  STREAM_FRUSTUM_MIN_FRAC,
  emitterDensityScale,
} from './chunks.js';
import { KIND_POINT, boxSphereOverlapFraction } from './store.js';
import { stepWavePreset, waveChunkNearEmitter, waveEmitterKeepR, wavePresetId } from './behaviors.js';
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
  const mid = streamDistanceScale(48, 16, 4);
  const next = streamDistanceScale(64, 16, 4);
  assert.ok(Math.abs(mid - next) <= 0.04, `adjacent cubes should share density (${mid} vs ${next})`);
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
  assert.ok(seen > 100, `frustum should rush min density after a look-ahead jump (got ${seen})`);
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
  const ratio = nearDens / Math.max(farDens, 1e-6);
  assert.ok(ratio < 2.6, `near/far should stay close (ratio ${ratio.toFixed(2)}, near ${nearDens.toFixed(1)}, far ${farDens.toFixed(1)})`);
  assert.ok(ratio > 0.8, `near should not drop below the far field (ratio ${ratio.toFixed(2)})`);
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
  assert.ok(around > 20, `emitter neighborhood should stay populated (got ${around})`);
}

{
  assert.equal(emitterDensityScale(1), STREAM_EMITTER_DENSITY_MAX);
  assert.equal(emitterDensityScale(4), STREAM_EMITTER_DENSITY_MAX);
  assert.equal(emitterDensityScale(STREAM_EMITTER_CROWD), STREAM_EMITTER_DENSITY_MIN);
  assert.equal(STREAM_EMITTER_DENSITY_MAX, STREAM_EMITTER_DENSITY_MIN);
}

{
  const pose = {
    x: 8,
    y: 8,
    z: 36,
    forward: { x: 0, y: 0, z: -1 },
    fov: 60,
    aspect: 16 / 9,
    billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
  };
  const opts = {
    capacity: 8000,
    initialCount: 2400,
    startCount: 2400,
    chunkSize: 16,
    chunkRadius: 4,
    startRadius: 4,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 1, g: 1, b: 1 }, weight: 1, baseScale: 1 },
    ],
  };
  const settle = (world) => {
    for (let i = 0; i < 48; i++) world.tick(1 / 60, pose);
  };
  const chunkCounts = (pts) => {
    const bins = new Map();
    for (let i = 0; i < pts.count; i++) {
      const x = pts.positions[i * 3];
      const y = pts.positions[i * 3 + 1];
      const z = pts.positions[i * 3 + 2];
      const cx = Math.floor(x / opts.chunkSize);
      const cy = Math.floor(y / opts.chunkSize);
      const cz = Math.floor(z / opts.chunkSize);
      const key = `${cx},${cy},${cz}`;
      let row = bins.get(key);
      if (!row) {
        const h = opts.chunkSize * 0.5;
        row = {
          n: 0,
          dist: Math.hypot(cx * opts.chunkSize + h - pose.x, cy * opts.chunkSize + h - pose.y, cz * opts.chunkSize + h - pose.z),
        };
        bins.set(key, row);
      }
      row.n++;
    }
    return [...bins.values()].filter((row) => row.n > 0);
  };
  const spread = (rows) => {
    let worst = 1;
    for (const row of rows) {
      const band = rows.filter((other) => Math.abs(other.dist - row.dist) <= 12);
      if (band.length < 3) continue;
      const nums = band.map((other) => other.n).sort((a, b) => a - b);
      const mid = nums[nums.length >> 1];
      if (mid > 0) worst = Math.max(worst, row.n / mid);
    }
    return worst;
  };
  const pair = createWorld(opts);
  settle(pair);
  const pairCount = pair.count;
  const pairSpread = spread(chunkCounts(pair.getRenderSpecies('points')));
  assert.equal(stepWavePreset(1), 'ring');
  assert.equal(stepWavePreset(1), 'line');
  assert.equal(stepWavePreset(1), 'tube');
  try {
    const tube = createWorld(opts);
    settle(tube);
    const tubeRows = chunkCounts(tube.getRenderSpecies('points'));
    const tubeSpread = spread(tubeRows);
    const pairRows = chunkCounts(pair.getRenderSpecies('points'));
    const maxOf = (rows) => rows.reduce((m, row) => Math.max(m, row.n), 0);
    const mean = (count, rows) => count / Math.max(1, rows.length);
    assert.ok(
      mean(tube.count, tubeRows) <= mean(pairCount, pairRows) * 1.35,
      `tube keep cubes should stay near field density (pair ${mean(pairCount, pairRows).toFixed(1)}/cube, tube ${mean(tube.count, tubeRows).toFixed(1)}/cube)`,
    );
    assert.ok(
      maxOf(tubeRows) <= maxOf(pairRows) * 1.5,
      `tube cubes should not outrun the densest pair cube (pair ${maxOf(pairRows)}, tube ${maxOf(tubeRows)})`,
    );
    assert.ok(
      tubeSpread < 2.25,
      `tube cubes in the same distance band should stay near uniform (spread ${tubeSpread.toFixed(2)}, pair ${pairSpread.toFixed(2)})`,
    );
  } finally {
    while (wavePresetId() !== 'pair') stepWavePreset(1);
  }
}

console.log('stream.test.js ok');
