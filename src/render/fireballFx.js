// Render-only warlock fireball: gather wind-up, then a continuous puff streak.
// Shells stay closer together than a puff is wide, so the path reads as one
// trail. A volley drops to a single bead per shell instead of opening gaps.

const GATHER_SEC = 0.8;
const GATHER_GAP = 0.04;
/** Seconds between streak samples. Short enough that a fast ball's steps overlap. */
export const FLY_GAP = 0.014;
/** Beads beside each other in one sample. One sample, not a stack of dots. */
export const FLY_ARMS = 2;
export const FLY_BEADS = 1;
const HELIX_R = 0.38;
/**
 * Spark cull tops out at 200. Normal orbit on this map sits past that, so the
 * mesh kept drawing and the puffs were dropped. Body sprites follow the ball
 * out through a zoomed-out view.
 */
export const FIREBALL_TRAIL_CULL = 1600;

/**
 * Puffs per sample. The gap stays fixed so the streak does not break into dots.
 * Past a few orbs, one bead still covers the path.
 * @param {number} flyingCount
 */
export function fireballFlyArms(flyingCount) {
  return (flyingCount | 0) > 4 ? 1 : FLY_ARMS;
}
/** Sim velocities are world-units per tick (20 Hz). Particles are per-second. */
const TICK_HZ = 20;

const HOT = [
  [1, 0.88, 0.28, 0.92],
  [1, 0.55, 0.08, 0.88],
  [1, 0.32, 0.04, 0.8],
  [0.92, 0.12, 0.02, 0.72],
];

/** Mostly still; a few slow rolls. Fast whirl reads as a spinner, not fire. */
function puffSpin() {
  const dir = Math.random() < 0.5 ? -1 : 1;
  const roll = Math.random();
  if (roll < 0.6) return dir * Math.random() * 0.16;
  if (roll < 0.9) return dir * (0.18 + Math.random() * 0.28);
  return dir * (0.42 + Math.random() * 0.28);
}

function puff() {
  return {
    sprite: 'puff',
    rotation: Math.random() * Math.PI * 2,
    spin: puffSpin(),
  };
}

function tint() {
  return HOT[(Math.random() * HOT.length) | 0];
}

/** Half the prior 2× band; still a little size jitter. */
function puffSize(base) {
  return base * (0.88 + Math.random() * 0.25);
}

function basis(vx, vy, vz) {
  const len = Math.hypot(vx, vy, vz) || 1;
  const fx = vx / len;
  const fy = vy / len;
  const fz = vz / len;
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  let rLen = Math.hypot(rx, ry, rz);
  if (rLen < 1e-4) {
    rx = 1;
    ry = 0;
    rz = 0;
    rLen = 1;
  } else {
    rx /= rLen;
    rz /= rLen;
  }
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  return { fx, fy, fz, rx, ry, rz, ux, uy, uz };
}

/**
 * @param {(init: object) => unknown} emit
 */
