import assert from 'node:assert/strict';
import {
  WAVE_SOURCES,
  WAVE_PRESET_CAP,
  WAVE_COEFF_STRIDE,
  WAVE_EMITTER_BALLS,
  WAVE_PRESET_TUBE,
  WAVE_PRESET_TUBE_CORNERS,
  COMPRESSION_K,
  COMPRESSION_SPEED,
  COMPRESSION_WAVELENGTH,
  COMPRESSION_AMPLITUDE,
  bakeCompressionWaveRest,
  collapseWaveEmitters,
  beginWaveBakeFrame,
  endWaveBakeFrame,
  writeLiveMonopole,
  waveEmitterFocus,
  waveChunkEmitDist2,
  toggleWavePreset,
  stepWavePreset,
  writeCompressionWavePositions,
  sampleCompressionWave,
  sampleCompressionWaveTrace,
  waveSourceAmplitude,
} from './behaviors.js';
import { getNanotubeLattice } from './nanotube.js';
import { createPointStore, createPointStaging, KIND_POINT } from './store.js';
import { createWorld } from './world.js';

assert.equal(WAVE_SOURCES.length, 2, 'origin + upper sphere');
{
  const live = sampleCompressionWave(10, 0, 0, 5 / 12);
  assert.ok(Number.isFinite(live.u));
  assert.ok(Math.abs(live.u) > 1e-6, 'field should be nonzero off a node');
  const t = 2.5;
  const dest = new Float32Array(8);
  sampleCompressionWaveTrace(10, 0, 0, t, dest);
  assert.ok(Math.abs(dest[7] - sampleCompressionWave(10, 0, 0, t).u) < 1e-6);
  assert.ok(Math.abs(dest[0] - dest[7]) < 1e-5, 'one-period window should close');
}

function expectedAt(hx, hy, hz, time) {
  const s = sampleCompressionWave(hx, hy, hz, time);
  return { x: s.x, y: s.y, z: s.z };
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

{
  assert.equal(WAVE_PRESET_CAP, 3);
  assert.equal(WAVE_COEFF_STRIDE, 18);
  assert.equal(WAVE_PRESET_TUBE.length, WAVE_PRESET_TUBE_CORNERS.length);
  assert.equal(WAVE_PRESET_TUBE.length, getNanotubeLattice().vertices.length);
  const store = createPointStore(1);
  store.count = 1;
  store.hx[0] = 10;
  store.hy[0] = 7;
  store.hz[0] = 0;
  bakeCompressionWaveRest(store, 0);
  assert.equal(store.waveK.length, WAVE_COEFF_STRIDE);
  const dest = new Float32Array(3);
  const t = 0.4;

  assert.equal(toggleWavePreset(), 'ring');
  assert.equal(WAVE_SOURCES.length, 6);
  writeCompressionWavePositions(store, dest, 0, t);
  const ring = expectedAt(10, 7, 0, t);
  assert.ok(Math.abs(dest[0] - ring.x) < 1e-5);
  assert.ok(Math.abs(dest[1] - ring.y) < 1e-5);
  assert.ok(Math.abs(dest[2] - ring.z) < 1e-5);

  assert.equal(toggleWavePreset(), 'tube');
  assert.equal(WAVE_SOURCES.length, WAVE_PRESET_TUBE_CORNERS.length);
  assert.equal(WAVE_EMITTER_BALLS.length, getNanotubeLattice().vertices.length);
  writeCompressionWavePositions(store, dest, 0, t);
  const tube = expectedAt(10, 7, 0, t);
  assert.ok(Math.abs(dest[0] - tube.x) < 1e-5);
  assert.ok(Math.abs(dest[1] - tube.y) < 1e-5);
  assert.ok(Math.abs(dest[2] - tube.z) < 1e-5);

  assert.equal(toggleWavePreset(), 'pair');
  assert.equal(WAVE_SOURCES.length, 2);
  assert.equal(stepWavePreset(-1), 'tube');
  assert.equal(stepWavePreset(1), 'pair');
  writeCompressionWavePositions(store, dest, 0, t);
  const pair = expectedAt(10, 7, 0, t);
  assert.ok(Math.abs(dest[0] - pair.x) < 1e-5);
  assert.ok(Math.abs(dest[1] - pair.y) < 1e-5);
  assert.ok(Math.abs(dest[2] - pair.z) < 1e-5);
}

function bruteDisplacement(x, y, z, time, sources) {
  const A = waveSourceAmplitude(sources.length);
  const wt = ((COMPRESSION_SPEED * Math.PI * 2) / COMPRESSION_WAVELENGTH) * time;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let uSum = 0;
  for (const src of sources) {
    const rx = x - src.x;
    const ry = y - src.y;
    const rz = z - src.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-8) continue;
    const r = Math.sqrt(r2);
    const u = A * Math.sin(COMPRESSION_K * r - wt);
    const inv = 1 / r;
    dx += rx * inv * u;
    dy += ry * inv * u;
    dz += rz * inv * u;
    uSum += u;
  }
  return { x: x + dx, y: y + dy, z: z + dz, u: uSum };
}

