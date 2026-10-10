// Headset select. Trigger down shows that hand's beam; turning the controller
// past a few degrees while held paints a lasso on the field, release selects
// inside it. A trigger tap that never turned selects what the beam hit at the
// press (aim-assisted onto a nearby unit). Grip held adds to the selection.
// Both hands run their own gesture; when they overlap, the later release adds
// to the earlier one so two lassos make one selection.

import { lassoOuterLoop } from './input/gamepadLasso.js';
import { readQuestTouch } from './xrRig.js';

/** Stroke sample spacing as a fraction of head height over the field. */
const SAMPLE_FRAC = 0.012;
/** Controller turn (from the press aim) that turns a tap into a lasso. */
const TAP_DEG = 3;
export const TAP_COS = Math.cos((TAP_DEG * Math.PI) / 180);
/** Tap aim assist reach around the beam's ground hit, as a fraction of head height. */
const TAP_SLOP_FRAC = 0.025;
/** Lasso line width as a fraction of head height. */
const LINE_FRAC = 0.006;
const LINE_MIN = 0.08;
/** Beam length when the ray misses the field, in head heights. */
const MISS_REACH = 3;
export const STROKE_MAX_PTS = 160;

/**
 * Controller target ray in Lite's scene space: origin is the translation,
 * forward is the third basis column.
 * @param {Float32Array | number[]} m
 */
export function controllerRay(m) {
  const dx = m[8];
  const dy = m[9];
  const dz = m[10];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-8)) return null;
  return { ox: m[12], oy: m[13], oz: m[14], dx: dx / len, dy: dy / len, dz: dz / len };
}

/**
 * Append a ground hit once it is `spacing` away from the last sample. A full
 * stroke keeps tracking with its last slot.
 * @param {{ x: number, z: number }[]} stroke
 */
export function noteStrokePoint(stroke, x, z, spacing, max = STROKE_MAX_PTS) {
  const n = stroke.length;
  if (n === 0) {
    stroke.push({ x, z });
    return;
  }
  const last = stroke[n - 1];
  if (Math.hypot(x - last.x, z - last.z) < spacing) return;
  if (n >= max) {
    last.x = x;
    last.z = z;
    return;
  }
  stroke.push({ x, z });
}

/** Furthest any sample strays from the first one. */
export function strokeReach(stroke) {
  const n = stroke?.length ?? 0;
  if (n < 2) return 0;
  const a = stroke[0];
  let best = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(stroke[i].x - a.x, stroke[i].z - a.z);
    if (d > best) best = d;
  }
  return best;
}

/**
 * Outer loop of the stroke on the field (same hull rule as the desktop lasso).
 * @param {{ x: number, z: number }[]} stroke
 * @returns {{ x: number, z: number }[]}
 */
export function strokeLoop(stroke) {
  const flat = new Array(stroke.length);
  for (let i = 0; i < stroke.length; i++) flat[i] = { x: stroke[i].x, y: stroke[i].z };
  const hull = lassoOuterLoop(flat);
  const out = new Array(hull.length);
  for (let i = 0; i < hull.length; i++) out[i] = { x: hull[i].x, z: hull[i].y };
  return out;
}

function triggerHeld(src) {
  return !!(src.gamepad?.buttons?.[0]?.pressed || src.selecting);
}

/**
 * @param {{
 *   renderer: { rayToGround: Function, groundHeight: Function, setXrSelect: Function },
 *   getInput: () => ({ groundLoopSelect?: Function, selectAtRay?: Function } | null | undefined),
 * }} opts
 */