export function createFireballFx(emit) {
  function emitBody(init) {
    emit({ ...init, cullMin: FIREBALL_TRAIL_CULL });
  }
  /** @type {Map<string, {
   *   cx: number, cy: number, cz: number,
   *   vx: number, vy: number, vz: number,
   *   winding: boolean,
   *   bornAt: number,
   *   phase: number,
   *   spin: number,
   *   acc: number,
   *   seen: boolean,
   * }>} */
  const live = new Map();
  let clock = 0;

  function keyOf(slot, generation) {
    return `${slot}:${generation}`;
  }

  function emitGather(ball, gatherT) {
    const count = 4 + (gatherT > 0.4 ? 2 : 0);
    const reach = 3.2 - gatherT * 1.4;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.28) * 1.25;
      const ce = Math.cos(elev);
      const r = (0.45 + Math.random() * 0.55) * reach;
      const ox = Math.cos(ang) * ce * r;
      const oy = Math.sin(elev) * r * 0.62;
      const oz = Math.sin(ang) * ce * r;
      const inv = (9 + gatherT * 10) / Math.max(0.8, r);
      const swirl = 2.4 + gatherT * 2.2;
      const c = tint();
      emitBody({
        ...puff(),
        position: [ball.cx + ox, ball.cy + oy, ball.cz + oz],
        velocity: [
          -ox * inv - oz * swirl * 0.12,
          -oy * inv + 0.55,
          -oz * inv + ox * swirl * 0.12,
        ],
        gravity: [0, 1.1, 0],
        color: [c[0], c[1], c[2], c[3] * (0.55 + gatherT * 0.45)],
        lifetime: 0.36 + Math.random() * 0.22,
        startSize: puffSize(1.45),
        endSize: puffSize(0.36),
        drag: 0.85,
      });
    }
    if (gatherT > 0.28) {
      const c = tint();
      emitBody({
        ...puff(),
        position: [
          ball.cx + (Math.random() - 0.5) * 0.7,
          ball.cy + (Math.random() - 0.5) * 0.5,
          ball.cz + (Math.random() - 0.5) * 0.7,
        ],
        velocity: [0, 0.35, 0],
        gravity: [0, 0.4, 0],
        color: [c[0], c[1], c[2], 0.7 + gatherT * 0.28],
        lifetime: 0.28 + Math.random() * 0.16,
        startSize: puffSize(1.7 + gatherT * 0.8),
        endSize: puffSize(0.85),
        drag: 1.4,
      });
    }
  }

  function emitHelix(ball, arms) {
    const b = basis(ball.vx, ball.vy, ball.vz);
    const count = arms > 0 ? arms : 1;
    const c0 = tint();
    for (let arm = 0; arm < count; arm++) {
      const a = ball.phase + (count === 1 ? 0 : arm * Math.PI);
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const rad = HELIX_R + Math.sin(ball.phase * 1.6 + arm) * 0.08;
      const px = ball.cx + b.rx * cs * rad + b.ux * sn * rad;
      const py = ball.cy + b.ry * cs * rad + b.uy * sn * rad;
      const pz = ball.cz + b.rz * cs * rad + b.uz * sn * rad;
      const c = arm === 0 ? c0 : tint();
      const size = puffSize(3.1);
      // Ride a little, then slip behind — full inherit made the swirl lift with the orb.
      const ride = 0.22;
      const swirl = 0.45;
      emitBody({
        ...puff(),
        position: [px, py, pz],
        velocity: [
          ball.vx * TICK_HZ * ride + (-b.rx * sn + b.ux * cs) * swirl - b.fx * 1.6,
          ball.vy * TICK_HZ * ride + (-b.ry * sn + b.uy * cs) * swirl - b.fy * 1.6,
          ball.vz * TICK_HZ * ride + (-b.rz * sn + b.uz * cs) * swirl - b.fz * 1.6,
        ],
        gravity: [0, 0, 0],
        color: [c[0], c[1], c[2], 0.84],
        lifetime: 0.42 + Math.random() * 0.14,
        startSize: size,
        endSize: size * 0.42,
        drag: 0.85,
      });
    }
  }

  function emitLaunch(ball) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const c = tint();
      emitBody({
        ...puff(),
        position: [ball.cx, ball.cy, ball.cz],
        velocity: [
          Math.cos(ang) * (1.4 + Math.random() * 1.1),
          0.5 + Math.random() * 0.9,
          Math.sin(ang) * (1.4 + Math.random() * 1.1),
        ],
        gravity: [0, 0.45, 0],
        color: [c[0], c[1], c[2], 0.85],
        lifetime: 0.24 + Math.random() * 0.14,
        startSize: puffSize(1.15),
        endSize: puffSize(0.28),
        drag: 1.3,
      });
    }
  }

  function pulse(ball, dt, gap, arms) {
    const gatherT = Math.min(1, (clock - ball.bornAt) / GATHER_SEC);
    ball.acc += dt;
    const step = gap ?? (ball.winding ? GATHER_GAP : FLY_GAP);
    if (ball.acc < step) return;
    ball.acc = 0;
    if (ball.winding) emitGather(ball, gatherT);
    else emitHelix(ball, arms);
  }

  function beginFrame() {
    for (const ball of live.values()) ball.seen = false;
  }

  function track(slot, generation, x, y, z, vx, vy, vz, winding) {
    const key = keyOf(slot, generation);
    let ball = live.get(key);
    if (!ball) {
      ball = {
        cx: x,
        cy: y,
        cz: z,
        vx,
        vy,
        vz,
        winding: !!winding,
        bornAt: clock,
        phase: Math.random() * Math.PI * 2,
        spin: 9.5 + Math.random() * 2.4,
        acc: 0,
        seen: true,
      };
      live.set(key, ball);
      pulse(ball, GATHER_GAP);
      return;
    }
    ball.seen = true;
    if (ball.winding && !winding) emitLaunch(ball);
    ball.winding = !!winding;
    // Snap to the interpolated orb — easing left the swirl a frame behind.
    ball.cx = x;
    ball.cy = y;
    ball.cz = z;
    ball.vx = vx;
    ball.vy = vy;
    ball.vz = vz;
  }

  function endFrame() {
    for (const [key, ball] of live) {
      if (!ball.seen) live.delete(key);
    }
  }

  function update(deltaMs) {
    const dt = Math.min(0.08, Math.max(0, deltaMs / 1000));
    if (dt <= 0) return;
    clock += dt;
    let flying = 0;
    for (const ball of live.values()) {
      if (!ball.winding) flying++;
    }
    const arms = fireballFlyArms(flying);
    for (const ball of live.values()) {
      ball.phase += ball.spin * dt;
      pulse(ball, dt, ball.winding ? GATHER_GAP : FLY_GAP, arms);
    }
  }

  function clear() {
    live.clear();
  }

  return { beginFrame, track, endFrame, update, clear };
}
