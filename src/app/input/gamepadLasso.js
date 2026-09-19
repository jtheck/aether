// Drawn-lasso hatch follows the outer hull, not the raw stroke.
// Gamepad paints that hull with a circular brush (speed-sized; both bumpers = 2× max).

/** Single-bumper floor — still a real stamp, not a hairline. */
export const BRUSH_RADIUS_MIN = 36;
/** Single-bumper ceiling. Both bumpers use 2× this. */
export const BRUSH_RADIUS_MAX = 72;
/** Per-frame travel (px) that fills the single-bumper range. */
export const BRUSH_SPEED_PX = 18;
export const BRUSH_RADIUS_BOTH = BRUSH_RADIUS_MAX * 2;
export const BRUSH_CIRCLE_N = 8;
export const BRUSH_STAMP_MIN = 8;
export const BRUSH_STAMP_FRAC = 0.45;
export const BRUSH_MAX_STAMPS = 80;
const BRUSH_SMOOTH = 0.4;

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

/**
 * Live brush radius in CSS pixels. One bumper eases with stroke speed;
 * both bumpers snap to double the single-bumper max.
 * @param {number} [speed]
 * @param {boolean} [both]
 */
export function brushRadiusTarget(speed, both) {
  if (both) return BRUSH_RADIUS_BOTH;
  const s = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const t = Math.max(0, Math.min(1, s / BRUSH_SPEED_PX));
  const e = t * t * (3 - 2 * t);
  return BRUSH_RADIUS_MIN + (BRUSH_RADIUS_MAX - BRUSH_RADIUS_MIN) * e;
}

/**
 * @param {number} prev
 * @param {number} target
 * @param {boolean} [both]
 */
export function stepBrushRadius(prev, target, both = false) {
  const next = Number.isFinite(target) ? target : BRUSH_RADIUS_MIN;
  if (both || !Number.isFinite(prev) || prev <= 0) return next;
  return prev + (next - prev) * BRUSH_SMOOTH;
}

/**
 * @param {number} prev
 * @param {number} instant
 */
export function stepBrushSpeed(prev, instant) {
  const v = Number.isFinite(instant) && instant > 0 ? instant : 0;
  if (!Number.isFinite(prev) || prev <= 0) return v;
  return prev + (v - prev) * BRUSH_SMOOTH;
}

/**
 * Commit stamps along the stroke so a fast swipe does not leave gaps.
 * The live tip is not stored here — fold it in with `brushViewStamps`.
 * @param {{ x: number, y: number, r: number }[]} stamps
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} [max]
 */
export function appendBrushStamps(stamps, x, y, r, max = BRUSH_MAX_STAMPS) {
  const rr = Number.isFinite(r) && r > 1 ? r : 1;
  if (!stamps) return stamps;
  if (!stamps.length) {
    stamps.push({ x, y, r: rr });
    return stamps;
  }
  const last = stamps[stamps.length - 1];
  const x0 = last.x;
  const y0 = last.y;
  const r0 = last.r;
  const dist = Math.hypot(x - x0, y - y0);
  const spacing = Math.max(BRUSH_STAMP_MIN, Math.min(r0, rr) * BRUSH_STAMP_FRAC);
  if (!(dist >= spacing)) return stamps;
  const steps = Math.max(1, Math.min(12, Math.floor(dist / spacing)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const stamp = { x: x0 + (x - x0) * t, y: y0 + (y - y0) * t, r: r0 + (rr - r0) * t };
    if (stamps.length >= max) {
      stamps[stamps.length - 1] = stamp;
      break;
    }
    stamps.push(stamp);
  }
  return stamps;
}

/**
 * @param {{ x: number, y: number, r: number }[]} stamps
 * @param {number} x
 * @param {number} y
 * @param {number} r
 */
export function brushViewStamps(stamps, x, y, r) {
  const rr = Number.isFinite(r) && r > 1 ? r : 1;
  const last = stamps?.[stamps.length - 1];
  if (!last || last.x !== x || last.y !== y || last.r !== rr) {
    return (stamps ?? []).concat({ x, y, r: rr });
  }
  return stamps;
}

/** Vertices sit outside the disk so hull edges stay tangent to the brush. */
export function brushCircleBoost(n = BRUSH_CIRCLE_N) {
  return 1 / Math.cos(Math.PI / n);
}

/**
 * Circle samples around each stamp. Reuses `out` objects when provided.
 * @param {{ x: number, y: number, r: number }[]} stamps
 * @param {{ x: number, y: number }[]} [out]
 */
export function brushStampHullPts(stamps, out = []) {
  const n = BRUSH_CIRCLE_N;
  const boost = brushCircleBoost(n);
  let w = 0;
  for (let s = 0; s < (stamps?.length ?? 0); s++) {
    const st = stamps[s];
    if (!st || !(st.r > 0) || !Number.isFinite(st.x) || !Number.isFinite(st.y)) continue;
    const rad = st.r * boost;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let p = out[w];
      if (!p) {
        p = { x: 0, y: 0 };
        out[w] = p;
      }
      p.x = st.x + Math.cos(a) * rad;
      p.y = st.y + Math.sin(a) * rad;
      w++;
    }
  }
  out.length = w;
  return out;
}

/**
 * Outer hatch of the painted stroke — Minkowski sum of the stamps with a disk.
 * @param {{ x: number, y: number, r: number }[]} stamps
 * @param {{ x: number, y: number }[]} [scratch]
 */
export function brushOuterLoop(stamps, scratch) {
  const hull = lassoOuterLoop(brushStampHullPts(stamps, scratch));
  const out = new Array(hull.length);
  for (let i = 0; i < hull.length; i++) out[i] = { x: hull[i].x, y: hull[i].y };
  return out;
}
