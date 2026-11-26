import { STICK_SPLIT_HALF, STICK_SPLIT_YAW, stickSplitOppose } from './input/gamepad.js';
import {
  XR_ALTITUDE_EASE,
  XR_ALTITUDE_REPEAT_MS,
  XR_ALTITUDE_PLAY_SLACK,
  XR_ALTITUDE_SLACK_DECAY,
  XR_ALTITUDE_SNAP,
  XR_FREE_UNDER,
  XR_SWAP_FACE_BUTTONS,
} from './controlMods.js';
import { chaseToward } from '../render/cameraController.js';
import { setXrEyeFromPose } from '../render/xrEye.js';

// Quest Touch. Trigger and grip are always the first two buttons.
// An `xr-standard` pad (current Quest browser) is:
//   buttons[2] touchpad   buttons[3] stick click
//   buttons[4] X / A      buttons[5] Y / B  (see XR_SWAP_FACE_BUTTONS for ability/cancel)
// Older Quest 1 reports put the stick click at 2 and the faces at 3 and 4.
//   axes[0], axes[1] are the unused touchpad slot
//   axes[2], axes[3] are the stick (push forward is negative y)

const STICK_DEAD = 0.35;
const STICK_SMOOTH = 10;
/** A jump stands this many head heights back from the target, so it sits ahead and below. */
const JUMP_BACK = 0.8;
/** Inherent look-down so a level visor sees the table, not the horizon. */
export const XR_LOOK_DOWN = 0.36;
/** Slow tail after the synthetic tilt has caught most of a head turn. */
export const XR_LOOK_FOLLOW = 2.25;
/** Earlier headset scheme: full right-stick yaw, radians per second. */
const XR_DIRECT_YAW = 1.4;
/** Full oppose yaw, midway between that direct yaw and the pad's oppose step. */
const XR_YAW_RATE = (XR_DIRECT_YAW + STICK_SPLIT_YAW * 60) / 2;
/** Initial catch-up rate while the tilt is well behind the viewer yaw. */
export const XR_LOOK_SNAP = 12;
const XR_LOOK_SNAP_ARC = Math.PI / 6;
/**
 * Tier 0 is ground-run (terrain-hug at clearance). Tiers 1–3 lock a world height when
 * entered so hills do not yank the view. Below ground-run and above the high band,
 * pinch is free vertical roam; between, a held pinch steps presets on a repeat timer.
 * Left-stick click cycles on the same repeat while held.
 */
export const XR_GROUND_CLEARANCE = 6;
export const XR_ALTITUDE_BANDS = [XR_GROUND_CLEARANCE, 32, 88, 188];
/** Pull required on X before a pinch counts for altitude (in/out, not feather). */
export const XR_ALTITUDE_PINCH = 0.34;
export { XR_ALTITUDE_REPEAT_MS } from './controlMods.js';
/** Same-direction throw, or a pinch, that lets go of a hold. Rest noise stays under this. */
const XR_HOLD_BREAK = 0.22;

function buttonAt(gamepad, index) {
  const b = gamepad?.buttons?.[index];
  return { value: b?.value || 0, pressed: !!b?.pressed, touched: !!(b?.touched || b?.pressed) };
}

/** Stick pair. Four axes means the touchpad slot is first and the stick is second. */
export function stickAxes(axes) {
  if (!axes || axes.length < 2) return [0, 0];
  if (axes.length >= 4) return [axes[2] || 0, axes[3] || 0];
  return [axes[0] || 0, axes[1] || 0];
}

/** Face-button slots. Default mapping: Y / B ability, X / A cancel. */
function faceButtons(gamepad) {
  const face = gamepad?.mapping === 'xr-standard'
    ? { stick: 3, primary: 5, secondary: 4 }
    : { stick: 2, primary: 4, secondary: 3 };
  if (XR_SWAP_FACE_BUTTONS) {
    const p = face.primary;
    face.primary = face.secondary;
    face.secondary = p;
  }
  return face;
}

/** Named Quest controls off an XR input source's gamepad. Missing buttons stay released. */
export function readQuestTouch(gamepad) {
  const [stickX, stickY] = stickAxes(gamepad?.axes);
  const face = faceButtons(gamepad);
  return {
    trigger: buttonAt(gamepad, 0),
    grip: buttonAt(gamepad, 1),
    stickClick: buttonAt(gamepad, face.stick),
    primary: buttonAt(gamepad, face.primary),
    secondary: buttonAt(gamepad, face.secondary),
    stickX,
    stickY,
  };
}

