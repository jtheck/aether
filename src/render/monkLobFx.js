// Render-only unit lob loft, tumble, dust/fire trails, and land FX.

import { lobHeightAt, LOB_TRAIL } from '../sim/monkKick.js';

/**
 * @param {(init: object) => unknown} emit
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createMonkLobFx(emit, groundYAt) {
  /**
   * @typedef {{
   *   progressFrom: number,
   *   progress: number,
   *   peak: number,
   *   trail: number,
   *   flipTurns: number,
   *   twistTurns: number,
   *   rollTurns: number,
   *   flipDir: number,
   *   twistDir: number,
   *   rollDir: number,
   * }} Flight
   */
  /** @type {Map<number, Flight>} */
  const flights = new Map();
  /** @type {Map<number, { x: number, z: number, loft: number }>} */
  const lastPos = new Map();
  /** Previous sample so we can paint beads along the arc, not on the body. */
  /** @type {Map<number, { x: number, z: number, loft: number }>} */
  const trailPrev = new Map();
  let trailAcc = 0;
  /** Same 0–1 blend as unit XZ display interpolation. */
  let displayAlpha = 1;

  function smoothProgress(f) {
    const a = displayAlpha;
    return f.progressFrom + (f.progress - f.progressFrom) * a;
  }

  // Spaced so you read distinct medium beads, not a white smear on the body.
  const TRAIL_INTERVAL_MS = 28;

  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  /** Fresh comic tumble recipe — different every launch. */
  function rollTumble() {
    // Always at least some end-over-end; twist/roll optional.
    const flipTurns = 1 + Math.floor(Math.random() * 3); // 1..3
    const twistTurns = Math.random() < 0.75 ? Math.random() * 2.2 : 0;
    const rollTurns = Math.random() < 0.7 ? 0.5 + Math.random() * 2.5 : Math.random() * 0.8;
    return {
      flipTurns,
      twistTurns,
      rollTurns,
      flipDir: randSign(),
      twistDir: randSign(),
      rollDir: randSign(),
    };
  }

  function progressOf(patch, entity) {
    if (!patch) return null;
    const n = patch.count ?? 0;
    for (let i = 0; i < n; i++) {
      if ((patch.entity[i] | 0) === entity) return patch.progress[i] ?? 0;
    }
    return null;
  }

  function applyUpdates(updatesList) {
    if (!updatesList?.length) return;
    // Merge flight snapshot from newest patch; accumulate land puffs from all.
    const patch = updatesList[updatesList.length - 1];
    const prevPatch = updatesList.length > 1 ? updatesList[updatesList.length - 2] : null;
    const prev = new Map(flights);
    flights.clear();
    const n = patch?.count ?? 0;
    for (let i = 0; i < n; i++) {
      const entity = patch.entity[i] | 0;
      const prior = prev.get(entity);
      const tumble = prior
        ? {
            flipTurns: prior.flipTurns,
            twistTurns: prior.twistTurns,
            rollTurns: prior.rollTurns,
            flipDir: prior.flipDir,
            twistDir: prior.twistDir,
            rollDir: prior.rollDir,
          }
        : rollTumble();
      const progress = patch.progress[i] ?? 0;
      // Blend from the previous published tick (batched drain) or last frame's target.
      const fromBatched = progressOf(prevPatch, entity);
      const progressFrom =
        fromBatched != null ? fromBatched : prior != null ? prior.progress : progress;
      flights.set(entity, {
        progressFrom,
        progress,
        peak: patch.peak[i] ?? 14,
        trail: patch.trail?.[i] ?? LOB_TRAIL.DUST,
        ...tumble,
      });
    }
    for (const id of [...lastPos.keys()]) {
      if (!flights.has(id)) {
        lastPos.delete(id);
        trailPrev.delete(id);
      }
    }
    for (let u = 0; u < updatesList.length; u++) {
      const p = updatesList[u];
      const lands = p?.landCount ?? 0;
      for (let i = 0; i < lands; i++) {
        const kind = p.landTrail?.[i] ?? LOB_TRAIL.DUST;
        if (kind === LOB_TRAIL.FIRE) emitLandEmbers(p.landX[i], p.landY[i]);
        else emitLandDust(p.landX[i], p.landY[i]);
      }
    }
  }

  function emitLandDust(x, z) {
    const gy = groundYAt(x, z);
    // Juicy dirt thump — alpha blend so brown actually shows.
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 5 + Math.random() * 7;
      const brown = 0.48 + Math.random() * 0.22;
      emit({
        position: [x, gy + 0.15 + Math.random() * 0.35, z],
        velocity: [
          Math.cos(ang) * speed,
          3.5 + Math.random() * 6,
          Math.sin(ang) * speed,
        ],
        gravity: [0, -18, 0],
        color: [brown + 0.08, brown * 0.78, brown * 0.48, 0.8],
        lifetime: 0.5 + Math.random() * 0.4,
        startSize: 1.2 + Math.random() * 1.4,
        endSize: 0.12,
        drag: 1.4,
        blend: 'alpha',
      });
    }
    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5;
      emit({
        position: [x, gy + 0.1, z],
        velocity: [
          Math.cos(ang) * speed,
          2 + Math.random() * 4,
          Math.sin(ang) * speed,
        ],
        gravity: [0, -12, 0],
        color: [0.55, 0.42, 0.28, 0.55],
        lifetime: 0.55 + Math.random() * 0.45,
        startSize: 1.6 + Math.random() * 1.8,
        peakSize: 2.4 + Math.random() * 1.6,
        endSize: 0.2,
        hangTime: 0.06,
        drag: 1.8,
        blend: 'alpha',
      });
    }
    // Soft dirt bloom (not a white flash).
    emit({
      position: [x, gy + 0.25, z],
      velocity: [0, 1.2, 0],
      gravity: [0, 0, 0],
      color: [0.55, 0.44, 0.3, 0.45],
      lifetime: 0.22,
      startSize: 2.8,
      endSize: 7.5,
      drag: 0.05,
      blend: 'alpha',
    });
  }

  function emitLandEmbers(x, z) {
    const gy = groundYAt(x, z);
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      emit({
        position: [x, gy + 0.2 + Math.random() * 0.4, z],
        velocity: [
          Math.cos(ang) * speed,
          2 + Math.random() * 5,
          Math.sin(ang) * speed,
        ],
        gravity: [0, -10, 0],
        color: [1, 0.45 + Math.random() * 0.35, 0.08, 0.75],
        lifetime: 0.35 + Math.random() * 0.3,
        startSize: 0.35 + Math.random() * 0.4,
        endSize: 0.05,
        drag: 1.2,
      });
    }
  }

  function setDisplayAlpha(alpha) {
    displayAlpha = Math.min(1, Math.max(0, alpha));
  }

  function loftFor(entity) {
    const f = flights.get(entity | 0);
    if (!f) return 0;
    return lobHeightAt(smoothProgress(f), f.peak);
  }

  function pitchFor(entity) {
    const f = flights.get(entity | 0);
    if (!f) return 0;
    return f.flipDir * smoothProgress(f) * Math.PI * 2 * f.flipTurns;
  }

  /** Extra yaw spin (twist) on top of travel facing. */
  function yawTwistFor(entity) {
    const f = flights.get(entity | 0);
    if (!f) return 0;
    return f.twistDir * smoothProgress(f) * Math.PI * 2 * f.twistTurns;
  }

  function rollFor(entity) {
    const f = flights.get(entity | 0);
    if (!f) return 0;
    return f.rollDir * smoothProgress(f) * Math.PI * 2 * f.rollTurns;
  }

  function isFlying(entity) {
    return flights.has(entity | 0);
  }

  function notePose(entity, x, z) {
    if (!flights.has(entity | 0)) return;
    lastPos.set(entity | 0, { x, z, loft: loftFor(entity) });
  }

  function emitDustBead(px, py, pz) {
    const life = 0.75 + Math.random() * 0.35;
    emit({
      position: [px, py, pz],
      velocity: [
        (Math.random() - 0.5) * 0.15,
        -0.05,
        (Math.random() - 0.5) * 0.15,
      ],
      gravity: [0, -0.35, 0],
      color: [0.72, 0.74, 0.78, 0.42],
      lifetime: life,
      startSize: 0.12,
      peakSize: 0.9 + Math.random() * 0.35,
      endSize: 0.08,
      hangTime: life * 0.28,
      drag: 5,
      blend: 'alpha',
    });
  }

  function emitFireBead(px, py, pz) {
    const life = 0.45 + Math.random() * 0.3;
    emit({
      sprite: 'puff',
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.4,
      position: [px, py, pz],
      velocity: [
        (Math.random() - 0.5) * 0.35,
        0.4 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.35,
      ],
      gravity: [0, -1.2, 0],
      color: [1, 0.4 + Math.random() * 0.4, 0.06, 0.7],
      lifetime: life,
      startSize: 0.18,
      peakSize: 0.7 + Math.random() * 0.35,
      endSize: 0.06,
      hangTime: life * 0.2,
      drag: 2.5,
    });
    if (Math.random() > 0.45) {
      emit({
        sprite: 'puff',
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 1.4,
        position: [px, py + 0.15, pz],
        velocity: [0, 0.8 + Math.random() * 0.6, 0],
        gravity: [0, -0.4, 0],
        color: [1, 0.85, 0.35, 0.45],
        lifetime: 0.25 + Math.random() * 0.15,
        startSize: 0.22,
        endSize: 0.04,
        drag: 1.5,
      });
    }
  }

  /**
   * Breadcrumb trail of medium soft puffs. Spawn only behind the unit
   * (never on the nose) and swell start→peak→end so they fade in then out.
   */
  function emitTrailBeads() {
    for (const [entity, f] of flights) {
      const cur = lastPos.get(entity);
      if (!cur) continue;
      if (!trailPrev.has(entity)) {
        trailPrev.set(entity, cur);
        continue;
      }
      const prev = trailPrev.get(entity);
      const gy0 = groundYAt(prev.x, prev.z);
      const gy1 = groundYAt(cur.x, cur.z);
      const y0 = gy0 + (prev.loft ?? 0) + 0.7;
      const y1 = gy1 + (cur.loft ?? 0) + 0.7;
      const dx = cur.x - prev.x;
      const dy = y1 - y0;
      const dz = cur.z - prev.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2 && Math.abs(dy) < 0.2) {
        trailPrev.set(entity, cur);
        continue;
      }

      const spacing = f.trail === LOB_TRAIL.FIRE ? 1.1 : 1.4;
      const count = Math.max(1, Math.min(3, Math.round(dist / spacing)));
      for (let i = 0; i < count; i++) {
        // t=0 is behind (prev), t=1 is the unit. Stay well off the nose.
        const t = ((i + 0.2 + Math.random() * 0.35) / (count + 0.6)) * 0.55;
        const px = prev.x + dx * t + (Math.random() - 0.5) * 0.2;
        const py = y0 + dy * t + (Math.random() - 0.5) * 0.15;
        const pz = prev.z + dz * t + (Math.random() - 0.5) * 0.2;
        if (f.trail === LOB_TRAIL.FIRE) emitFireBead(px, py, pz);
        else emitDustBead(px, py, pz);
      }
      trailPrev.set(entity, cur);
    }
  }

  function update(deltaMs) {
    trailAcc += deltaMs;
    if (trailAcc >= TRAIL_INTERVAL_MS) {
      trailAcc = 0;
      if (flights.size > 0) emitTrailBeads();
    }
  }

  function clear() {
    flights.clear();
    lastPos.clear();
    trailPrev.clear();
    trailAcc = 0;
    displayAlpha = 1;
  }

  return {
    applyUpdates,
    setDisplayAlpha,
    loftFor,
    pitchFor,
    yawTwistFor,
    rollFor,
    isFlying,
    spinFor: pitchFor,
    notePose,
    update,
    clear,
    get activeCount() {
      return flights.size;
    },
  };
}
