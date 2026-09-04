// Render-only locust swarm: insects follow the shot, then the same bugs
// peel forward onto new chew sites. Matches sim hop (new circles, old fade)
// instead of cloning a full pack on every victim.

const INSECTS = 8;
/** Incoming swarm keeps flying for this long after the shot dies. */
const HANDOFF_SEC = 0.55;
const FADE_SEC = 0.85;
/** One sprite per insect, not a 20-wide ribbon (old gap 0.034 / life ~0.75s). */
const EMIT_GAP = 0.07;
const FOLLOW = 0.38;
const PEEL_SEC = 0.42;
const HOP_SEC = 0.38;
const ORBIT_SPEED = 1.55;
/** Must cover sim LOCUST_HOP_RANGE (22) plus a building footprint. */
const HOP_RANGE2 = 28 * 28;
/** Leave a couple of chewers if the donor is still being eaten. */
const REMNANT = 2;
/** One landing is impact + 2 hops; extra sites share that swarm. */
const LANDING_SITES = 3;
/** Hard cap across shots + chew sites so a saturated blob cannot fill the particle pool. */
const MAX_INSECTS = 200;
/** Tighter than particle size-cull (~660): far swarms stay in sync, they just do not emit. */
const CULL_RANGE = 280;

const BODY = [
  [0.46, 0.5, 0.14, 0.92],
  [0.28, 0.22, 0.07, 0.88],
  [0.58, 0.52, 0.16, 0.8],
  [0.2, 0.26, 0.09, 0.85],
];

