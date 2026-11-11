// Headset select. Grip down shows that hand's beam; turning the controller
// past a few degrees while held paints a lasso on the field, release selects
// inside it. A grip tap that never turned selects what the beam hit at the
// press (aim-assisted onto a nearby unit). Both hands run their own gesture.
// Holding the other grip still is shift: the release adds, and the still grip
// selects nothing when it lets go. Two lassos at once make one selection (the
// later release adds to the earlier).

import { lassoOuterLoop } from './input/gamepadLasso.js';

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
/** How far past the board rim the laser may still reach, as a fraction of the half-extent. */
export const LASER_PAST_BOARD = 0.5;
export const STROKE_MAX_PTS = 160;

/**
 * Controller target ray in Lite's scene space: origin is the translation,
 * forward is the third basis column, and `u*` is the wrist's up (column 1)
 * so a roll slants the pointer.
 * @param {Float32Array | number[]} m
 */
export function controllerRay(m) {
  const dx = m[8];
  const dy = m[9];
  const dz = m[10];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-8)) return null;
  let ux = m[4] || 0;
  let uy = m[5] || 0;
  let uz = m[6] || 0;
  const ul = Math.hypot(ux, uy, uz);
  if (ul > 1e-8) {
    ux /= ul;
    uy /= ul;
    uz /= ul;
  } else {
    ux = 0;
    uy = 1;
    uz = 0;
  }
  return {
    ox: m[12], oy: m[13], oz: m[14],
    dx: dx / len, dy: dy / len, dz: dz / len,
    ux, uy, uz,
  };
}

