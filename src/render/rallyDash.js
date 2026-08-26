/** Positive remainder in [0, period). */
export function wrapPeriod(v, period) {
  if (!(period > 0)) return 0;
  return ((v % period) + period) % period;
}

/**
 * Dash spans along a path of length `pathLen`.
 * Increasing `offset` shifts dashes toward +s (building → flag).
 *
 * @param {number} pathLen
 * @param {number} offset
 * @param {number} dashLen
 * @param {number} period
 * @param {(a: number, b: number) => void} fn
 */
export function forEachRallyDash(pathLen, offset, dashLen, period, fn) {
  if (!(pathLen > 0) || !(dashLen > 0) || !(period > 0)) return;
  const off = wrapPeriod(offset, period);
  let start = off - period;
  while (start < pathLen) {
    const a = Math.max(0, start);
    const b = Math.min(pathLen, start + dashLen);
    if (b - a > 1e-4) fn(a, b);
    start += period;
  }
}
