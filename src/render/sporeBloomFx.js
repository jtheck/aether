// Render-only Spore Bloom FX.
// Stage order: inky drips → colorful seed wisps → trees shrink → mushrooms → trees.

import { SPORE_DRIP_FOUNTAIN, SPORE_SEED_ARC_HALF } from '../sim/sporeBloom.js';

/**
 * @param {(init: object) => unknown} emit
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{ spawnCluster?: Function, clearGrown?: Function, clear?: Function, update?: Function } | null} [mushrooms]
 */
export function createSporeBloomFx(emit, groundYAt, mushrooms = null) {
  let simTick = 0;
  /** @type {Array<{ x: number, z: number, age: number, life: number, emitAcc: number, dropped: number, budget: number }>} */
  const drips = [];
  /** @type {Array<{ x: number, z: number, growAtTick: number, wait: number }>} */
  const pendingMushrooms = [];
  /** Seed-tile wisps — delayed so ink drips lead; stop just before trees sprout. */
  /** @type {Map<string, { x: number, z: number, growAtTick: number, delay: number, acc: number }>} */
  const seeds = new Map();
  /** Quick cast-confirm lines along the seed arc. */
  /** @type {Array<{
   *   cx: number, cz: number, mid: number, half: number, radius: number,
   *   age: number, life: number, swept: number,
   * }>} */
  const arcs = [];
  const ARC_LIFE = 0.32;
  const ARC_POINTS = 36;
  const ARC_EDGE = 0.22;

  const DRIP_LIFE = 1.35;
  // Let ink beads hang/drop before fungal sparkles kick in.
  const WISP_START_DELAY = 0.55;
  // Trees start melt ~0.85s and finish ~2.25s; sprout mushies as melt wraps up.
  const MUSHROOM_DELAY = 1.55;
  // Sim runs at 20Hz; cut wisps this many ticks before grow so live ones fade before trees.
  const TICK_HZ = 20;
  const WISP_END_LEAD_TICKS = Math.round(1.0 * TICK_HZ);

  function seedKey(x, z) {
    return `${x.toFixed(2)},${z.toFixed(2)}`;
  }

  function arcPoint(arc, t) {
    const ang = arc.mid - arc.half + t * arc.half * 2;
    return {
      x: arc.cx + Math.cos(ang) * arc.radius,
      z: arc.cz + Math.sin(ang) * arc.radius,
      ang,
    };
  }

  function edgeFade(t) {
    const u = Math.max(0, Math.min(1, t));
    const rise = Math.max(0, Math.min(1, u / ARC_EDGE));
    const fall = Math.max(0, Math.min(1, (1 - u) / ARC_EDGE));
    const s = rise * fall;
    return s * s * (3 - 2 * s);
  }

  function emitArcBead(arc, t, lead) {
    const fade = edgeFade(t);
    if (fade < 0.06) return;
    const p = arcPoint(arc, t);
    const gy = groundYAt(p.x, p.z);
    const size = (lead ? 0.46 : 0.38) * (0.45 + 0.55 * fade);
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: true,
      position: [p.x, gy + 0.38, p.z],
      velocity: [0, 0, 0],
      gravity: [0, 0, 0],
      color: [0, 0, 0, (lead ? 1 : 0.9) * fade],
      lifetime: lead ? 0.18 : 0.36,
      startSize: size,
      endSize: size * 0.85,
      drag: 0,
    });
  }

  function spawnArcFlash(cx, cz, dirX, dirY, radius) {
    const len = Math.hypot(dirX, dirY);
    if (len <= 1e-6 || !(radius > 0)) return;
    const arc = {
      cx,
      cz,
      mid: Math.atan2(dirY, dirX),
      half: SPORE_SEED_ARC_HALF * 0.86,
      radius,
      age: 0,
      life: ARC_LIFE,
      swept: 0,
    };
    arcs.push(arc);
    for (let i = 0; i < ARC_POINTS; i++) {
      emitArcBead(arc, i / (ARC_POINTS - 1), false);
    }
  }

  function updateArcs(dt) {
    for (let i = arcs.length - 1; i >= 0; i--) {
      const arc = arcs[i];
      arc.age += dt;
      const t = Math.min(1, arc.age / arc.life);
      while (arc.swept <= t) {
        emitArcBead(arc, Math.min(1, arc.swept), true);
        arc.swept += 1 / ARC_POINTS;
      }
      if (arc.age >= arc.life) arcs.splice(i, 1);
    }
  }

  function queueTreeDrips(worldX, worldZ, kind = 0) {
    const fountain = kind === SPORE_DRIP_FOUNTAIN;
    drips.push({
      x: worldX,
      z: worldZ,
      age: 0,
      life: fountain ? 1.85 : DRIP_LIFE,
      emitAcc: fountain ? 0 : 0.04,
      dropped: 0,
      budget: fountain ? 48 + Math.floor(Math.random() * 16) : 10 + Math.floor(Math.random() * 5),
      fountain,
    });
    if (fountain) {
      const gy = groundYAt(worldX, worldZ);
      for (let n = 0; n < 22; n++) emitFountainDroplet(worldX, worldZ, gy);
    }
  }

  /**
   * Round ink beads: hang + swell, then drop.
   * Alpha blend required — additive black is invisible.
   */
  function emitOneDroplet(x, z, gy) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.7;
    const startY = gy + 3.2 + Math.random() * 3.2;
    const hang = 0.28 + Math.random() * 0.32;
    const peak = 0.55 + Math.random() * 0.35;
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: false,
      killY: gy - 2.5,
      position: [
        x + Math.cos(ang) * rad,
        startY,
        z + Math.sin(ang) * rad,
      ],
      velocity: [0, -0.15 - Math.random() * 0.2, 0],
      gravity: [0, -22 - Math.random() * 10, 0],
      color: [0, 0, 0, 1],
      hangTime: hang,
      // Long enough to clear terrain; killY culls once underground.
      lifetime: hang + 2.5,
      startSize: 0.18 + Math.random() * 0.12,
      peakSize: peak,
      endSize: peak,
      drag: 0.08,
    });
  }

  /** Tall ink jet: shoot up from the body, then fall as drips. */
  function emitFountainDroplet(x, z, gy) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.38;
    const ox = Math.cos(ang) * rad;
    const oz = Math.sin(ang) * rad;
    const peak = 0.48 + Math.random() * 0.38;
    if (Math.random() > 0.28) {
      const vy = 18 + Math.random() * 16;
      emit({
        blend: 'alpha',
        hard: true,
        fadeOut: false,
        killY: gy - 2.5,
        position: [x + ox, gy + 0.4 + Math.random() * 1.3, z + oz],
        velocity: [ox * 2.2, vy, oz * 2.2],
        gravity: [0, -16 - Math.random() * 8, 0],
        color: [0, 0, 0, 1],
        hangTime: 0,
        lifetime: 2.6,
        startSize: 0.16 + Math.random() * 0.14,
        peakSize: peak,
        endSize: peak,
        drag: 0.12,
      });
      return;
    }
    const hang = 0.18 + Math.random() * 0.28;
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: false,
      killY: gy - 2.5,
      position: [x + ox * 0.55, gy + 8 + Math.random() * 8, z + oz * 0.55],
      velocity: [0, -0.12 - Math.random() * 0.18, 0],
      gravity: [0, -22 - Math.random() * 10, 0],
      color: [0, 0, 0, 1],
      hangTime: hang,
      lifetime: hang + 2.6,
      startSize: 0.18 + Math.random() * 0.14,
      peakSize: peak,
      endSize: peak,
      drag: 0.08,
    });
  }

  function updateDrips(dt) {
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.age += dt;
      d.emitAcc += dt;
      const gy = groundYAt(d.x, d.z);
      const gap = d.fountain
        ? 0.035 + (d.dropped / Math.max(1, d.budget)) * 0.05
        : 0.1 + (d.dropped / Math.max(1, d.budget)) * 0.12;
      while (d.emitAcc >= gap && d.dropped < d.budget && d.age < d.life) {
        d.emitAcc -= gap;
        if (d.fountain) emitFountainDroplet(d.x, d.z, gy);
        else emitOneDroplet(d.x, d.z, gy);
        d.dropped++;
      }
      if (d.age >= d.life + 0.9) drips.splice(i, 1);
    }
  }

  /** Purple / green fungal wisps — slow, floaty spore-drift (not sparks). */
  function emitSeedWisps(dt) {
    for (const s of seeds.values()) {
      if (simTick >= s.growAtTick - WISP_END_LEAD_TICKS) continue;
      if (s.delay > 0) {
        s.delay -= dt;
        continue;
      }
      s.acc += dt;
      // Sparse cadence so they hang in the air instead of spraying.
      if (s.acc < 0.28) continue;
      s.acc = 0;
      const gy = groundYAt(s.x, s.z);
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.85;
      const drift = 0.08 + Math.random() * 0.18;
      emit({
        blend: 'alpha',
        fadeOut: true,
        position: [
          s.x + Math.cos(ang) * rad,
          gy + 0.2 + Math.random() * 0.7,
          s.z + Math.sin(ang) * rad,
        ],
        velocity: [
          Math.cos(ang) * drift,
          0.08 + Math.random() * 0.22,
          Math.sin(ang) * drift,
        ],
        gravity: [0, 0.04, 0],
        color:
          Math.random() > 0.4
            ? [0.65, 0.4, 0.95, 0.42]
            : [0.4, 0.9, 0.45, 0.38],
        lifetime: 1.8 + Math.random() * 1.4,
        startSize: 0.22 + Math.random() * 0.28,
        endSize: 0.06 + Math.random() * 0.08,
        drag: 0.25,
      });
    }
  }

  function clearGrownSeeds(tick) {
    if (Number.isFinite(tick)) simTick = tick;
    for (const [key, s] of seeds) {
      if (simTick >= s.growAtTick - WISP_END_LEAD_TICKS) seeds.delete(key);
    }
  }

  function updatePendingMushrooms(dt) {
    for (let i = pendingMushrooms.length - 1; i >= 0; i--) {
      const m = pendingMushrooms[i];
      m.wait -= dt;
      if (m.wait > 0) continue;
      // Keep retrying until the GLB bridge is ready — don't drop the seed.
      if (!mushrooms?.spawnCluster?.(m.x, m.z, m.growAtTick)) continue;
      pendingMushrooms.splice(i, 1);
    }
  }

  function applyUpdates(updatesList, currentTick = 0) {
    if (Number.isFinite(currentTick)) simTick = currentTick;
    if (!updatesList?.length) return;
    for (let u = 0; u < updatesList.length; u++) {
      const patch = updatesList[u];
      const dn = patch?.dripCount ?? 0;
      for (let i = 0; i < dn; i++) {
        queueTreeDrips(patch.dripX[i], patch.dripY[i], patch.dripKind?.[i] ?? 0);
      }
      const sn = patch?.seedCount ?? 0;
      for (let i = 0; i < sn; i++) {
        const x = patch.seedX[i];
        const z = patch.seedY[i];
        const growAtTick = patch.seedGrowAt[i] | 0;
        // Wisps wait so ink drips read first.
        seeds.set(seedKey(x, z), {
          x,
          z,
          growAtTick,
          delay: WISP_START_DELAY,
          acc: 0,
        });
        pendingMushrooms.push({
          x,
          z,
          growAtTick,
          wait: MUSHROOM_DELAY,
        });
      }
      const an = patch?.arcCount ?? 0;
      for (let i = 0; i < an; i++) {
        spawnArcFlash(
          patch.arcX[i],
          patch.arcY[i],
          patch.arcDirX[i],
          patch.arcDirY[i],
          patch.arcRadius[i],
        );
      }
      const hn = patch?.headCount ?? 0;
      for (let i = 0; i < hn; i++) {
        const hx = patch.headX[i];
        const hz = patch.headY[i];
        mushrooms?.spawnHead?.(patch.headEntity[i], hx, hz, !!patch.headKill[i]);
        const gy = groundYAt(hx, hz);
        for (let n = 0; n < 5; n++) {
          emit({
            blend: 'alpha',
            fadeOut: true,
            position: [
              hx + (Math.random() - 0.5) * 0.7,
              gy + 1.8 + Math.random() * 0.8,
              hz + (Math.random() - 0.5) * 0.7,
            ],
            velocity: [
              (Math.random() - 0.5) * 1.4,
              1.1 + Math.random() * 1.6,
              (Math.random() - 0.5) * 1.4,
            ],
            gravity: [0, 0.15, 0],
            color:
              Math.random() > 0.4
                ? [0.65, 0.4, 0.95, 0.5]
                : [0.4, 0.9, 0.45, 0.46],
            lifetime: 0.45 + Math.random() * 0.35,
            startSize: 0.28 + Math.random() * 0.22,
            endSize: 0.05,
            drag: 1.1,
          });
        }
      }
    }
  }

  function update(deltaMs, currentTick) {
    if (Number.isFinite(currentTick)) {
      simTick = currentTick;
      clearGrownSeeds(currentTick);
    }
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    updateArcs(dt);
    updateDrips(dt);
    emitSeedWisps(dt);
    updatePendingMushrooms(dt);
    mushrooms?.update?.(deltaMs, simTick);
  }

  function clear() {
    drips.length = 0;
    pendingMushrooms.length = 0;
    seeds.clear();
    arcs.length = 0;
    mushrooms?.clear?.();
    simTick = 0;
  }

  return {
    applyUpdates,
    update,
    clear,
  };
}
