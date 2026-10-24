// Headset pose for systems that otherwise read the desktop orbit camera.
// The XR draw already uses the eye camera; this is for CPU work that runs
// before that camera exists for the frame (unit scale, scenery LOD, billboards).

const world = new Float32Array(16);
world[0] = world[5] = world[10] = world[15] = 1;
const hudWorld = new Float32Array(16);
hudWorld[0] = hudWorld[5] = hudWorld[10] = hudWorld[15] = 1;
let version = 1;
let hudSeeded = false;
let hudTargetPosition = null;

/** Widest tangent of any eye frustum, in the viewer's own frame. */
const reach = { h: 1, v: 1 };

/** Camera-locked HUD translation follows softly but can never trail far. */
export const XR_HUD_DRIFT_FOLLOW = 4;
export const XR_HUD_DRIFT_MAX = 0.09;
export const XR_HUD_DRIFT_CARRY = 0.02;
/** Angular spring: loose near home, stronger only after the HUD floats away. */
export const XR_HUD_TURN_FOLLOW = 4;
export const XR_HUD_TURN_SNAP = 16;
export const XR_HUD_TURN_SNAP_ARC = Math.PI / 10;

/** @type {{ x: number, y: number, z: number, worldMatrix: Float32Array } | null} */
let eye = null;

const view = {
  get x() { return world[12]; },
  get y() { return world[13]; },
  get z() { return world[14]; },
  worldMatrix: world,
};

const hudView = {
  get x() { return hudWorld[12]; },
  get y() { return hudWorld[13]; },
  get z() { return hudWorld[14]; },
  worldMatrix: hudWorld,
};

/** Carry a small part of camera translation, then spring home through a soft limit. */
export function xrHudDriftPosition(
  current,
  previousTarget,
  target,
  dt,
  follow = XR_HUD_DRIFT_FOLLOW,
  maxLag = XR_HUD_DRIFT_MAX,
  carry = XR_HUD_DRIFT_CARRY,
) {
  if (!current || !previousTarget) return [target[0], target[1], target[2]];
  const decay = Math.exp(-Math.max(0, dt) * Math.max(0, follow));
  const carried = Math.max(0, carry);
  let ox = (
    current[0] - previousTarget[0]
    - (target[0] - previousTarget[0]) * carried
  ) * decay;
  let oy = (
    current[1] - previousTarget[1]
    - (target[1] - previousTarget[1]) * carried
  ) * decay;
  let oz = (
    current[2] - previousTarget[2]
    - (target[2] - previousTarget[2]) * carried
  ) * decay;
  const lag = Math.hypot(ox, oy, oz);
  const cap = Math.max(0, maxLag);
  if (lag > 1e-8) {
    const soft = cap > 0 ? cap * Math.tanh(lag / cap) : 0;
    const s = soft / lag;
    ox *= s;
    oy *= s;
    oz *= s;
  }
  return [target[0] + ox, target[1] + oy, target[2] + oz];
}

/** Ease a unit direction with a loose tail and a stronger large-angle spring. */
export function xrHudDriftDirection(
  current,
  target,
  dt,
  follow = XR_HUD_TURN_FOLLOW,
  snap = XR_HUD_TURN_SNAP,
  snapArc = XR_HUD_TURN_SNAP_ARC,
) {
  const tx = target?.[0] ?? 0;
  const ty = target?.[1] ?? 0;
  const tz = target?.[2] ?? 0;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-8) return current ? [current[0], current[1], current[2]] : [0, 0, 1];
  const to = [tx / tl, ty / tl, tz / tl];
  const cx = current?.[0] ?? 0;
  const cy = current?.[1] ?? 0;
  const cz = current?.[2] ?? 0;
  const cl = Math.hypot(cx, cy, cz);
  if (cl < 1e-8) return to;
  const from = [cx / cl, cy / cl, cz / cl];
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const angle = Math.acos(dot);
  const amount = Math.min(1, angle / Math.max(1e-5, snapArc));
  const ease = amount * amount * (3 - 2 * amount);
  const rate = Math.max(0, follow + (snap - follow) * ease);
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  let x = from[0] + (to[0] - from[0]) * k;
  let y = from[1] + (to[1] - from[1]) * k;
  let z = from[2] + (to[2] - from[2]) * k;
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) return to;
  x /= len;
  y /= len;
  z /= len;
  return [x, y, z];
}

/**
 * Copy a WebXR pose into Lite's left-handed scene, same as the eye camera.
 * @param {Float32Array | number[]} rh viewer transform matrix
 * @param {ArrayLike<{ projectionMatrix: Float32Array }>} [views] the pose's eye views
 * @param {number} [dt] frame delta in seconds
 */
