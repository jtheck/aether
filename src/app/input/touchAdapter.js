// Touch gesture adapter — v1's "grab the rim to orbit, center to play" model,
// rebuilt on v2's surfaces instead of globals.
//
// Parallel by default (per pointerId), with one narrow merge exception:
//   - Edge band: each rim finger orbits (rotate only for now — inward zoom off).
//   - Center finger: brief still hold → pan; early drag → synth LMB (box);
//     short lift → tap. Each center contact runs its own pan-hold / pan /
//     action stream so one hand can pan while the other selects / a-moves.
//   - Chord: two *uncommitted* center fingers within CHORD_MAX_STAGGER_MS
//     merge into pinch/rotate/pan. Extra fingers during a live chord still get
//     their own stream: tap → force-move (can't cleanly 2-finger-tap while
//     already chorded), drag → box-select. A finger already panning, soloing,
//     or on the rim never upgrades into a chord (late 2nd finger stays independent).
//   - Gameplay LMB is a single seat (gameInput): at most one solo stream;
//     a new solo take over cancels the previous. Camera pan has no such limit.
//
// Double-tap cast vs select-all lives in gameInput, not here.

import { DRAG_THRESHOLD_PX } from './gameInput.js';

/** Screen-rim band that orbits the camera instead of driving gameplay input. */
const EDGE_ZONE_PX = 48;
/** Edge-drag ramps from 20% to 100% speed over this long — avoids a jolt on first move. */
const EDGE_RAMP_MS = 350;
/**
 * nudgeRotate feeds cameraController's velocity (~19x steady-state gain).
 * Pre-gain-corrected so held edge-drag turns at roughly v1's rate.
 */
const EDGE_ROTATE_SENS = 0.00093;
// Edge inward-zoom intentionally omitted while tuning — rim drag is rotate-only.

/** Second center finger must land within this long of the first to chord into pinch (v1: twoFingerChordMaxStaggerMs). */
const CHORD_MAX_STAGGER_MS = 90;
/** Fraction of radius zoomed per px of pinch span change. */
const PINCH_ZOOM_SENS = 0.0012;
/** nudgeRotate multiplier per radian of finger-pair rotation. */
const PINCH_ROTATE_SENS = 0.16;
/** Same feel as RMB drag-pan (cameraController.panByScreenDelta, RMB_PAN_BASE). */
const TOUCH_PAN_BASE = 5.0;
/** Total span/angle/centroid change before a chord engages that axis (tap vs gesture). */
const PINCH_DIST_DEADZONE_PX = 10;
/** ~0.45° — engage twist almost immediately (cumulative |dangle| also counts). */
const PINCH_ANGLE_DEADZONE_RAD = 0.008;
/** Per-frame twist that counts even before total-from-start crosses the deadzone. */
const PINCH_ANGLE_FRAME_ENGAGE_RAD = 0.0035;
/** 2-finger pan engage distance — keep low so chord pan feels as immediate as 1-finger hold-pan. */
const PINCH_PAN_DEADZONE_PX = 8;
/** 1 rad of twist ≈ this many px of "emphasis" when ranking pan/zoom/rotate. */
const PINCH_ROT_EMPHASIS_PX = 380;
/** EMA blend for per-frame emphasis scores (higher = snappier handoff). */
const PINCH_EMPHASIS_EMA = 0.45;
/** Winner emphasis exponent — >1 favors the strongest axis without zeroing the others. */
const PINCH_EMPHASIS_POWER = 1.75;
/** Floor so a non-dominant engaged axis still contributes a little (blend, not either/or). */
const PINCH_WEIGHT_FLOOR = 0.18;
/**
 * Two-finger tap → force-move. Judged from total motion, not engage latches
 * (rotate/pan latch on tiny jitter and were killing legitimate taps).
 */
const TWO_FINGER_TAP_MAX_MS = 420;
/** Cumulative centroid path while both fingers down. */
const TWO_FINGER_TAP_MAX_PATH_PX = 40;
/** Net centroid drift from chord start. */
const TWO_FINGER_TAP_MAX_CENTROID_PX = 32;
/** |span change| from chord start. */
const TWO_FINGER_TAP_MAX_SPAN_DELTA_PX = 28;
/** Cumulative |dangle| — ~7° of jitter still counts as a tap. */
const TWO_FINGER_TAP_MAX_ANGLE_RAD = 0.12;
/** Per-frame jump beyond this resyncs the chord baseline instead of applying it (event coalescing hiccups). */
const ANOMALY_CENTROID_PX = 140;
const ANOMALY_DIST_PX = 80;

