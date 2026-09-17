/** Particle behavior steps — pure SoA math, no engine imports. */

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

/**
 * Scenery ico-spheres that emit compression waves (keep in sync with render backends).
 * Push another `{x,y,z}` to superpose — linear in S, bake at spawn.
 * Point stores pack basis as `i * WAVE_SOURCES.length + s`.
 */
export const WAVE_SOURCES = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 14, z: 0 },
];

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
  const S = WAVE_SOURCES.length;
  const base = i * S;
  for (let s = 0; s < S; s++) {
    const src = WAVE_SOURCES[s];
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
  const S = WAVE_SOURCES.length;
  const A = opts.amplitude ?? COMPRESSION_AMPLITUDE;
  const speed = opts.speed ?? COMPRESSION_SPEED;
  const omega = (speed * Math.PI * 2) / COMPRESSION_WAVELENGTH;
  const wt = omega * time;
  const ct = Math.cos(wt);
  const st = Math.sin(wt);
  const { hx, hy, hz, wnx, wny, wnz, waveC, waveS } = store;
  let o = destOffset | 0;

  if (S === 1) {
    for (let i = 0; i < n; i++) {
      const u = A * (waveS[i] * ct - waveC[i] * st);
      const p = o * 3;
      dest[p] = hx[i] + wnx[i] * u;
      dest[p + 1] = hy[i] + wny[i] * u;
      dest[p + 2] = hz[i] + wnz[i] * u;
      o++;
    }
    return o;
  }

  for (let i = 0; i < n; i++) {
    let x = hx[i];
    let y = hy[i];
    let z = hz[i];
    const base = i * S;
    for (let s = 0; s < S; s++) {
      const j = base + s;
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