export function setXrEyeFromPose(rh, views, dt = 0) {
  const previousHud = hudSeeded ? [hudWorld[12], hudWorld[13], hudWorld[14]] : null;
  const previousUp = hudSeeded ? [hudWorld[4], hudWorld[5], hudWorld[6]] : null;
  const previousBack = hudSeeded ? [hudWorld[8], hudWorld[9], hudWorld[10]] : null;
  world[0] = rh[0];
  world[1] = rh[1];
  world[2] = -rh[2];
  world[3] = 0;
  world[4] = rh[4];
  world[5] = rh[5];
  world[6] = -rh[6];
  world[7] = 0;
  world[8] = -rh[8];
  world[9] = -rh[9];
  world[10] = rh[10];
  world[11] = 0;
  world[12] = rh[12];
  world[13] = rh[13];
  world[14] = -rh[14];
  world[15] = 1;
  hudWorld.set(world);
  if (hudSeeded) {
    const back = xrHudDriftDirection(previousBack, [world[8], world[9], world[10]], dt);
    const upHint = xrHudDriftDirection(previousUp, [world[4], world[5], world[6]], dt);
    let rx = upHint[1] * back[2] - upHint[2] * back[1];
    let ry = upHint[2] * back[0] - upHint[0] * back[2];
    let rz = upHint[0] * back[1] - upHint[1] * back[0];
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-8) {
      rx = world[0];
      ry = world[1];
      rz = world[2];
      rl = Math.hypot(rx, ry, rz) || 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = back[1] * rz - back[2] * ry;
    const uy = back[2] * rx - back[0] * rz;
    const uz = back[0] * ry - back[1] * rx;
    hudWorld[0] = rx;
    hudWorld[1] = ry;
    hudWorld[2] = rz;
    hudWorld[4] = ux;
    hudWorld[5] = uy;
    hudWorld[6] = uz;
    hudWorld[8] = back[0];
    hudWorld[9] = back[1];
    hudWorld[10] = back[2];
  }
  const targetPosition = [world[12], world[13], world[14]];
  const hudPosition = xrHudDriftPosition(
    previousHud,
    hudTargetPosition,
    targetPosition,
    dt,
  );
  hudWorld[12] = hudPosition[0];
  hudWorld[13] = hudPosition[1];
  hudWorld[14] = hudPosition[2];
  hudTargetPosition = targetPosition;
  hudSeeded = true;
  if (views?.length) {
    const r = eyeReach(views);
    reach.h = r.h;
    reach.v = r.v;
  }
  version += 1;
  eye = view;
}

export function xrEyeVersion() {
  return version;
}

export function clearXrEye() {
  eye = null;
  hudSeeded = false;
  hudTargetPosition = null;
}

export function xrEye() {
  return eye;
}

export function xrHudEye() {
  return eye ? hudView : null;
}

/**
 * Symmetric projection that maps canvas NDC onto the headset frustum.
 * Vertical fov matches the wider eye. Aspect is the horizontal/vertical
 * tangent, so the left and right edges of the canvas land on the eye edges.
 * Screen HUD placed through this stays in view as the head moves.
 * @param {{ h: number, v: number }} [frustum]
 */
export function xrHudProjection(frustum = reach) {
  const v = frustum?.v > 1e-4 ? frustum.v : 1;
  const h = frustum?.h > 1e-4 ? frustum.h : 1;
  return { fov: 2 * Math.atan(v), aspect: h / v };
}

/**
 * Control-group pads land at most this far off the view axis (tangent).
 * atan(0.78) is about 38 degrees - in from the visor rim.
 */
export const XR_HUD_EDGE_TAN = 0.72;

/**
 * The other screen chrome (selection, resources, clock, spectator sheet)
 * sits a little closer than the control pads. atan(0.66) is about 33 degrees.
 */
export const XR_HUD_CHROME_TAN = 0.60;

/**
 * How far to pull a screen panel toward the center so its edge stays inside
 * `edge`. 1 when the eye is already that narrow. World-pinned marks keep the
 * full eye projection; only layout points use this scale.
 * @param {{ h: number, v: number }} [eyes]
 * @param {number} [edge]
 */
export function xrHudEdgeScale(eyes = reach, edge = XR_HUD_EDGE_TAN) {
  const h = eyes?.h > 1e-4 ? eyes.h : 1;
  const v = eyes?.v > 1e-4 ? eyes.v : 1;
  const limit = edge > 1e-4 ? edge : XR_HUD_EDGE_TAN;
  const s = Math.min(limit / h, limit / v);
  if (!(s > 0)) return 1;
  return s < 1 ? s : 1;
}

/** Inset for everything except the control-group pads. */
export function xrHudChromeScale(eyes = reach) {
  return xrHudEdgeScale(eyes, XR_HUD_CHROME_TAN);
}

/**
 * Layout point pulled toward the canvas center. Scale 1 is identity.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} [scale]
 */
export function xrHudLayoutPoint(x, y, width, height, scale = 1) {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const s = scale > 0 ? scale : 1;
  return {
    x: w * 0.5 + (x - w * 0.5) * s,
    y: h * 0.5 + (y - h * 0.5) * s,
  };
}

