// Touch gesture adapter — v1's "grab the rim to orbit, center to play" model,
// rebuilt on v2's surfaces instead of globals.
//
// Each touch is classified once, at pointerdown, by where it landed:
//   - Edge band (screen rim): orbits the camera. Tangential drag rotates,
//     inward drag zooms (soft blend between the two near the band's inner
//     edge). Independent per finger — never touches gameplay input.
//   - Center, alone: forwarded to gameInput as a synthetic mouse press. This
//     is the entire reason touch selection/orders/box-select/ability-hold
//     need no new logic here — gameInput already implements all of it from
//     plain {clientX,clientY,button,pointerId} objects, not real PointerEvents.
//   - Center, two fingers landing within a short stagger of each other: a
//     pinch/rotate/pan chord (camera only). A stationary chord (no pinch/pan
//     engaged) is a "two-finger tap" — mirrors RMB-tap semantics (dismiss
//     build UI, else force-move).
//
// Extra simultaneous fingers beyond these get no role (tracked so lift is a
// no-op) — mirrors v1's "lock the primary two, ignore the rest" behavior.

/** Screen-rim band that orbits the camera instead of driving gameplay input. */
const EDGE_ZONE_PX = 48;
/** Inward strip past the band where rotate crossfades to zoom. */
const EDGE_ZOOM_BLEND_PX = 14;
/** Edge-drag ramps from 20% to 100% speed over this long — avoids a jolt on first move. */
const EDGE_RAMP_MS = 350;
/**
 * nudgeRotate/nudgeZoom feed cameraController's velocity, which settles to a
 * steady-state ~1/(1-MOMENTUM*DAMPING) ≈ 19x the per-call amount under a
 * sustained per-frame drag. These are v1's direct-mutation sensitivities
 * (zoneRotateSensitivity / zoneZoomSensitivity) divided by that gain, so a
 * held edge-drag turns/zooms at roughly v1's rate instead of ~19x too fast.
 */
const EDGE_ROTATE_SENS = 0.00093;
/** Fraction of current radius zoomed per px of inward drag (pre-gain-corrected, see above). */
const EDGE_ZOOM_SENS = 0.00078;

/** Second center finger must land within this long of the first to chord into pinch (v1: twoFingerChordMaxStaggerMs). */
const CHORD_MAX_STAGGER_MS = 90;
/** Fraction of radius zoomed per px of pinch span change. */
const PINCH_ZOOM_SENS = 0.0012;
/** nudgeRotate multiplier per radian of finger-pair rotation. */
const PINCH_ROTATE_SENS = 0.047;
/** Same feel as RMB drag-pan (cameraController.panByScreenDelta, RMB_PAN_BASE). */
const TOUCH_PAN_BASE = 5.0;
/** Total span/angle change below which a chord reads as a tap, not a gesture. */
const PINCH_DIST_DEADZONE_PX = 10;
const PINCH_ANGLE_DEADZONE_RAD = 0.05;
/** Stationary two-finger tap window. */
const TWO_FINGER_TAP_MAX_MOVE_PX = 14;
const TWO_FINGER_TAP_MAX_MS = 300;
/** Per-frame jump beyond this resyncs the chord baseline instead of applying it (event coalescing hiccups). */
const ANOMALY_CENTROID_PX = 140;
const ANOMALY_DIST_PX = 80;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {ReturnType<import('../../render/cameraController.js').createCameraController>} opts.camera
 * @param {ReturnType<import('./gameInput.js').createGameInput>} opts.game
 */
