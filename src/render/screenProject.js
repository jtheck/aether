/**
 * Clip-space → canvas pixels. Column-major view-projection, same convention
 * as renderer.worldToScreen. Writes into `out` — no allocations.
 * @param {ArrayLike<number>} vp
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} width
 * @param {number} height
 * @param {{ x: number, y: number }} out
 * @returns {boolean}
 */
export function projectWorldToCanvas(vp, x, y, z, width, height, out) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (Math.abs(cw) < 1e-8) return false;
  const iw = 1 / cw;
  out.x = (cx * iw * 0.5 + 0.5) * width;
  out.y = (1 - cy * iw) * 0.5 * height;
  return true;
}
