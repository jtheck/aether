import { setXrEyeFromPose } from '../render/xrEye.js';

// Quest Touch. Trigger and grip are always the first two buttons.
// An `xr-standard` pad (current Quest browser) is:
//   buttons[2] touchpad   buttons[3] stick click
//   buttons[4] X / A      buttons[5] Y / B
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
/** Initial catch-up rate while the tilt is well behind the viewer yaw. */
export const XR_LOOK_SNAP = 12;
const XR_LOOK_SNAP_ARC = Math.PI / 6;

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

/** Face-button slots. X / A is primary, Y / B is secondary. */
function faceButtons(gamepad) {
  if (gamepad?.mapping === 'xr-standard') return { stick: 3, primary: 4, secondary: 5 };
  return { stick: 2, primary: 3, secondary: 4 };
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
 * camera. After that the left stick slides and the right stick yaws and lifts.
 * Look-down eases toward viewer yaw so every heading settles to the same pitch
 * without attaching the synthetic adjustment rigidly to small head motion.
 * While `rightStickBusy()` is true only the left stick flies.
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
    bounds,
    facing: fl > 1e-5 ? [raw[0] / fl, raw[1] / fl] : null,
    rightStickBusy: opts.rightStickBusy ?? null,
    speed,
    seeded: false,
    lastTime: 0,
    hands: null,
    /** @type {{ x: number, z: number } | null} pending jumpXrRig target */
    jump: null,
    /** Unpitched fly/yaw space. Look-down is applied on top each frame. */
    locomotion: null,
    /** Smoothed viewer-right axis used only by the synthetic look-down. */
    lookRight: null,
    lookLastTime: 0,
    eyeLastTime: 0,
    logged: false,
    smooth: { mx: 0, my: 0, yaw: 0, lift: 0 },
  };
}

/** Fly the head to look over (x, z) on the next frame, keeping its height and facing. */
export function jumpXrRig(rig, x, z) {
  if (Number.isFinite(x) && Number.isFinite(z)) rig.jump = { x, z };
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
  const basis = flatBasis(pose.transform.matrix);
  let next = loco;

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
  } else if (rig.jump) {
    const dest = xrJumpHead(head, basis.forward, rig.jump, rig.bounds);
    rig.jump = null;
    next = loco.getOffsetReferenceSpace(
      new XRRigidTransform(referenceOffset(head, dest)),
    );
    const s = rig.smooth;
    s.mx = s.my = s.yaw = s.lift = 0;
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
      const [rawMx, rawMy] = shapeStick(left.stickX, -left.stickY);
      const [rawYaw, rawLift] = rig.rightStickBusy?.() ? [0, 0] : shapeStick(right.stickX, -right.stickY);
      const s = rig.smooth;
      if (rawMx === 0 && rawMy === 0 && rawYaw === 0 && rawLift === 0) {
        s.mx = s.my = s.yaw = s.lift = 0;
      } else {
        s.mx = damp(s.mx, rawMx, dt);
        s.my = damp(s.my, rawMy, dt);
        s.yaw = damp(s.yaw, rawYaw, dt);
        s.lift = damp(s.lift, rawLift, dt);
        const dist = rig.speed * dt;
        const dest = clampXrHead([
          head[0] + (basis.right[0] * s.mx + basis.forward[0] * s.my) * dist,
          head[1] + s.lift * dist,
          head[2] + (basis.right[1] * s.mx + basis.forward[1] * s.my) * dist,
        ], rig.bounds);
        next = loco.getOffsetReferenceSpace(
          new XRRigidTransform(referenceOffset(head, dest)),
        );
        if (s.yaw !== 0) {
          const yaw = s.yaw * dt * 1.4;
          next = yawSpace(next, dest, yaw);
        }
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
  setXrEyeFromPose(view.transform.matrix, view.views, eyeDt);
}
