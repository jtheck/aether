// Drawn-lasso hatch follows the outer hull, not the raw stroke.

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {{ x: number, y: number }} c
 */
function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Monotone-chain hull. Returns a copy; 0–2 points stay as-is.
 * @param {{ x: number, y: number }[]} pts
 */
export function convexHull2(pts) {
  const p = [];
  for (let i = 0; i < (pts?.length ?? 0); i++) {
    const q = pts[i];
    if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) p.push(q);
  }
  if (p.length <= 2) return p.slice();
  p.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Drawn-lasso hatch follows this, not the raw stroke. Interior scribbles
 * and the close-across chord drop; only the outer perimeter remains.
 * @param {{ x: number, y: number }[]} pts
 */
export function lassoOuterLoop(pts) {
  const hull = convexHull2(pts);
  return hull.length >= 3 ? hull : (pts ? pts.slice() : []);
}
