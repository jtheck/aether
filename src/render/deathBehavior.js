// Client-only death exits. The sim has already stopped the unit; these samples
// are offsets from the spot where it fell. u is 0 at the moment of death and 1
// when the mesh is gone.

import { UNIT } from '../sim/unitTypes.js';

export const DEATH_KIND = {
  SHRINK: 0,
  BALLOON: 1,
  FLEE: 2,
};

/** Generic corpse: shrink away. */
export const DEATH_SHRINK_MS = 450;
/** Untied-balloon flight, including the fade at the end. */
export const BALLOON_MS = 3200;
/**
 * Bolt away from the fight, then the fade. Short on purpose: they should be
 * off the board before the eye settles.
 */
export const FLEE_MS = 1100;

/** Last slice of the balloon is the fade, after the shot into the sky. */
const BALLOON_FADE_AT = 0.88;
/** Last slice of the bolt is the fade. They are already gone. */
const FLEE_FADE_AT = 0.84;
/**
 * World units covered before the fade. A default board is 832 across, so this
 * clears the table from the middle and from most of the near side.
 */
const FLEE_DISTANCE = 780;
const FLEE_FADE_DISTANCE = 140;

/**
 * Sharp turns, then one committed climb. Times are fractions of BALLOON_MS.
 * `dist` / `up` are world units. The hull is about 12 across, so each whip is
 * many lengths of ship, not a twitch in place.
 */
const BALLOON_SEGMENTS = [
  { u1: 0.10, dist: 140, up: 36, turn: true, wobble: 0.75 },
  { u1: 0.22, dist: 120, up: -18, turn: true, wobble: 0.85 },
  { u1: 0.36, dist: 110, up: 28, turn: true, wobble: 0.7 },
  { u1: 0.50, dist: 100, up: -24, turn: true, wobble: 0.75 },
  { u1: 0.64, dist: 80, up: 16, turn: true, wobble: 0.55 },
  { u1: 0.88, dist: 24, up: 220, turn: false, wobble: 0.12 },
  { u1: 1.00, dist: 6, up: 70, turn: false, wobble: 0.04 },
];

export function deathKindForType(typeId) {
  const id = typeId | 0;
  if (id === UNIT.DIRIGIBLE) return DEATH_KIND.BALLOON;
  if (id === UNIT.VILLAGER || id === UNIT.BRIGAND) return DEATH_KIND.FLEE;
  return DEATH_KIND.SHRINK;
}

export function deathDurationMs(kind) {
  if (kind === DEATH_KIND.BALLOON) return BALLOON_MS;
  if (kind === DEATH_KIND.FLEE) return FLEE_MS;
  return DEATH_SHRINK_MS;
}

function clamp01(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u;
}

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Quadratic so the mesh stays put, then drops out. */
function tailAlpha(t, fadeAt) {
  if (t <= fadeAt) return 1;
  const tail = (t - fadeAt) / (1 - fadeAt);
  return 1 - tail * tail;
}

/**
 * Integrate one slice. Heading wobbles inside the slice so a burst is a whip,
 * not a ruler line. Position stays continuous across slices.
 */
function advanceSlice(pos, heading, seg, frac) {
  const steps = 4;
  let { x, y, z } = pos;
  let yaw = heading;
  for (let s = 0; s < steps; s++) {
    const a0 = s / steps;
    if (a0 >= frac) break;
    const b1 = Math.min((s + 1) / steps, frac);
    const mid = (a0 + b1) * 0.5;
    const portion = b1 - a0;
    const head = heading + Math.sin(mid * Math.PI) * seg.wobble;
    x += Math.sin(head) * seg.dist * portion;
    z += Math.cos(head) * seg.dist * portion;
    y += seg.up * portion;
    yaw = head;
  }
  return { x, y, z, yaw };
}

/**
 * Party balloon with the neck open: a fast erratic whip, then one shot upward,
 * then a quick fade.
 * @returns {{ x: number, y: number, z: number, yaw: number, pitch: number, roll: number, alpha: number, scale: number }}
 */
export function sampleBalloon(u, seed) {
  const t = clamp01(u);
  const s = seed | 0;
  let heading = hash01(s + 1) * Math.PI * 2;
  let pos = { x: 0, y: 0, z: 0, yaw: heading };
  let prevU = 0;
  for (let i = 0; i < BALLOON_SEGMENTS.length; i++) {
    const seg = BALLOON_SEGMENTS[i];
    if (t <= prevU) break;
    if (seg.turn) {
      const sign = hash01(s * 5.3 + (i + 1) * 19.1) < 0.5 ? -1 : 1;
      const mag = 1.25 + hash01(s * 2.2 + (i + 1) * 8.7) * 1.45;
      heading += sign * mag;
    }
    const frac = Math.min(1, (t - prevU) / (seg.u1 - prevU));
    pos = advanceSlice(pos, heading, seg, frac);
    if (t <= seg.u1) break;
    prevU = seg.u1;
  }
  const sky = smoothstep(0.64, 0.88, t);
  const wobble = 1 - sky;
  const alpha = tailAlpha(t, BALLOON_FADE_AT);
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    yaw: pos.yaw,
    pitch: Math.sin(t * 16 + s * 0.017) * 0.22 * wobble - sky * 0.65,
    roll: Math.sin(t * 21 + s * 0.013) * 0.48 * wobble,
    alpha,
    scale: alpha,
  };
}

/**
 * Run straight along `dirX, dirZ` (already "away from the fight"), full speed
 * the whole way, then fade. No ease-out — easing is what made it look like a walk.
 * @returns {{ x: number, z: number, yaw: number, alpha: number, scale: number, moving: boolean }}
 */
export function sampleFlee(u, dirX, dirZ) {
  const t = clamp01(u);
  let x = dirX;
  let z = dirZ;
  let len = Math.hypot(x, z);
  if (len < 1e-6) {
    x = 0;
    z = 1;
    len = 1;
  }
  x /= len;
  z /= len;
  const sprintU = Math.min(t, FLEE_FADE_AT) / FLEE_FADE_AT;
  let dist = FLEE_DISTANCE * sprintU;
  if (t > FLEE_FADE_AT) dist += FLEE_FADE_DISTANCE * ((t - FLEE_FADE_AT) / (1 - FLEE_FADE_AT));
  const alpha = tailAlpha(t, FLEE_FADE_AT);
  return {
    x: x * dist,
    z: z * dist,
    yaw: Math.atan2(x, z),
    alpha,
    scale: alpha,
    moving: alpha > 0.05,
  };
}
