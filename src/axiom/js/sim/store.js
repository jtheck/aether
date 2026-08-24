/** Engine-agnostic SoA particle store. No Babylon imports. */

import { bakeCompressionWaveRest } from './behaviors.js';

export const KIND_POINT = 'point';
export const KIND_TRIANGLE = 'triangle';
export const KIND_PLANE = 'plane';
export const KIND_TETRA = 'tetra';

/**
 * @param {number} capacity
 */
export function createStore(capacity) {
  const cap = Math.max(1, capacity | 0);
  return {
    capacity: cap,
    count: 0,
    px: new Float32Array(cap),
    py: new Float32Array(cap),
    pz: new Float32Array(cap),
    /** Rest / home position (compression wave etc. displaces from here). */
    hx: new Float32Array(cap),
    hy: new Float32Array(cap),
    hz: new Float32Array(cap),
    /** Baked radial unit dir + cos/sin(k·r) for wave at origin sphere. */
    wnx: new Float32Array(cap),
    wny: new Float32Array(cap),
    wnz: new Float32Array(cap),
    waveC: new Float32Array(cap),
    waveS: new Float32Array(cap),
    /** Same bake for upper sphere wave (y=14). */
    w2nx: new Float32Array(cap),
    w2ny: new Float32Array(cap),
    w2nz: new Float32Array(cap),
    wave2C: new Float32Array(cap),
    wave2S: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    vz: new Float32Array(cap),
    life: new Float32Array(cap),
    maxLife: new Float32Array(cap),
    size: new Float32Array(cap),
    windInfluence: new Float32Array(cap),
    /** Baked roll cos/sin (billboards) — no per-frame trig. */
    spinC: new Float32Array(cap),
    spinS: new Float32Array(cap),
    /** Baked 3×3 local rotation, column-major (non-billboard meshes). */
    ori: new Float32Array(cap * 9),
    /** Preallocated render matrices: 16 floats per particle (column-major). */
    matrices: new Float32Array(cap * 16),
    /** RGBA colors for thin-instance / point color. */
    colors: new Float32Array(cap * 4),
    /** xyz positions for point-cloud upload (3 * capacity). */
    positions: new Float32Array(cap * 3),
  };
}

