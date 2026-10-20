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
 * While `rightStickBusy()` is true only the left stick flies.
 * @param {[number, number, number]} eye desktop camera world position
 * @param {object | null} [bounds]
 * @param {{ rightStickBusy?: () => boolean }} [opts]
 */
export function createXrRig(eye, bounds = null, opts = {}) {
  const speed = Math.max(16, Math.hypot(eye[0], eye[2]) * 0.35);
  return {
    eye,
    bounds,
    rightStickBusy: opts.rightStickBusy ?? null,
    speed,
    seeded: false,
    lastTime: 0,
    hands: null,
    /** @type {{ x: number, z: number } | null} pending jumpXrRig target */
    jump: null,
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
  const pose = frame.getViewerPose(ctx.referenceSpace);
  if (!pose) return;
  const head = poseHead(pose);
  setXrEyeFromPose(pose.transform.matrix, pose.views);
  if (!rig.seeded) {
    ctx._referenceSpace = ctx.referenceSpace.getOffsetReferenceSpace(
      new XRRigidTransform(referenceOffset(head, rig.eye)),
    );
    rig.seeded = true;
    rig.lastTime = time;
    return;
  }
  if (rig.jump) {
    const dest = xrJumpHead(head, flatBasis(pose.transform.matrix).forward, rig.jump, rig.bounds);
    rig.jump = null;
    ctx._referenceSpace = ctx.referenceSpace.getOffsetReferenceSpace(
      new XRRigidTransform(referenceOffset(head, dest)),
    );
    const s = rig.smooth;
    s.mx = s.my = s.yaw = s.lift = 0;
    rig.lastTime = time;
    return;
  }

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
  if (dt === 0) return;

  const [rawMx, rawMy] = shapeStick(left.stickX, -left.stickY);
  const [rawYaw, rawLift] = rig.rightStickBusy?.() ? [0, 0] : shapeStick(right.stickX, -right.stickY);
  const s = rig.smooth;
  if (rawMx === 0 && rawMy === 0 && rawYaw === 0 && rawLift === 0) {
    s.mx = s.my = s.yaw = s.lift = 0;
    return;
  }
  s.mx = damp(s.mx, rawMx, dt);
  s.my = damp(s.my, rawMy, dt);
  s.yaw = damp(s.yaw, rawYaw, dt);
  s.lift = damp(s.lift, rawLift, dt);
  const moveX = s.mx;
  const moveY = s.my;
  const yaw = s.yaw;
  const lift = s.lift;

  const basis = flatBasis(pose.transform.matrix);
  const dist = rig.speed * dt;
  const dest = clampXrHead([
    head[0] + (basis.right[0] * moveX + basis.forward[0] * moveY) * dist,
    head[1] + lift * dist,
    head[2] + (basis.right[1] * moveX + basis.forward[1] * moveY) * dist,
  ], rig.bounds);
  let ref = ctx.referenceSpace;
  ref = ref.getOffsetReferenceSpace(new XRRigidTransform(referenceOffset(head, dest)));
  if (yaw !== 0) ref = yawSpace(ref, dest, yaw * dt * 1.4);
  ctx._referenceSpace = ref;
}