function makeInsects(n = INSECTS) {
  const list = [];
  for (let i = 0; i < n; i++) {
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

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function insectCount(pack) {
  let n = 0;
  for (let i = 0; i < pack.clumps.length; i++) n += pack.clumps[i].insects.length;
  return n;
}

function peelFromList(list, n) {
  if (n <= 0 || !list.length) return [];
  const take = Math.min(n, list.length);
  return list.splice(list.length - take, take);
}

/**
 * @param {(init: object) => unknown} emit
 * @param {{ getEye?: () => { x: number, y: number, z: number } | null, cullRangeScale?: number }} [opts]
 */
export function createLocustFx(emit, opts = {}) {
  let getEye = opts.getEye ?? null;
  let cullRangeScale = Math.max(0.05, opts.cullRangeScale ?? 1);
  /** @type {Map<string, {
   *   cx: number, cy: number, cz: number,
   *   vx: number, vz: number,
   *   insects: ReturnType<typeof makeInsects>,
   *   seen: boolean,
   *   key: string,
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
  /** @type {Array<{ key: string, x: number, y: number, z: number }>} */
  const pending = [];

  function keyOf(slot, generation) {
    return `${slot}:${generation}`;
  }

  function tooFar(x, y, z) {
    if (!getEye) return false;
    const eye = getEye();
    if (!eye) return false;
    const range = CULL_RANGE * cullRangeScale;
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    return dx * dx + dy * dy + dz * dz > range * range;
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
      lifetime: 0.26 + Math.random() * 0.18,
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
    if (tooFar(swarm.cx, swarm.cy, swarm.cz)) return;
    for (let i = 0; i < swarm.insects.length; i++) {
      const bug = swarm.insects[i];
      bug.emitAcc += dt;
      if (bug.emitAcc < EMIT_GAP) continue;
      bug.emitAcc = 0;
      emitInsect(swarm, bug, fade);
    }
  }

  function flyingInsects() {
    let n = 0;
    for (const swarm of live.values()) n += swarm.insects.length;
    for (let i = 0; i < handoff.length; i++) n += handoff[i].insects.length;
    return n;
  }

  function totalInsects() {
    let n = flyingInsects();
    for (const pack of dots.values()) n += insectCount(pack);
    return n;
  }

  function roomFor(want) {
    return Math.max(0, Math.min(want, MAX_INSECTS - totalInsects()));
  }

  function trimList(list, n) {
    if (n <= 0 || !list.length) return 0;
    const take = Math.min(n, list.length);
    list.length -= take;
    return take;
  }

  function trimBudget() {
    let extra = totalInsects() - MAX_INSECTS;
    if (extra <= 0) return;
    const eye = getEye?.() ?? null;
    const scored = [];
    for (const pack of dots.values()) {
      const n = insectCount(pack);
      if (n <= 0) continue;
      let hopping = false;
      for (let c = 0; c < pack.clumps.length; c++) {
        if (pack.clumps[c].hop < 1) {
          hopping = true;
          break;
        }
      }
      if (hopping) continue;
      const d = eye ? dist2(pack.tx, pack.tz, eye.x, eye.z) : 0;
      scored.push({ kind: 'pack', pack, d, n });
    }
    for (const swarm of live.values()) {
      if (!swarm.insects.length) continue;
      const d = eye ? dist2(swarm.cx, swarm.cz, eye.x, eye.z) : 0;
      scored.push({ kind: 'live', swarm, d, n: swarm.insects.length });
    }
    for (let i = 0; i < handoff.length; i++) {
      const swarm = handoff[i];
      if (!swarm.insects.length) continue;
      const d = eye ? dist2(swarm.cx, swarm.cz, eye.x, eye.z) : 0;
      scored.push({ kind: 'handoff', swarm, d, n: swarm.insects.length });
    }
    scored.sort((a, b) => b.d - a.d);
    for (let i = 0; i < scored.length && extra > 0; i++) {
      const row = scored[i];
      if (row.kind === 'pack') {
        const keep = row.pack.seen ? 1 : 0;
        extra -= peelFromPack(row.pack, Math.min(extra, Math.max(0, row.n - keep))).length;
      } else {
        extra -= trimList(row.swarm.insects, extra);
      }
    }
  }

  function peelFromPack(pack, n) {
    const taken = [];
    for (let c = pack.clumps.length - 1; c >= 0 && taken.length < n; c--) {
      const more = peelFromList(pack.clumps[c].insects, n - taken.length);
      for (let i = 0; i < more.length; i++) taken.push(more[i]);
      if (!pack.clumps[c].insects.length) pack.clumps.splice(c, 1);
    }
    return taken;
  }

  function nearestHandoff(x, z) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < handoff.length; i++) {
      const swarm = handoff[i];
      if (!swarm.insects.length) continue;
      const d = dist2(swarm.cx, swarm.cz, x, z);
      if (d < bestD) {
        bestD = d;
        best = swarm;
      }
    }
    if (!best || bestD > HOP_RANGE2) return null;
    return { kind: 'handoff', swarm: best, x: best.cx, y: best.cy, z: best.cz };
  }

  function nearestPack(x, z) {
    let best = null;
    let bestKey = null;
    let bestD = Infinity;
    for (const [key, pack] of dots) {
      if (insectCount(pack) <= 0) continue;
      const d = dist2(pack.tx, pack.tz, x, z);
      if (d <= 0.4 || d >= bestD) continue;
      bestD = d;
      best = pack;
      bestKey = key;
    }
    if (!best || bestD > HOP_RANGE2) return null;
    return { kind: 'pack', pack: best, key: bestKey, x: best.tx, y: best.ty, z: best.tz };
  }

  function nearestLive(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const swarm of live.values()) {
      if (!swarm.seen) continue;
      const d = dist2(swarm.cx, swarm.cz, x, z);
      if (d < bestD) {
        bestD = d;
        best = swarm;
      }
    }
    if (!best || bestD > HOP_RANGE2) return null;
    return { kind: 'live', swarm: best, x: best.cx, y: best.cy, z: best.cz };
  }

  function nearestDonor(x, z) {
    return nearestHandoff(x, z) ?? nearestPack(x, z) ?? nearestLive(x, z);
  }

  function spawnDot(key, x, y, z, insects, hopFrom) {
    const ang = Math.random() * Math.PI * 2;
    const pack = {
      tx: x,
      ty: y,
      tz: z,
      driftX: Math.cos(ang) * 2.35,
      driftZ: Math.sin(ang) * 2.35,
      clumps: [],
      seen: true,
      dying: 0,
    };
    if (insects.length) {
      pack.clumps.push(makeClump(
        Math.random() * Math.PI * 2,
        0.35,
        insects,
        hopFrom?.x,
        hopFrom?.y,
        hopFrom?.z,
      ));
    }
    dots.set(key, pack);
    return pack;
  }

  function donorId(donor) {
    if (donor.kind === 'handoff') return `h:${handoff.indexOf(donor.swarm)}`;
    if (donor.kind === 'pack') return `p:${donor.key}`;
    return `l:${donor.swarm.key}`;
  }

  function settleNew(dests, donor) {
    const from = { x: donor.x, y: donor.y, z: donor.z };
    if (donor.kind === 'pack') {
      const have = insectCount(donor.pack);
      const keep = donor.pack.seen ? REMNANT : 0;
      let remain = Math.max(0, have - keep);
      for (let i = 0; i < dests.length; i++) {
        const take = Math.ceil(remain / (dests.length - i));
        remain -= take;
        const dest = dests[i];
        spawnDot(dest.key, dest.x, dest.y, dest.z, peelFromPack(donor.pack, take), from);
      }
      return;
    }
    // Incoming shot: split the same insects across impact + hops. Do not mint
    // a full pack per site — that is what blew the particle pool to 65k.
    const ordered = dests.slice();
    ordered.sort((a, b) => dist2(a.x, a.z, from.x, from.z) - dist2(b.x, b.z, from.x, from.z));
    const lush = ordered.slice(0, LANDING_SITES);
    const rest = ordered.slice(LANDING_SITES);
    const keepOnShot = donor.kind === 'live' ? REMNANT : 0;
    const available = Math.max(0, donor.swarm.insects.length - keepOnShot);
    const pool = peelFromList(donor.swarm.insects, available);
    for (let i = 0; i < lush.length; i++) {
      const share = [];
      for (let k = i; k < pool.length; k += lush.length) share.push(pool[k]);
      const dest = lush[i];
      spawnDot(dest.key, dest.x, dest.y, dest.z, share, from);
    }
    if (!rest.length) return;
    const seed = dots.get(lush[0].key);
    if (!seed) return;
    settleNew(rest, {
      kind: 'pack',
      pack: seed,
      key: lush[0].key,
      x: seed.tx,
      y: seed.ty,
      z: seed.tz,
    });
  }

  function settleOrphans(orphans) {
    const left = orphans.slice();
    while (left.length) {
      const seed = left.shift();
      const pack = spawnDot(seed.key, seed.x, seed.y, seed.z, makeInsects(Math.max(1, roomFor(INSECTS))), null);
      const nearby = [];
      for (let i = left.length - 1; i >= 0; i--) {
        if (dist2(left[i].x, left[i].z, seed.x, seed.z) > HOP_RANGE2) continue;
        nearby.push(left[i]);
        left.splice(i, 1);
      }
      if (!nearby.length) continue;
      settleNew(nearby, {
        kind: 'pack',
        pack,
        key: seed.key,
        x: seed.x,
        y: seed.y,
        z: seed.z,
      });
    }
  }

  function resolvePending() {
    if (!pending.length) return;
    /** @type {Map<string, { donor: ReturnType<typeof nearestDonor>, dests: typeof pending }>} */
    const groups = new Map();
    const orphans = [];
    for (let i = 0; i < pending.length; i++) {
      const dest = pending[i];
      const donor = nearestDonor(dest.x, dest.z);
      if (!donor) {
        orphans.push(dest);
        continue;
      }
      const id = donorId(donor);
      let group = groups.get(id);
      if (!group) {
        group = { donor, dests: [] };
        groups.set(id, group);
      }
      group.dests.push(dest);
    }
    for (const group of groups.values()) settleNew(group.dests, group.donor);
    settleOrphans(orphans);
    for (let i = handoff.length - 1; i >= 0; i--) {
      if (!handoff[i].insects.length) handoff.splice(i, 1);
    }
    pending.length = 0;
    trimBudget();
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
        key,
        cx: x,
        cy: y,
        cz: z,
        vx,
        vz,
        insects: makeInsects(roomFor(INSECTS)),
        seen: true,
      };
      live.set(key, swarm);
      if (swarm.insects.length) pulse(swarm, EMIT_GAP, 1);
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
    pending.length = 0;
  }

  function sustain(key, x, y, z, stacks) {
    if ((stacks | 0) <= 0) return;
    const pack = dots.get(key);
    if (pack) {
      pack.seen = true;
      pack.dying = 0;
      pack.tx += (x - pack.tx) * 0.28;
      pack.ty += (y - pack.ty) * 0.28;
      pack.tz += (z - pack.tz) * 0.28;
      return;
    }
    pending.push({ key, x, y, z });
  }

  function endDots() {
    resolvePending();
    for (const [key, pack] of dots) {
      if (pack.seen) continue;
      if (insectCount(pack) <= 0) {
        dots.delete(key);
        continue;
      }
      if (pack.dying <= 0) pack.dying = 1e-6;
    }
  }

  function update(deltaMs) {
    const dt = Math.min(0.08, Math.max(0, deltaMs / 1000));
    if (dt <= 0) return;
    trimBudget();
    for (const swarm of live.values()) pulse(swarm, dt, 1);
    for (let i = handoff.length - 1; i >= 0; i--) {
      const swarm = handoff[i];
      swarm.age += dt;
      swarm.cx += swarm.vx * dt;
      swarm.cz += swarm.vz * dt;
      swarm.vx *= Math.exp(-dt * 1.6);
      swarm.vz *= Math.exp(-dt * 1.6);
      if (swarm.insects.length) pulse(swarm, dt, 1);
      if (swarm.age >= HANDOFF_SEC || !swarm.insects.length) handoff.splice(i, 1);
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
    pending.length = 0;
  }

  function configure(next = {}) {
    if (next.getEye !== undefined) getEye = next.getEye;
    if (next.cullRangeScale != null) cullRangeScale = Math.max(0.05, next.cullRangeScale);
  }

  function snapshot() {
    const packs = [];
    for (const [key, pack] of dots) {
      packs.push({
        key,
        insects: insectCount(pack),
        dying: pack.dying,
        x: pack.tx,
        z: pack.tz,
      });
    }
    return {
      live: live.size,
      handoff: handoff.length,
      packs,
      insects: totalInsects(),
    };
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
    configure,
    snapshot,
  };
}

export const LOCUST_FX_INSECTS = INSECTS;
export const LOCUST_FX_REMNANT = REMNANT;
export const LOCUST_FX_MAX_INSECTS = MAX_INSECTS;
