// Render-only locust swarm: orbiting insects that swerve with the shot and linger.

const INSECTS = 8;
const LINGER_SEC = 0.9;
const EMIT_GAP = 0.034;
const FOLLOW = 0.38;

const BODY = [
  [0.46, 0.5, 0.14, 0.92],
  [0.28, 0.22, 0.07, 0.88],
  [0.58, 0.52, 0.16, 0.8],
  [0.2, 0.26, 0.09, 0.85],
];

function makeInsects() {
  const list = [];
  for (let i = 0; i < INSECTS; i++) {
    list.push({
      phase: Math.random() * Math.PI * 2,
      radius: 0.5 + Math.random() * 1.45,
      spin: (1.1 + Math.random() * 2.2) * (Math.random() < 0.5 ? -1 : 1),
      bob: 0.9 + Math.random() * 1.6,
      bobPhase: Math.random() * Math.PI * 2,
      yOff: (Math.random() - 0.5) * 0.85,
      emitAcc: Math.random() * EMIT_GAP,
    });
  }
  return list;
}

/**
 * @param {(init: object) => unknown} emit
 */
export function createLocustFx(emit) {
  /** @type {Map<string, {
   *   cx: number, cy: number, cz: number,
   *   vx: number, vz: number,
   *   insects: ReturnType<typeof makeInsects>,
   *   seen: boolean,
   * }>} */
  const live = new Map();
  /** @type {Array<{
   *   cx: number, cy: number, cz: number,
   *   vx: number, vz: number,
   *   insects: ReturnType<typeof makeInsects>,
   *   age: number,
   * }>} */
  const lingering = [];

  function keyOf(slot, generation) {
    return `${slot}:${generation}`;
  }

  function emitInsect(swarm, insect, lingerT) {
    const fade = lingerT == null ? 1 : Math.max(0, 1 - lingerT / LINGER_SEC);
    if (fade <= 0.04) return;
    const ox = Math.cos(insect.phase) * insect.radius;
    const oz = Math.sin(insect.phase) * insect.radius;
    const oy = insect.yOff + Math.sin(insect.bobPhase) * 0.42;
    const tx = -Math.sin(insect.phase) * insect.spin * 0.55;
    const tz = Math.cos(insect.phase) * insect.spin * 0.55;
    const c = BODY[(Math.random() * BODY.length) | 0];
    const hang = lingerT == null
      ? 0.06 + Math.random() * 0.1
      : 0.16 + Math.random() * 0.28;
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: true,
      hangTime: hang,
      position: [swarm.cx + ox, swarm.cy + oy, swarm.cz + oz],
      velocity: [
        swarm.vx * 0.22 + tx + (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 1.15,
        swarm.vz * 0.22 + tz + (Math.random() - 0.5) * 1.1,
      ],
      gravity: [0, lingerT == null ? -1.4 : -0.55, 0],
      color: [c[0], c[1], c[2], c[3] * fade],
      lifetime: (lingerT == null ? 0.5 : 0.75) + Math.random() * 0.45,
      startSize: [0.7 + Math.random() * 0.28, 0.2 + Math.random() * 0.1],
      endSize: [0.14, 0.05],
      drag: lingerT == null ? 1.05 : 1.55,
      rotation: insect.phase,
    });
  }

  function stepInsects(insects, dt) {
    for (let i = 0; i < insects.length; i++) {
      const bug = insects[i];
      bug.phase += bug.spin * dt;
      bug.bobPhase += bug.bob * dt;
    }
  }

  function pulse(swarm, dt, lingerT) {
    stepInsects(swarm.insects, dt);
    for (let i = 0; i < swarm.insects.length; i++) {
      const bug = swarm.insects[i];
      bug.emitAcc += dt;
      if (bug.emitAcc < EMIT_GAP) continue;
      bug.emitAcc = 0;
      emitInsect(swarm, bug, lingerT);
    }
  }

  function beginFrame() {
    for (const swarm of live.values()) swarm.seen = false;
  }

  function track(slot, generation, x, y, z, vx, vz) {
    const key = keyOf(slot, generation);
    let swarm = live.get(key);
    if (!swarm) {
      swarm = {
        cx: x,
        cy: y,
        cz: z,
        vx,
        vz,
        insects: makeInsects(),
        seen: true,
      };
      live.set(key, swarm);
      pulse(swarm, EMIT_GAP, null);
      return;
    }
    swarm.seen = true;
    swarm.cx += (x - swarm.cx) * FOLLOW;
    swarm.cy += (y - swarm.cy) * FOLLOW;
    swarm.cz += (z - swarm.cz) * FOLLOW;
    swarm.vx = vx;
    swarm.vz = vz;
  }

  function endFrame() {
    for (const [key, swarm] of live) {
      if (swarm.seen) continue;
      lingering.push({
        cx: swarm.cx,
        cy: swarm.cy,
        cz: swarm.cz,
        vx: swarm.vx * 0.35,
        vz: swarm.vz * 0.35,
        insects: swarm.insects,
        age: 0,
      });
      live.delete(key);
    }
  }

  function update(deltaMs) {
    const dt = Math.min(0.08, Math.max(0, deltaMs / 1000));
    if (dt <= 0) return;
    for (const swarm of live.values()) pulse(swarm, dt, null);
    for (let i = lingering.length - 1; i >= 0; i--) {
      const swarm = lingering[i];
      swarm.age += dt;
      swarm.cx += swarm.vx * dt;
      swarm.cz += swarm.vz * dt;
      swarm.vx *= Math.exp(-dt * 2.2);
      swarm.vz *= Math.exp(-dt * 2.2);
      pulse(swarm, dt, swarm.age);
      if (swarm.age >= LINGER_SEC) lingering.splice(i, 1);
    }
  }

  function clear() {
    live.clear();
    lingering.length = 0;
  }

  return { beginFrame, track, endFrame, update, clear };
}
