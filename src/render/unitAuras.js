// Render-only unit aura FX: expanding cast pulses + per-unit buff sparkles.
// Sim publishes gameplay shields / DoT / frost; this layer only paints.

/** Bit flags for ongoing unit auras (extend as buffs/debuffs land). */
export const AURA = {
  HOLY: 1 << 0,
  SHADOW: 1 << 1,
  FROST: 1 << 2,
};

/**
 * @param {(init: object) => unknown} emit
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{ maxSparkleDistSq?: number, getEye?: () => { x: number, y: number, z: number } }} [opts]
 */
export function createUnitAuras(emit, groundYAt, opts = {}) {
  /** @type {Array<{ x: number, z: number, maxR: number, age: number, life: number, emitAcc: number }>} */
  const pulses = [];
  /** Latest per-entity aura mask from sim (sparse-friendly: 0 = none). */
  let auraMask = null;
  let auraCount = 0;
  /** @type {Float32Array | null} */
  let posX = null;
  /** @type {Float32Array | null} */
  let posY = null;
  /** @type {Float32Array | null} */
  let posZ = null;
  let sparkleAcc = 0;
  const maxSparkleDistSq = opts.maxSparkleDistSq ?? Infinity;
  const getEye = opts.getEye ?? null;

  const SPARKLE_INTERVAL_MS = 70;

  function spawnPulse(worldX, worldZ, maxRadius) {
    pulses.push({
      x: worldX,
      z: worldZ,
      maxR: Math.max(2, maxRadius),
      age: 0,
      life: 0.72,
      emitAcc: 0,
    });
    // Soft birth flash at the caster feet.
    const gy = groundYAt(worldX, worldZ);
    emit({
      position: [worldX, gy + 0.35, worldZ],
      velocity: [0, 1.2, 0],
      gravity: [0, 0, 0],
      color: [1, 0.98, 0.92, 0.55],
      lifetime: 0.28,
      startSize: 3.2,
      endSize: 10,
      drag: 0.05,
    });
    emit({
      position: [worldX, gy + 0.55, worldZ],
      velocity: [0, 2.5, 0],
      gravity: [0, 0, 0],
      color: [1, 1, 1, 0.7],
      lifetime: 0.18,
      startSize: 1.4,
      endSize: 4.5,
      drag: 0.08,
    });
  }

  function applyHolyArmorUpdates(updatesList) {
    if (!updatesList?.length) return;
    for (let u = 0; u < updatesList.length; u++) {
      const patch = updatesList[u];
      const n = patch?.count ?? 0;
      for (let i = 0; i < n; i++) {
        spawnPulse(patch.x[i], patch.y[i], patch.radius[i]);
      }
    }
  }

  /**
   * Feed latest unit poses + aura masks (bitfield per entity).
   * Call once per rendered frame after positions are known.
   */
  function sync(count, mask, x, y, z) {
    auraCount = count | 0;
    auraMask = mask;
    posX = x;
    posY = y;
    posZ = z;
  }

  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }

  function updatePulses(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.age += dt;
      if (p.age >= p.life) {
        pulses.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      const radius = easeOutCubic(t) * p.maxR;
      // Emit denser near the start so the front reads as a bright leading edge.
      p.emitAcc += dt;
      const emitGap = 0.018 + t * 0.012;
      if (p.emitAcc < emitGap) continue;
      p.emitAcc = 0;

      const gy = groundYAt(p.x, p.z) + 0.22;
      const beadCount = 18 + Math.floor((1 - t) * 14);
      const fade = 1 - t;
      for (let b = 0; b < beadCount; b++) {
        const ang = (b / beadCount) * Math.PI * 2 + t * 0.7;
        const jitter = (Math.random() - 0.5) * 0.35;
        const r = radius + jitter;
        const px = p.x + Math.cos(ang) * r;
        const pz = p.z + Math.sin(ang) * r;
        emit({
          position: [px, gy + Math.random() * 0.15, pz],
          velocity: [
            Math.cos(ang) * (1.8 + Math.random() * 1.4),
            0.4 + Math.random() * 1.1,
            Math.sin(ang) * (1.8 + Math.random() * 1.4),
          ],
          gravity: [0, 0.6, 0],
          color: [1, 0.97, 0.9, 0.72 * fade],
          lifetime: 0.22 + Math.random() * 0.18,
          startSize: 0.55 + Math.random() * 0.45,
          endSize: 0.08,
          drag: 1.4,
        });
        if (Math.random() > 0.45) {
          emit({
            position: [px, gy + 0.05, pz],
            velocity: [
              Math.cos(ang) * (0.4 + Math.random() * 0.6),
              0.15 + Math.random() * 0.4,
              Math.sin(ang) * (0.4 + Math.random() * 0.6),
            ],
            gravity: [0, 0.2, 0],
            color: [0.95, 0.93, 0.88, 0.35 * fade],
            lifetime: 0.45 + Math.random() * 0.35,
            startSize: [0.9 + Math.random() * 0.7, 0.35 + Math.random() * 0.25],
            endSize: [0.15, 0.05],
            drag: 2.2,
          });
        }
      }
    }
  }

  function emitSparkles() {
    if (!auraMask || !posX || !posY || !posZ) return;
    const n = auraCount;
    const eye = Number.isFinite(maxSparkleDistSq) ? getEye?.() ?? null : null;
    const gate = !!eye;
    for (let i = 0; i < n; i++) {
      const mask = auraMask[i] | 0;
      if (!mask) continue;
      const x = posX[i];
      const y = posY[i];
      const z = posZ[i];
      if (!(y > -1e8)) continue;
      if (gate) {
        const dx = eye.x - x;
        const dy = eye.y - y;
        const dz = eye.z - z;
        if (dx * dx + dy * dy + dz * dz > maxSparkleDistSq) continue;
      }

      if (mask & AURA.HOLY) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.35 + Math.random() * 1.1;
        emit({
          position: [
            x + Math.cos(ang) * rad,
            y + 0.4 + Math.random() * 1.6,
            z + Math.sin(ang) * rad,
          ],
          velocity: [
            (Math.random() - 0.5) * 0.6,
            0.8 + Math.random() * 1.4,
            (Math.random() - 0.5) * 0.6,
          ],
          gravity: [0, 0.4, 0],
          color:
            Math.random() > 0.35
              ? [1, 1, 0.96, 0.55]
              : [0.92, 0.95, 1, 0.45],
          lifetime: 0.7 + Math.random() * 0.55,
          startSize: 0.22 + Math.random() * 0.28,
          endSize: 0.04,
          drag: 0.85,
        });
      }

      if (mask & AURA.SHADOW) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.25 + Math.random() * 0.95;
        emit({
          blend: 'alpha',
          shape: 'star',
          fadeOut: true,
          position: [
            x + Math.cos(ang) * rad,
            y + 0.5 + Math.random() * 1.4,
            z + Math.sin(ang) * rad,
          ],
          velocity: [
            (Math.random() - 0.5) * 0.4,
            0.5 + Math.random() * 1.1,
            (Math.random() - 0.5) * 0.4,
          ],
          gravity: [0, 0.2, 0],
          color:
            Math.random() > 0.4
              ? [0.45, 0.12, 0.7, 0.75]
              : [0.08, 0.02, 0.12, 0.85],
          lifetime: 0.55 + Math.random() * 0.4,
          startSize: 0.28 + Math.random() * 0.22,
          endSize: 0.05,
          drag: 0.7,
        });
      }

      if (mask & AURA.FROST) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.3 + Math.random() * 1.0;
        emit({
          position: [
            x + Math.cos(ang) * rad,
            y + 0.35 + Math.random() * 1.5,
            z + Math.sin(ang) * rad,
          ],
          velocity: [
            (Math.random() - 0.5) * 0.35,
            0.35 + Math.random() * 0.9,
            (Math.random() - 0.5) * 0.35,
          ],
          gravity: [0, -0.15, 0],
          color:
            Math.random() > 0.4
              ? [0.7, 0.92, 1, 0.6]
              : [0.45, 0.78, 1, 0.5],
          lifetime: 0.65 + Math.random() * 0.45,
          startSize: 0.18 + Math.random() * 0.22,
          endSize: 0.04,
          drag: 0.9,
        });
      }
    }
  }

  function update(deltaMs) {
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    updatePulses(dt);
    sparkleAcc += deltaMs;
    if (sparkleAcc >= SPARKLE_INTERVAL_MS) {
      sparkleAcc = 0;
      emitSparkles();
    }
  }

  function clear() {
    pulses.length = 0;
    auraMask = null;
    auraCount = 0;
    posX = posY = posZ = null;
    sparkleAcc = 0;
  }

  return {
    AURA,
    spawnPulse,
    applyHolyArmorUpdates,
    sync,
    update,
    clear,
  };
}
