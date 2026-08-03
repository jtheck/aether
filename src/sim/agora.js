// Agora capture points — owned spawn markers with TF2-style occupation.
// Positions are Q16.16 world xz. Deterministic; included in checksum.

import * as fx from './fixed.js';

/** 5 tiles × 4 world units (legacy occupation radius). */
export const AGORA_OCCUPATION_RADIUS = fx.fromFloat(20);
const OCC_R2 = fx.mul(AGORA_OCCUPATION_RADIUS, AGORA_OCCUPATION_RADIUS);

/** ~15s at 20 Hz while continuously capturing. */
export const AGORA_CAPTURE_TICKS = 300;

/**
 * @param {number} owner
 * @param {number} xF world x (float)
 * @param {number} zF world z (float)
 */
export function createAgora(owner, xF, zF) {
  return {
    owner: owner | 0,
    x: fx.fromFloat(xF),
    z: fx.fromFloat(zF),
    progress: 0,
    capturer: -1,
    contested: 0,
    captured: 0,
  };
}

/** @param {{ owner: number, x: number, z: number }[]} list */
export function createAgoras(list) {
  return list.map((a) => createAgora(a.owner, a.x, a.z));
}

/**
 * Serialize for worker→main (render placement). Floats for groundYAt.
 * @param {ReturnType<typeof createAgora>[] | null | undefined} agoras
 */
export function serializeAgoras(agoras) {
  if (!agoras?.length) return [];
  return agoras.map((a) => ({
    owner: a.owner | 0,
    x: fx.toFloat(a.x),
    z: fx.toFloat(a.z),
    progress: a.progress | 0,
    capturer: a.capturer | 0,
    contested: a.contested | 0,
    captured: a.captured | 0,
  }));
}

/**
 * Per-tick occupation. On full capture of an enemy agora: set match-over + winner.
 * @param {object} w
 */
export function agoraCaptureSystem(w) {
  const agoras = w.agoras;
  if (!agoras?.length || w.kothMatchOver) return;

  for (let ai = 0; ai < agoras.length; ai++) {
    const a = agoras[ai];
    if (a.captured) continue;

    const counts = countOwnersNear(w, a.x, a.z);
    const defender = a.owner;
    const defN = defender >= 0 && defender < counts.length ? counts[defender] : 0;

    let bestAtk = -1;
    let bestN = 0;
    let rivalTeams = 0;
    for (let o = 0; o < counts.length; o++) {
      if (o === defender) continue;
      const n = counts[o];
      if (n <= 0) continue;
      rivalTeams++;
      if (n > bestN) {
        bestN = n;
        bestAtk = o;
      }
    }

    if (rivalTeams === 0) {
      a.contested = 0;
      a.capturer = -1;
      if (a.progress > 0) a.progress = Math.max(0, a.progress - 1);
      continue;
    }

    if (rivalTeams > 1) {
      a.contested = 1;
      a.capturer = -1;
      continue;
    }

    // One attacker team — need 2× defenders (or free point) to push.
    if (defN > 0 && bestN < defN * 2) {
      a.contested = 1;
      a.capturer = -1;
      continue;
    }

    a.contested = 0;
    a.capturer = bestAtk;
    a.progress = Math.min(AGORA_CAPTURE_TICKS, a.progress + 1);

    if (a.progress >= AGORA_CAPTURE_TICKS) {
      a.captured = 1;
      a.owner = bestAtk;
      w.matchWinner = bestAtk;
      w.kothMatchOver = 1;
      return;
    }
  }
}

function countOwnersNear(w, ax, az) {
  const counts = new Int32Array(8);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    const o = w.owner[i];
    if (o < 0 || o >= counts.length) continue;
    if (fx.dist2(w.px[i], w.py[i], ax, az) > OCC_R2) continue;
    counts[o]++;
  }
  return counts;
}

export function mixAgoraChecksum(h, mix, agoras) {
  if (!agoras) return h;
  mix(agoras.length);
  for (let i = 0; i < agoras.length; i++) {
    const a = agoras[i];
    mix(a.owner);
    mix(a.x);
    mix(a.z);
    mix(a.progress);
    mix(a.capturer);
    mix(a.contested);
    mix(a.captured);
  }
  return h;
}
