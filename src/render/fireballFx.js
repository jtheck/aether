// Render-only warlock fireball: gather wind-up, then a dense puff-spiral body.

const GATHER_SEC = 0.8;
const GATHER_GAP = 0.022;
const FLY_GAP = 0.012;
const ARMS = 3;
const BEADS = 5;
const HELIX_R = 1.15;
/** Sim velocities are world-units per tick (20 Hz). Particles are per-second. */
const TICK_HZ = 20;

const HOT = [
  [1, 0.88, 0.28, 0.92],
  [1, 0.55, 0.08, 0.88],
  [1, 0.32, 0.04, 0.8],
  [0.92, 0.12, 0.02, 0.72],
];

function puff(spin = 1.8) {
  return {
    sprite: 'puff',
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * spin,
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
      emit({
        ...puff(2.2),
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
      emit({
        ...puff(1.1),
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

  function emitHelix(ball) {
    const b = basis(ball.vx, ball.vy, ball.vz);
    const c0 = tint();
    for (let arm = 0; arm < ARMS; arm++) {
      for (let k = 0; k < BEADS; k++) {
        const a = ball.phase + arm * ((Math.PI * 2) / ARMS) - k * 0.42;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        const rad = HELIX_R * (1 - k * 0.08) + Math.sin(ball.phase * 1.6 + arm) * 0.12;
        const back = k * 0.38;
        const px = ball.cx + b.rx * cs * rad + b.ux * sn * rad - b.fx * back;
        const py = ball.cy + b.ry * cs * rad + b.uy * sn * rad - b.fy * back;
        const pz = ball.cz + b.rz * cs * rad + b.uz * sn * rad - b.fz * back;
        const c = k === 0 ? c0 : tint();
        const size = puffSize(2.05 - k * 0.28);
        // Ride a little, then slip behind — full inherit made the swirl lift with the orb.
        const ride = 0.22;
        const swirl = 1.05;
        emit({
          ...puff(2.4),
          position: [px, py, pz],
          velocity: [
            ball.vx * TICK_HZ * ride + (-b.rx * sn + b.ux * cs) * swirl - b.fx * 3.4,
            ball.vy * TICK_HZ * ride + (-b.ry * sn + b.uy * cs) * swirl - b.fy * 3.4,
            ball.vz * TICK_HZ * ride + (-b.rz * sn + b.uz * cs) * swirl - b.fz * 3.4,
          ],
          gravity: [0, 0, 0],
          color: [c[0], c[1], c[2], 0.82 - k * 0.1],
          lifetime: 0.4 + Math.random() * 0.16,
          startSize: size,
          endSize: size * 0.16,
          drag: 0.85,
        });
      }
    }
  }

  function emitLaunch(ball) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const c = tint();
      emit({
        ...puff(2.6),
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

  function pulse(ball, dt) {
    const gatherT = Math.min(1, (clock - ball.bornAt) / GATHER_SEC);
    ball.acc += dt;
    const gap = ball.winding ? GATHER_GAP : FLY_GAP;
    if (ball.acc < gap) return;
    ball.acc = 0;
    if (ball.winding) emitGather(ball, gatherT);
    else emitHelix(ball);
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
    for (const ball of live.values()) {
      ball.phase += ball.spin * dt;
      pulse(ball, dt);
    }
  }

  function clear() {
    live.clear();
  }

  return { beginFrame, track, endFrame, update, clear };
}
