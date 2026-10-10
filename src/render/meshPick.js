/**
 * CPU ray vs thin-instance triangle meshes.
 * Instance matrices match writeMatrix in buildings.js / agoras.js
 * (column-major, yaw about Y, non-uniform scale, translation).
 * Hit `t` is the parameter of the incoming ray. The local direction is
 * not renormalized, so t stays comparable across instances.
 */

const DET_EPS = 1e-12;
const T_EPS = 1e-5;
const AABB_PAD = 1e-4;
const _inv = new Float32Array(16);

/**
 * @param {object[]} meshes
 * @returns {{ positions: Float32Array, indices: Uint32Array, min: number[], max: number[] }[]}
 */
export function pickPartsFromMeshes(meshes) {
  const parts = [];
  if (!meshes) return parts;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const positions = mesh?.pickPositions;
    const indices = mesh?.pickIndices;
    const min = mesh?.boundMin;
    const max = mesh?.boundMax;
    if (!positions || !indices || !min || !max) continue;
    parts.push({ positions, indices, min, max });
  }
  return parts;
}

function invertAffine(m, o, out) {
  const a = m[o];
  const b = m[o + 4];
  const c = m[o + 8];
  const d = m[o + 1];
  const e = m[o + 5];
  const f = m[o + 9];
  const g = m[o + 2];
  const h = m[o + 6];
  const i = m[o + 10];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det < DET_EPS && det > -DET_EPS) return false;
  const invDet = 1 / det;
  const i00 = A * invDet;
  const i01 = (c * h - b * i) * invDet;
  const i02 = (b * f - c * e) * invDet;
  const i10 = B * invDet;
  const i11 = (a * i - c * g) * invDet;
  const i12 = (c * d - a * f) * invDet;
  const i20 = C * invDet;
  const i21 = (b * g - a * h) * invDet;
  const i22 = (a * e - b * d) * invDet;
  const tx = m[o + 12];
  const ty = m[o + 13];
  const tz = m[o + 14];
  out[0] = i00;
  out[1] = i10;
  out[2] = i20;
  out[3] = 0;
  out[4] = i01;
  out[5] = i11;
  out[6] = i21;
  out[7] = 0;
  out[8] = i02;
  out[9] = i12;
  out[10] = i22;
  out[11] = 0;
  out[12] = -(i00 * tx + i01 * ty + i02 * tz);
  out[13] = -(i10 * tx + i11 * ty + i12 * tz);
  out[14] = -(i20 * tx + i21 * ty + i22 * tz);
  out[15] = 1;
  return true;
}

function xform(m, x, y, z, translate) {
  const tx = translate ? m[12] : 0;
  const ty = translate ? m[13] : 0;
  const tz = translate ? m[14] : 0;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + tx,
    y: m[1] * x + m[5] * y + m[9] * z + ty,
    z: m[2] * x + m[6] * y + m[10] * z + tz,
  };
}

function rayHitAabb(ox, oy, oz, dx, dy, dz, min, max, maxT) {
  let tEnter = 0;
  let tExit = maxT;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const mn = min[a] - AABB_PAD;
    const mx = max[a] + AABB_PAD;
    if (d[a] < 1e-12 && d[a] > -1e-12) {
      if (o[a] < mn || o[a] > mx) return null;
      continue;
    }
    let t1 = (mn - o[a]) / d[a];
    let t2 = (mx - o[a]) / d[a];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (tExit < T_EPS) return null;
  return tEnter > T_EPS ? tEnter : T_EPS;
}

function rayHitTriangles(ox, oy, oz, dx, dy, dz, positions, indices, maxT) {
  let best = maxT;
  const n = indices.length;
  for (let i = 0; i < n; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const e1x = positions[ib] - ax;
    const e1y = positions[ib + 1] - ay;
    const e1z = positions[ib + 2] - az;
    const e2x = positions[ic] - ax;
    const e2y = positions[ic + 1] - ay;
    const e2z = positions[ic + 2] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det < DET_EPS && det > -DET_EPS) continue;
    const invDet = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t > T_EPS && t < best) best = t;
  }
  return best < maxT ? best : null;
}

/**
 * Nearest allowed thin instance under the ray.
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null} ray
 * @param {{ positions: Float32Array, indices: Uint32Array, min: number[], max: number[] }[]} parts
 * @param {Float32Array} matrices
 * @param {number} count
 * @param {(slot: number) => boolean} [allowSlot]
 * @param {number} [maxT]
 * @returns {{ slot: number, t: number } | null}
 */
export function nearestMeshInstanceHit(ray, parts, matrices, count, allowSlot, maxT = Infinity) {
  if (!ray || !parts?.length || !matrices || count <= 0) return null;
  let bestT = maxT;
  let bestSlot = -1;
  const nParts = parts.length;
  for (let slot = 0; slot < count; slot++) {
    if (allowSlot && !allowSlot(slot)) continue;
    const o = slot * 16;
    if (!invertAffine(matrices, o, _inv)) continue;
    const origin = xform(_inv, ray.ox, ray.oy, ray.oz, true);
    const dir = xform(_inv, ray.dx, ray.dy, ray.dz, false);
    let slotBest = bestT;
    let slotHit = false;
    for (let p = 0; p < nParts; p++) {
      const part = parts[p];
      if (rayHitAabb(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, part.min, part.max, slotBest) == null) {
        continue;
      }
      const t = rayHitTriangles(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        part.positions, part.indices, slotBest,
      );
      if (t == null) continue;
      slotBest = t;
      slotHit = true;
    }
    if (!slotHit) continue;
    bestT = slotBest;
    bestSlot = slot;
  }
  if (bestSlot < 0) return null;
  return { slot: bestSlot, t: bestT };
}
