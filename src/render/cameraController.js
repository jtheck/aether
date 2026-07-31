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
const RMB_PAN_BASE = 5;
const PAN_DRAG_THRESHOLD = 5;

const DOUBLE_CLICK_MS = 300;
const DOUBLE_CLICK_PX = 10;

const MIN_BETA = 1.2;
const MAX_BETA = 0.82;

const DEFAULT_ALPHA = -Math.PI / 2.1;
const DEFAULT_BETA = Math.PI / 3.2;
// Zoom tracks board half-extent (800×800 → WORLD_HALF_F = 400).
const DEFAULT_RADIUS = WORLD_HALF_F * 1.55;
const RESET_RADIUS = WORLD_HALF_F * 1.8;
const LOWER_RADIUS = 40;
const UPPER_RADIUS = WORLD_HALF_F * 3.5;
/** v1's typical play radius; used to remap (60/r)^1.5 onto v2's larger default zoom. */
const V1_REF_RADIUS = 80;

/**
 * @param {object} camera Lite ArcRotateCamera
 * @param {HTMLCanvasElement} canvas
 * @param {{ onClearSelection?: () => void }} [opts]
 */
export function createCameraController(camera, canvas, opts = {}) {
  const velocity = { alpha: 0, radius: 0, panX: 0, panZ: 0 };
  const keyStates = Object.create(null);
  let nudged = false;
  let onClearSelection = opts.onClearSelection ?? null;

  let rmbPanActive = false;
  let rmbDidPan = false;
  let rmbLastScreen = { x: 0, y: 0 };
  let rmbPointerId = null;
  let lastRightClickTime = 0;
  let lastRightClickPos = { x: 0, y: 0 };

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
    const min = -WORLD_HALF_F + margin;
    const max = WORLD_HALF_F - margin;
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

  function nudgeZoom(delta) {
    markNudged();
    velocity.radius += delta;
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
      velocity.radius += INVERSE_ZOOM * delta * ZOOM_WHEEL;
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

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();
    const dist = Math.hypot(x - lastRightClickPos.x, y - lastRightClickPos.y);
    if (now - lastRightClickTime < DOUBLE_CLICK_MS && dist < DOUBLE_CLICK_PX) {
      onClearSelection?.();
      lastRightClickTime = 0;
      lastRightClickPos = { x: 0, y: 0 };
      e.preventDefault();
      return true;
    }
    lastRightClickTime = now;
    lastRightClickPos = { x, y };

    rmbPanActive = true;
    rmbDidPan = false;
    rmbPointerId = e.pointerId;
    rmbLastScreen = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    return true;
  }

  function handlePointerMove(e) {
    if (!rmbPanActive) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId) return false;

    const cam = camera;
    const rect = canvas.getBoundingClientRect();
    const fov = cam.fov ?? 0.8;
    const pixelsToWorld =
      (2 * (cam.radius || 60) * Math.tan(fov / 2)) / Math.max(1, rect.height);
    const screenDx = e.clientX - rmbLastScreen.x;
    const screenDy = e.clientY - rmbLastScreen.y;
    const panDistance = Math.hypot(screenDx, screenDy);
    if (panDistance > PAN_DRAG_THRESHOLD) rmbDidPan = true;
    rmbLastScreen = { x: e.clientX, y: e.clientY };

    const { rightX, rightZ, forwardX, forwardZ } = groundAxes();
    const wx = rightX * screenDx * pixelsToWorld + forwardX * screenDy * pixelsToWorld;
    const wz = rightZ * screenDx * pixelsToWorld + forwardZ * screenDy * pixelsToWorld;

    // v1: basePanSens * min(1, (60/r)^1.5), with r remapped so DEFAULT_RADIUS ≈ v1's ~80.
    const r = Math.max(1, cam.radius || DEFAULT_RADIUS);
    const effectiveR = r * (V1_REF_RADIUS / DEFAULT_RADIUS);
    const zoomFactor = Math.min(1.0, Math.pow(60 / effectiveR, 1.5));
    const panSens = RMB_PAN_BASE * zoomFactor;

    markNudged();
    velocity.panX += wx * panSens;
    velocity.panZ += wz * panSens;
    return true;
  }

  function handlePointerUp(e) {
    if (!rmbPanActive) return false;
    if (e.type !== 'pointercancel' && e.button !== 2) return false;
    if (rmbPointerId != null && e.pointerId !== rmbPointerId && e.type !== 'pointercancel') {
      return false;
    }
    return endRmbPan();
  }

  function clearKeyStates() {
    for (const k of Object.keys(keyStates)) keyStates[k] = false;
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
      markNudged();
      velocity.radius += 2.0;
    } else if (key === 't') {
      markNudged();
      velocity.radius -= 2.0;
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
    if (keyStates.q) {
      markNudged();
      velocity.radius += KEY_ZOOM_SPEED;
    }
    if (keyStates.t) {
      markNudged();
      velocity.radius -= KEY_ZOOM_SPEED;
    }

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

    // Zoom → beta coupling
    const minR = camera.lowerRadiusLimit ?? LOWER_RADIUS;
    const maxR = camera.upperRadiusLimit ?? UPPER_RADIUS;
    const normalized = Math.max(
      0,
      Math.min(1, (camera.radius - minR) / Math.max(1e-6, maxR - minR)),
    );
    const targetBeta = MIN_BETA + normalized * (MAX_BETA - MIN_BETA);
    if (Math.abs(camera.beta - targetBeta) < 0.01) camera.beta = targetBeta;
    else camera.beta += (targetBeta - camera.beta) * 0.35;

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

    const t = getTarget();
    clampTargetPan(t.x + velocity.panX, t.z + velocity.panZ);

    camera.radius += velocity.radius;
    camera.radius = Math.max(minR, Math.min(maxR, camera.radius));

    const loB = camera.lowerBetaLimit ?? 0.1;
    const hiB = camera.upperBetaLimit ?? 1.5;
    camera.beta = Math.max(loB, Math.min(hiB, camera.beta));

    // Clear Lite inertial leftovers so they never fight us.
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    camera.inertialAlphaOffset = 0;
    camera.inertialBetaOffset = 0;
    camera.inertialRadiusOffset = 0;

    if (!rmbPanActive && !anyKeyHeld() && velocitiesIdle()) {
      nudged = false;
    }
  }

  function reset() {
    velocity.alpha = 0;
    velocity.radius = 0;
    velocity.panX = 0;
    velocity.panZ = 0;
    camera.alpha = DEFAULT_ALPHA;
    camera.beta = DEFAULT_BETA;
    camera.radius = RESET_RADIUS;
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
    isRmbPanning,
    nudgePan,
    nudgeZoom,
    nudgeRotate,
    tick,
    reset,
    markNudged,
    setClearSelection(fn) {
      onClearSelection = fn;
    },
  };
}
