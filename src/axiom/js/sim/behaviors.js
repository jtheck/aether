/** Particle behavior steps — pure SoA math, no engine imports. */

import { nanotubeCorners } from './nanotube.js';

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

export const WAVE_PRESET_RING = wavePresetRing();
/** Every carbon is a wave source. Collapse at bake keeps the per-frame sum O(1). */
export const WAVE_PRESET_TUBE_CORNERS = nanotubeCorners();
export const WAVE_PRESET_TUBE = WAVE_PRESET_TUBE_CORNERS;

/** Pair, ring, tube — spawn collapses each; toggle only picks a baked bank. */
export const WAVE_PRESETS = [WAVE_PRESET_PAIR, WAVE_PRESET_RING, WAVE_PRESET_TUBE];
export const WAVE_PRESET_CAP = WAVE_PRESETS.length;
/** Interleaved [Bx,By,Bz,Cx,Cy,Cz] per preset per particle. */
export const WAVE_COEFF_STRIDE = WAVE_PRESET_CAP * 6;

/** Ico-spheres: pair/ring follow sources; tube shows every carbon. */
export const WAVE_BALL_CAP = WAVE_PRESET_TUBE_CORNERS.length;

/**
 * Live ico-sphere positions. Same as `WAVE_SOURCES` (tube = all carbons).
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

const WAVE_PRESET_AMP = WAVE_PRESETS.map((s) => waveSourceAmplitude(s.length));

function packPresetXyz(sources) {
  const xyz = new Float32Array(sources.length * 3);
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    xyz[i * 3] = s.x;
    xyz[i * 3 + 1] = s.y;
    xyz[i * 3 + 2] = s.z;
  }
  return xyz;
}

const WAVE_PRESET_XYZ = WAVE_PRESETS.map(packPresetXyz);

function centroidOf(sources) {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = sources.length || 1;
  for (let i = 0; i < sources.length; i++) {
    x += sources[i].x;
    y += sources[i].y;
    z += sources[i].z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

const WAVE_PRESET_CENTROIDS = WAVE_PRESETS.map(centroidOf);

/** Live-preset emitter centroid (tube ≈ axis mid). */
export function waveEmitterFocus() {
  return WAVE_PRESET_CENTROIDS[presetIndex];
}

/** Min distance² from an AABB to any live emitter — 0 if a source sits inside. */
export function waveChunkEmitDist2(bounds) {
  const { minX, minY, minZ, size } = bounds;
  const maxX = minX + size;
  const maxY = minY + size;
  const maxZ = minZ + size;
  const xyz = WAVE_PRESET_XYZ[presetIndex];
  let best = Infinity;
  const n = xyz.length / 3;
  for (let s = 0; s < n; s++) {
    const i = s * 3;
    const sx = xyz[i];
    const sy = xyz[i + 1];
    const sz = xyz[i + 2];
    const dx = sx < minX ? minX - sx : sx > maxX ? sx - maxX : 0;
    const dy = sy < minY ? minY - sy : sy > maxY ? sy - maxY : 0;
    const dz = sz < minZ ? minZ - sz : sz > maxZ ? sz - maxZ : 0;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

/** ~5 ms of collapse — pair/ring are cheap, tube is not. */
export function waveBakeParticleBudget() {
  const s = WAVE_PRESETS[presetIndex].length;
  if (s <= 6) return 10000;
  return Math.max(400, Math.floor(4500 / 5.2));
}

let waveBakeBudgeted = false;
let waveBakeLeft = 0;

/** Cap how many dirty banks the next write may collapse. Omit to bake all. */
export function beginWaveBakeFrame(n) {
  waveBakeBudgeted = true;
  waveBakeLeft = n == null ? Infinity : Math.max(0, n);
}

export function endWaveBakeFrame() {
  waveBakeBudgeted = false;
  waveBakeLeft = 0;
}

export function waveBakeLeftCount() {
  return waveBakeBudgeted ? waveBakeLeft : Infinity;
}

/**
 * Collapse one live bank if the frame still has room.
 * @returns {boolean}
 */
export function tryBakeWaveBank(store, i, p = presetIndex) {
  if (waveBakeBudgeted && waveBakeLeft <= 0) return false;
  bakeWaveBank(store, i, p);
  if (waveBakeBudgeted && waveBakeLeft !== Infinity) waveBakeLeft--;
  return true;
}

/** Drain leftover budget on dirty slots, nearest-emitter chunks first. */
export function bakeDirtyWaveStore(store, p = presetIndex) {
  const mask = store.waveMask;
  if (!mask) return 0;
  const bit = 1 << p;
  const n = store.count | 0;
  let baked = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] & bit) continue;
    if (!tryBakeWaveBank(store, i, p)) break;
    baked++;
  }
  return baked;
}

