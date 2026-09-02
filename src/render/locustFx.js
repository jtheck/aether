// Render-only locust swarm: orbiting insects that swerve with the shot, then
// peel off and circle a nearby spot at full intensity while the DoT is up.

const INSECTS = 8;
/** Incoming swarm keeps flying for this long after the shot dies. */
const HANDOFF_SEC = 0.55;
const FADE_SEC = 0.85;
const EMIT_GAP = 0.034;
const FOLLOW = 0.38;
const PEEL_SEC = 0.42;
const HOP_SEC = 0.38;
const ORBIT_SPEED = 1.55;

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

function makeClump(angle, spread, insects, fromX, fromY, fromZ) {
  return {
    insects: insects ?? makeInsects(),
    orbitPhase: angle,
    orbitSpin: ORBIT_SPEED * (0.75 + Math.random() * 0.55) * (Math.random() < 0.5 ? -1 : 1),
    orbitR: 2.05 + spread,
    peel: 0,
    hop: fromX != null ? 0 : 1,
    fromX: fromX ?? 0,
    fromY: fromY ?? 0,
    fromZ: fromZ ?? 0,
    placed: false,
    cx: 0,
    cy: 0,
    cz: 0,
    vx: 0,
    vz: 0,
  };
}

function visualCount(stacks) {
  return Math.max(0, stacks | 0);
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
  const handoff = [];
  /** @type {Map<string, {
   *   tx: number, ty: number, tz: number,
   *   driftX: number, driftZ: number,
   *   clumps: ReturnType<typeof makeClump>[],
   *   seen: boolean,
   *   dying: number,
   * }>} */
  const dots = new Map();

  function keyOf(slot, generation) {
    return `${slot}:${generation}`;
  }

  function emitInsect(swarm, insect, fade) {
    const a = fade == null ? 1 : fade;
    if (a <= 0.04) return;
    const ox = Math.cos(insect.phase) * insect.radius;
    const oz = Math.sin(insect.phase) * insect.radius;
    const oy = insect.yOff + Math.sin(insect.bobPhase) * 0.42;
    const tx = -Math.sin(insect.phase) * insect.spin * 0.55;
    const tz = Math.cos(insect.phase) * insect.spin * 0.55;
    const c = BODY[(Math.random() * BODY.length) | 0];
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: true,
      hangTime: 0.08 + Math.random() * 0.16,
      position: [swarm.cx + ox, swarm.cy + oy, swarm.cz + oz],
      velocity: [
        swarm.vx * 0.22 + tx + (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 1.15,
        swarm.vz * 0.22 + tz + (Math.random() - 0.5) * 1.1,
      ],
      gravity: [0, -0.85, 0],
      color: [c[0], c[1], c[2], c[3] * a],
      lifetime: 0.55 + Math.random() * 0.4,
      startSize: [0.7 + Math.random() * 0.28, 0.2 + Math.random() * 0.1],
      endSize: [0.14, 0.05],
      drag: 1.15,
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

  function pulse(swarm, dt, fade) {
    stepInsects(swarm.insects, dt);
    for (let i = 0; i < swarm.insects.length; i++) {
      const bug = swarm.insects[i];
      bug.emitAcc += dt;
      if (bug.emitAcc < EMIT_GAP) continue;
      bug.emitAcc = 0;
      emitInsect(swarm, bug, fade);
    }
  }

  function nearestHopOrigin(x, y, z) {
    let best = null;
    let bestD = Infinity;
    for (const pack of dots.values()) {
      const dx = pack.tx - x;
      const dz = pack.tz - z;
      const d = dx * dx + dz * dz;
      if (d > 0.4 && d < bestD) {
        bestD = d;
        best = { x: pack.tx, y: pack.ty, z: pack.tz };
      }
    }
    for (let i = 0; i < handoff.length; i++) {
      const swarm = handoff[i];
      const dx = swarm.cx - x;
      const dz = swarm.cz - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = { x: swarm.cx, y: swarm.cy, z: swarm.cz };
      }
    }
    return best;
  }

  function ensureClumps(pack, want, hopFrom) {
    while (pack.clumps.length < want) {
      const i = pack.clumps.length;
      const angle = (i * Math.PI * 2) / Math.max(3, want) + Math.random() * 0.4;
      const from = hopFrom ?? (pack.clumps[0]
        ? { x: pack.clumps[0].cx, y: pack.clumps[0].cy, z: pack.clumps[0].cz }
        : null);
      pack.clumps.push(makeClump(
        angle,
        0.35 + i * 0.28,
        null,
        from?.x,
        from?.y,
        from?.z,
      ));
    }
    if (pack.clumps.length > want) pack.clumps.length = want;
  }

  function stepClump(pack, clump, dt) {
    clump.peel = Math.min(1, clump.peel + dt / PEEL_SEC);
    if (clump.hop < 1) clump.hop = Math.min(1, clump.hop + dt / HOP_SEC);
    clump.orbitPhase += clump.orbitSpin * dt;
    const r = clump.orbitR * clump.peel;
    const homeX = pack.tx + pack.driftX;
    const homeZ = pack.tz + pack.driftZ;
    const destX = homeX + Math.cos(clump.orbitPhase) * r;
    const destZ = homeZ + Math.sin(clump.orbitPhase) * r;
    const destY = pack.ty + Math.sin(clump.orbitPhase * 1.7) * 0.28;
    const t = clump.hop * clump.hop;
    const nx = clump.fromX + (destX - clump.fromX) * t;
    const ny = clump.fromY + (destY - clump.fromY) * t;
    const nz = clump.fromZ + (destZ - clump.fromZ) * t;
    clump.vx = (nx - clump.cx) / Math.max(dt, 1e-4);
    clump.vz = (nz - clump.cz) / Math.max(dt, 1e-4);
    clump.cx = nx;
    clump.cy = ny;
    clump.cz = nz;
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
      pulse(swarm, EMIT_GAP, 1);
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
      handoff.push({
        cx: swarm.cx,
        cy: swarm.cy,
        cz: swarm.cz,
        vx: swarm.vx * 0.45,
        vz: swarm.vz * 0.45,
        insects: swarm.insects,
        age: 0,
      });
      live.delete(key);
    }
  }

  function beginDots() {
    for (const pack of dots.values()) pack.seen = false;
  }

  function sustain(key, x, y, z, stacks) {
    const want = visualCount(stacks);
    if (want <= 0) return;
    let pack = dots.get(key);
    const hopFrom = pack ? null : nearestHopOrigin(x, y, z);
    if (!pack) {
      const ang = Math.random() * Math.PI * 2;
      pack = {
        tx: x,
        ty: y,
        tz: z,
        driftX: Math.cos(ang) * 2.35,
        driftZ: Math.sin(ang) * 2.35,
        clumps: [],
        seen: true,
        dying: 0,
      };
      dots.set(key, pack);
    }
    pack.seen = true;
    pack.dying = 0;
    pack.tx += (x - pack.tx) * 0.28;
    pack.ty += (y - pack.ty) * 0.28;
    pack.tz += (z - pack.tz) * 0.28;
    ensureClumps(pack, want, hopFrom);
  }

  function endDots() {
    for (const [key, pack] of dots) {
      if (pack.seen) continue;
      if (pack.dying <= 0) pack.dying = 1e-6;
    }
  }

  function update(deltaMs) {
    const dt = Math.min(0.08, Math.max(0, deltaMs / 1000));
    if (dt <= 0) return;
    for (const swarm of live.values()) pulse(swarm, dt, 1);
    for (let i = handoff.length - 1; i >= 0; i--) {
      const swarm = handoff[i];
      swarm.age += dt;
      swarm.cx += swarm.vx * dt;
      swarm.cz += swarm.vz * dt;
      swarm.vx *= Math.exp(-dt * 1.6);
      swarm.vz *= Math.exp(-dt * 1.6);
      pulse(swarm, dt, 1);
      if (swarm.age >= HANDOFF_SEC) handoff.splice(i, 1);
    }
    for (const [key, pack] of dots) {
      if (pack.dying > 0) pack.dying += dt;
      const fade = pack.dying > 0 ? Math.max(0, 1 - pack.dying / FADE_SEC) : 1;
      for (let c = 0; c < pack.clumps.length; c++) {
        const clump = pack.clumps[c];
        if (!clump.placed) {
          clump.cx = clump.hop < 1 ? clump.fromX : pack.tx;
          clump.cy = clump.hop < 1 ? clump.fromY : pack.ty;
          clump.cz = clump.hop < 1 ? clump.fromZ : pack.tz;
          clump.placed = true;
        }
        stepClump(pack, clump, dt);
        pulse(clump, dt, fade);
      }
      if (pack.dying >= FADE_SEC) dots.delete(key);
    }
  }

  function clear() {
    live.clear();
    handoff.length = 0;
    dots.clear();
  }

  return {
    beginFrame,
    track,
    endFrame,
    beginDots,
    sustain,
    endDots,
    update,
    clear,
  };
}