/** v1 centerPanHoldMs — still this long → commit one-finger pan. */
const CENTER_PAN_HOLD_MS = 95;
/** v1 centerPanHoldMaxMovePx — move farther before hold fires → cancel pan arm. */
const CENTER_PAN_HOLD_MAX_MOVE_PX = 10;
const CENTER_PAN_HOLD_MAX_MOVE_SQ = CENTER_PAN_HOLD_MAX_MOVE_PX * CENTER_PAN_HOLD_MAX_MOVE_PX;
const BOX_DRAG_THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {ReturnType<import('../../render/cameraController.js').createCameraController>} opts.camera
 * @param {ReturnType<import('./gameInput.js').createGameInput>} opts.game
 */
export function createTouchAdapter({ canvas, camera, game }) {
  /**
   * role:
   *   edge    — rim camera
   *   pending — center, pan-hold vs tap/box not decided
   *   pan     — center camera pan
   *   solo    — synth LMB into gameInput
   *   pinch   — member of active two-finger chord
   *
   * @typedef {{
   *   x: number, y: number, startX: number, startY: number, startTime: number,
   *   lastX: number, lastY: number,
   *   isEdge: boolean, edgeAxis: 'left'|'right'|'top'|'bottom'|null,
   *   role: 'edge' | 'pending' | 'pan' | 'solo' | 'pinch',
   *   suppressTap?: boolean,
   *   forceMoveOnTap?: boolean, // tap during live 2-finger chord → force-move
   * }} TouchState
   * @type {Map<number, TouchState>}
   */
  const touches = new Map();

  /** Per-pointer pan-hold timers (parallel center fingers each get their own). */
  const panHoldTimers = new Map();

  /** At most one gameplay LMB stream (gameInput single dragPointerId). */
  let soloId = null;
  /** @type {[number, number] | null} */
  let pinchIds = null;
  let pinchBaseline = null;

  function edgeAxisAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const lx = clientX - r.left;
    const ly = clientY - r.top;
    const dLeft = lx;
    const dRight = r.width - lx;
    const dTop = ly;
    const dBottom = r.height - ly;
    const dist = Math.min(dLeft, dRight, dTop, dBottom);
    // Rim only — no inward blend band while edge zoom is disabled.
    if (dist >= EDGE_ZONE_PX) return null;
    if (dist === dLeft) return 'left';
    if (dist === dRight) return 'right';
    if (dist === dTop) return 'top';
    return 'bottom';
  }

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
      pointerType: 'touch',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    };
  }

  function clearPanHoldTimerFor(id) {
    const t = panHoldTimers.get(id);
    if (t != null) {
      clearTimeout(t);
      panHoldTimers.delete(id);
    }
  }

  function clearAllPanHoldTimers() {
    for (const t of panHoldTimers.values()) clearTimeout(t);
    panHoldTimers.clear();
  }

  /** Uncommitted center finger that can still merge into a pinch chord. */
  function chordEligible(t) {
    return t && !t.isEdge && t.role === 'pending';
  }

  function beginSolo(id, t, clientX = t.startX, clientY = t.startY) {
    clearPanHoldTimerFor(id);
    // Single gameplay seat — take over if another finger was boxing/tapping.
    if (soloId != null && soloId !== id) {
      const prev = touches.get(soloId);
      soloId = null;
      game.cancelDrag();
      if (prev && prev.role === 'solo') {
        prev.role = 'pan';
        prev.lastX = prev.x;
        prev.lastY = prev.y;
      }
    }
    soloId = id;
    t.role = 'solo';
    game.handlePointerDown(synthMouse('pointerdown', clientX, clientY, id));
  }

  function endSolo(type, t) {
    const id = soloId;
    soloId = null;
    if (id == null) return;
    const touch = t && t.role === 'solo' ? t : touches.get(id);
    if (!touch) {
      game.cancelDrag();
      return;
    }
    if (touch.role === 'solo') touch.role = 'pending';
    void game.handlePointerUp(synthMouse(type, touch.x, touch.y, id));
  }

  function cancelSolo() {
    if (soloId == null) return;
    const id = soloId;
    soloId = null;
    const t = touches.get(id);
    if (t && t.role === 'solo') t.role = 'pending';
    game.cancelDrag();
  }

  function startPanHoldTimer(id) {
    clearPanHoldTimerFor(id);
    const delay = Math.max(1, CENTER_PAN_HOLD_MS);
    const timeoutId = setTimeout(() => {
      panHoldTimers.delete(id);
      const t = touches.get(id);
      if (!t || t.role !== 'pending') return;
      const mdx = t.x - t.startX;
      const mdy = t.y - t.startY;
      if (mdx * mdx + mdy * mdy > CENTER_PAN_HOLD_MAX_MOVE_SQ) return;
      t.role = 'pan';
      t.lastX = t.x;
      t.lastY = t.y;
    }, delay);
    panHoldTimers.set(id, timeoutId);
  }

  function reanchorTouch(t) {
    t.startX = t.x;
    t.startY = t.y;
    t.startTime = performance.now();
    t.lastX = t.x;
    t.lastY = t.y;
  }

  function armCenterFinger(id, t) {
    if (game.isPlacing?.()) {
      beginSolo(id, t);
      return;
    }
    t.role = 'pending';
    // While pinching/rotating/2-finger-panning, a free finger can't start a new
    // 2-finger tap — treat its tap as force-move (same order as 2-finger tap).
    if (pinchIds != null) t.forceMoveOnTap = true;
    startPanHoldTimer(id);
  }

  /** After chord break — fresh ambient baseline so survivors don't inherit a huge drag. */
  function armSurvivor(id, t) {
    reanchorTouch(t);
    armCenterFinger(id, t);
  }

  function applyCenterPan(t) {
    const dx = t.x - t.lastX;
    const dy = t.y - t.lastY;
    t.lastX = t.x;
    t.lastY = t.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    camera.panByScreenDelta(dx, dy, TOUCH_PAN_BASE);
  }

  function updatePendingMove(id, t) {
    const mdx = t.x - t.startX;
    const mdy = t.y - t.startY;
    const movedSq = mdx * mdx + mdy * mdy;
    if (panHoldTimers.has(id) && movedSq > CENTER_PAN_HOLD_MAX_MOVE_SQ) {
      clearPanHoldTimerFor(id);
    }
    if (movedSq < BOX_DRAG_THRESHOLD_SQ) return;
    beginSolo(id, t, t.startX, t.startY);
    game.handlePointerMove(synthMouse('pointermove', t.x, t.y, id));
  }

  function fireTap(id, t, cancelled) {
    clearPanHoldTimerFor(id);
    // Chord survivors must not synth-LMB on lift — that was issuing a-move after pinch/rotate.
    if (cancelled || t.suppressTap) {
      if (t.role === 'pending') t.role = 'pan';
      return;
    }
    if (t.forceMoveOnTap) {
      game.forceMoveAt?.(t.x, t.y);
      return;
    }
    beginSolo(id, t, t.startX, t.startY);
    endSolo('pointerup', t);
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
    clearPanHoldTimerFor(idA);
    clearPanHoldTimerFor(idB);
    if (soloId === idA || soloId === idB) cancelSolo();
    a.role = 'pinch';
    b.role = 'pinch';
    pinchIds = [idA, idB];
    const c0 = centroidOf(a, b);
    pinchBaseline = {
      startTime: performance.now(),
      movedPx: 0,
      dist: distOf(a, b),
      angle: angleOf(a, b),
      startCentroid: c0,
      lastCentroid: c0,
      lastDist: distOf(a, b),
      lastAngle: angleOf(a, b),
      angleAccum: 0,
      emaZoom: 0,
      emaRotate: 0,
      emaPan: 0,
      engagedZoom: false,
      engagedRotate: false,
      engagedPan: false,
    };
  }

  function endPinch() {
    if (!pinchIds || !pinchBaseline) {
      pinchIds = null;
      pinchBaseline = null;
      return false;
    }
    const [idA, idB] = pinchIds;
    const a = touches.get(idA);
    const b = touches.get(idB);
    const b0 = pinchBaseline;
    pinchIds = null;
    pinchBaseline = null;
    // Never treat a post-chord lift as a 1-finger tap (a-move / select).
    if (a) {
      a.role = 'pending';
      a.suppressTap = true;
    }
    if (b) {
      b.role = 'pending';
      b.suppressTap = true;
    }
    let wasTap = false;
    if (a && b) {
      const dur = performance.now() - b0.startTime;
      const spanDelta = Math.abs(distOf(a, b) - b0.dist);
      const centroidDrift = Math.hypot(
        centroidOf(a, b).x - b0.startCentroid.x,
        centroidOf(a, b).y - b0.startCentroid.y,
      );
      wasTap =
        dur < TWO_FINGER_TAP_MAX_MS &&
        b0.movedPx < TWO_FINGER_TAP_MAX_PATH_PX &&
        centroidDrift < TWO_FINGER_TAP_MAX_CENTROID_PX &&
        spanDelta < TWO_FINGER_TAP_MAX_SPAN_DELTA_PX &&
        b0.angleAccum < TWO_FINGER_TAP_MAX_ANGLE_RAD;
      if (wasTap) {
        const c = centroidOf(a, b);
        // Stationary 2-finger tap — force-move, not synth LMB a-move.
        if (!game.dismissMenus?.()) game.forceMoveAt?.(c.x, c.y);
      }
    }
    return wasTap;
  }

  /**
   * Soft weights from EMA'd emphasis scores. Dominant axis gets most of the
   * motion; others keep a floor so you can zoom→pan→twist in one chord.
   */
  function chordAxisWeights(b0) {
    const z = Math.pow(Math.max(0, b0.emaZoom), PINCH_EMPHASIS_POWER);
    const r = Math.pow(Math.max(0, b0.emaRotate), PINCH_EMPHASIS_POWER);
    const p = Math.pow(Math.max(0, b0.emaPan), PINCH_EMPHASIS_POWER);
    const sum = z + r + p;
    if (sum < 1e-6) return { zoom: 1, rotate: 1, pan: 1 };
    const floor = PINCH_WEIGHT_FLOOR;
    const scale = 1 - floor;
    return {
      zoom: floor + (scale * z) / sum,
      rotate: floor + (scale * r) / sum,
      pan: floor + (scale * p) / sum,
    };
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

    if (Math.hypot(cdx, cdy) > ANOMALY_CENTROID_PX || Math.abs(ddist) > ANOMALY_DIST_PX) {
      b0.lastCentroid = centroid;
      b0.lastDist = dist;
      b0.lastAngle = angle;
      return;
    }

    const panPxRaw = Math.hypot(cdx, cdy);
    const absDangle = Math.abs(dangle);
    b0.movedPx += panPxRaw;
    b0.angleAccum += absDangle;

    // Latch engagement — once an axis has proven intent, it stays available
    // for the rest of the chord (no restart needed to switch).
    if (!b0.engagedZoom && Math.abs(dist - b0.dist) > PINCH_DIST_DEADZONE_PX) b0.engagedZoom = true;
    let totalAngle = angle - b0.angle;
    if (totalAngle > Math.PI) totalAngle -= 2 * Math.PI;
    if (totalAngle < -Math.PI) totalAngle += 2 * Math.PI;
    if (
      !b0.engagedRotate &&
      (Math.abs(totalAngle) > PINCH_ANGLE_DEADZONE_RAD ||
        b0.angleAccum > PINCH_ANGLE_DEADZONE_RAD ||
        absDangle > PINCH_ANGLE_FRAME_ENGAGE_RAD)
    ) {
      b0.engagedRotate = true;
    }
    if (
      !b0.engagedPan &&
      Math.hypot(centroid.x - b0.startCentroid.x, centroid.y - b0.startCentroid.y) >
        PINCH_PAN_DEADZONE_PX
    ) {
      b0.engagedPan = true;
    }

    // Twist always drifts the centroid a bit — don't let that steal emphasis from rotate.
    const rotPx = absDangle * PINCH_ROT_EMPHASIS_PX;
    const panPx = Math.max(0, panPxRaw - rotPx * 0.4);

    // Dynamic emphasis: whichever motion is strongest right now leads.
    const aEma = PINCH_EMPHASIS_EMA;
    b0.emaZoom += (Math.abs(ddist) - b0.emaZoom) * aEma;
    b0.emaRotate += (rotPx - b0.emaRotate) * aEma;
    b0.emaPan += (panPx - b0.emaPan) * aEma;
    const w = chordAxisWeights(b0);

    if (b0.engagedZoom && Math.abs(ddist) > 0.05) {
      camera.nudgeZoom(-ddist * PINCH_ZOOM_SENS * camera.getRadius() * w.zoom);
    }
    if (b0.engagedRotate && Math.abs(dangle) > 1e-4) {
      camera.nudgeRotate(dangle * PINCH_ROTATE_SENS * w.rotate);
    }
    // Pan: full 1-finger strength when slide leads; only soften when zoom/twist dominate.
    if (b0.engagedPan && panPxRaw > 0.05) {
      const panLeads =
        b0.emaPan >= b0.emaZoom * 0.85 && b0.emaPan >= b0.emaRotate * 0.85;
      const panScale = panLeads ? 1 : w.pan;
      camera.panByScreenDelta(cdx * panScale, cdy * panScale, TOUCH_PAN_BASE);
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
    const tangential = tangentialDelta(t.edgeAxis, dx, dy);
    camera.nudgeRotate(tangential * EDGE_ROTATE_SENS * ramp);
  }

  /** Find another pending center finger that can chord with `id` (simultaneous, uncommitted). */
  function findChordPartner(id, t) {
    if (pinchIds != null) return null;
    for (const [otherId, other] of touches) {
      if (otherId === id) continue;
      if (!chordEligible(other) || !chordEligible(t)) continue;
      if (Math.abs(t.startTime - other.startTime) > CHORD_MAX_STAGGER_MS) continue;
      return otherId;
    }
    return null;
  }

  function handlePointerDown(e) {
    const id = e.pointerId;
    // Replace any ghost with the same id (OS reuse after a missed up).
    if (touches.has(id)) releasePointer(id, 'pointercancel', /*emitTap*/ false);

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
      role: edgeAxis != null ? 'edge' : 'pending',
    };
    touches.set(id, t);

    if (t.isEdge) return;

    const partnerId = findChordPartner(id, t);
    if (partnerId != null) {
      beginPinch(partnerId, id);
      return;
    }

    // Independent stream — including a 3rd+ finger while a 2-finger chord is live
    // (camera chord + tap → force-move; drag → box-select).
    armCenterFinger(id, t);
  }

  function handlePointerMove(e) {
    const id = e.pointerId;
    const t = touches.get(id);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;

    switch (t.role) {
      case 'edge':
        applyEdgeCamera(t);
        return;
      case 'pan':
        applyCenterPan(t);
        return;
      case 'pending':
        updatePendingMove(id, t);
        return;
      case 'solo':
        game.handlePointerMove(synthMouse('pointermove', t.x, t.y, id));
        return;
      case 'pinch':
        if (pinchIds && (pinchIds[0] === id || pinchIds[1] === id)) updatePinch();
        return;
      default:
        return;
    }
  }

  /**
   * Fully detach a pointer. Always safe to call — clears role seats, timers,
   * synth LMB, and pinch membership so nothing stays "stuck active".
   */
  function releasePointer(id, upType, emitTap) {
    const t = touches.get(id);
    if (!t) {
      clearPanHoldTimerFor(id);
      if (soloId === id) {
        soloId = null;
        game.cancelDrag();
      }
      return;
    }

    const cancelled = upType === 'pointercancel';
    clearPanHoldTimerFor(id);

    if (t.role === 'pinch' && pinchIds && (pinchIds[0] === id || pinchIds[1] === id)) {
      const otherId = pinchIds[0] === id ? pinchIds[1] : pinchIds[0];
      endPinch();
      touches.delete(id);
      const other = touches.get(otherId);
      if (!cancelled && other && !other.isEdge && other.role === 'pending') {
        // Keep camera control if they stay down; lift will not a-move (suppressTap).
        armSurvivor(otherId, other);
      }
      return;
    }

    if (t.role === 'solo' || soloId === id) {
      endSolo(cancelled ? 'pointercancel' : upType, t);
      touches.delete(id);
      return;
    }

    if (t.role === 'pending' && emitTap && !cancelled) {
      fireTap(id, t, false);
      touches.delete(id);
      return;
    }

    // pan / edge / cancelled pending — drop quietly
    if (soloId === id) {
      soloId = null;
      game.cancelDrag();
    }
    touches.delete(id);
  }

  function handlePointerUp(e) {
    const id = e.pointerId;
    const cancelled = e.type === 'pointercancel';
    releasePointer(id, cancelled ? 'pointercancel' : 'pointerup', /*emitTap*/ true);
  }

  /** Blur / focus loss / visibility — hard clear so no ghost blocks future gestures. */
  function reset() {
    clearAllPanHoldTimers();
    if (soloId != null) {
      soloId = null;
      game.cancelDrag();
    }
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
