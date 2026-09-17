/** Chunked infinite volume — load/unload cubic regions around a focus point. */

/**
 * @param {number} x
 * @param {number} chunkSize
 */
export function coordToChunk(x, chunkSize) {
  return Math.floor(x / chunkSize);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 */
export function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

/**
 * @param {string} key
 */
export function parseChunkKey(key) {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
}

/**
 * Chebyshev neighborhood (cube of chunks).
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} radius
 * @param {(cx: number, cy: number, cz: number) => void} fn
 */
export function forEachChunkInRadius(cx, cy, cz, radius, fn) {
  const r = radius | 0;
  for (let dz = -r; dz <= r; dz++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        fn(cx + dx, cy + dy, cz + dz);
      }
    }
  }
}

export function maxChunksForRadius(radius) {
  const e = 2 * (radius | 0) + 1;
  return e * e * e;
}

/**
 * Full-chunk equivalents inside the inscribed live sphere
 * (r = (radius + 0.5) * chunkSize). Particle budget divides by this, not the
 * paging cube — corner chunks never fill and must not steal quota.
 * @param {number} radius
 */
export function sphereChunkEquivalent(radius) {
  const R = (radius | 0) + 0.5;
  return (4 / 3) * Math.PI * R * R * R;
}

/**
 * World-space AABB for a chunk index.
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} chunkSize
 */
export function chunkBounds(cx, cy, cz, chunkSize) {
  return {
    minX: cx * chunkSize,
    minY: cy * chunkSize,
    minZ: cz * chunkSize,
    size: chunkSize,
  };
}

/** Always-on bubble around the camera (look-up / step back). */
export const STREAM_CORE_RADIUS = 1;
/** Widen FOV so off-screen standby + quantized look stay filled. */
export const STREAM_FOV_PAD = 1.55;
/** Look hash step (radians) — pad covers the gap between bins. */
export const STREAM_LOOK_QUANT = (8 * Math.PI) / 180;

/**
 * Camera basis + look. `forward` wins when present; else up × right (RH, look −Z).
 * @param {{ x?: number, y?: number, z?: number, forward?: { x: number, y: number, z: number }, billboard?: { rx: number, ry: number, rz: number, ux: number, uy: number, uz: number }, fov?: number, aspect?: number } | null | undefined} camera
 */
export function poseAxes(camera) {
  const bb = camera?.billboard;
  const rx = bb?.rx ?? 1;
  const ry = bb?.ry ?? 0;
  const rz = bb?.rz ?? 0;
  const ux = bb?.ux ?? 0;
  const uy = bb?.uy ?? 1;
  const uz = bb?.uz ?? 0;
  let fx = camera?.forward?.x;
  let fy = camera?.forward?.y;
  let fz = camera?.forward?.z;
  if (fx == null || fy == null || fz == null) {
    fx = uy * rz - uz * ry;
    fy = uz * rx - ux * rz;
    fz = ux * ry - uy * rx;
  }
  const len = Math.hypot(fx, fy, fz) || 1;
  fx /= len;
  fy /= len;
  fz /= len;
  let fov = camera?.fov;
  if (fov == null || !(fov > 0)) fov = 60;
  else if (fov < Math.PI + 0.05) fov = (fov * 180) / Math.PI;
  const aspect = Math.max(0.25, camera?.aspect ?? 16 / 9);
  return {
    x: camera?.x ?? 0,
    y: camera?.y ?? 0,
    z: camera?.z ?? 0,
    fx,
    fy,
    fz,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
    fov,
    aspect,
  };
}

export function lookQuant(fx, fy, fz, step = STREAM_LOOK_QUANT) {
  const yaw = Math.atan2(fx, fz);
  const pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
  return `${Math.round(yaw / step)},${Math.round(pitch / step)}`;
}

/**
 * Expected loaded chunks for a padded frustum + core (budget / storeCap).
 * @param {number} radius
 * @param {{ fov?: number, aspect?: number, fovPad?: number, coreRadius?: number }} [opts]
 */
export function estimateHotChunks(radius, opts = {}) {
  const r = Math.max(1, radius | 0);
  const fovDeg = opts.fov ?? 60;
  const aspect = opts.aspect ?? 16 / 9;
  const pad = opts.fovPad ?? STREAM_FOV_PAD;
  const coreR = opts.coreRadius ?? STREAM_CORE_RADIUS;
  const vfov = Math.min(Math.PI * 0.92, (fovDeg * pad * Math.PI) / 180);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const frac = Math.min(0.55, Math.max(0.12, (hfov * vfov) / (4 * Math.PI)));
  const core = (2 * coreR + 1) ** 3;
  return Math.max(core, maxChunksForRadius(r) * frac);
}

/**
 * Chunk bounding-sphere vs padded camera frustum (false positives OK).
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} chunkSize
 * @param {object} camera
 * @param {{ far?: number, near?: number, fovPad?: number }} [opts]
 */
export function chunkSphereHitsFrustum(cx, cy, cz, chunkSize, camera, opts = {}) {
  const s = chunkSize;
  const minX = cx * s;
  const minY = cy * s;
  const minZ = cz * s;
  const a = poseAxes(camera);
  const pad = opts.fovPad ?? STREAM_FOV_PAD;
  const halfV = Math.tan(((a.fov * pad) * Math.PI) / 360);
  const halfH = halfV * a.aspect;
  const near = opts.near ?? -s;
  const far = opts.far ?? 1e6;
  if (
    a.x >= minX &&
    a.x <= minX + s &&
    a.y >= minY &&
    a.y <= minY + s &&
    a.z >= minZ &&
    a.z <= minZ + s
  ) {
    return true;
  }
  const inside = (px, py, pz) => {
    const dx = px - a.x;
    const dy = py - a.y;
    const dz = pz - a.z;
    const depth = dx * a.fx + dy * a.fy + dz * a.fz;
    if (depth < near || depth > far) return false;
    const sx = dx * a.rx + dy * a.ry + dz * a.rz;
    const sy = dx * a.ux + dy * a.uy + dz * a.uz;
    const d = Math.max(depth, 1e-3);
    return Math.abs(sx) <= d * halfH && Math.abs(sy) <= d * halfV;
  };
  for (let i = 0; i < 8; i++) {
    if (
      inside(
        minX + (i & 1) * s,
        minY + ((i >> 1) & 1) * s,
        minZ + ((i >> 2) & 1) * s,
      )
    ) {
      return true;
    }
  }
  return inside(minX + s * 0.5, minY + s * 0.5, minZ + s * 0.5);
}

/**
 * Core bubble always; else Chebyshev radius ∩ padded frustum.
 */
export function chunkWanted(cx, cy, cz, focus, camera, chunkSize, chunkRadius, opts = {}) {
  const coreR = opts.coreRadius ?? STREAM_CORE_RADIUS;
  const cheb = Math.max(
    Math.abs(cx - focus.cx),
    Math.abs(cy - focus.cy),
    Math.abs(cz - focus.cz),
  );
  if (cheb <= coreR) return true;
  if (cheb > chunkRadius) return false;
  return chunkSphereHitsFrustum(cx, cy, cz, chunkSize, camera, {
    far: (chunkRadius + 0.5) * chunkSize + chunkSize * 1.5,
    ...opts,
  });
}
