// v1-style RTS camera: velocity + momentum for pan/zoom/yaw.
// Pointer pan is grab-the-ground: the world point under the plant stays
// under the cursor/finger. Keys / wheel / flick still use velocity.

import { WORLD_HALF_F, TILE_SIZE_F } from '../sim/field.js';
import { getViewProjectionMatrix, mat4Invert } from '../vendor/lite/liteVendor.js';

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
// Click-vs-pan grace. Must match LMB `DRAG_THRESHOLD_PX` — v1 used 5px on
// *per-event* deltas, which almost never tripped. Cumulative travel from
// pointer-down (what we measure) hits 5px on an ordinary click, so RMB
// move was getting eaten by a "pan".
const PAN_DRAG_THRESHOLD = 25;

// Beta: 0 = straight down, π/2 = horizon. Horizon at both ends; play sits in
// a look-down trough. Smoothstep both legs so zoom never slams pitch.
const MIN_BETA = 0.82;
const MAX_BETA = 1.2;
const CLOSE_BETA = 1.2;
/** Normalized zoom where the look-down trough bottoms (0 = closest). */
export const CAMERA_CLOSE_SPAN = 0.32;
const CLOSE_SPAN = CAMERA_CLOSE_SPAN;
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

const DEFAULT_ALPHA = -Math.PI / 2.1;
const DEFAULT_BETA = Math.PI / 3.2;
const LOWER_RADIUS = 50;

/**
 * @param {object} camera Lite ArcRotateCamera
 * @param {HTMLCanvasElement} canvas
 * @param {{ worldHalfF?: number }} [opts]
 */
