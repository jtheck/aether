import assert from 'node:assert/strict';
import {
  chunkSphereHitsFrustum,
  chunkWanted,
  estimateHotChunks,
  lookQuant,
  poseAxes,
} from './chunks.js';
import { KIND_POINT, boxSphereOverlapFraction } from './store.js';
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

console.log('stream.test.js ok');