export function createXrSelect({ renderer, getInput }) {
  /** @type {Map<object, boolean>} trigger state last frame, per XRInputSource */
  const wasHeld = new Map();
  /**
   * Live gestures, one per XRInputSource.
   * @type {Map<object, {
   *   slot: string,
   *   pressRay: { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number },
   *   pressHit: { x: number, y: number, z: number } | null,
   *   pressHead: number,
   *   minDot: number,
   *   stroke: { x: number, z: number }[],
   * }>}
   */
  const gestures = new Map();
  /** A release that overlapped another live gesture: the next release adds. */
  let chainAdd = false;

  function headHeight(ray) {
    const floor = renderer.groundHeight(ray.ox, ray.oz);
    return Math.max(1, ray.oy - (Number.isFinite(floor) ? floor : 0));
  }

  function end(key, g) {
    gestures.delete(key);
    renderer.setXrSelect(g.slot, null);
    if (gestures.size === 0) chainAdd = false;
  }

  function finish(key, g, src) {
    const grip = readQuestTouch(src.gamepad).grip.pressed;
    const add = grip || chainAdd;
    const swept = g.minDot < TAP_COS;
    const loop = swept ? strokeLoop(g.stroke) : null;
    end(key, g);
    if (gestures.size > 0) chainAdd = true;
    const input = getInput();
    if (!input) return;
    if (loop && loop.length >= 3) {
      input.groundLoopSelect?.(loop, add);
      return;
    }
    input.selectAtRay?.(g.pressRay, add, g.pressHit
      ? { x: g.pressHit.x, z: g.pressHit.z, slop: g.pressHead * TAP_SLOP_FRAC }
      : null);
  }

  function begin(src, ray) {
    const hit = renderer.rayToGround(ray);
    const head = headHeight(ray);
    const g = {
      slot: src.handedness || 'none',
      pressRay: ray,
      pressHit: hit,
      pressHead: head,
      minDot: 1,
      stroke: [],
    };
    if (hit) noteStrokePoint(g.stroke, hit.x, hit.z, head * SAMPLE_FRAC);
    gestures.set(src.source, g);
    return g;
  }

  function update(key, g, src) {
    const ray = src.targetRayTracked ? controllerRay(src.targetRayMatrix) : null;
    if (!ray) {
      if (!triggerHeld(src)) end(key, g);
      return;
    }
    if (!triggerHeld(src)) {
      finish(key, g, src);
      return;
    }
    const p = g.pressRay;
    const dot = ray.dx * p.dx + ray.dy * p.dy + ray.dz * p.dz;
    if (dot < g.minDot) g.minDot = dot;
    const head = headHeight(ray);
    const hit = renderer.rayToGround(ray);
    if (hit) noteStrokePoint(g.stroke, hit.x, hit.z, head * SAMPLE_FRAC);
    const length = hit
      ? Math.hypot(hit.x - ray.ox, hit.y - ray.oy, hit.z - ray.oz)
      : head * MISS_REACH;
    renderer.setXrSelect(g.slot, {
      ray,
      length,
      loop: g.minDot < TAP_COS ? strokeLoop(g.stroke) : null,
      tip: hit ? { x: hit.x, z: hit.z } : null,
      width: Math.max(LINE_MIN, head * LINE_FRAC),
    });
  }

  /** Call once per XR frame after the rig has moved the reference space. */
  function step(ctx) {
    const sources = ctx.input?.inputSources ?? [];
    for (const src of sources) {
      const held = triggerHeld(src);
      const pressed = held && !wasHeld.get(src.source);
      wasHeld.set(src.source, held);
      const g = gestures.get(src.source);
      if (g) {
        update(src.source, g, src);
        continue;
      }
      if (!pressed || !src.targetRayTracked) continue;
      const ray = controllerRay(src.targetRayMatrix);
      if (!ray) continue;
      update(src.source, begin(src, ray), src);
    }
    if (wasHeld.size > sources.length || gestures.size > 0) {
      for (const key of wasHeld.keys()) {
        if (!sources.some((s) => s.source === key)) wasHeld.delete(key);
      }
      for (const [key, g] of gestures) {
        if (!sources.some((s) => s.source === key)) end(key, g);
      }
    }
  }

  return {
    step,
    dispose() {
      wasHeld.clear();
      for (const [key, g] of gestures) end(key, g);
    },
  };
}
