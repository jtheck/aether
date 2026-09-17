/** Particle behavior steps — pure SoA math, no engine imports. */

import { nanotubeCorners, nanotubeWaveSources } from './nanotube.js';

/**
 * Wind field with wrap inside a cubic chunk volume.
 * @param {object} store
 * @param {number} dt seconds
 * @param {number} time seconds
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 */
export function behaviorWind(store, dt, time, bounds) {
  const n = store.count;
  const { px, py, pz, vx, vy, vz, life, maxLife, windInfluence } = store;
  const { minX, minY, minZ, size } = bounds;
  const maxX = minX + size;
  const maxY = minY + size;
  const maxZ = minZ + size;

  const windStrength = 0.12;
  const turbulence = 0.04;
  const windDirection = Math.sin(time * 0.2) * 0.3;

  for (let i = 0; i < n; i++) {
    const x = px[i];
    const y = py[i];
    const z = pz[i];
    const infl = windInfluence[i];

    // Height factor relative to chunk (still varies in Y)
    const heightFactor = Math.max(0.5, (y - minY) / size);
    const flowX = Math.sin(x * 0.05 + time * 0.1) * 0.02;
    const flowZ = Math.cos(z * 0.03 + time * 0.15) * 0.01;

    const baseX = (windStrength + windDirection + flowX) * infl * heightFactor;
    const baseY = Math.sin(time * 0.5 + x * 0.05) * turbulence * 0.35;
    const baseZ = (Math.cos(time * 0.3 + z * 0.05) + flowZ) * turbulence;

    const turbX = Math.sin(time * 0.7 + y * 0.2) * turbulence;
    const turbY = Math.cos(time * 0.9 + x * 0.15) * turbulence * 0.35;
    const turbZ = Math.sin(time * 1.1 + z * 0.25) * turbulence;
    const gustX = Math.sin(time * 0.1 + x * 0.05) * 0.02;

    let nvx = (vx[i] + baseX + turbX + gustX) * 0.99;
    let nvy = (vy[i] + baseY + turbY) * 0.99;
    let nvz = (vz[i] + baseZ + turbZ) * 0.99;

    let nx = x + nvx;
    let ny = y + nvy;
    let nz = z + nvz;

    // Toroidal wrap inside this chunk cube
    nx = wrap(nx, minX, maxX, size);
    ny = wrap(ny, minY, maxY, size);
    nz = wrap(nz, minZ, maxZ, size);

    let nl = life[i] + dt * 0.1;
    if (nl > maxLife[i]) {
      nl = 0;
      nx = minX + Math.random() * size;
      ny = minY + Math.random() * size;
      nz = minZ + Math.random() * size;
      nvx = (Math.random() - 0.5) * 0.08;
      nvy = (Math.random() - 0.5) * 0.08;
      nvz = (Math.random() - 0.5) * 0.08;
    }

    px[i] = nx;
    py[i] = ny;
    pz[i] = nz;
    vx[i] = nvx;
    vy[i] = nvy;
    vz[i] = nvz;
    life[i] = nl;
  }
}

function wrap(v, min, max, size) {
  let x = v;
  while (x < min) x += size;
  while (x >= max) x -= size;
  return x;
}

/**
 * @param {object} store
 * @param {object} spatial
 * @param {Int32Array} queryScratch
 */
export function behaviorNeighborStub(store, spatial, queryScratch) {
  void store;
  void spatial;
  void queryScratch;
}

/** Must match bakeCompressionWaveRest — change both together. */
export const COMPRESSION_WAVELENGTH = 10;
export const COMPRESSION_SPEED = 6;
export const COMPRESSION_AMPLITUDE = 1.1;
export const COMPRESSION_K = (Math.PI * 2) / COMPRESSION_WAVELENGTH;

export const WAVE_PRESET_PAIR = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 14, z: 0 },
];

/** Six emitters in the XZ plane, mid-height between the pair. */
export function wavePresetRing() {
  const r = 10;
  const y = 7;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return out;
}

/** All carbon corners (icos). Wave sum uses `WAVE_PRESET_TUBE` only. */
export const WAVE_PRESET_TUBE_CORNERS = nanotubeCorners();
/** Two rings of six — enough to read as a cylinder without starving the field. */
export const WAVE_PRESET_TUBE = nanotubeWaveSources(12);

function slotsFrom(start, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(start + i);
  return out;
}

/** Pair, ring, then the 12-site tube wave. Spawn bakes every slot; toggle only remaps. */
export const WAVE_CATALOG = WAVE_PRESET_PAIR.concat(wavePresetRing(), WAVE_PRESET_TUBE);