export function createTouchAdapter({ canvas, camera, game }) {
  /**
   * @typedef {{
   *   x: number, y: number, startX: number, startY: number, startTime: number,
   *   lastX: number, lastY: number, isEdge: boolean, edgeAxis: 'left'|'right'|'top'|'bottom'|null,
   * }} TouchState
   * @type {Map<number, TouchState>}
   */
  const touches = new Map();

  /** Lone center finger currently forwarded to gameInput as a synthetic LMB. */
  let soloId = null;
  /** @type {[number, number] | null} Two center fingers driving pinch/rotate/pan. */
  let pinchIds = null;
  let pinchBaseline = null;

  function edgeDistance(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const lx = clientX - r.left;
    const ly = clientY - r.top;
    return Math.min(lx, ly, r.width - lx, r.height - ly);
  }

  function edgeAxisAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const lx = clientX - r.left;
    const ly = clientY - r.top;
    const dLeft = lx;
    const dRight = r.width - lx;
    const dTop = ly;
    const dBottom = r.height - ly;
    const dist = Math.min(dLeft, dRight, dTop, dBottom);
    if (dist >= EDGE_ZONE_PX + EDGE_ZOOM_BLEND_PX) return null;
    if (dist === dLeft) return 'left';
    if (dist === dRight) return 'right';
    if (dist === dTop) return 'top';
    return 'bottom';
  }

  /** Rotate/zoom weights blended over the inner strip of the edge band. */
  function edgeWeights(dist) {
    if (dist < EDGE_ZONE_PX) return { rotate: 1, zoom: 0 };
    if (dist >= EDGE_ZONE_PX + EDGE_ZOOM_BLEND_PX) return { rotate: 0, zoom: 1 };
    const t = (dist - EDGE_ZONE_PX) / EDGE_ZOOM_BLEND_PX;
    return { rotate: 1 - t, zoom: t };
  }

  /** Screen-space "grab this edge and drag" — table follows the finger regardless of which rim it's on. */
  function tangentialDelta(axis, dx, dy) {
    switch (axis) {
      case 'left': return -dy;
      case 'right': return dy;
      case 'top': return dx;
      case 'bottom': return -dx;
      default: return 0;
    }
  }

  function synthMouse(type, clientX, clientY, pointerId) {
    return {
      type,
      clientX,
      clientY,
      button: 0,
      pointerId,
      pointerType: 'mouse',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    };
  }

  function beginSolo(id, t) {
    soloId = id;
    game.handlePointerDown(synthMouse('pointerdown', t.x, t.y, id));
  }

  function endSolo(type) {
    const id = soloId;
    const t = id != null ? touches.get(id) : null;
    soloId = null;
    if (id == null || !t) return;
    void game.handlePointerUp(synthMouse(type, t.x, t.y, id));
  }

  function cancelSolo() {
    if (soloId == null) return;
    soloId = null;
    game.cancelDrag();
  }

  function centroidOf(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function distOf(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function angleOf(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  function beginPinch(idA, idB) {
    const a = touches.get(idA);
    const b = touches.get(idB);
    if (!a || !b) return;
    pinchIds = [idA, idB];
    pinchBaseline = {
      startTime: performance.now(),
      movedPx: 0,
      dist: distOf(a, b),
      angle: angleOf(a, b),
      lastCentroid: centroidOf(a, b),
      lastDist: distOf(a, b),
      lastAngle: angleOf(a, b),
      engagedZoom: false,
      engagedRotate: false,
    };
  }

  function endPinch() {
    if (!pinchIds || !pinchBaseline) {
      pinchIds = null;
      pinchBaseline = null;
      return;
    }
    const [idA, idB] = pinchIds;
    const a = touches.get(idA);
    const b = touches.get(idB);
    const b0 = pinchBaseline;
    pinchIds = null;
    pinchBaseline = null;
    const wasTap =
      !b0.engagedZoom &&
      !b0.engagedRotate &&
      b0.movedPx < TWO_FINGER_TAP_MAX_MOVE_PX &&
      performance.now() - b0.startTime < TWO_FINGER_TAP_MAX_MS;
    if (wasTap && a && b) {
      const c = centroidOf(a, b);
      if (!game.dismissMenus?.()) game.forceMoveAt?.(c.x, c.y);
    }
  }

  function updatePinch() {
    if (!pinchIds || !pinchBaseline) return;
    const a = touches.get(pinchIds[0]);
    const b = touches.get(pinchIds[1]);
    if (!a || !b) return;
    const b0 = pinchBaseline;

    const centroid = centroidOf(a, b);
    const dist = distOf(a, b);
    const angle = angleOf(a, b);

    const cdx = centroid.x - b0.lastCentroid.x;
    const cdy = centroid.y - b0.lastCentroid.y;
    const ddist = dist - b0.lastDist;
    let dangle = angle - b0.lastAngle;
    if (dangle > Math.PI) dangle -= 2 * Math.PI;
    if (dangle < -Math.PI) dangle += 2 * Math.PI;

    // Coordinate jump (event coalescing / OS hiccup) — resync without applying.
    if (Math.hypot(cdx, cdy) > ANOMALY_CENTROID_PX || Math.abs(ddist) > ANOMALY_DIST_PX) {
      b0.lastCentroid = centroid;
      b0.lastDist = dist;
      b0.lastAngle = angle;
      return;
    }

    b0.movedPx += Math.hypot(cdx, cdy);
    if (!b0.engagedZoom && Math.abs(dist - b0.dist) > PINCH_DIST_DEADZONE_PX) b0.engagedZoom = true;
    let totalAngle = angle - b0.angle;
    if (totalAngle > Math.PI) totalAngle -= 2 * Math.PI;
    if (totalAngle < -Math.PI) totalAngle += 2 * Math.PI;
    if (!b0.engagedRotate && Math.abs(totalAngle) > PINCH_ANGLE_DEADZONE_RAD) b0.engagedRotate = true;

    if (b0.engagedZoom && Math.abs(ddist) > 0.05) {
      camera.nudgeZoom(-ddist * PINCH_ZOOM_SENS * camera.getRadius());
    }
    if (b0.engagedRotate && Math.abs(dangle) > 1e-4) {
      camera.nudgeRotate(dangle * PINCH_ROTATE_SENS);
    }
    if (Math.abs(cdx) > 0.05 || Math.abs(cdy) > 0.05) {
      camera.panByScreenDelta(cdx, cdy, TOUCH_PAN_BASE);
    }

    b0.lastCentroid = centroid;
    b0.lastDist = dist;
    b0.lastAngle = angle;
  }

  function applyEdgeCamera(t) {
    const dx = t.x - t.lastX;
    const dy = t.y - t.lastY;
    t.lastX = t.x;
    t.lastY = t.y;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) return;

    const ramp = Math.min(1, 0.2 + 0.8 * ((performance.now() - t.startTime) / EDGE_RAMP_MS));
    const w = edgeWeights(edgeDistance(t.x, t.y));
    const tangential = tangentialDelta(t.edgeAxis, dx, dy);

    if (w.rotate > 0) camera.nudgeRotate(tangential * EDGE_ROTATE_SENS * ramp * w.rotate);
    if (w.zoom > 0) camera.nudgeZoom(-dy * EDGE_ZOOM_SENS * camera.getRadius() * ramp * w.zoom);
  }

  function handlePointerDown(e) {
    const id = e.pointerId;
    if (touches.has(id)) return;
    const edgeAxis = edgeAxisAt(e.clientX, e.clientY);
    /** @type {TouchState} */
    const t = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      lastX: e.clientX,
      lastY: e.clientY,
      isEdge: edgeAxis != null,
      edgeAxis,
    };
    touches.set(id, t);

    if (t.isEdge) return; // Edge fingers only ever drive camera, on move.

    if (soloId == null) {
      if (pinchIds == null) beginSolo(id, t);
      return; // Chord already active — extra finger gets no role.
    }
    const solo = touches.get(soloId);
    const stagger = solo ? t.startTime - solo.startTime : Infinity;
    if (pinchIds == null && stagger <= CHORD_MAX_STAGGER_MS) {
      const prevSoloId = soloId;
      cancelSolo();
      beginPinch(prevSoloId, id);
    }
    // Else: a later, non-chorded extra finger — leave the solo gesture alone.
  }

  function handlePointerMove(e) {
    const id = e.pointerId;
    const t = touches.get(id);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;

    if (t.isEdge) {
      applyEdgeCamera(t);
      return;
    }
    if (soloId === id) {
      game.handlePointerMove(synthMouse('pointermove', t.x, t.y, id));
      return;
    }
    if (pinchIds && (pinchIds[0] === id || pinchIds[1] === id)) {
      updatePinch();
    }
  }

  function handlePointerUp(e) {
    const id = e.pointerId;
    const t = touches.get(id);
    if (!t) {
      return;
    }
    const cancelled = e.type === 'pointercancel';

    if (t.isEdge) {
      touches.delete(id);
      return;
    }
    if (soloId === id) {
      endSolo(cancelled ? 'pointercancel' : 'pointerup');
      touches.delete(id);
      return;
    }
    if (pinchIds && (pinchIds[0] === id || pinchIds[1] === id)) {
      const otherId = pinchIds[0] === id ? pinchIds[1] : pinchIds[0];
      endPinch();
      touches.delete(id);
      // One finger of a chord lifts, the other keeps touching — hand it back to gameplay.
      const other = touches.get(otherId);
      if (!cancelled && other && !other.isEdge) beginSolo(otherId, other);
      return;
    }
    touches.delete(id);
  }

  /** Blur / focus loss — drop all in-flight gesture state without emitting synthetic events. */
  function reset() {
    if (soloId != null) game.cancelDrag();
    soloId = null;
    pinchIds = null;
    pinchBaseline = null;
    touches.clear();
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    reset,
  };
}
