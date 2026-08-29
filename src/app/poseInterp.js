/**
 * Display-only chase for units under Space-follow.
 * Sim stays 20Hz; the camera already eases, so a locked view makes each tick
 * read as a skipped step. A couple of floats per selected unit — not a second sim.
 */

/** Tight enough to stay glued, slow enough to soak a 50ms pose corner. */
export const FOLLOW_POSE_RATE = 9;

const _xz = { x: 0, z: 0 };

/**
 * Frame-rate-independent chase. `rate` is the exponential time-constant.
 * @param {number} x
 * @param {number} z
 * @param {number} tx
 * @param {number} tz
 * @param {number} dtSec
 * @param {number} [rate]
 * @param {{ x: number, z: number }} [out]
 */
export function chasePoseXZ(x, z, tx, tz, dtSec, rate = FOLLOW_POSE_RATE, out = _xz) {
  const u = 1 - Math.exp(-rate * Math.max(0, dtSec));
  out.x = x + (tx - x) * u;
  out.z = z + (tz - z) * u;
  return out;
}
