// Gamepad field cursor — roam the view, then ease-pan toward the screen edges.

/**
 * Client pixel at the canvas center (same point screenToGround uses).
 * @param {{ left?: number, top?: number, width?: number, height?: number } | null | undefined} rect
 * @returns {{ clientX: number, clientY: number } | null}
 */
export function canvasCenterClient(rect) {
  const w = rect?.width ?? 0;
  const h = rect?.height ?? 0;
  if (!(w > 0) || !(h > 0)) return null;
  return {
    clientX: (rect.left || 0) + w * 0.5,
    clientY: (rect.top || 0) + h * 0.5,
  };
}

/**
 * Show the field mark while a standard pad can play. Menu / splash hide it.
 * @param {{ connected?: boolean, playActive?: boolean, menuOpen?: boolean } | null | undefined} state
 */
export function gamepadCursorVisible(state) {
  return !!(state?.connected && state.playActive !== false && !state.menuOpen);
}

/** CSS px from the canvas edge where the cursor stops. */
export const CURSOR_EDGE_INSET = 16;
/**
 * How far in from the canvas edge the pan ease begins, as a fraction of the
 * half-axis. 0.52 ≈ halfway from center to the edge on that axis.
 */
export const CURSOR_PAN_EDGE_FRAC = 0.52;
/** Degenerate-viewport fallback half-extent, in canvas CSS pixels. */
export const CURSOR_LEASH_MIN = 72;
/** Canvas px per full-stick frame. */
export const CURSOR_GAIN = 20;
/** Remain each settle frame after the stick recenters. */
export const CURSOR_SETTLE = 0.32;
export const CURSOR_SETTLE_EPS = 1.5;

/**
 * Half-extents from view center: cursor rim, then an earlier pan rim.
 * @param {number} w
 * @param {number} h
 * @returns {{ x: number, y: number, panX: number, panY: number }}
 */
export function leashLimit(w, h) {
  const hw = (w || 0) * 0.5;
  const hh = (h || 0) * 0.5;
  if (!(hw > 0) || !(hh > 0)) {
    return { x: CURSOR_LEASH_MIN, y: CURSOR_LEASH_MIN, panX: CURSOR_LEASH_MIN, panY: CURSOR_LEASH_MIN };
  }
  const x = Math.max(1, hw - CURSOR_EDGE_INSET);
  const y = Math.max(1, hh - CURSOR_EDGE_INSET);
  return {
    x,
    y,
    panX: Math.max(1, Math.min(x, hw * (1 - CURSOR_PAN_EDGE_FRAC))),
    panY: Math.max(1, Math.min(y, hh * (1 - CURSOR_PAN_EDGE_FRAC))),
  };
}

/**
 * @param {number | { x?: number, y?: number, panX?: number, panY?: number } | null | undefined} leash
 * @returns {{ x: number, y: number, panX: number, panY: number }}
 */
function leashAxes(leash) {
  if (leash && typeof leash === 'object') {
    const x = Number.isFinite(leash.x) && leash.x > 1e-6 ? leash.x : CURSOR_LEASH_MIN;
    const y = Number.isFinite(leash.y) && leash.y > 1e-6 ? leash.y : x;
    const panX = Number.isFinite(leash.panX) && leash.panX > 1e-6 ? Math.min(x, leash.panX) : x;
    const panY = Number.isFinite(leash.panY) && leash.panY > 1e-6 ? Math.min(y, leash.panY) : y;
    return { x, y, panX, panY };
  }
  const n = leash > 1e-6 ? leash : CURSOR_LEASH_MIN;
  return { x: n, y: n, panX: n, panY: n };
}

/**
 * Client pixel at view center plus the leash offset.
 * @param {{ left?: number, top?: number, width?: number, height?: number } | null | undefined} rect
 * @param {number} [ox]
 * @param {number} [oy]
 */
export function canvasAimClient(rect, ox = 0, oy = 0) {
  const c = canvasCenterClient(rect);
  if (!c) return null;
  return {
    clientX: c.clientX + (Number.isFinite(ox) ? ox : 0),
    clientY: c.clientY + (Number.isFinite(oy) ? oy : 0),
  };
}

/**
 * Ease-in 0..1 across the pan band (slow at the inner rim, full at the edge).
 * @param {number} along
 * @param {number} panStart
 * @param {number} limit
 */
function edgePanMix(along, panStart, limit) {
  const span = limit - panStart;
  if (!(span > 1e-6)) return Math.abs(along) >= limit ? 1 : 0;
  const t = (Math.abs(along) - panStart) / span;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t;
}

/**
 * Outward stick in the edge band eases into camera; leftover at the cursor rim
 * is full camera stick (same space as deadzoned lx/ly).
 * @param {number} pos
 * @param {number} stick
 * @param {number} overflow
 * @param {number} panStart
 * @param {number} limit
 */
function outwardCam(pos, stick, overflow, panStart, limit) {
  if (overflow) return overflow;
  if (!stick) return 0;
  const mix = ((pos > 0 && stick > 0) || (pos < 0 && stick < 0))
    ? edgePanMix(pos, panStart, limit)
    : 0;
  return mix ? stick * mix : 0;
}

/**
 * Move the cursor with a look stick. Camera eases in from a rim measured
 * inward from the screen edge, then leftover at the cursor rim is full pan.
 * @param {number} ox
 * @param {number} oy
 * @param {number} lx
 * @param {number} ly
 * @param {number | { x?: number, y?: number, panX?: number, panY?: number }} leash
 * @param {number} [gain]
 */
export function stepCursorLeash(ox, oy, lx, ly, leash, gain = CURSOR_GAIN) {
  const g = gain > 1e-6 ? gain : CURSOR_GAIN;
  const nx = (Number.isFinite(ox) ? ox : 0) + (Number.isFinite(lx) ? lx : 0) * g;
  const ny = (Number.isFinite(oy) ? oy : 0) + (Number.isFinite(ly) ? ly : 0) * g;
  const { x: limitX, y: limitY, panX, panY } = leashAxes(leash);
  const cx = Math.max(-limitX, Math.min(limitX, nx));
  const cy = Math.max(-limitY, Math.min(limitY, ny));
  return {
    ox: cx,
    oy: cy,
    camLx: outwardCam(cx, Number.isFinite(lx) ? lx : 0, (nx - cx) / g, panX, limitX),
    camLy: outwardCam(cy, Number.isFinite(ly) ? ly : 0, (ny - cy) / g, panY, limitY),
  };
}

/**
 * Snap the leash home after the stick recenters.
 * @param {number} ox
 * @param {number} oy
 * @param {number} [remain]
 * @param {number} [eps]
 */
export function settleCursorLeash(ox, oy, remain = CURSOR_SETTLE, eps = CURSOR_SETTLE_EPS) {
  const nx = (Number.isFinite(ox) ? ox : 0) * remain;
  const ny = (Number.isFinite(oy) ? oy : 0) * remain;
  if (nx * nx + ny * ny < eps * eps) return { ox: 0, oy: 0 };
  return { ox: nx, oy: ny };
}
