import assert from 'node:assert/strict';
import {
  CARBON_CC,
  NANOTUBE_BOND,
  NANOTUBE_N,
  NANOTUBE_M,
  NANOTUBE_SCALE,
  buildNanotubeLattice,
  getNanotubeLattice,
  nanotubeCorners,
  nanotubeRadius,
  nanotubeWaveSources,
} from './nanotube.js';

const R = nanotubeRadius();
const expectR = (Math.sqrt(3) * CARBON_CC * Math.sqrt(NANOTUBE_N * NANOTUBE_N + NANOTUBE_N * NANOTUBE_M + NANOTUBE_M * NANOTUBE_M)) / (Math.PI * 2);
assert.ok(Math.abs(R - expectR) < 1e-9);
assert.ok(R > 3.7 && R < 3.8, `radius ${R}`);

const lat = buildNanotubeLattice();
assert.equal(lat.n, 6);
assert.equal(lat.m, 5);
assert.ok(Math.abs(lat.scale - NANOTUBE_SCALE) < 1e-12);
assert.ok(Math.abs(lat.radius - R * NANOTUBE_SCALE) < 1e-6);
assert.ok(lat.vertices.length > 60, `verts ${lat.vertices.length}`);
assert.ok(lat.edges.length > 80, `edges ${lat.edges.length}`);
assert.equal(lat.positions.length, lat.edges.length * 6);

let maxRadial = 0;
for (const v of lat.vertices) {
  const r = Math.sqrt(v.x * v.x + v.z * v.z);
  maxRadial = Math.max(maxRadial, Math.abs(r - lat.radius));
  assert.ok(v.y >= -0.2 && v.y <= lat.y1 + 0.2, `y ${v.y}`);
}
assert.ok(maxRadial < 0.05 * NANOTUBE_SCALE, `radial drift ${maxRadial}`);

let bondMin = Infinity;
let bondMax = 0;
for (const [i, j] of lat.edges) {
  const a = lat.vertices[i];
  const b = lat.vertices[j];
  const len = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  bondMin = Math.min(bondMin, len);
  bondMax = Math.max(bondMax, len);
}
assert.ok(bondMin > NANOTUBE_BOND * 0.72, `short bond ${bondMin}`);
assert.ok(bondMax < NANOTUBE_BOND * 1.28, `long bond ${bondMax}`);
assert.ok(Math.abs((bondMin + bondMax) * 0.5 - NANOTUBE_BOND) < 2, `bond mid ${(bondMin + bondMax) * 0.5}`);

const corners = nanotubeCorners();
assert.equal(corners.length, lat.vertices.length);
assert.equal(getNanotubeLattice().vertices.length, lat.vertices.length);
for (let i = 0; i < corners.length; i++) {
  assert.equal(corners[i].x, lat.vertices[i].x);
  assert.equal(corners[i].y, lat.vertices[i].y);
  assert.equal(corners[i].z, lat.vertices[i].z);
}

const src = nanotubeWaveSources(12);
assert.equal(src.length, 12);
for (const s of src) {
  const r = Math.hypot(s.x, s.z);
  assert.ok(Math.abs(r - lat.radius) < 0.08 * lat.scale, `source r ${r}`);
}

console.log('nanotube.test.js ok');
