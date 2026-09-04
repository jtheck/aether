// v1-style RTS camera: velocity + momentum for pan/zoom/yaw.
// Touch/gamepad later call nudgePan / nudgeZoom / nudgeRotate.

import { WORLD_HALF_F, TILE_SIZE_F } from '../sim/field.js';

const ZOOM_WHEEL = 0.025;
const ROT_WHEEL = 0.0003;
const ROT_WHEEL_MAX = 0.08;
const INVERSE_ROT = -1;
const INVERSE_ZOOM = 1;

const MOMENTUM = 0.95;
const DAMPING = 0.998;
const PAN_DECAY = 0.8;
const PAN_DAMP = 0.975;

const ROT_THRESHOLD = 0.01;
const ZOOM_THRESHOLD = 0.1;
const PAN_THRESHOLD = 0.001;

const KEY_ROT_SPEED = 0.2;
const KEY_ZOOM_SPEED = 0.2;
const KEY_PAN_BASE = 5 * 1.2;
const CAMERA_KEYS = new Set([
  'w', 'r', 'q', 't', 'e', 's', 'd', 'f', 'a',
  'pageup', 'pagedown',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);
const RMB_PAN_BASE = 5;
// Click-vs-pan: same latch for camera motion and the force-move. Pan used
// to start on the first pixel while the click still fired until 25px, so a
// short drag both panned and issued an order. 5px cumulative ate ordinary
// clicks; this sits between jitter and an intentional drag.
export const RMB_PAN_DRAG_THRESHOLD_PX = 10;

// Beta: 0 = straight down, π/2 = horizon. Horizon at both ends; play sits in
// a look-down trough. Smoothstep both legs so zoom never slams pitch.
const MIN_BETA = 0.82;
const MAX_BETA = 1.2;
const CLOSE_BETA = 1.2;
/** Normalized zoom where the look-down trough bottoms (0 = closest). */
export const CAMERA_CLOSE_SPAN = 0.32;
const CLOSE_SPAN = CAMERA_CLOSE_SPAN;
/** Quiet ms after the last zoom impulse before a landing may stick on the trough. */
export const ZOOM_TEND_IDLE_MS = 100;
/** Normalized: must already be on the dest to hold. Never reach out and pull. */
export const ZOOM_TEND_HOME = 0.05;
/** Normalized: already-there, or a tiny overshoot we may settle. Beyond this, fly-through. */
export const ZOOM_TEND_NEAR = 0.045;
/** Exponential settle once we are on the dest — slower than follow-zip. */
export const ZOOM_TEND_RATE = 4;
/** Gentle, centered bowl — small mid/edge gap so the whole range feels even. */
const ZOOM_MID_SPEED = 0.72;
const ZOOM_EDGE_SPEED = 1.06;

function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Zoom 0 = closest, 1 = farthest. */
export function cameraZoomNormalized(radius, minR, maxR) {
  const span = Math.max(1e-3, (maxR ?? 0) - (minR ?? 0));
  return Math.max(0, Math.min(1, ((radius ?? 0) - (minR ?? 0)) / span));
}

/** Radius at the look-down trough (play gaze). */
export function cameraPlayRadius(minR, maxR) {
  const lo = minR ?? 0;
  return lo + CLOSE_SPAN * Math.max(1e-3, (maxR ?? 0) - lo);
}

/**
 * After a toward-trough toss goes idle: hold only if we are already on the dest.
 * Never pull a stop-short in. `predicted` is where current zoom momentum would rest.
 */
export function zoomTendCatch(radius, dest, predicted, home, near) {
  const toDest = dest - radius;
  if (!Number.isFinite(toDest) || !Number.isFinite(predicted)) return false;
  if (Math.abs(radius - dest) > home) return false;
  const dir = toDest !== 0 ? Math.sign(toDest) : Math.sign(predicted - dest) || 1;
  const overshoot = (predicted - dest) * dir;
  if (overshoot > near) return false;
  return Math.abs(predicted - dest) <= home;
}

/**
 * 0 at play-down / close-in, 1 at max zoom-out look-up.
 * Close-in horizon tilt does not count.
 * @param {number} normalizedZoom
 */
export function farHorizonAmount(normalizedZoom) {
  const n = Math.max(0, Math.min(1, normalizedZoom));
  if (n <= CLOSE_SPAN) return 0;
  return (n - CLOSE_SPAN) / (1 - CLOSE_SPAN);
}

/** @param {number} normalized 0 = closest, 1 = farthest */
function betaForNormalizedZoom(normalized) {
  const n = Math.max(0, Math.min(1, normalized));
  if (n < CLOSE_SPAN) {
    return CLOSE_BETA + smooth01(n / CLOSE_SPAN) * (MIN_BETA - CLOSE_BETA);
  }
  return MIN_BETA + smooth01((n - CLOSE_SPAN) / (1 - CLOSE_SPAN)) * (MAX_BETA - MIN_BETA);
}

/** Centered cosine: slowest at mid-zoom, barely quicker at either extreme. */
function zoomSpeedForNormalized(normalized) {
  const n = Math.max(0, Math.min(1, normalized));
  const edge = Math.abs(n - 0.5) * 2;
  const t = 0.5 - 0.5 * Math.cos(Math.PI * edge);
  return ZOOM_MID_SPEED + t * (ZOOM_EDGE_SPEED - ZOOM_MID_SPEED);
}

/** Exponential chase while Space is held — rushes in from far, then sticks. */
export const FOLLOW_ZIP_RATE = 18;

/**
 * Frame-rate-independent chase. `rate` is the exponential time-constant.
 * @param {number} x
 * @param {number} z
 * @param {number} tx
 * @param {number} tz
 * @param {number} dtSec
 * @param {number} [rate]
 */
export function chaseToward(x, z, tx, tz, dtSec, rate = FOLLOW_ZIP_RATE) {
  const u = 1 - Math.exp(-rate * Math.max(0, dtSec));
  return { x: x + (tx - x) * u, z: z + (tz - z) * u };
}

const DEFAULT_ALPHA = -Math.PI / 2.1;
const DEFAULT_BETA = Math.PI / 3.2;
const LOWER_RADIUS = 50;
/** v1's typical play radius; used to remap (60/r)^1.5 onto v2's larger default zoom. */
const V1_REF_RADIUS = 80;

/**
 * Pan/zoom half-extent. Missing / 0 follows the table; authored values clamp inside it.
 * @param {number} tableHalfF
 * @param {number} [authoredHalfF]
 */
export function resolveCameraHalfF(tableHalfF, authoredHalfF) {
  const table = Math.max(1, Number(tableHalfF) || 0);
  const authored = Number(authoredHalfF);
  if (!Number.isFinite(authored) || authored <= 0) return table;
  return Math.min(table, Math.max(TILE_SIZE_F * 2, authored));
}

/**
 * @param {object} camera Lite ArcRotateCamera
 * @param {HTMLCanvasElement} canvas
 * @param {{ worldHalfF?: number }} [opts]
 */
export function createCameraController(camera, canvas, opts = {}) {
  let worldHalfF = opts.worldHalfF ?? WORLD_HALF_F;
  // Zoom / pan clamp tracks the active board half-extent.
  let DEFAULT_RADIUS = worldHalfF * 1.55;
  let RESET_RADIUS = worldHalfF * 1.8;
  /** Max zoom-out — keep the look-up view near the table, not a wide pullback. */
  let UPPER_RADIUS = worldHalfF * 2.15;
  const velocity = { alpha: 0, radius: 0, panX: 0, panZ: 0 };
  const keyStates = Object.create(null);
  let nudged = false;
  let zoomIdleMs = 0;
  let zoomInputThisTick = false;
  let lastZoomSign = 0;
  let zoomTend = false;
  let followActive = false;
  let followX = 0;
  let followZ = 0;

  let rmbPanActive = false;
  let rmbDidPan = false;
  let rmbLastScreen = { x: 0, y: 0 };
  let rmbDownScreen = { x: 0, y: 0 };
  let rmbPointerId = null;

  camera.lowerRadiusLimit = LOWER_RADIUS;
  camera.upperRadiusLimit = UPPER_RADIUS;
  camera.lowerBetaLimit ??= 0.1;
  camera.upperBetaLimit ??= 1.5;

  function applyWorldHalf(next) {
    const half = Number(next);
    if (!Number.isFinite(half) || half <= 0) return;
    worldHalfF = half;
    DEFAULT_RADIUS = worldHalfF * 1.55;
    RESET_RADIUS = worldHalfF * 1.8;
    UPPER_RADIUS = worldHalfF * 2.15;
    camera.upperRadiusLimit = UPPER_RADIUS;
  }

  /** Live board swap (skirmish → stress, etc.) — pan + zoom limits follow the table. */
  function setWorldHalfF(next) {
    applyWorldHalf(next);
    const { minR, maxR } = radiusLimits();
    if (Number.isFinite(camera.radius)) {
      camera.radius = Math.max(minR, Math.min(maxR, camera.radius));
    }
    const t = getTarget();
    const margin = 2 * TILE_SIZE_F;
    const lo = -worldHalfF + margin;
    const hi = worldHalfF - margin;
    setTargetXZ(
      Math.max(lo, Math.min(hi, t.x)),
      Math.max(lo, Math.min(hi, t.z)),
    );
  }

  function markNudged() {
    nudged = true;
  }

  function getTarget() {
    const t = camera.target;
    if (!t) return { x: 0, y: 0, z: 0 };
    return { x: t.x ?? 0, y: t.y ?? 0, z: t.z ?? 0 };
  }

  /**
   * Lite target is an observable vec3 (`set` / property setters call markLocalDirty).
   * Replacing `camera.target` or calling a missing `setTarget` leaves the view matrix
   * stale until the next alpha/radius write — pan looks broken until you zoom.
   */
  function setTargetXZ(x, z) {
    const t = camera.target;
    if (!t) return;
    const y = t.y ?? 0;
    if (typeof t.set === 'function') t.set(x, y, z);
    else {
      t.x = x;
      t.y = y;
      t.z = z;
    }
  }

  /** Lite: pos = target + (r·cosα·sinβ, r·cosβ, r·sinα·sinβ). */
  function cameraPosition() {
    const t = getTarget();
    const a = camera.alpha ?? 0;
    const b = camera.beta ?? DEFAULT_BETA;
    const r = camera.radius ?? DEFAULT_RADIUS;
    let sb = Math.sin(b);
    if (sb === 0) sb = 1e-4;
    const cb = Math.cos(b);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return {
      x: t.x + r * ca * sb,
      y: t.y + r * cb,
      z: t.z + r * sa * sb,
    };
  }

  /** v1 RMB/keyboard: flatten(toTarget), right = (−fz, fx). */
  function groundAxes() {
    const t = getTarget();
    const p = cameraPosition();
    let fx = t.x - p.x;
    let fz = t.z - p.z;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    return { rightX: -fz, rightZ: fx, forwardX: fx, forwardZ: fz };
  }

  function clampTargetPan(nx, nz) {
    const margin = 2 * TILE_SIZE_F;
    const min = -worldHalfF + margin;
    const max = worldHalfF - margin;
    let px = velocity.panX;
    let pz = velocity.panZ;
    const t = getTarget();
    let x = t.x;
    let z = t.z;
    if (nx >= min && nx <= max) x = nx;
    else px = 0;
    if (nz >= min && nz <= max) z = nz;
    else pz = 0;
    velocity.panX = px;
    velocity.panZ = pz;
    setTargetXZ(x, z);
  }

  function followXZ(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    followActive = true;
    followX = x;
    followZ = z;
    velocity.panX = 0;
    velocity.panZ = 0;
    markNudged();
  }

  /** Instant cinematic pose. `unclamped` keeps authored story radii. */
  function setPose(pose = {}, opts = {}) {
    followActive = false;
    velocity.alpha = 0;
    velocity.radius = 0;
    velocity.panX = 0;
    velocity.panZ = 0;
    zoomTend = false;
    lastZoomSign = 0;
    zoomIdleMs = 0;
    zoomInputThisTick = false;
    if (Number.isFinite(pose.x) && Number.isFinite(pose.z)) setTargetXZ(pose.x, pose.z);
    if (Number.isFinite(pose.alpha)) camera.alpha = pose.alpha;
    if (Number.isFinite(pose.radius)) {
      if (opts.unclamped) camera.radius = Math.max(8, pose.radius);
      else {
        const { minR, maxR } = radiusLimits();
        camera.radius = Math.max(minR, Math.min(maxR, pose.radius));
      }
    }
    markNudged();
  }

  function getPose() {
    const t = getTarget();
    return {
      x: t.x,
      z: t.z,
      radius: camera.radius ?? DEFAULT_RADIUS,
      alpha: camera.alpha ?? 0,
    };
  }

  /** Instant snap to a ground point (control-group double-tap). */
  function lookAtXZ(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    velocity.panX = 0;
    velocity.panZ = 0;
    clampTargetPan(x, z);
    if (followActive) {
      followX = x;
      followZ = z;
    }
    markNudged();
  }

  function stopFollow() {
    followActive = false;
  }

  function isFollowing() {
    return followActive;
  }

  function nudgePan(dx, dz) {
    if (followActive) return;
    markNudged();
    velocity.panX += dx;
    velocity.panZ += dz;
  }

  function radiusLimits() {
    const minR = camera.lowerRadiusLimit ?? LOWER_RADIUS;
    const maxR = camera.upperRadiusLimit ?? UPPER_RADIUS;
    return { minR, maxR, span: Math.max(1e-6, maxR - minR) };
  }

  function playRadius() {
    const { minR, maxR } = radiusLimits();
    return cameraPlayRadius(minR, maxR);
  }

  function predictZoomRestRadius() {
    const { minR, maxR, span } = radiusLimits();
    let r = camera.radius;
    let v = velocity.radius;
    for (let i = 0; i < 80 && Math.abs(v) >= ZOOM_THRESHOLD; i++) {
      const n = Math.max(0, Math.min(1, (r - minR) / span));
      r += v * zoomSpeedForNormalized(n);
      v *= MOMENTUM * DAMPING;
      if (r <= minR) return minR;
      if (r >= maxR) return maxR;
    }
    return r;
  }

  function applyZoomInput(delta) {
    markNudged();
    zoomTend = false;
    zoomIdleMs = 0;
    zoomInputThisTick = true;
    if (delta !== 0) lastZoomSign = Math.sign(delta);
    const { minR, maxR } = radiusLimits();
    const r = camera.radius;
    // At a zoom stop, drop momentum into the wall instead of banking it.
    if (delta < 0 && r <= minR + 1e-3) {
      if (velocity.radius < 0) velocity.radius = 0;
      return;
    }
    if (delta > 0 && r >= maxR - 1e-3) {
      if (velocity.radius > 0) velocity.radius = 0;
      return;
    }
    velocity.radius += delta;
  }

  function nudgeZoom(delta) {
    applyZoomInput(delta);
  }

  function nudgeRotate(deltaAlpha) {
    markNudged();
    velocity.alpha += deltaAlpha;
  }

  function handleWheel(e) {
    if (!camera) return;
    markNudged();
    e.preventDefault();
    const delta = e.deltaY;
    if ((e.buttons & 2) !== 0 || e.shiftKey) {
      const impulse = INVERSE_ROT * delta * ROT_WHEEL;
      velocity.alpha += Math.max(-ROT_WHEEL_MAX, Math.min(ROT_WHEEL_MAX, impulse));
    } else {
      applyZoomInput(INVERSE_ZOOM * delta * ZOOM_WHEEL);
    }
  }

  function endRmbPan() {
    if (!rmbPanActive) return false;
    rmbPanActive = false;
    rmbPointerId = null;
    return rmbDidPan;
  }

  function handlePointerDown(e) {
    if (e.pointerType === 'touch') return false;
    if (e.button !== 2) return false;

    rmbPanActive = true;
    rmbDidPan = false;
    rmbPointerId = e.pointerId;
    rmbLastScreen = { x: e.clientX, y: e.clientY };
    rmbDownScreen = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    return true;
  }

  /** Screen-space px delta → ground-plane world delta (camera-relative axes, current zoom). */
  function screenDeltaToGroundPan(screenDx, screenDy) {
    const cam = camera;
    const rect = canvas.getBoundingClientRect();
    const fov = cam.fov ?? 0.8;
    const pixelsToWorld =
      (2 * (cam.radius || DEFAULT_RADIUS) * Math.tan(fov / 2)) / Math.max(1, rect.height);
    const { rightX, rightZ, forwardX, forwardZ } = groundAxes();
    return {
      wx: (rightX * screenDx + forwardX * screenDy) * pixelsToWorld,
      wz: (rightZ * screenDx + forwardZ * screenDy) * pixelsToWorld,
    };
  }

  /** v1: basePanSens * min(1, (60/r)^1.5), with r remapped so DEFAULT_RADIUS ≈ v1's ~80. */
  function panZoomFactor() {
    const r = Math.max(1, camera.radius || DEFAULT_RADIUS);
    const effectiveR = r * (V1_REF_RADIUS / DEFAULT_RADIUS);
    return Math.min(1.0, Math.pow(60 / effectiveR, 1.5));
  }

  /** Shared by RMB drag and touch centroid-pan — same feel, one formula. */
  function panByScreenDelta(screenDx, screenDy, sensBase) {
    if (followActive) return;
    const { wx, wz } = screenDeltaToGroundPan(screenDx, screenDy);
    const panSens = sensBase * panZoomFactor();
    markNudged();
    velocity.panX += wx * panSens;
    velocity.panZ += wz * panSens;
  }

  function rmbTravelPx(clientX, clientY) {
    return Math.hypot(clientX - rmbDownScreen.x, clientY - rmbDownScreen.y);
  }

  /** Apply pan only after the click-vs-drag latch; catch up from pointer-down. */
  function applyRmbPanTo(clientX, clientY) {
    if (!rmbDidPan && rmbTravelPx(clientX, clientY) <= RMB_PAN_DRAG_THRESHOLD_PX) return;
    rmbDidPan = true;
    const screenDx = clientX - rmbLastScreen.x;
    const screenDy = clientY - rmbLastScreen.y;
    rmbLastScreen = { x: clientX, y: clientY };
    if (screenDx !== 0 || screenDy !== 0) {
      panByScreenDelta(screenDx, screenDy, RMB_PAN_BASE);
    }
  }

  function handlePointerMove(e) {
    if (!rmbPanActive) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId) return false;
    applyRmbPanTo(e.clientX, e.clientY);
    return true;
  }

  function handlePointerUp(e) {
    if (!rmbPanActive) return false;
    if (e.type !== 'pointercancel' && e.button !== 2) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId && e.type !== 'pointercancel') {
      return false;
    }
    // Last sample — a flick can skip moves and land past the latch only on up.
    if (e.type !== 'pointercancel' && e.clientX != null && e.clientY != null) {
      applyRmbPanTo(e.clientX, e.clientY);
    }
    return endRmbPan();
  }

  function clearKeyStates() {
    for (const k of Object.keys(keyStates)) keyStates[k] = false;
  }

  /** Drop coasting velocity (e.g. input unlock after splash) without resetting the camera pose. */
  function clearVelocity() {
    velocity.alpha = 0;
    velocity.radius = 0;
    velocity.panX = 0;
    velocity.panZ = 0;
    zoomTend = false;
    lastZoomSign = 0;
    zoomIdleMs = 0;
    zoomInputThisTick = false;
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;
  }

  function isRmbPanning() {
    return rmbPanActive;
  }

  function handleKeyDown(e) {
    if (e.repeat) return;
    // Let browser shortcuts through (e.g. Ctrl+Shift+R hard reload).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    // BUTTON stays eligible — HUD clicks leave buttons focused and used to
    // freeze pan until the canvas was clicked.
    if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
    const key = e.key.toLowerCase();
    if (!CAMERA_KEYS.has(key)) return;
    e.preventDefault();
    keyStates[key] = true;
    markNudged();
    if (key === 's' || key === 'pageup') {
      camera.alpha += KEY_ROT_SPEED;
    } else if (key === 'f' || key === 'pagedown') {
      camera.alpha -= KEY_ROT_SPEED;
    } else if (key === 'q') {
      applyZoomInput(2.0);
    } else if (key === 't') {
      applyZoomInput(-2.0);
    }
  }

  function handleKeyUp(e) {
    keyStates[e.key.toLowerCase()] = false;
  }

  function applyHeldKeys() {
    if (keyStates.s || keyStates.pageup) {
      markNudged();
      camera.alpha += KEY_ROT_SPEED;
    } else if (keyStates.f || keyStates.pagedown) {
      markNudged();
      camera.alpha -= KEY_ROT_SPEED;
    }
    if (keyStates.q) applyZoomInput(KEY_ZOOM_SPEED);
    if (keyStates.t) applyZoomInput(-KEY_ZOOM_SPEED);

    if (followActive) return;

    let panX = 0;
    let panZ = 0;
    if (keyStates.e) panZ += 1.0;
    if (keyStates.d) panZ -= 1.0;
    if (keyStates.w) panX += 1.0;
    if (keyStates.r) panX -= 1.0;
    if (keyStates.a) panX += 0.7;
    if (keyStates.arrowup) panZ += 1.0;
    if (keyStates.arrowdown) panZ -= 1.0;
    if (keyStates.arrowleft) panX -= 1.0;
    if (keyStates.arrowright) panX += 1.0;

    if (panX !== 0 || panZ !== 0) {
      markNudged();
      const { rightX, rightZ, forwardX, forwardZ } = groundAxes();
      const zoomFactor = Math.max(0.3, Math.min(2.0, camera.radius / 80));
      const panSens = KEY_PAN_BASE * zoomFactor;
      const wx = (rightX * panX + forwardX * panZ) * panSens;
      const wz = (rightZ * panX + forwardZ * panZ) * panSens;
      velocity.panX += wx * 0.25;
      velocity.panZ += wz * 0.25;
      const maxVel = panSens * 8.0;
      velocity.panX = Math.max(-maxVel, Math.min(maxVel, velocity.panX));
      velocity.panZ = Math.max(-maxVel, Math.min(maxVel, velocity.panZ));
    }
  }

  function velocitiesIdle() {
    return (
      velocity.alpha === 0 &&
      velocity.radius === 0 &&
      velocity.panX === 0 &&
      velocity.panZ === 0
    );
  }

  function anyKeyHeld() {
    for (const k of Object.keys(keyStates)) {
      if (keyStates[k]) return true;
    }
    return false;
  }

  function tick(dtMs) {
    if (!nudged && !followActive && !anyKeyHeld()) return;

    applyHeldKeys();

    const dt = Math.min(0.05, Math.max(0, (Number(dtMs) || 16) / 1000));
    if (!zoomInputThisTick) zoomIdleMs += Number(dtMs) || 16;
    zoomInputThisTick = false;

    const { minR, maxR, span } = radiusLimits();
    const normalized = Math.max(0, Math.min(1, (camera.radius - minR) / span));

    velocity.alpha *= MOMENTUM;
    velocity.radius *= MOMENTUM;
    if (followActive) {
      velocity.panX = 0;
      velocity.panZ = 0;
    } else {
      velocity.panX *= PAN_DECAY;
      velocity.panZ *= PAN_DECAY;
      velocity.panX *= PAN_DAMP;
      velocity.panZ *= PAN_DAMP;
    }
    velocity.alpha *= DAMPING;
    velocity.radius *= DAMPING;

    if (Math.abs(velocity.alpha) < ROT_THRESHOLD) velocity.alpha = 0;
    if (Math.abs(velocity.radius) < ZOOM_THRESHOLD) velocity.radius = 0;
    if (Math.abs(velocity.panX) < PAN_THRESHOLD) velocity.panX = 0;
    if (Math.abs(velocity.panZ) < PAN_THRESHOLD) velocity.panZ = 0;

    if (!zoomTend && lastZoomSign !== 0 && zoomIdleMs >= ZOOM_TEND_IDLE_MS) {
      const destR = playRadius();
      const toDest = destR - camera.radius;
      const tossedToward = lastZoomSign * toDest > 0;
      const homeR = ZOOM_TEND_HOME * span;
      const nearR = ZOOM_TEND_NEAR * span;
      if (tossedToward && zoomTendCatch(camera.radius, destR, predictZoomRestRadius(), homeR, nearR)) {
        zoomTend = true;
      } else {
        lastZoomSign = 0;
      }
    }

    camera.alpha += velocity.alpha;

    const t = getTarget();
    if (followActive) {
      const next = chaseToward(t.x, t.z, followX, followZ, dt);
      clampTargetPan(next.x, next.z);
    } else {
      clampTargetPan(t.x + velocity.panX, t.z + velocity.panZ);
    }

    if (zoomTend) {
      const destR = playRadius();
      const u = 1 - Math.exp(-ZOOM_TEND_RATE * dt);
      camera.radius += (destR - camera.radius) * u;
      velocity.radius *= 0.8;
      if (Math.abs(velocity.radius) < ZOOM_THRESHOLD) velocity.radius = 0;
      if (Math.abs(camera.radius - destR) < 0.4 && velocity.radius === 0) {
        camera.radius = destR;
        zoomTend = false;
        lastZoomSign = 0;
      }
    } else {
      camera.radius += velocity.radius * zoomSpeedForNormalized(normalized);
    }
    if (camera.radius <= minR) {
      camera.radius = minR;
      if (velocity.radius < 0) velocity.radius = 0;
    } else if (camera.radius >= maxR) {
      camera.radius = maxR;
      if (velocity.radius > 0) velocity.radius = 0;
    }

    const nAfter = Math.max(0, Math.min(1, (camera.radius - minR) / span));
    const loB = camera.lowerBetaLimit ?? 0.1;
    const hiB = camera.upperBetaLimit ?? 1.5;
    camera.beta = Math.max(loB, Math.min(hiB, betaForNormalizedZoom(nAfter)));

    // Clear Lite inertial leftovers so they never fight us.
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;

    if (!followActive && !rmbPanActive && !anyKeyHeld() && velocitiesIdle() && !zoomTend && lastZoomSign === 0) {
      nudged = false;
    }
  }

  function reset() {
    followActive = false;
    velocity.alpha = 0;
    velocity.radius = 0;
    velocity.panX = 0;
    velocity.panZ = 0;
    zoomTend = false;
    lastZoomSign = 0;
    zoomIdleMs = 0;
    zoomInputThisTick = false;
    camera.alpha = DEFAULT_ALPHA;
    camera.radius = RESET_RADIUS;
    {
      const { minR, span } = radiusLimits();
      const n = Math.max(0, Math.min(1, (RESET_RADIUS - minR) / span));
      camera.beta = betaForNormalizedZoom(n);
    }
    setTargetXZ(0, 0);
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;
    nudged = false;
    endRmbPan();
  }

  if (camera.radius == null) camera.radius = DEFAULT_RADIUS;

  return {
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
    handleKeyUp,
    clearKeyStates,
    clearVelocity,
    isRmbPanning,
    followXZ,
    lookAtXZ,
    setPose,
    getPose,
    stopFollow,
    isFollowing,
    nudgePan,
    nudgeZoom,
    nudgeRotate,
    panByScreenDelta,
    getRadius: () => camera.radius,
    setWorldHalfF,
    tick,
    reset,
    markNudged,
  };
}