/** Point stores pack basis as `i * WAVE_SOURCE_CAP + s`. */
export const WAVE_SOURCE_CAP = WAVE_CATALOG.length;

const WAVE_SLOTS_PAIR = slotsFrom(0, WAVE_PRESET_PAIR.length);
const WAVE_SLOTS_RING = slotsFrom(WAVE_SLOTS_PAIR.length, 6);
const WAVE_SLOTS_TUBE = slotsFrom(WAVE_SLOTS_PAIR.length + WAVE_SLOTS_RING.length, WAVE_PRESET_TUBE.length);

/** Ico-spheres: pair/ring follow sources; tube shows every carbon. */
export const WAVE_BALL_CAP = Math.max(WAVE_SOURCE_CAP, WAVE_PRESET_TUBE_CORNERS.length);

/**
 * Live ico-sphere positions. Same as `WAVE_SOURCES` except on the tube
 * (all corners vs the 12-site wave sum).
 */
export const WAVE_EMITTER_BALLS = WAVE_PRESET_PAIR.map((s) => ({ ...s }));

/**
 * Keep a fat source count from summing to a huge kick.
 * Ring (6) is the reference strength.
 */
export function waveSourceAmplitude(sourceCount, base = COMPRESSION_AMPLITUDE) {
  const n = sourceCount | 0;
  if (n <= 6) return base;
  return base * (6 / n);
}

/** Catalog indices the wave sum uses. Mutate in place — do not rebind. */
const waveActiveSlots = WAVE_SLOTS_PAIR.slice();

/** @type {'pair'|'ring'|'tube'} */
let presetId = 'pair';

/**
 * Live scenery (ico-spheres). Same positions as `waveActiveSlots`.
 * Mutate via `toggleWavePreset` — do not rebind.
 */
export const WAVE_SOURCES = WAVE_PRESET_PAIR.map((s) => ({ ...s }));

export function wavePresetId() {
  return presetId;
}

function setLiveSources(list) {
  WAVE_SOURCES.length = 0;
  for (const s of list) WAVE_SOURCES.push({ x: s.x, y: s.y, z: s.z });
}

function setEmitterBalls(list) {
  WAVE_EMITTER_BALLS.length = 0;
  for (const s of list) WAVE_EMITTER_BALLS.push({ x: s.x, y: s.y, z: s.z });
}

function setSlots(slots) {
  waveActiveSlots.length = 0;
  for (const s of slots) waveActiveSlots.push(s);
}

const PRESET_ORDER = /** @type {const} */ (['pair', 'ring', 'tube']);

function applyWavePreset(id) {
  if (id === 'ring') {
    presetId = 'ring';
    setSlots(WAVE_SLOTS_RING);
    setLiveSources(wavePresetRing());
    setEmitterBalls(wavePresetRing());
  } else if (id === 'tube') {
    presetId = 'tube';
    setSlots(WAVE_SLOTS_TUBE);
    setLiveSources(WAVE_PRESET_TUBE);
    setEmitterBalls(WAVE_PRESET_TUBE_CORNERS);
  } else {
    presetId = 'pair';
    setSlots(WAVE_SLOTS_PAIR);
    setLiveSources(WAVE_PRESET_PAIR);
    setEmitterBalls(WAVE_PRESET_PAIR);
  }
  return presetId;
}

/** Swap which baked slots the write loop sums. No rebake. @returns {'pair'|'ring'|'tube'} */
export function toggleWavePreset() {
  return stepWavePreset(1);
}

/** Left / right cycle. @param {number} dir −1 or +1 */
export function stepWavePreset(dir) {
  const d = dir < 0 ? -1 : 1;
  const i = Math.max(0, PRESET_ORDER.indexOf(presetId));
  return applyWavePreset(PRESET_ORDER[(i + d + PRESET_ORDER.length) % PRESET_ORDER.length]);
}

/**
 * @param {object} store
 * @param {number} i particle index (rest xyz)
 * @param {number} j basis index (`i * S + s`)
 * @param {number} ox
 * @param {number} oy
 * @param {number} oz
 */
function bakeWaveFrom(store, i, j, ox, oy, oz) {
  const dx = store.hx[i] - ox;
  const dy = store.hy[i] - oy;
  const dz = store.hz[i] - oz;
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 < 1e-8) {
    store.wnx[j] = 0;
    store.wny[j] = 0;
    store.wnz[j] = 0;
    store.waveC[j] = 1;
    store.waveS[j] = 0;
    return;
  }
  const r = Math.sqrt(r2);
  const inv = 1 / r;
  store.wnx[j] = dx * inv;
  store.wny[j] = dy * inv;
  store.wnz[j] = dz * inv;
  const kr = COMPRESSION_K * r;
  store.waveC[j] = Math.cos(kr);
  store.waveS[j] = Math.sin(kr);
}