/** Radial deadzone, then remap the live range to 0..1 so the edge is not a step. */
export function shapeStick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < STICK_DEAD || mag < 1e-6) return [0, 0];
  const scaled = Math.min(1, (mag - STICK_DEAD) / (1 - STICK_DEAD)) / mag;
  return [x * scaled, y * scaled];
}

function damp(current, target, dt) {
  const k = 1 - Math.exp(-dt * STICK_SMOOTH);
  return current + (target - current) * k;
}

/**
 * Keep the head above the ground, under a ceiling, and inside a horizontal radius.
 * @param {[number, number, number]} head
 * @param {{ floor?: (x: number, z: number) => number, clearance?: number, maxY?: number, maxRange?: number }} [bounds]
 */
export function clampXrHead(head, bounds) {
  if (!bounds) return [head[0], head[1], head[2]];
  let x = head[0];
  let y = head[1];
  let z = head[2];
  const maxR = bounds.maxRange;
  if (Number.isFinite(maxR) && maxR > 0) {
    const span = Math.hypot(x, z);
    if (span > maxR) {
      const s = maxR / span;
      x *= s;
      z *= s;
    }
  }
  const floorY = bounds.floor?.(x, z);
  const minY = (Number.isFinite(floorY) ? floorY : 0) + (bounds.clearance ?? 6);
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : minY + 400;
  if (y < minY) y = minY;
  if (y > maxY) y = maxY;
  return [x, y, z];
}

/** Rigid offset that moves a tracked point from `from` to `to` in Lite's left-handed scene. */
export function referenceOffset(from, to) {
  return {
    x: from[0] - to[0],
    y: from[1] - to[1],
    z: -(from[2] - to[2]),
  };
}

function poseHead(pose) {
  const p = pose.transform.position;
  return [p.x, p.y, -p.z];
}

function flatBasis(matrix) {
  let fx = -matrix[8];
  let fz = matrix[10];
  let fl = Math.hypot(fx, fz);
  if (fl < 1e-5) {
    fx = 0;
    fz = 1;
    fl = 1;
  }
  let rx = matrix[0];
  let rz = -matrix[2];
  let rl = Math.hypot(rx, rz);
  if (rl < 1e-5) {
    rx = 1;
    rz = 0;
    rl = 1;
  }
  return { forward: [fx / fl, fz / fl], right: [rx / rl, rz / rl] };
}

/**
 * Pitch around the head so a level visor sees the table. `right` is Lite XZ.
 * getOffsetReferenceSpace applies the inverse, so a +X offset looks the view down.
 * @param {[number, number, number]} head
 * @param {[number, number]} right
 */
export function lookDownOffset(head, right, lookDown = XR_LOOK_DOWN) {
  const angle = lookDown;
  let kx = right[0];
  let kz = -right[1];
  const kl = Math.hypot(kx, kz);
  if (kl < 1e-5) {
    kx = 1;
    kz = 0;
  } else {
    kx /= kl;
    kz /= kl;
  }
  const hx = head[0];
  const hy = head[1];
  const hz = -head[2];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = kx * hx + kz * hz;
  const cx = -kz * hy;
  const cy = kz * hx - kx * hz;
  const cz = kx * hy;
  const rx = hx * c + cx * s + kx * d * (1 - c);
  const ry = hy * c + cy * s;
  const rz = hz * c + cz * s + kz * d * (1 - c);
  const half = angle / 2;
  const qs = Math.sin(half);
  return {
    position: { x: hx - rx, y: hy - ry, z: hz - rz },
    orientation: { x: kx * qs, y: 0, z: kz * qs, w: Math.cos(half) },
  };
}

function lookDownSpace(ref, head, right) {
  const t = lookDownOffset(head, right);
  return ref.getOffsetReferenceSpace(new XRRigidTransform(t.position, t.orientation));
}

/** Signed yaw in XZ that takes unit `from` onto unit `to`. */
export function yawBetween(from, to) {
  const d = Math.atan2(to[0], to[1]) - Math.atan2(from[0], from[1]);
  if (d > Math.PI) return d - Math.PI * 2;
  if (d < -Math.PI) return d + Math.PI * 2;
  return d;
}