{
  const sources = WAVE_PRESET_TUBE;
  const t = 5 / 12;
  const A = waveSourceAmplitude(sources.length);
  const c = collapseWaveEmitters(10, 7, 0, sources, A);
  const wt = ((COMPRESSION_SPEED * Math.PI * 2) / COMPRESSION_WAVELENGTH) * t;
  const ct = Math.cos(wt);
  const st = Math.sin(wt);
  const collapsed = {
    x: 10 + c.bx * ct - c.cx * st,
    y: 7 + c.by * ct - c.cy * st,
    z: 0 + c.bz * ct - c.cz * st,
    u: c.uS * ct - c.uC * st,
  };
  const brute = bruteDisplacement(10, 7, 0, t, sources);
  assert.ok(Math.abs(collapsed.x - brute.x) < 1e-9);
  assert.ok(Math.abs(collapsed.y - brute.y) < 1e-9);
  assert.ok(Math.abs(collapsed.z - brute.z) < 1e-9);
  assert.ok(Math.abs(collapsed.u - brute.u) < 1e-9);
  const sampled = sampleCompressionWave(10, 7, 0, t, { sources });
  assert.ok(Math.abs(sampled.u - brute.u) < 1e-9);
}

{
  const store = createPointStore(1);
  store.count = 1;
  store.hx[0] = 10;
  store.hy[0] = 7;
  store.hz[0] = 0;
  store.waveMask[0] = 0;
  const dest = new Float32Array(3);
  beginWaveBakeFrame(0);
  writeCompressionWavePositions(store, dest, 0, 0.4);
  endWaveBakeFrame();
  const stand = new Float32Array(3);
  const wt = ((COMPRESSION_SPEED * Math.PI * 2) / COMPRESSION_WAVELENGTH) * 0.4;
  writeLiveMonopole(10, 7, 0, stand, 0, waveEmitterFocus(), COMPRESSION_AMPLITUDE, Math.cos(wt), Math.sin(wt));
  assert.ok(Math.abs(dest[0] - stand[0]) < 1e-6);
  assert.ok(Math.abs(dest[1] - stand[1]) < 1e-6);
  assert.ok(Math.abs(dest[2] - stand[2]) < 1e-6);
  assert.ok(dest[0] !== 10 || dest[1] !== 7 || dest[2] !== 0, 'unbaked should still move');
  assert.equal(store.waveMask[0], 0);

  assert.equal(waveChunkEmitDist2({ minX: -1, minY: -1, minZ: -1, size: 2 }), 0);

  writeCompressionWavePositions(store, dest, 0, 0.4);
  const live = expectedAt(10, 7, 0, 0.4);
  assert.ok(Math.abs(dest[0] - live.x) < 1e-5);
  assert.ok(Math.abs(dest[1] - live.y) < 1e-5);
  assert.ok(Math.abs(dest[2] - live.z) < 1e-5);
  assert.ok(store.waveMask[0] !== 0);
}

console.log('wavePack.test.js ok');
