// Headset pose for systems that otherwise read the desktop orbit camera.
// The XR draw already uses the eye camera; this is for CPU work that runs
// before that camera exists for the frame (unit scale, scenery LOD, billboards).

const world = new Float32Array(16);
world[0] = world[5] = world[10] = world[15] = 1;
let version = 1;

/** Widest tangent of any eye frustum, in the viewer's own frame. */
const reach = { h: 1, v: 1 };

/** @type {{ x: number, y: number, z: number, worldMatrix: Float32Array } | null} */
let eye = null;

const view = {
  get x() { return world[12]; },
  get y() { return world[13]; },
  get z() { return world[14]; },
  worldMatrix: world,
};

/**
 * Copy a WebXR pose into Lite's left-handed scene, same as the eye camera.
 * @param {Float32Array | number[]} rh viewer transform matrix
 * @param {ArrayLike<{ projectionMatrix: Float32Array }>} [views] the pose's eye views
 */
export function setXrEyeFromPose(rh, views) {
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
}

export function xrEye() {
  return eye;
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
