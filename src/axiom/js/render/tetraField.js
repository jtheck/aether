/**
 * Classic bobbing tetra grid.
 * Y is cos(x+φ)+sin(z+φ), applied in the vertex shader from the instance
 * translation. Matrices stay static so a phone never reuploads them.
 */

export const TETRA_PHASE_STEP = 0.00314;
const SPAN = 10;
const STEP = 0.75;

/**
 * Low-memory phones (and coarse-pointer devices with few cores) get a
 * coarser grid — about half the instances.
 * @param {Navigator | { deviceMemory?: number, hardwareConcurrency?: number } | null | undefined} [nav]
 * @param {(q: string) => { matches: boolean } | null | undefined} [match]
 */
export function isSlowTetraDevice(nav, match) {
  const n = nav === undefined ? (typeof navigator !== 'undefined' ? navigator : null) : nav;
  if (!n) return false;
  const mem = n.deviceMemory;
  if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
  const cores = n.hardwareConcurrency;
  const mq = match === undefined ? (typeof matchMedia === 'function' ? matchMedia : null) : match;
  let coarse = false;
  try {
    coarse = !!(mq && mq('(pointer: coarse)')?.matches);
  } catch {
    coarse = false;
  }
  return coarse && typeof cores === 'number' && cores > 0 && cores <= 4;
}

/** @param {boolean} slow */
export function tetraGridStep(slow) {
  return slow ? STEP * Math.SQRT2 : STEP;
}

/**
 * Identity instance matrices. Translation Y stays 0; the shader bobs it.
 * @param {boolean} [slow]
 */
export function buildTetraPlacements(slow = false) {
  const step = tetraGridStep(slow);
  /** @type {number[]} */
  const xs = [];
  /** @type {number[]} */
  const zs = [];
  for (let ix = -SPAN; ix < SPAN; ix += step) {
    for (let iz = -SPAN; iz < SPAN; iz += step) {
      xs.push(ix);
      zs.push(iz);
    }
  }
  const count = xs.length;
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    matrices[o] = 1;
    matrices[o + 5] = 1;
    matrices[o + 10] = 1;
    matrices[o + 12] = xs[i];
    matrices[o + 14] = zs[i];
    matrices[o + 15] = 1;
  }
  return { xs, zs, matrices, count, step };
}