/**
 * Map flat-page layout coords onto the oval rim of the comfortable tangent
 * box. Each axis insets by `limit / eyeReach` so wide eyes keep top-right
 * chrome up in the corner of the viewable oval, not the rectangular canvas.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {{ h: number, v: number }} [eyes]
 * @param {number} [edge]
 */
export function xrHudOvalLayoutPoint(x, y, width, height, eyes = reach, edge = XR_HUD_CHROME_TAN) {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const eh = eyes?.h > 1e-4 ? eyes.h : 1;
  const ev = eyes?.v > 1e-4 ? eyes.v : 1;
  const limit = edge > 1e-4 ? edge : XR_HUD_CHROME_TAN;
  const ax = Math.min(1, limit / eh);
  const ay = Math.min(1, limit / ev);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const hw = w * 0.5;
  const hh = h * 0.5;
  const nx = (x - cx) / hw;
  const ny = (y - cy) / hh;
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) return { x: cx, y: cy };
  const ux = nx / len;
  const uy = ny / len;
  const t = 1 / Math.hypot(ux / ax, uy / ay);
  return {
    x: cx + ux * t * hw,
    y: cy + uy * t * hh,
  };
}

/** Half-width of the selection strip arc along the top of the comfortable oval. */
export const XR_HUD_SELECTION_ARC_HALF = Math.PI * 0.38;

/**
 * Lay out a horizontal HUD row on the top arc of the comfortable oval. The
 * center chip sits at `rowY` (flat layout beneath the timer); outer chips
 * follow the rim down and outward.
 * @param {number} px
 * @param {number} rowY
 * @param {number} width
 * @param {number} height
 * @param {{ h: number, v: number }} [eyes]
 * @param {number} [edge]
 * @param {number} [arcHalfSpan]
 */
export function xrHudOvalTopArcPoint(
  px,
  rowY,
  width,
  height,
  eyes = reach,
  edge = XR_HUD_CHROME_TAN,
  arcHalfSpan = XR_HUD_SELECTION_ARC_HALF,
) {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const eh = eyes?.h > 1e-4 ? eyes.h : 1;
  const ev = eyes?.v > 1e-4 ? eyes.v : 1;
  const limit = edge > 1e-4 ? edge : XR_HUD_CHROME_TAN;
  const ax = Math.min(1, limit / eh);
  const ay = Math.min(1, limit / ev);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const hw = w * 0.5;
  const span = arcHalfSpan > 1e-4 ? arcHalfSpan : XR_HUD_SELECTION_ARC_HALF;
  const u = Math.max(-1, Math.min(1, (px - cx) / Math.max(1e-4, ax * hw)));
  const theta = -Math.PI / 2 + u * span;
  const x = cx + Math.cos(theta) * ax * hw;
  const yArc = cy + Math.sin(theta) * ay * (h * 0.5);
  const topCenterY = cy - ay * (h * 0.5);
  return { x, y: yArc + (rowY - topCenterY) };
}

/**
 * Union of the eye frustums as half-angle tangents. WebXR projections are
 * GL style, so an edge at NDC ±1 sits at tangent (P[8] ± 1) / P[0].
 */
export function eyeReach(views) {
  let h = 0;
  let v = 0;
  for (let i = 0; i < views.length; i++) {
    const p = views[i]?.projectionMatrix;
    if (!p || !(p[0] > 0) || !(p[5] > 0)) continue;
    h = Math.max(h, Math.abs((p[8] - 1) / p[0]), Math.abs((p[8] + 1) / p[0]));
    v = Math.max(v, Math.abs((p[9] - 1) / p[5]), Math.abs((p[9] + 1) / p[5]));
  }
  return h > 0 && v > 0 ? { h, v } : { h: 1, v: 1 };
}

/**
 * Vertical fov for a symmetric camera on the head that holds every eye's
 * view. Lite fits the cascades with the canvas aspect, so the narrow axis
 * is widened until the other axis fits too.
 */
export function xrFitFov(aspect, eyes = reach) {
  const a = aspect > 0 ? aspect : 1;
  const tan = Math.max(eyes.v, eyes.h / a) * 1.04;
  return 2 * Math.atan(tan);
}

const COVER_MIN = 80;
const COVER_STEP = 1.5;
const COVER_KEEP = 1.6;

/**
 * Shadow distance from the head. Close to the board the cascades shrink so
 * the near slice is sharp; high up they stretch to keep the board shadowed.
 * The value sits on a ladder and holds until the height moves well past
 * it. Any drift here resizes every cascade, and the shadows swim.
 */
export function xrShadowCover(height, maxCover, prev = 0) {
  const cap = Math.max(COVER_MIN, maxCover || COVER_MIN);
  const want = Math.min(cap, Math.max(COVER_MIN, (height || 0) * 5));
  if (prev > 0 && prev <= cap && want > prev / COVER_KEEP && want <= prev) return prev;
  const steps = Math.ceil(Math.log(want / COVER_MIN) / Math.log(COVER_STEP) - 1e-9);
  return Math.min(cap, COVER_MIN * COVER_STEP ** Math.max(0, steps));
}