/** @type {'pair'|'ring'|'tube'} */
let presetId = 'pair';
let presetIndex = 0;

/**
 * Live wave sources (and ico-spheres). Mutate via `toggleWavePreset` — do not rebind.
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

const PRESET_ORDER = /** @type {const} */ (['pair', 'ring', 'tube']);

function applyWavePreset(id) {
  if (id === 'ring') {
    presetId = 'ring';
    presetIndex = 1;
    setLiveSources(WAVE_PRESET_RING);
    setEmitterBalls(WAVE_PRESET_RING);
  } else if (id === 'tube') {
    presetId = 'tube';
    presetIndex = 2;
    setLiveSources(WAVE_PRESET_TUBE);
    setEmitterBalls(WAVE_PRESET_TUBE_CORNERS);
  } else {
    presetId = 'pair';
    presetIndex = 0;
    setLiveSources(WAVE_PRESET_PAIR);
    setEmitterBalls(WAVE_PRESET_PAIR);
  }
  return presetId;
}

/** Swap which baked bank the write loop uses. No rebake. @returns {'pair'|'ring'|'tube'} */
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
 * Phase-locked spherical sources are linear in (cos ωt, sin ωt):
 *   r̂ sin(kr − ωt) = r̂ sin(kr) cos(ωt) − r̂ cos(kr) sin(ωt)
 * Any emitter set collapses to two vectors (B, C) plus scalar (uS, uC).
 * Exact — not an LOD. Displacement = B cos(ωt) − C sin(ωt).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number, z: number }[]} sources
 * @param {number} A
 * @param {{ bx: number, by: number, bz: number, cx: number, cy: number, cz: number, uS: number, uC: number }} [out]
 */
export function collapseWaveEmitters(x, y, z, sources, A, out) {
  let bx = 0;
  let by = 0;
  let bz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let uS = 0;
  let uC = 0;
  const n = sources.length;
  for (let s = 0; s < n; s++) {
    const src = sources[s];
    const rx = x - src.x;
    const ry = y - src.y;
    const rz = z - src.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-8) continue;
    const r = Math.sqrt(r2);
    const inv = 1 / r;
    const kr = COMPRESSION_K * r;
    const as = A * Math.sin(kr);
    const ac = A * Math.cos(kr);
    const nx = rx * inv;
    const ny = ry * inv;
    const nz = rz * inv;
    bx += nx * as;
    by += ny * as;
    bz += nz * as;
    cx += nx * ac;
    cy += ny * ac;
    cz += nz * ac;
    uS += as;
    uC += ac;
  }
  if (!out) return { bx, by, bz, cx, cy, cz, uS, uC };
  out.bx = bx;
  out.by = by;
  out.bz = bz;
  out.cx = cx;
  out.cy = cy;
  out.cz = cz;
  out.uS = uS;
  out.uC = uC;
  return out;
}

const _collapse = { bx: 0, by: 0, bz: 0, cx: 0, cy: 0, cz: 0, uS: 0, uC: 0 };

/**
 * Packed xyz sibling of `collapseWaveEmitters` — same sum, fewer object hits.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Float32Array} xyz
 * @param {number} A
 * @param {{ bx: number, by: number, bz: number, cx: number, cy: number, cz: number }} out
 */
