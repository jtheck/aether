// Render-only Spore Bloom FX.
// Stage order: inky drips → colorful seed wisps → trees shrink → mushrooms → trees.

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

  function queueTreeDrips(worldX, worldZ) {
    drips.push({
      x: worldX,
      z: worldZ,
      age: 0,
      life: DRIP_LIFE,
      emitAcc: 0.04,
      dropped: 0,
      budget: 10 + Math.floor(Math.random() * 5),
    });
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

  function updateDrips(dt) {
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.age += dt;
      d.emitAcc += dt;
      const gy = groundYAt(d.x, d.z);
      const gap = 0.1 + (d.dropped / Math.max(1, d.budget)) * 0.12;
      while (d.emitAcc >= gap && d.dropped < d.budget && d.age < d.life) {
        d.emitAcc -= gap;
        emitOneDroplet(d.x, d.z, gy);
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
        queueTreeDrips(patch.dripX[i], patch.dripY[i]);
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
    }
  }

  function update(deltaMs, currentTick) {
    if (Number.isFinite(currentTick)) {
      simTick = currentTick;
      clearGrownSeeds(currentTick);
    }
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    updateDrips(dt);
    emitSeedWisps(dt);
    updatePendingMushrooms(dt);
    mushrooms?.update?.(deltaMs, simTick);
  }

  function clear() {
    drips.length = 0;
    pendingMushrooms.length = 0;
    seeds.clear();
    mushrooms?.clear?.();
    simTick = 0;
  }

  return {
    applyUpdates,
    update,
    clear,
  };
}
