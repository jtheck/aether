import assert from 'node:assert/strict';
import {
  COMPRESSION_AMPLITUDE,
  COMPRESSION_K,
  COMPRESSION_SPEED,
  COMPRESSION_WAVELENGTH,
  WAVE_SOURCES,
  bakeCompressionWaveRest,
  writeCompressionWavePositions,
} from './behaviors.js';
import { createPointStore, createPointStaging, KIND_POINT } from './store.js';
import { createWorld } from './world.js';

assert.equal(WAVE_SOURCES.length, 2, 'origin + upper sphere');

function expectedAt(hx, hy, hz, time) {
  const omega = (COMPRESSION_SPEED * Math.PI * 2) / COMPRESSION_WAVELENGTH;
  const wt = omega * time;
  let x = hx;
  let y = hy;
  let z = hz;
  for (const src of WAVE_SOURCES) {
    const dx = hx - src.x;
    const dy = hy - src.y;
    const dz = hz - src.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 < 1e-8) continue;
    const r = Math.sqrt(r2);
    const u = COMPRESSION_AMPLITUDE * Math.sin(COMPRESSION_K * r - wt);
    const inv = 1 / r;
    x += dx * inv * u;
    y += dy * inv * u;
    z += dz * inv * u;
  }
  return { x, y, z };
}

{
  const store = createPointStore(4);
  store.count = 2;
  store.hx[0] = 10;
  store.hy[0] = 0;
  store.hz[0] = 0;
  bakeCompressionWaveRest(store, 0);
  store.hx[1] = 0;
  store.hy[1] = 4;
  store.hz[1] = 3;
  bakeCompressionWaveRest(store, 1);

  const dest = new Float32Array(8 * 3);
  const t = 5 / 12;
  const next = writeCompressionWavePositions(store, dest, 1, t);
  assert.equal(next, 3);

  const a = expectedAt(10, 0, 0, t);
  const b = expectedAt(0, 4, 3, t);
  assert.ok(Math.abs(dest[3] - a.x) < 1e-5);
  assert.ok(Math.abs(dest[4] - a.y) < 1e-5);
  assert.ok(Math.abs(dest[5] - a.z) < 1e-5);
  assert.ok(Math.abs(dest[6] - b.x) < 1e-5);
  assert.ok(Math.abs(dest[7] - b.y) < 1e-5);
  assert.ok(Math.abs(dest[8] - b.z) < 1e-5);
}

{
  const atSource = createPointStore(1);
  atSource.count = 1;
  atSource.hx[0] = WAVE_SOURCES[0].x;
  atSource.hy[0] = WAVE_SOURCES[0].y;
  atSource.hz[0] = WAVE_SOURCES[0].z;
  bakeCompressionWaveRest(atSource, 0);
  const dest = new Float32Array(3);
  writeCompressionWavePositions(atSource, dest, 0, 1.25);
  const origin = expectedAt(
    WAVE_SOURCES[0].x,
    WAVE_SOURCES[0].y,
    WAVE_SOURCES[0].z,
    1.25,
  );
  assert.ok(Number.isFinite(dest[0]) && Number.isFinite(dest[1]) && Number.isFinite(dest[2]));
  assert.ok(Math.abs(dest[0] - origin.x) < 1e-5);
  assert.ok(Math.abs(dest[1] - origin.y) < 1e-5);
  assert.ok(Math.abs(dest[2] - origin.z) < 1e-5);
}

{
  const staging = createPointStaging(8);
  assert.equal(staging.positions.length, 24);
  assert.equal(staging.matrices, undefined);
}

{
  const world = createWorld({
    capacity: 400,
    initialCount: 120,
    startCount: 120,
    chunkSize: 16,
    chunkRadius: 1,
    startRadius: 1,
    flockDefs: [
      { id: 'points', meshKind: KIND_POINT, tint: { r: 0.35, g: 0.95, b: 1 }, weight: 1, baseScale: 1 },
    ],
  });
  world.tick(1 / 60, { x: 0, y: 4, z: 0 });
  const pts = world.getRenderSpecies('points');
  assert.equal(pts.meshKind, KIND_POINT);
  assert.ok(pts.count > 0);
  assert.equal(pts.matrices, undefined);
  for (let i = 0; i < pts.count * 3; i++) {
    assert.ok(Number.isFinite(pts.positions[i]), `positions[${i}]`);
  }
  const before = pts.positions.slice(0, 3);
  world.tick(1 / 60, { x: 0, y: 4, z: 0 });
  const moved =
    pts.positions[0] !== before[0] ||
    pts.positions[1] !== before[1] ||
    pts.positions[2] !== before[2];
  assert.ok(moved, 'wave should displace staging xyz');
}

console.log('wavePack.test.js ok');