function collapseWaveEmittersXyz(x, y, z, xyz, A, out) {
  let bx = 0;
  let by = 0;
  let bz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = xyz.length / 3;
  for (let s = 0; s < n; s++) {
    const i = s * 3;
    const rx = x - xyz[i];
    const ry = y - xyz[i + 1];
    const rz = z - xyz[i + 2];
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-8) continue;
    const r = Math.sqrt(r2);
    const inv = 1 / r;
    const kr = COMPRESSION_K * r;
    const as = A * Math.sin(kr);
    const ac = A * Math.cos(kr);
    bx += rx * inv * as;
    by += ry * inv * as;
    bz += rz * inv * as;
    cx += rx * inv * ac;
    cy += ry * inv * ac;
    cz += rz * inv * ac;
  }
  out.bx = bx;
  out.by = by;
  out.bz = bz;
  out.cx = cx;
  out.cy = cy;
  out.cz = cz;
  return out;
}

function markWaveBank(store, i, p) {
  if (store.waveMask) store.waveMask[i] |= 1 << p;
}

/**
 * Collapse one preset bank at rest.
 * @param {object} store
 * @param {number} i
 * @param {number} [p] preset index (default: live)
 */
export function bakeWaveBank(store, i, p = presetIndex) {
  const c = collapseWaveEmittersXyz(
    store.hx[i],
    store.hy[i],
    store.hz[i],
    WAVE_PRESET_XYZ[p],
    WAVE_PRESET_AMP[p],
    _collapse,
  );
  const o = i * WAVE_COEFF_STRIDE + p * 6;
  const k = store.waveK;
  k[o] = c.bx;
  k[o + 1] = c.by;
  k[o + 2] = c.bz;
  k[o + 3] = c.cx;
  k[o + 4] = c.cy;
  k[o + 5] = c.cz;
  markWaveBank(store, i, p);
}

/**
 * Collapse every preset at rest (tests / forced rebake).
 * @param {object} store
 * @param {number} i
 */