/**
 * Bake radial basis + cos/sin(k·r) at spawn for each wave source.
 * @param {object} store
 * @param {number} i
 */
export function bakeCompressionWaveRest(store, i) {
  const base = i * WAVE_SOURCE_CAP;
  for (let s = 0; s < WAVE_SOURCE_CAP; s++) {
    const src = WAVE_CATALOG[s];
    bakeWaveFrom(store, i, base + s, src.x, src.y, src.z);
  }
}

/**
 * Spin each particle's baked 3×3 about world Y through its own center
 * (orientation only — position unchanged). Slight per-particle rate via windInfluence.
 * @param {object} store
 * @param {number} dt seconds
 * @param {number} [radiansPerSec=1.4]
 */
export function behaviorSpinSelf(store, dt, radiansPerSec = 1.4) {
  const n = store.count | 0;
  if (n <= 0 || !(dt > 0)) return;
  const { ori, windInfluence } = store;
  for (let i = 0; i < n; i++) {
    const a = radiansPerSec * (0.65 + (windInfluence[i] || 0.5) * 0.7) * dt;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const o = i * 9;
    // Left-multiply Ry(a) onto column-major ori
    for (let col = 0; col < 3; col++) {
      const b = o + col * 3;
      const x = ori[b];
      const z = ori[b + 2];
      ori[b] = c * x + s * z;
      ori[b + 2] = -s * x + c * z;
    }
  }
}

/**
 * Slow orbit of rest positions around a cluster center.
 * Primary spin about Y; `tilt` leans the orbit plane (radians).
 * @param {object} store
 * @param {number} time seconds
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} radiansPerSec
 * @param {number} [tilt] orbit-plane tilt (radians)
 */
export function behaviorOrbitCluster(store, time, center, radiansPerSec, tilt = 0) {
  const n = store.count;
  const { px, py, pz, hx, hy, hz } = store;
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const ang = time * radiansPerSec;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  for (let i = 0; i < n; i++) {
    const ox = hx[i] - cx;
    const oy = hy[i] - cy;
    const oz = hz[i] - cz;
    // Spin about Y
    const x1 = ox * cosA - oz * sinA;
    const z1 = ox * sinA + oz * cosA;
    // Lean orbit plane (rotate around X)
    const y2 = oy * cosT - z1 * sinT;
    const z2 = oy * sinT + z1 * cosT;
    px[i] = cx + x1;
    py[i] = cy + y2;
    pz[i] = cz + z2;
  }
}

/**
 * Spherical longitudinal compression waves — write displaced xyz into `dest`.
 * Spawn-baked r̂ and cos/sin(k·r); per frame only shared sin/cos(ωt) + muls.
 *   p = rest + Σ r̂_s * A * sin(k·r_s − ωt)  (sources phase-locked)
 *
 * @param {object} store point store (rest + baked basis)
 * @param {Float32Array} dest interleaved xyz (usually flock staging)
 * @param {number} destOffset particle index in dest (not float index)
 * @param {number} time seconds
 * @param {{ amplitude?: number, speed?: number }} [opts]
 * @returns {number} destOffset + store.count
 */
export function writeCompressionWavePositions(store, dest, destOffset, time, opts = {}) {
  const n = store.count | 0;
  if (n <= 0) return destOffset;
  const slots = waveActiveSlots;
  const S = slots.length;
  const stride = WAVE_SOURCE_CAP;
  const A = opts.amplitude ?? waveSourceAmplitude(S);
  const speed = opts.speed ?? COMPRESSION_SPEED;
  const omega = (speed * Math.PI * 2) / COMPRESSION_WAVELENGTH;
  const wt = omega * time;
  const ct = Math.cos(wt);
  const st = Math.sin(wt);
  const { hx, hy, hz, wnx, wny, wnz, waveC, waveS } = store;
  let o = destOffset | 0;

  for (let i = 0; i < n; i++) {
    let x = hx[i];
    let y = hy[i];
    let z = hz[i];
    const base = i * stride;
    for (let s = 0; s < S; s++) {
      const j = base + slots[s];
      const u = A * (waveS[j] * ct - waveC[j] * st);
      x += wnx[j] * u;
      y += wny[j] * u;
      z += wnz[j] * u;
    }
    const p = o * 3;
    dest[p] = x;
    dest[p + 1] = y;
    dest[p + 2] = z;
    o++;
  }
  return o;
}