/** Smooth a flat unit direction along the shortest yaw arc: quick catch, soft tail. */
export function smoothFlatDirection(
  current,
  target,
  dt,
  tailRate = XR_LOOK_FOLLOW,
  snapRate = XR_LOOK_SNAP,
) {
  const tl = Math.hypot(target?.[0] ?? 0, target?.[1] ?? 0);
  if (tl < 1e-5) return current ? [current[0], current[1]] : [1, 0];
  const to = [target[0] / tl, target[1] / tl];
  const cl = Math.hypot(current?.[0] ?? 0, current?.[1] ?? 0);
  if (cl < 1e-5) return to;
  const from = [current[0] / cl, current[1] / cl];
  const angle = Math.atan2(from[0], from[1]);
  const turn = yawBetween(from, to);
  const catchAmount = Math.min(1, Math.abs(turn) / XR_LOOK_SNAP_ARC);
  const catchEase = catchAmount * catchAmount * (3 - 2 * catchAmount);
  const rate = tailRate + (snapRate - tailRate) * catchEase;
  const follow = 1 - Math.exp(-Math.max(0, dt) * Math.max(0, rate));
  const next = angle + turn * follow;
  return [Math.sin(next), Math.cos(next)];
}

function yawSpace(ref, head, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = head[0] * c - head[2] * s;
  const rz = head[0] * s + head[2] * c;
  const half = angle / 2;
  return ref.getOffsetReferenceSpace(new XRRigidTransform(
    { x: head[0] - rx, y: 0, z: -(head[2] - rz) },
    { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
  ));
}

function hand(sources, handedness) {
  for (const src of sources) {
    if (src.handedness === handedness) return src;
  }
  return null;
}

/**
 * Headset rig for the match. The first frame parks the head on the desktop
 * camera. After that either stick pans, with no deadzone, and both sticks
 * in the same direction add. The stick that moved first keeps panning; the
 * other adds turn without quieting that pan. A pinch lifts in place and
 * quiets the slide. A lone stick never turns. Look-down eases toward
 * viewer yaw so every heading settles to the same pitch without attaching
 * the synthetic adjustment rigidly to small head motion.
 * While `rightStickBusy()` is true the sticks do not move the head.
 * `follow` eases the view onto `followAt` until a pan or a second click.
 * Tier 0 is ground-run on the terrain; higher tiers float. Free crawl under that,
 * free roam above the top preset. Pinch steps presets with a deliberate pull.
 * @param {[number, number, number]} eye desktop camera world position
 * @param {object | null} [bounds]
 * @param {{ rightStickBusy?: () => boolean, facing?: [number, number] | null }} [opts]
 */
export function createXrRig(eye, bounds = null, opts = {}) {
  const speed = Math.max(16, Math.hypot(eye[0], eye[2]) * 0.35);
  const raw = opts.facing;
  const fl = raw ? Math.hypot(raw[0], raw[1]) : 0;
  return {
    eye,
    lastHead: eye,
    bounds,
    facing: fl > 1e-5 ? [raw[0] / fl, raw[1] / fl] : null,
    rightStickBusy: opts.rightStickBusy ?? null,
    speed,
    seeded: false,
    lastTime: 0,
    hands: null,
    /** @type {{ x: number, z: number } | null} pending jumpXrRig target */
    jump: null,
    /** Selection follow. `followAt` is refreshed each frame while this is on. */
    follow: false,
    /** @type {{ x: number, z: number } | null} */
    followAt: null,
    /** Armed snap tier, or null in free close / far. */
    altitudeIndex: null,
    /** Last band a click chose, so the next click advances after a pinch. */
    altitudePick: null,
    /** Pinch gesture active; repeat steps use {@link XR_ALTITUDE_REPEAT_MS}. */
    altitudePinchLatch: false,
    /** `performance.now()` of the last altitude step from pinch. */
    altitudePinchLastAt: 0,
    /** Fast ease until the tier catch-up finishes. */
    altitudeSnapFast: false,
    /** World Y locked for floating tiers (1+); ground-run (0) re-samples terrain. */
    altitudeLockY: null,
    /** Temporary offset on a locked float tier; decays when pinch is neutral. */
    altitudeDrift: 0,
    /** Stick that started the current throw. The other one turns. */
    panHand: null,
    /** Unpitched fly/yaw space. Look-down is applied on top each frame. */
    locomotion: null,
    /** Smoothed viewer-right axis used only by the synthetic look-down. */
    lookRight: null,
    lookLastTime: 0,
    eyeLastTime: 0,
    logged: false,
    smooth: { strafe: 0, forward: 0, yaw: 0, zoom: 0 },
  };
}

function stickAxis(v) {
  if (!Number.isFinite(v)) return 0;
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

/**
 * Pinch / spread lift on X. Uses the pad half-gate so a slight strafe on the
 * second stick does not read as zoom. When pan or turn is already committed on
 * Y, X lift only wins at matching strength (deliberate pinch, not drift).
 */
function xrStickLift(lx, ly, rx, ry, lOn, rOn) {
  if (!(lOn && rOn)) return 0;
  let lift = -stickSplitOppose(lx, rx, true);
  if (!lift) return 0;
  const turn = ly * ry < 0 ? (Math.abs(ly) + Math.abs(ry)) * 0.5 : 0;
  const coopPan = ly * ry > 0 ? (Math.abs(ly) + Math.abs(ry)) * 0.5 : 0;
  const intent = Math.max(turn, coopPan);
  if (intent >= STICK_SPLIT_HALF && Math.abs(lift) < intent) lift = 0;
  return lift;
}

/** Pan still left when a pinch is fully opposed. Turning does not use this. */
const XR_PAN_DURING_GESTURE = 0.06;

/** Quiet the slide as a pinch gets aggressive. A light oppose barely cuts. */
function gesturePanScale(amount) {
  const t = amount > 1 ? 1 : amount < 0 ? 0 : amount;
  const u = t * t * (3 - 2 * t);
  return 1 - u * (1 - XR_PAN_DURING_GESTURE);
}

/** A pan large enough to drop selection follow. A pinch does not. */
export function xrBreaksFollow(left, right, panHand = null) {
  const m = xrStickMotion(left, right, panHand);
  return Math.hypot(m.strafe, m.forward) >= XR_HOLD_BREAK;
}

/** Eye height above sampled floor at x/z, or null when unknown. */
export function xrHeightAboveFloor(head, bounds) {
  const floorY = bounds?.floor?.(head[0], head[2]);
  if (!Number.isFinite(floorY)) return null;
  return head[1] - floorY;
}

/** `free-close`, `snap` (ground-run through high preset), or `free-far`. */
export function xrAltitudeZone(relY) {
  if (!Number.isFinite(relY)) return 'snap';
  const hi = XR_ALTITUDE_BANDS[XR_ALTITUDE_BANDS.length - 1];
  if (relY < XR_GROUND_CLEARANCE - XR_FREE_UNDER) return 'free-close';
  if (relY > hi) return 'free-far';
  return 'snap';
}

/** Pinch / spread magnitude on X for altitude gestures. */
export function xrPinchLiftMagnitude(left, right) {
  const lx = stickAxis(left?.stickX);
  const ly = stickAxis(left?.stickY);
  const rx = stickAxis(right?.stickX);
  const ry = stickAxis(right?.stickY);
  const lOn = lx !== 0 || ly !== 0;
  const rOn = rx !== 0 || ry !== 0;
  if (!(lOn && rOn)) return 0;
  return Math.abs(xrStickLift(lx, ly, rx, ry, lOn, rOn));
}

export function xrCommitAltitudeTier(rig, idx, head, bounds) {
  if (!(idx >= 0 && idx < XR_ALTITUDE_BANDS.length)) return;
  rig.altitudeIndex = idx;
  rig.altitudePick = idx;
  rig.altitudeSnapFast = true;
  rig.altitudeDrift = 0;
  if (idx === 0) {
    rig.altitudeLockY = null;
    return;
  }
  const floorY = bounds?.floor?.(head[0], head[2]);
  const base = Number.isFinite(floorY) ? floorY : 0;
  rig.altitudeLockY = base + XR_ALTITUDE_BANDS[idx];
}

export function xrNearestAltitudeTier(relY) {
  const b = XR_ALTITUDE_BANDS;
  if (!Number.isFinite(relY)) return 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (relY <= (b[i] + b[i + 1]) * 0.5) return i;
  }
  return b.length - 1;
}

/** One pinch edge steps a tier, or drops into free close / far at the ends. */
export function xrStepAltitudeFromPinch(rig, lift, relY, head, bounds) {
  if (Math.abs(lift) < XR_ALTITUDE_PINCH) return;
  const zone = xrAltitudeZone(relY);
  const up = lift > 0;
  const h = head ?? [0, 0, 0];
  if (rig.altitudeIndex === 0) {
    if (up) {
      xrCommitAltitudeTier(rig, 1, h, bounds);
    } else {
      rig.altitudeIndex = null;
      rig.altitudePick = 0;
      rig.altitudeLockY = null;
    }
    return;
  }
  if (zone === 'free-close') {
    if (up) xrCommitAltitudeTier(rig, 0, h, bounds);
    return;
  }
  if (zone === 'free-far') {
    if (!up) {
      xrCommitAltitudeTier(rig, XR_ALTITUDE_BANDS.length - 1, h, bounds);
    }
    return;
  }
  let idx = rig.altitudeIndex;
  if (idx == null || idx < 0 || idx >= XR_ALTITUDE_BANDS.length) {
    idx = xrNearestAltitudeTier(relY);
  }
  const top = XR_ALTITUDE_BANDS.length - 1;
  if (up) {
    if (idx >= top) {
      rig.altitudeIndex = null;
      rig.altitudePick = top;
      rig.altitudeLockY = null;
    } else {
      xrCommitAltitudeTier(rig, idx + 1, h, bounds);
    }
  } else if (idx <= 0) {
    xrCommitAltitudeTier(rig, 0, h, bounds);
  } else {
    xrCommitAltitudeTier(rig, idx - 1, h, bounds);
  }
}

export function xrAllowsFreeZoom(relY, altitudeIndex = null) {
  if (altitudeIndex === 0) return false;
  const z = xrAltitudeZone(relY);
  return z === 'free-close' || z === 'free-far';
}

/** A deliberate pinch on X for altitude (see XR_ALTITUDE_PINCH). */
export function xrBreaksAltitude(left, right) {
  return xrPinchLiftMagnitude(left, right) >= XR_ALTITUDE_PINCH;
}

/** Next altitude band; first click is ground-run. */
export function cycleXrAltitude(rig, head, bounds) {
  const next = rig.altitudePick == null ? 0 : (rig.altitudePick + 1) % XR_ALTITUDE_BANDS.length;
  const h = head ?? [0, 0, 0];
  xrCommitAltitudeTier(rig, next, h, bounds);
  return next;
}

export function toggleXrFollow(rig) {
  rig.follow = !rig.follow;
  if (!rig.follow) rig.followAt = null;
}

/**
 * Ease a follow lock and an altitude band onto `head` (already moved by the sticks).
 * A break skips that hold; the caller clears the flag.
 * @param {[number, number, number]} head
 * @param {[number, number]} forward
 */
export function xrHoldHead(head, forward, opts) {
  let x = head[0];
  let y = head[1];
  let z = head[2];
  const dt = Math.max(0, opts.dt || 0);
  if (opts.follow && opts.followAt && !opts.breakFollow) {
    const parked = xrJumpHead([x, y, z], forward, opts.followAt, opts.bounds);
    const chased = chaseToward(x, z, parked[0], parked[2], dt);
    x = chased.x;
    z = chased.z;
  }
  if (opts.altitudeIndex != null && !opts.breakAltitude) {
    const floorY = opts.bounds?.floor?.(x, z);
    const base = Number.isFinite(floorY) ? floorY : 0;
    const ease = opts.altitudeSnapFast ? XR_ALTITUDE_SNAP : XR_ALTITUDE_EASE;
    const u = 1 - Math.exp(-ease * dt);
    let target = opts.altitudeIndex === 0
      ? base + XR_ALTITUDE_BANDS[0]
      : opts.altitudeLockY;
    if (opts.altitudeIndex !== 0 && !Number.isFinite(target)) {
      target = base + XR_ALTITUDE_BANDS[opts.altitudeIndex];
    }
    if (opts.altitudeIndex !== 0 && Number.isFinite(opts.altitudeDrift)) {
      target += opts.altitudeDrift;
    }
    y += (target - y) * u;
  }
  return clampXrHead([x, y, z], opts.bounds);
}

/**
 * Either stick pans. Two sticks thrown the same way add, up to double.
 * The stick already out keeps its pan; the other one's up/down turns
 * (left up or right down turns right) and does not quiet that pan.
 * Pinch/spread below or above the snap corridor is free zoom; between the three
 * presets it steps a tier. A hard pinch still quiets the slide in the corridor.
 * No deadzone. `yaw` is positive for a right turn, per 60 Hz frame,
 * which is the sign `yawSpace` already uses. `zoom` is a -1..1 lift, positive up.
 * `panHand` is the stick that started this throw, or null.
 * @param {{ stickX?: number, stickY?: number }} left
 * @param {{ stickX?: number, stickY?: number }} right
 * @param {'left' | 'right' | null} [panHand]
 */
export function xrStickMotion(left, right, panHand = null) {
  const lx = stickAxis(left?.stickX);
  const ly = stickAxis(left?.stickY);
  const rx = stickAxis(right?.stickX);
  const ry = stickAxis(right?.stickY);
  const lOn = lx !== 0 || ly !== 0;
  const rOn = rx !== 0 || ry !== 0;
  let primary = panHand === 'left' || panHand === 'right' ? panHand : null;
  if (primary === 'left' && !lOn) primary = null;
  if (primary === 'right' && !rOn) primary = null;
  if (!primary) {
    if (lOn && !rOn) primary = 'left';
    else if (rOn && !lOn) primary = 'right';
    else if (lOn && rOn) {
      primary = Math.hypot(rx, ry) > Math.hypot(lx, ly) ? 'right' : 'left';
    }
  }
  let forward = -(ly + ry);
  let yaw = 0;
  if (ly * ry < 0 && primary) {
    const py = primary === 'left' ? ly : ry;
    const sy = primary === 'left' ? ry : ly;
    forward = -py;
    yaw = ((primary === 'left' ? sy : -sy) * XR_YAW_RATE) / 60 || 0;
  }
  const lift = xrStickLift(lx, ly, rx, ry, lOn, rOn);
  const scale = gesturePanScale(Math.abs(lift));
  return {
    strafe: ((lx + rx) * scale) || 0,
    forward: (forward * scale) || 0,
    yaw,
    zoom: lift || 0,
    panHand: primary,
  };
}

/**
 * Head pose that puts an orbit shot on the headset look-down.
 * Horizontal distance stays the orbit eye's, and the height drops or
 * rises so the visor ray hits the look target.
 * @param {[number, number, number]} eye
 * @param {{ x: number, y?: number, z: number }} target
 * @param {(x: number, z: number) => number} [floor]
 */
export function xrFitHead(eye, target, floor) {
  const tx = target?.x || 0;
  const tz = target?.z || 0;
  const dx = tx - (eye?.[0] || 0);
  const dz = tz - (eye?.[2] || 0);
  const dist = Math.hypot(dx, dz);
  const sampled = typeof floor === 'function' ? floor(tx, tz) : target?.y;
  const ground = Number.isFinite(sampled) ? sampled : 0;
  if (!(dist > 0.5)) {
    return {
      eye: [eye?.[0] || 0, Math.max(eye?.[1] || 0, ground + 4), eye?.[2] || 0],
      facing: null,
    };
  }
  return {
    eye: [eye[0], ground + dist * Math.tan(XR_LOOK_DOWN), eye[2]],
    facing: [dx / dist, dz / dist],
  };
}

/**
 * Fly the head on the next frame. With only x/z, keep height and facing
 * and stand back from the point. A y and facing replace the whole pose
 * (level loads and campaign shots).
 * @param {{ x: number, z: number }} [pose]
 */
export function jumpXrRig(rig, x, z, pose = null) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  rig.jump = {
    x,
    z,
    y: Number.isFinite(pose?.y) ? pose.y : null,
    facing: pose?.facing || null,
  };
}