/** Tracked target ray of an XR input source, or null. */
export function sourceRay(src) {
  const ray = src?.targetRayTracked ? controllerRay(src.targetRayMatrix) : null;
  if (ray) ray.hand = src.handedness || '';
  return ray;
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

/** Head height over the field under the ray origin, at least 1. */
export function rayHeadHeight(renderer, ray) {
  const floor = renderer.groundHeight(ray.ox, ray.oz);
  return Math.max(1, ray.oy - (Number.isFinite(floor) ? floor : 0));
}

/**
 * Longest the laser may travel from the hand: every point a bit past the
 * board, including the drop from the hand down to the ground. A shallow
 * aim ends there instead of following the ground plane out to the horizon.
 * @param {{ ox: number, oy: number, oz: number }} ray
 * @param {number} halfX
 * @param {number} halfZ
 * @param {number} [groundY]
 */
export function laserReach(ray, halfX, halfZ, groundY = 0) {
  const limX = Math.abs(halfX) * (1 + LASER_PAST_BOARD);
  const limZ = Math.abs(halfZ) * (1 + LASER_PAST_BOARD);
  const dx = Math.max(Math.abs(limX - ray.ox), Math.abs(-limX - ray.ox));
  const dz = Math.max(Math.abs(limZ - ray.oz), Math.abs(-limZ - ray.oz));
  const drop = Math.max(0, ray.oy - groundY);
  return Math.hypot(dx, dz, drop);
}

/**
 * Keep a ground hit inside the laser's reach. Past that, the ray ends in
 * the air at the cap so the beam and the aim stop together.
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 * @param {{ x: number, y?: number, z: number, t?: number } | null} hit
 * @param {number} reach
 */
export function clipLaserHit(ray, hit, reach) {
  if (!hit || !(reach > 0)) return hit;
  const dist = Number.isFinite(hit.t)
    ? hit.t
    : Math.hypot(hit.x - ray.ox, (hit.y ?? ray.oy) - ray.oy, hit.z - ray.oz);
  if (dist <= reach) return hit;
  return {
    x: ray.ox + ray.dx * reach,
    y: ray.oy + ray.dy * reach,
    z: ray.oz + ray.dz * reach,
    t: reach,
  };
}

function hitOnGround(renderer, hit) {
  if (!hit || typeof renderer.groundHeight !== 'function') return !!hit;
  const ground = renderer.groundHeight(hit.x, hit.z);
  if (!Number.isFinite(ground)) return true;
  return hit.y <= ground + 1.5;
}

/**
 * Beam overlay for a ray: reaches the field hit inside the laser's reach,
 * or a few head heights into the sky. A hit past the cap has no ground ring.
 * @param {{ rayToGround: Function, groundHeight: Function }} renderer
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 * @param {{ x: number, y: number, z: number } | null} [hit]
 */
export function beamState(renderer, ray, hit = renderer.rayToGround(ray), loop = null) {
  const head = rayHeadHeight(renderer, ray);
  const onGround = hitOnGround(renderer, hit);
  return {
    ray,
    length: hit ? Math.hypot(hit.x - ray.ox, hit.y - ray.oy, hit.z - ray.oz) : head * MISS_REACH,
    loop,
    tip: onGround ? { x: hit.x, z: hit.z } : null,
    width: Math.max(LINE_MIN, head * LINE_FRAC),
  };
}

function gripHeld(src) {
  return !!(src.gamepad?.buttons?.[1]?.pressed || src.squeezing);
}

/**
 * @param {{
 *   renderer: { rayToGround: Function, groundHeight: Function, setXrSelect: Function },
 *   getInput: () => ({ groundLoopSelect?: Function, selectAtRay?: Function } | null | undefined),
 * }} opts
 */
export function createXrSelect({ renderer, getInput }) {
  /** @type {Map<object, boolean>} grip state last frame, per XRInputSource */
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
   *   modifier: boolean,
   * }>}
   */
  const gestures = new Map();
  /** A release that overlapped another live gesture: the next release adds. */
  let chainAdd = false;
  /** This frame a grip tap must not select (a lasso still does). */
  let suppressTap = false;

  function end(key, g) {
    gestures.delete(key);
    renderer.setXrSelect(g.slot, null);
    if (gestures.size === 0) chainAdd = false;
  }

  function finish(key, g) {
    const swept = g.minDot < TAP_COS;
    let shift = false;
    for (const [k, other] of gestures) {
      if (k === key || other.minDot < TAP_COS) continue;
      other.modifier = true;
      shift = true;
    }
    const add = shift || chainAdd;
    const loop = swept ? strokeLoop(g.stroke) : null;
    end(key, g);
    if (!swept && g.modifier) return;
    if (gestures.size > 0) chainAdd = true;
    const input = getInput();
    if (!input) return;
    if (loop && loop.length >= 3) {
      input.groundLoopSelect?.(loop, add);
      return;
    }
    if (suppressTap) return;
    input.selectAtRay?.(g.pressRay, add, g.pressHit
      ? { x: g.pressHit.x, z: g.pressHit.z, slop: g.pressHead * TAP_SLOP_FRAC }
      : null);
  }

  function begin(src, ray) {
    const hit = renderer.rayToGround(ray);
    const head = rayHeadHeight(renderer, ray);
    const g = {
      slot: src.handedness || 'none',
      pressRay: ray,
      pressHit: hit,
      pressHead: head,
      minDot: 1,
      stroke: [],
      modifier: false,
    };
    if (hit) noteStrokePoint(g.stroke, hit.x, hit.z, head * SAMPLE_FRAC);
    gestures.set(src.source, g);
    return g;
  }

  function update(key, g, src) {
    const ray = sourceRay(src);
    if (!ray) {
      if (!gripHeld(src)) end(key, g);
      return;
    }
    if (!gripHeld(src)) {
      finish(key, g);
      return;
    }
    const p = g.pressRay;
    const dot = ray.dx * p.dx + ray.dy * p.dy + ray.dz * p.dz;
    if (dot < g.minDot) g.minDot = dot;
    const hit = renderer.rayToGround(ray);
    if (hit) noteStrokePoint(g.stroke, hit.x, hit.z, rayHeadHeight(renderer, ray) * SAMPLE_FRAC);
    renderer.setXrSelect(g.slot, beamState(
      renderer,
      ray,
      hit,
      g.minDot < TAP_COS ? strokeLoop(g.stroke) : null,
    ));
  }

  function endAll() {
    for (const [key, g] of gestures) end(key, g);
  }

  /**
   * Call once per XR frame after the rig has moved the reference space.
   * `blocked` drops live gestures without selecting (the grip belongs to
   * something else). `suppressTap` keeps a sweep and ignores a grip tap.
   * `canBegin` vetoes one press.
   * @param {{ input?: { inputSources?: object[] } }} ctx
   * @param {{ blocked?: boolean, suppressTap?: boolean, canBegin?: (src: object) => boolean }} [opts]
   */
  function step(ctx, opts = {}) {
    const sources = ctx.input?.inputSources ?? [];
    suppressTap = !!opts.suppressTap;
    if (opts.blocked && gestures.size > 0) endAll();
    for (const src of sources) {
      const held = gripHeld(src);
      const pressed = held && !wasHeld.get(src.source);
      wasHeld.set(src.source, held);
      if (opts.blocked) continue;
      const g = gestures.get(src.source);
      if (g) {
        update(src.source, g, src);
        continue;
      }
      if (!pressed) continue;
      const ray = sourceRay(src);
      if (!ray || opts.canBegin?.(src) === false) continue;
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
    /** True while this hand ('left' / 'right') is mid-gesture and owns its beam. */
    isActive(hand) {
      for (const g of gestures.values()) if (g.slot === hand) return true;
      return false;
    },
    dispose() {
      wasHeld.clear();
      endAll();
    },
  };
}
