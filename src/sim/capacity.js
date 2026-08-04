/** Power-of-two capacity growth for thin-instance / pool buffers. */

/**
 * Next power-of-two capacity ≥ needed (at least `initial`).
 * @param {number} needed
 * @param {{ initial?: number }} [opts]
 * @returns {number}
 */
export function capacityFor(needed, opts = {}) {
  const initial = opts.initial ?? 32;
  const n = Math.max(0, needed | 0);
  if (n <= initial) return initial;
  // nextPow2: smallest 2^k >= n
  let c = initial;
  while (c < n) c <<= 1;
  return c;
}