export function bakeCompressionWaveRest(store, i) {
  for (let p = 0; p < WAVE_PRESET_CAP; p++) bakeWaveBank(store, i, p);
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
 * Emitters are collapsed at bake to B,C; per frame only shared sin/cos(ωt).
 *   p = rest + B cos(ωt) − C sin(ωt)
 *     = rest + Σ r̂_s * A * sin(k·r_s − ωt)  (sources phase-locked)
 *
 * @param {object} store point store (rest + baked B,C)
 * @param {Float32Array} dest interleaved xyz (usually flock staging)
 * @param {number} destOffset particle index in dest (not float index)
 * @param {number} time seconds
 * @param {{ amplitude?: number, speed?: number }} [opts]
 * @returns {number} destOffset + store.count
 */
export function writeCompressionWavePositions(store, dest, destOffset, time, opts = {}) {
  const n = store.count | 0;
  if (n <= 0) return destOffset;
  const bakedA = WAVE_PRESET_AMP[presetIndex];
  const gain = opts.amplitude != null && bakedA ? opts.amplitude / bakedA : 1;
  const speed = opts.speed ?? COMPRESSION_SPEED;
  const omega = (speed * Math.PI * 2) / COMPRESSION_WAVELENGTH;
  const wt = omega * time;
  const ct = Math.cos(wt) * gain;
  const st = Math.sin(wt) * gain;
  const { hx, hy, hz, waveK, waveMask } = store;
  const stride = WAVE_COEFF_STRIDE;
  const pref = presetIndex * 6;
  const bit = 1 << presetIndex;
  const focus = WAVE_PRESET_CENTROIDS[presetIndex];
  const standA = COMPRESSION_AMPLITUDE;
  const ct0 = Math.cos(wt);
  const st0 = Math.sin(wt);
  let o = destOffset | 0;

  for (let i = 0; i < n; i++) {
    if (waveMask && !(waveMask[i] & bit)) {
      if (!waveBakeBudgeted) {
        bakeWaveBank(store, i, presetIndex);
      } else {
        const p = o * 3;
        writeLiveMonopole(hx[i], hy[i], hz[i], dest, p, focus, standA, ct0, st0);
        o++;
        continue;
      }
    }
    const k = i * stride + pref;
    const p = o * 3;
    dest[p] = hx[i] + waveK[k] * ct - waveK[k + 3] * st;
    dest[p + 1] = hy[i] + waveK[k + 1] * ct - waveK[k + 4] * st;
    dest[p + 2] = hz[i] + waveK[k + 2] * ct - waveK[k + 5] * st;
    o++;
  }
  return o;
}

/**
 * One monopole at the emitter centroid — cheap live motion until the exact bank bakes.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Float32Array} dest
 * @param {number} p
 * @param {{ x: number, y: number, z: number }} origin
 * @param {number} A
 * @param {number} ct cos(ωt)
 * @param {number} st sin(ωt)
 */
export function writeLiveMonopole(x, y, z, dest, p, origin, A, ct, st) {
  const rx = x - origin.x;
  const ry = y - origin.y;
  const rz = z - origin.z;
  const r2 = rx * rx + ry * ry + rz * rz;
  if (r2 < 1e-8) {
    dest[p] = x;
    dest[p + 1] = y;
    dest[p + 2] = z;
    return;
  }
  const r = Math.sqrt(r2);
  const u = A * (Math.sin(COMPRESSION_K * r) * ct - Math.cos(COMPRESSION_K * r) * st);
  const inv = 1 / r;
  dest[p] = x + rx * inv * u;
  dest[p + 1] = y + ry * inv * u;
  dest[p + 2] = z + rz * inv * u;
}

/**
 * Live field at any point — same sum the dots bake at rest.
 * `u` is the scalar sine sum; `dx,dy,dz` is the radial displacement.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} time seconds
 * @param {{ amplitude?: number, speed?: number, sources?: { x: number, y: number, z: number }[] }} [opts]
 */
export function sampleCompressionWave(x, y, z, time, opts = {}) {
  const sources = opts.sources ?? WAVE_SOURCES;
  const A = opts.amplitude ?? waveSourceAmplitude(sources.length);
  const speed = opts.speed ?? COMPRESSION_SPEED;
  const wt = ((speed * Math.PI * 2) / COMPRESSION_WAVELENGTH) * time;
  const c = collapseWaveEmitters(x, y, z, sources, A);
  const ct = Math.cos(wt);
  const st = Math.sin(wt);
  const dx = c.bx * ct - c.cx * st;
  const dy = c.by * ct - c.cy * st;
  const dz = c.bz * ct - c.cz * st;
  return { x: x + dx, y: y + dy, z: z + dz, dx, dy, dz, u: c.uS * ct - c.uC * st };
}

/**
 * Instant scope at a fixed point: `dest[i] = u(x,y,z, t)` over one period ending at `time`.
 * Position is frozen — moving the probe replaces the whole curve, no travel smear.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} time seconds (rightmost sample)
 * @param {Float32Array|number[]} dest
 * @param {{ amplitude?: number, speed?: number, sources?: { x: number, y: number, z: number }[], window?: number }} [opts]
 */
export function sampleCompressionWaveTrace(x, y, z, time, dest, opts = {}) {
  const n = dest?.length | 0;
  if (n <= 0) return dest;
  const sources = opts.sources ?? WAVE_SOURCES;
  const A = opts.amplitude ?? waveSourceAmplitude(sources.length);
  const speed = opts.speed ?? COMPRESSION_SPEED;
  const omega = (speed * Math.PI * 2) / COMPRESSION_WAVELENGTH;
  const window = opts.window ?? COMPRESSION_WAVELENGTH / speed;
  const c = collapseWaveEmitters(x, y, z, sources, A);
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const ti = time - window * (1 - i / denom);
    const wt = omega * ti;
    dest[i] = c.uS * Math.cos(wt) - c.uC * Math.sin(wt);
  }
  return dest;
}
