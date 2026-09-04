/**
 * In-match HUD / 3D-menu integers as lowercase hex.
 * Match clock, FPS, and ping stay decimal at their own formatters.
 * @param {number} n
 */
export function formatGameNumber(n) {
  const v = n | 0;
  if (v < 0) return `-${(-v).toString(16)}`;
  return v.toString(16);
}