/** Uniform-ish random rotation → column-major 3×3 at ori[i*9]. */
function bakeRandomOrientation(store, i) {
  const roll = Math.random() * Math.PI * 2;
  store.spinC[i] = Math.cos(roll);
  store.spinS[i] = Math.sin(roll);

  // Random euler → 3×3 (yaw / pitch / roll). Trig only at spawn.
  const yaw = Math.random() * Math.PI * 2;
  const pitch = Math.random() * Math.PI * 2;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = store.spinC[i];
  const sr = store.spinS[i];
  const o = i * 9;
  const { ori } = store;
  // R = Rz(yaw) * Ry(pitch) * Rx(roll), column-major
  ori[o] = cy * cp;
  ori[o + 1] = sy * cp;
  ori[o + 2] = -sp;
  ori[o + 3] = cy * sp * sr - sy * cr;
  ori[o + 4] = sy * sp * sr + cy * cr;
  ori[o + 5] = cp * sr;
  ori[o + 6] = cy * sp * cr + sy * sr;
  ori[o + 7] = sy * sp * cr - cy * sr;
  ori[o + 8] = cp * cr;
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 */
export function setCount(store, count) {
  store.count = Math.max(0, Math.min(store.capacity, count | 0));
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 */
export function spawnWindParticles(store, count) {
  const n = Math.min(store.capacity, count | 0);
  store.count = n;
  for (let i = 0; i < n; i++) initParticle(store, i);
}

/**
 * Even-ish fill of a cubic volume (uniform random in AABB).
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 */
export function spawnInBox(store, count, bounds) {
  const n = Math.min(store.capacity, count | 0);
  store.count = n;
  for (let i = 0; i < n; i++) initParticleInBox(store, i, bounds);
}

/**
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {{ x: number, y: number, z: number, r: number }} sphere
 */
function closestAabbPointToSphere(bounds, sphere) {
  const maxX = bounds.minX + bounds.size;
  const maxY = bounds.minY + bounds.size;
  const maxZ = bounds.minZ + bounds.size;
  return {
    x: Math.min(maxX, Math.max(bounds.minX, sphere.x)),
    y: Math.min(maxY, Math.max(bounds.minY, sphere.y)),
    z: Math.min(maxZ, Math.max(bounds.minZ, sphere.z)),
  };
}

function inSphere(x, y, z, sphere) {
  const dx = x - sphere.x;
  const dy = y - sphere.y;
  const dz = z - sphere.z;
  return dx * dx + dy * dy + dz * dz <= sphere.r * sphere.r;
}

/**
 * Approximate volume fraction of `bounds` that lies inside `sphere` (0..1).
 * Used so grazing chunks don't pack a full quota into a thin spherical cap.
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {{ x: number, y: number, z: number, r: number }} sphere
 * @param {number} [samples]
 */
export function boxSphereOverlapFraction(bounds, sphere, samples = 40) {
  const { minX, minY, minZ, size } = bounds;
  const r2 = sphere.r * sphere.r;
  let cornersIn = 0;
  for (let i = 0; i < 8; i++) {
    const x = minX + (i & 1) * size;
    const y = minY + ((i >> 1) & 1) * size;
    const z = minZ + ((i >> 2) & 1) * size;
    const dx = x - sphere.x;
    const dy = y - sphere.y;
    const dz = z - sphere.z;
    if (dx * dx + dy * dy + dz * dz <= r2) cornersIn++;
  }
  if (cornersIn === 8) return 1;
  const near = closestAabbPointToSphere(bounds, sphere);
  if (!inSphere(near.x, near.y, near.z, sphere)) return 0;
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    if (
      inSphere(
        minX + Math.random() * size,
        minY + Math.random() * size,
        minZ + Math.random() * size,
        sphere,
      )
    ) {
      hit++;
    }
  }
  return hit / samples;
}

/**
 * Uniform fill of AABB ∩ sphere. `count` should already be scaled by overlap.
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {{ x: number, y: number, z: number, r: number }} sphere
 */
export function spawnInBoxSphere(store, count, bounds, sphere) {
  const n = Math.min(store.capacity, count | 0);
  if (n <= 0) {
    store.count = 0;
    return;
  }
  const { minX, minY, minZ, size } = bounds;
  let i = 0;
  const maxTries = Math.max(n * 24, 24);
  for (let tries = 0; tries < maxTries && i < n; tries++) {
    const x = minX + Math.random() * size;
    const y = minY + Math.random() * size;
    const z = minZ + Math.random() * size;
    if (!inSphere(x, y, z, sphere)) continue;
    initParticleAt(store, i, x, y, z);
    i++;
  }
  store.count = i;
}

/**
 * Grow/shrink in AABB ∩ sphere. Existing in-sphere slots are kept.
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {{ x: number, y: number, z: number, r: number }} sphere
 */
export function resizeInBoxSphere(store, count, bounds, sphere) {
  const want = Math.max(0, Math.min(store.capacity, count | 0));
  if (want <= store.count) {
    store.count = want;
    return;
  }
  const { minX, minY, minZ, size } = bounds;
  let i = store.count;
  const maxTries = Math.max((want - i) * 24, 24);
  for (let tries = 0; tries < maxTries && i < want; tries++) {
    const x = minX + Math.random() * size;
    const y = minY + Math.random() * size;
    const z = minZ + Math.random() * size;
    if (!inSphere(x, y, z, sphere)) continue;
    initParticleAt(store, i, x, y, z);
    i++;
  }
  store.count = i;
}

/**
 * Random cluster center inside a box (inset by spread so the ball fits).
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {number} [spread]
 * @returns {{ x: number, y: number, z: number }}
 */
export function randomClusterCenter(bounds, spread = 0.4) {
  const { minX, minY, minZ, size } = bounds;
  const margin = Math.min(size * 0.45, Math.max(spread * 2, 0.5));
  const span = Math.max(0.01, size - 2 * margin);
  return {
    x: minX + margin + Math.random() * span,
    y: minY + margin + Math.random() * span,
    z: minZ + margin + Math.random() * span,
  };
}

/**
 * Tight cluster of particles around a center (or a new random one in the box).
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 * @param {{ spread?: number, center?: { x: number, y: number, z: number } }} [opts]
 */
export function spawnClusterInBox(store, count, bounds, opts = {}) {
  const n = Math.min(store.capacity, count | 0);
  store.count = n;
  if (n <= 0) return;
  const spread = opts.spread ?? 0.4;
  const center = opts.center ?? randomClusterCenter(bounds, spread);
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  for (let i = 0; i < n; i++) {
    // Uniform in a ball (reject outside)
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let tries = 0; tries < 8; tries++) {
      dx = (Math.random() * 2 - 1) * spread;
      dy = (Math.random() * 2 - 1) * spread;
      dz = (Math.random() * 2 - 1) * spread;
      if (dx * dx + dy * dy + dz * dz <= spread * spread) break;
    }
    initParticleAt(store, i, cx + dx, cy + dy, cz + dz);
  }
}