export function createCameraController(camera, canvas, opts = {}) {
  const worldHalfF = opts.worldHalfF ?? WORLD_HALF_F;
  // Zoom / pan clamp tracks the active board half-extent.
  const DEFAULT_RADIUS = worldHalfF * 1.55;
  const RESET_RADIUS = worldHalfF * 1.8;
  /** Max zoom-out — keep the look-up view near the table, not a wide pullback. */
  const UPPER_RADIUS = worldHalfF * 2.15;
  const velocity = { alpha: 0, radius: 0, panX: 0, panZ: 0 };
  const keyStates = Object.create(null);
  let nudged = false;

  let rmbPanActive = false;
  let rmbDidPan = false;
  let rmbLastScreen = { x: 0, y: 0 };
  let rmbDownScreen = { x: 0, y: 0 };
  let rmbPointerId = null;

  /** World XZ under the plant — pointer pan keeps this pixel locked. */
  let grabWorld = null;
  let grabPanActive = false;
  let grabLastScreen = { x: 0, y: 0 };
  /** Pointer that owns the grab. A new pan mid-press must not inherit this. */
  let grabPointerId = null;

  camera.lowerRadiusLimit = LOWER_RADIUS;
  camera.upperRadiusLimit = UPPER_RADIUS;
  camera.lowerBetaLimit ??= 0.1;
  camera.upperBetaLimit ??= 1.5;

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

  function nudgePan(dx, dz) {
    markNudged();
    velocity.panX += dx;
    velocity.panZ += dz;
  }

  function radiusLimits() {
    const minR = camera.lowerRadiusLimit ?? LOWER_RADIUS;
    const maxR = camera.upperRadiusLimit ?? UPPER_RADIUS;
    return { minR, maxR, span: Math.max(1e-6, maxR - minR) };
  }

  function applyZoomInput(delta) {
    markNudged();
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
    endGrabPan();
    return rmbDidPan;
  }

  function stopPanCoast() {
    velocity.panX = 0;
    velocity.panZ = 0;
  }

  function dropGrab() {
    grabPanActive = false;
    grabWorld = null;
    grabPointerId = null;
  }

  function handlePointerDown(e) {
    if (e.pointerType === 'touch') return false;
    if (e.button !== 2) return false;

    // New press takes over. If the old plant stays live, the first move of
    // the next pan rubber-bands back to that world point.
    stopPanCoast();
    dropGrab();

    rmbPanActive = true;
    rmbDidPan = false;
    rmbPointerId = e.pointerId;
    rmbLastScreen = { x: e.clientX, y: e.clientY };
    rmbDownScreen = { x: e.clientX, y: e.clientY };
    // Don't activate the grab until the drag commits — otherwise 1–10px of
    // click jitter starts a pan and (with the old 5px latch) cancels MOVE.
    e.preventDefault();
    return true;
  }

  function unproject(inv, ndcX, ndcY, depth) {
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * depth + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * depth + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * depth + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * depth + inv[15];
    const iw = 1 / w;
    return [x * iw, y * iw, z * iw];
  }

  /** Ray × look-at plane (usually y=0). Same unproject as gameplay picks. */
  function screenToGround(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth || 1;
    const h = rect.height || canvas.clientHeight || 1;
    let vp;
    try {
      vp = getViewProjectionMatrix(camera, w / h);
    } catch {
      return null;
    }
    const inv = mat4Invert(vp);
    if (!inv) return null;
    const ndcX = (2 * (clientX - rect.left)) / w - 1;
    const ndcY = 1 - (2 * (clientY - rect.top)) / h;
    const near = unproject(inv, ndcX, ndcY, 1);
    const far = unproject(inv, ndcX, ndcY, 0);
    const dy = far[1] - near[1];
    if (Math.abs(dy) < 1e-8) return null;
    const planeY = getTarget().y;
    const t = (planeY - near[1]) / dy;
    if (t < 0) return null;
    return {
      x: near[0] + (far[0] - near[0]) * t,
      z: near[2] + (far[2] - near[2]) * t,
    };
  }

  /** Screen-space px delta → ground-plane world delta (fallback when the ray misses). */
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

  function beginGrabPan(clientX, clientY, pointerId = null) {
    grabPanActive = true;
    grabPointerId = pointerId;
    grabLastScreen = { x: clientX, y: clientY };
    grabWorld = screenToGround(clientX, clientY);
    stopPanCoast();
    markNudged();
  }

  function relockGrab() {
    const hit = screenToGround(grabLastScreen.x, grabLastScreen.y);
    if (hit && grabWorld) {
      const t = getTarget();
      clampTargetPan(t.x + grabWorld.x - hit.x, t.z + grabWorld.z - hit.z);
      return;
    }
    if (hit) grabWorld = hit;
  }

  /**
   * Slide the target so `grabWorld` stays under this screen pixel.
   * Shared by RMB, 1-finger hold-pan, and pinch-centroid.
   */
  function grabPanTo(clientX, clientY, pointerId = null) {
    if (grabPointerId != null && pointerId != null && pointerId !== grabPointerId) {
      return false;
    }
    if (!grabPanActive) beginGrabPan(clientX, clientY, pointerId);
    markNudged();
    const prev = grabLastScreen;
    grabLastScreen = { x: clientX, y: clientY };
    if (grabWorld && screenToGround(clientX, clientY)) {
      relockGrab();
      return true;
    }
    const { wx, wz } = screenDeltaToGroundPan(clientX - prev.x, clientY - prev.y);
    const t = getTarget();
    clampTargetPan(t.x + wx, t.z + wz);
    grabWorld = screenToGround(clientX, clientY);
    return true;
  }

  function endGrabPan() {
    if (rmbPanActive) return;
    grabPanActive = false;
    grabWorld = null;
    grabPointerId = null;
  }

  /** Fallback 1:1 screen-delta pan (sky miss / callers without a plant). */
  function panByScreenDelta(screenDx, screenDy, sensBase = 1) {
    const { wx, wz } = screenDeltaToGroundPan(screenDx, screenDy);
    const s = Number.isFinite(sensBase) ? sensBase : 1;
    markNudged();
    const t = getTarget();
    clampTargetPan(t.x + wx * s, t.z + wz * s);
  }

  function handlePointerMove(e) {
    if (!rmbPanActive) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId) return false;

    // Cumulative from pointer-down — per-event deltas are often < threshold.
    const totalDist = Math.hypot(e.clientX - rmbDownScreen.x, e.clientY - rmbDownScreen.y);
    if (totalDist > PAN_DRAG_THRESHOLD) {
      if (!rmbDidPan) {
        rmbDidPan = true;
        beginGrabPan(e.clientX, e.clientY, e.pointerId);
      } else {
        grabPanTo(e.clientX, e.clientY, e.pointerId);
      }
    }
    rmbLastScreen = { x: e.clientX, y: e.clientY };
    return true;
  }

  function handlePointerUp(e) {
    if (!rmbPanActive) return false;
    if (e.type !== 'pointercancel' && e.button !== 2) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId && e.type !== 'pointercancel') {
      return false;
    }
    if (e.type !== 'pointercancel') {
      const totalDist = Math.hypot(e.clientX - rmbDownScreen.x, e.clientY - rmbDownScreen.y);
      if (totalDist > PAN_DRAG_THRESHOLD) rmbDidPan = true;
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
    const active = document.activeElement;
    if (active && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(active.tagName)) return;
    const key = e.key.toLowerCase();
    const cameraKeys = new Set([
      'w', 'r', 'q', 't', 'e', 's', 'd', 'f', 'a',
      'pageup', 'pagedown',
      'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    ]);
    if (cameraKeys.has(key)) e.preventDefault();
    keyStates[key] = true;
    if (key === 'w' || key === 'pageup') {
      markNudged();
      camera.alpha += KEY_ROT_SPEED;
    } else if (key === 'r' || key === 'pagedown') {
      markNudged();
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
    if (keyStates.w || keyStates.pageup) {
      markNudged();
      camera.alpha += KEY_ROT_SPEED;
    } else if (keyStates.r || keyStates.pagedown) {
      markNudged();
      camera.alpha -= KEY_ROT_SPEED;
    }
    if (keyStates.q) applyZoomInput(KEY_ZOOM_SPEED);
    if (keyStates.t) applyZoomInput(-KEY_ZOOM_SPEED);

    let panX = 0;
    let panZ = 0;
    if (keyStates.e) panZ += 1.0;
    if (keyStates.s) panX += 1.0;
    if (keyStates.d) panZ -= 1.0;
    if (keyStates.f) panX -= 1.0;
    if (keyStates.a) panX -= 0.7;
    if (keyStates.arrowup) panZ += 1.0;
    if (keyStates.arrowdown) panZ -= 1.0;
    if (keyStates.arrowleft) panX += 1.0;
    if (keyStates.arrowright) panX -= 1.0;

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

  function tick(_dtMs) {
    if (!nudged) return;

    applyHeldKeys();

    const { minR, maxR, span } = radiusLimits();
    const normalized = Math.max(0, Math.min(1, (camera.radius - minR) / span));

    velocity.alpha *= MOMENTUM;
    velocity.radius *= MOMENTUM;
    velocity.panX *= PAN_DECAY;
    velocity.panZ *= PAN_DECAY;
    velocity.alpha *= DAMPING;
    velocity.radius *= DAMPING;
    velocity.panX *= PAN_DAMP;
    velocity.panZ *= PAN_DAMP;

    if (Math.abs(velocity.alpha) < ROT_THRESHOLD) velocity.alpha = 0;
    if (Math.abs(velocity.radius) < ZOOM_THRESHOLD) velocity.radius = 0;
    if (Math.abs(velocity.panX) < PAN_THRESHOLD) velocity.panX = 0;
    if (Math.abs(velocity.panZ) < PAN_THRESHOLD) velocity.panZ = 0;

    camera.alpha += velocity.alpha;

    if (!grabPanActive) {
      const t = getTarget();
      clampTargetPan(t.x + velocity.panX, t.z + velocity.panZ);
    } else {
      velocity.panX = 0;
      velocity.panZ = 0;
    }

    camera.radius += velocity.radius * zoomSpeedForNormalized(normalized);
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

    // After zoom/rotate, put the planted world point back under the finger.
    if (grabPanActive) relockGrab();

    // Clear Lite inertial leftovers so they never fight us.
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;

    if (!rmbPanActive && !grabPanActive && !anyKeyHeld() && velocitiesIdle()) {
      nudged = false;
    }
  }

  function reset() {
    velocity.alpha = 0;
    velocity.radius = 0;
    velocity.panX = 0;
    velocity.panZ = 0;
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
    rmbPanActive = false;
    rmbDidPan = false;
    rmbPointerId = null;
    grabPanActive = false;
    grabWorld = null;
    grabPointerId = null;
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
    nudgePan,
    nudgeZoom,
    nudgeRotate,
    beginGrabPan,
    grabPanTo,
    endGrabPan,
    stopPanCoast,
    panByScreenDelta,
    getRadius: () => camera.radius,
    tick,
    reset,
    markNudged,
  };
}