/**
 * Head spot for a jump: `back` head heights behind the target along the
 * flat forward, at the current height, then clamped into the bounds.
 * @param {[number, number, number]} head
 * @param {[number, number]} forward unit flat forward (x, z)
 * @param {{ x: number, z: number }} target
 */
export function xrJumpHead(head, forward, target, bounds = null) {
  const floor = bounds?.floor?.(target.x, target.z);
  const above = Math.max(4, head[1] - (Number.isFinite(floor) ? floor : 0));
  const back = above * JUMP_BACK;
  return clampXrHead([target.x - forward[0] * back, head[1], target.z - forward[1] * back], bounds);
}

export function stepXrRig(rig, ctx, frame, time) {
  // Lite snapshots this reference space before onFrame and renders that pose
  // afterward. Keep CPU/HUD work on the same pose instead of one locomotion
  // step ahead during fast pan or lift.
  const renderPose = frame.getViewerPose(ctx.referenceSpace);
  const loco = rig.locomotion ?? ctx.referenceSpace;
  const pose = frame.getViewerPose(loco);
  if (!pose) return;
  const head = poseHead(pose);
  rig.lastHead = head;
  const basis = flatBasis(pose.transform.matrix);
  let next = loco;
  let snapHud = false;

  if (!rig.seeded) {
    const dest = rig.eye;
    next = loco.getOffsetReferenceSpace(
      new XRRigidTransform(referenceOffset(head, dest)),
    );
    const facing = rig.facing;
    if (facing) {
      const yaw = yawBetween(basis.forward, facing);
      if (Math.abs(yaw) > 1e-4) next = yawSpace(next, dest, yaw);
    }
    rig.seeded = true;
    rig.lastTime = time;
    snapHud = true;
  } else if (rig.jump) {
    const j = rig.jump;
    rig.jump = null;
    snapHud = true;
    const dest = Number.isFinite(j.y)
      ? clampXrHead([j.x, j.y, j.z], rig.bounds)
      : xrJumpHead(head, basis.forward, j, rig.bounds);
    next = loco.getOffsetReferenceSpace(
      new XRRigidTransform(referenceOffset(head, dest)),
    );
    if (j.facing) {
      const yaw = yawBetween(basis.forward, j.facing);
      if (Math.abs(yaw) > 1e-4) next = yawSpace(next, dest, yaw);
    }
    const s = rig.smooth;
    s.strafe = s.forward = s.yaw = s.zoom = 0;
    rig.lastTime = time;
  } else {
    const sources = ctx.input?.inputSources ?? [];
    const left = readQuestTouch(hand(sources, 'left')?.gamepad);
    const right = readQuestTouch(hand(sources, 'right')?.gamepad);
    rig.hands = { left, right };
    if (!rig.logged && sources.length) {
      rig.logged = true;
      for (const src of sources) {
        const pad = src.gamepad;
        console.info(
          `[xr] ${src.handedness} buttons ${pad?.buttons?.length ?? 0} axes ${pad?.axes?.length ?? 0}`,
        );
      }
    }

    const dt = Math.min(0.05, Math.max(0, (time - rig.lastTime) / 1000));
    rig.lastTime = time;
    if (dt > 0) {
      const busy = !!rig.rightStickBusy?.();
      const raw = busy
        ? { strafe: 0, forward: 0, yaw: 0, zoom: 0 }
        : xrStickMotion(left, right, rig.panHand);
      if (!busy) rig.panHand = raw.panHand ?? null;
      const breakFollow = !busy && Math.hypot(raw.strafe, raw.forward) >= XR_HOLD_BREAK;
      const relY = xrHeightAboveFloor(head, rig.bounds);
      const pinchLive = !busy && xrBreaksAltitude(left, right);
      if (pinchLive) {
        const lx = stickAxis(left.stickX);
        const ly = stickAxis(left.stickY);
        const rx = stickAxis(right.stickX);
        const ry = stickAxis(right.stickY);
        const lOn = lx !== 0 || ly !== 0;
        const rOn = rx !== 0 || ry !== 0;
        const lift = xrStickLift(lx, ly, rx, ry, lOn, rOn);
        const firstPinch = !rig.altitudePinchLatch;
        const repeatDue = time - (rig.altitudePinchLastAt || 0) >= XR_ALTITUDE_REPEAT_MS;
        if (firstPinch || repeatDue) {
          xrStepAltitudeFromPinch(rig, lift, relY ?? 0, head, rig.bounds);
          rig.altitudePinchLatch = true;
          rig.altitudePinchLastAt = time;
        }
      } else {
        rig.altitudePinchLatch = false;
        rig.altitudePinchLastAt = 0;
      }
      if (breakFollow) rig.follow = false;
      const freeZoom = relY != null && xrAllowsFreeZoom(relY, rig.altitudeIndex);
      const snapTier = rig.altitudeIndex != null && rig.altitudeIndex > 0
        && relY != null && !freeZoom;
      let drift = rig.altitudeDrift || 0;
      if (snapTier) {
        const slide = rig.speed * dt;
        if (Math.abs(raw.zoom) > 0.05) {
          drift += raw.zoom * slide * 0.55;
          drift = Math.max(-XR_ALTITUDE_PLAY_SLACK, Math.min(XR_ALTITUDE_PLAY_SLACK, drift));
        } else if (drift !== 0) {
          drift *= Math.exp(-XR_ALTITUDE_SLACK_DECAY * dt);
          if (Math.abs(drift) < 0.08) drift = 0;
        }
        rig.altitudeDrift = drift;
      } else if (drift !== 0) {
        rig.altitudeDrift = 0;
      }
      const s = rig.smooth;
      let dest = [head[0], head[1], head[2]];
      let yawDt = 0;
      let moved = false;
      if (raw.strafe === 0 && raw.forward === 0 && raw.yaw === 0 && raw.zoom === 0) {
        s.strafe = s.forward = s.yaw = s.zoom = 0;
      } else {
        // Pan and lift are -1..1 throws. Yaw is still per 60 Hz tick.
        s.strafe = damp(s.strafe, raw.strafe, dt);
        s.forward = damp(s.forward, raw.forward, dt);
        s.yaw = damp(s.yaw, raw.yaw * 60, dt);
        const zoomTarget = freeZoom ? raw.zoom : 0;
        s.zoom = damp(s.zoom, zoomTarget, dt);
        const slide = rig.speed * dt;
        const dy = freeZoom ? s.zoom * slide : 0;
        dest = [
          head[0] + basis.right[0] * s.strafe * slide
            + basis.forward[0] * s.forward * slide,
          head[1] + dy,
          head[2] + basis.right[1] * s.strafe * slide
            + basis.forward[1] * s.forward * slide,
        ];
        yawDt = s.yaw * dt;
        moved = true;
      }
      const held = xrHoldHead(dest, basis.forward, {
        dt,
        bounds: rig.bounds,
        follow: rig.follow,
        followAt: rig.followAt,
        altitudeIndex: rig.altitudeIndex,
        breakFollow,
        breakAltitude: false,
        altitudeSnapFast: !!rig.altitudeSnapFast,
        altitudeLockY: rig.altitudeLockY,
        altitudeDrift: rig.altitudeDrift || 0,
      });
      if (rig.altitudeSnapFast && rig.altitudeIndex != null && relY != null) {
        const target = rig.altitudeIndex === 0
          ? (rig.bounds?.floor?.(dest[0], dest[2]) || 0) + XR_ALTITUDE_BANDS[0]
          : rig.altitudeLockY;
        if (Number.isFinite(target) && Math.abs(dest[1] - target) < 0.75) {
          rig.altitudeSnapFast = false;
        }
      }
      if (held[0] !== dest[0] || held[1] !== dest[1] || held[2] !== dest[2]) {
        dest = held;
        moved = true;
      } else if (moved) {
        dest = clampXrHead(dest, rig.bounds);
      }
      if (moved) {
        next = loco.getOffsetReferenceSpace(
          new XRRigidTransform(referenceOffset(head, dest)),
        );
        if (yawDt !== 0) next = yawSpace(next, dest, yawDt);
      }
    }
  }

  rig.locomotion = next;
  const grounded = next === loco ? pose : frame.getViewerPose(next) ?? pose;
  const groundedBasis = flatBasis(grounded.transform.matrix);
  const lookDt = rig.lookLastTime > 0
    ? Math.min(0.05, Math.max(0, (time - rig.lookLastTime) / 1000))
    : 0;
  rig.lookLastTime = time;
  rig.lookRight = smoothFlatDirection(rig.lookRight, groundedBasis.right, lookDt);
  const look = lookDownSpace(
    next,
    poseHead(grounded),
    rig.lookRight,
  );
  ctx._referenceSpace = look;
  const view = renderPose ?? frame.getViewerPose(look) ?? grounded;
  const eyeDt = rig.eyeLastTime > 0
    ? Math.min(0.05, Math.max(0, (time - rig.eyeLastTime) / 1000))
    : 0;
  rig.eyeLastTime = time;
  setXrEyeFromPose(view.transform.matrix, view.views, eyeDt, snapHud ? { snapHud: true } : null);
}