/**
 * Grow or shrink live count in place (no reshuffle of existing slots).
 * @param {ReturnType<typeof createStore>} store
 * @param {number} count
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 */
export function resizeInBox(store, count, bounds) {
  const want = Math.max(0, Math.min(store.capacity, count | 0));
  if (want <= store.count) {
    store.count = want;
    return;
  }
  for (let i = store.count; i < want; i++) initParticleInBox(store, i, bounds);
  store.count = want;
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {number} i
 */
export function initParticle(store, i) {
  initParticleInBox(store, i, { minX: -30, minY: 2, minZ: -20, size: 60 });
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {number} i
 * @param {{ minX: number, minY: number, minZ: number, size: number }} bounds
 */
export function initParticleInBox(store, i, bounds) {
  const { minX, minY, minZ, size } = bounds;
  initParticleAt(
    store,
    i,
    minX + Math.random() * size,
    minY + Math.random() * size,
    minZ + Math.random() * size,
  );
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {number} i
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function initParticleAt(store, i, x, y, z) {
  store.px[i] = x;
  store.py[i] = y;
  store.pz[i] = z;
  store.hx[i] = x;
  store.hy[i] = y;
  store.hz[i] = z;
  bakeCompressionWaveRest(store, i);
  store.vx[i] = (Math.random() - 0.5) * 0.08;
  store.vy[i] = (Math.random() - 0.5) * 0.08;
  store.vz[i] = (Math.random() - 0.5) * 0.08;
  store.life[i] = Math.random();
  store.maxLife[i] = 1;
  store.size[i] = Math.random() * 1.0 + 1.0;
  store.windInfluence[i] = Math.random() * 0.5 + 0.5;
  bakeRandomOrientation(store, i);
}

/**
 * Grow live count; initialize only new slots.
 * @param {ReturnType<typeof createStore>} store
 * @param {number} n
 */
export function ensureCount(store, n) {
  const want = Math.max(0, Math.min(store.capacity, n | 0));
  if (want <= store.count) {
    setCount(store, want);
    return;
  }
  const start = store.count;
  store.count = want;
  for (let i = start; i < want; i++) initParticle(store, i);
}

/**
 * @param {ReturnType<typeof createStore>} store
 * @param {{ r: number, g: number, b: number }} tint
 * @param {number} [baseScale=1] extra scale multiplier for mesh kind
 * @param {{ billboard?: { rx: number, ry: number, rz: number, ux: number, uy: number, uz: number }, positionsOnly?: boolean }} [opts]
 *   billboard: camera right/up axes — bake facing into matrices (thin-instance safe; mesh billboardMode is not)
 *   positionsOnly: point clouds — skip 4×4 / color (Three/BJS/Lite points use xyz)
 */
export function packRenderBuffers(store, tint, baseScale = 1, opts = {}) {
  const n = store.count;
  const { px, py, pz, size, matrices, colors, positions, spinC, spinS, ori } = store;
  if (opts.positionsOnly) {
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      positions[p] = px[i];
      positions[p + 1] = py[i];
      positions[p + 2] = pz[i];
    }
    return;
  }
  const tr = tint.r;
  const tg = tint.g;
  const tb = tint.b;
  const bb = opts.billboard;

  let rx = 1;
  let ry = 0;
  let rz = 0;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  let fx = 0;
  let fy = 0;
  let fz = 1;
  if (bb) {
    rx = bb.rx;
    ry = bb.ry;
    rz = bb.rz;
    ux = bb.ux;
    uy = bb.uy;
    uz = bb.uz;
    // forward = right × up; negate so +Z mesh faces camera
    fx = -(ry * uz - rz * uy);
    fy = -(rz * ux - rx * uz);
    fz = -(rx * uy - ry * ux);
  }

  for (let i = 0; i < n; i++) {
    const s = size[i] * baseScale;
    const o = i * 16;
    if (bb) {
      // Face camera, then apply baked roll (spinC/spinS) — still upright-ish variety, no trig
      const cr = spinC[i];
      const sr = spinS[i];
      const rrx = (rx * cr + ux * sr) * s;
      const rry = (ry * cr + uy * sr) * s;
      const rrz = (rz * cr + uz * sr) * s;
      const rux = (-rx * sr + ux * cr) * s;
      const ruy = (-ry * sr + uy * cr) * s;
      const ruz = (-rz * sr + uz * cr) * s;
      matrices[o] = rrx;
      matrices[o + 1] = rry;
      matrices[o + 2] = rrz;
      matrices[o + 3] = 0;
      matrices[o + 4] = rux;
      matrices[o + 5] = ruy;
      matrices[o + 6] = ruz;
      matrices[o + 7] = 0;
      matrices[o + 8] = fx * s;
      matrices[o + 9] = fy * s;
      matrices[o + 10] = fz * s;
      matrices[o + 11] = 0;
    } else {
      const r = i * 9;
      matrices[o] = ori[r] * s;
      matrices[o + 1] = ori[r + 1] * s;
      matrices[o + 2] = ori[r + 2] * s;
      matrices[o + 3] = 0;
      matrices[o + 4] = ori[r + 3] * s;
      matrices[o + 5] = ori[r + 4] * s;
      matrices[o + 6] = ori[r + 5] * s;
      matrices[o + 7] = 0;
      matrices[o + 8] = ori[r + 6] * s;
      matrices[o + 9] = ori[r + 7] * s;
      matrices[o + 10] = ori[r + 8] * s;
      matrices[o + 11] = 0;
    }
    matrices[o + 12] = px[i];
    matrices[o + 13] = py[i];
    matrices[o + 14] = pz[i];
    matrices[o + 15] = 1;

    const c = i * 4;
    colors[c] = tr;
    colors[c + 1] = tg;
    colors[c + 2] = tb;
    colors[c + 3] = 1;

    const p = i * 3;
    positions[p] = px[i];
    positions[p + 1] = py[i];
    positions[p + 2] = pz[i];
  }
}
