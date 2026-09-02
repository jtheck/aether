// Agora capture points — invade from the right, then a left-side tug of war.
// Positions are Q16.16 world xz. Deterministic; included in checksum.

import * as fx from './fixed.js';

/** 5 tiles × 4 world units (legacy occupation radius). */
export const AGORA_OCCUPATION_RADIUS = fx.fromFloat(20);
const OCC_R2 = fx.mul(AGORA_OCCUPATION_RADIUS, AGORA_OCCUPATION_RADIUS);

/** ~15s at 20 Hz while continuously capturing. */
export const AGORA_CAPTURE_TICKS = 300;

/** Locked home — enemy color invades from the right. */
export const AGORA_PHASE_LOCK = 0;
/** Unlocked — tug of war from the left until retake or occupy. */
export const AGORA_PHASE_TUG = 1;

/**
 * @param {number} owner
 * @param {number} xF world x (float)
 * @param {number} zF world z (float)
 */
export function createAgora(owner, xF, zF) {
  const o = owner | 0;
  return {
    owner: o,
    founder: o,
    x: fx.fromFloat(xF),
    z: fx.fromFloat(zF),
    progress: 0,
    tug: 0,
    capturer: -1,
    contested: 0,
    captured: 0,
    phase: AGORA_PHASE_LOCK,
  };
}

/** @param {{ owner: number, x: number, z: number }[]} list */
export function createAgoras(list) {
  return list.map((a) => createAgora(a.owner, a.x, a.z));
}

export function agoraOverlayActive(a) {
  if (!a) return false;
  return (a.phase | 0) === AGORA_PHASE_TUG
    || (a.progress | 0) > 0
    || (a.tug | 0) > 0;
}

/**
 * Serialize for worker→main (render placement). Floats for groundYAt.
 * @param {ReturnType<typeof createAgora>[] | null | undefined} agoras
 */
export function serializeAgoras(agoras) {
  if (!agoras?.length) return [];
  return agoras.map((a) => ({
    owner: a.owner | 0,
    founder: a.founder | 0,
    x: fx.toFloat(a.x),
    z: fx.toFloat(a.z),
    progress: a.progress | 0,
    tug: a.tug | 0,
    capturer: a.capturer | 0,
    contested: a.contested | 0,
    captured: a.captured | 0,
    phase: a.phase | 0,
  }));
}

/**
 * Per-tick occupation. Full invade unlocks a tug; filling the tug retakes or occupies.
 * Occupy ends the match when `w.agoraOccupyEndsMatch` is set (skirmish / 1v1).
 * @param {object} w
 */
export function agoraCaptureSystem(w) {
  const agoras = w.agoras;
  if (!agoras?.length || w.kothMatchOver) return;

  for (let ai = 0; ai < agoras.length; ai++) {
    const a = agoras[ai];
    if (a.captured) continue;

    const counts = countOwnersNear(w, a.x, a.z);
    if ((a.phase | 0) === AGORA_PHASE_TUG) stepTug(w, a, counts);
    else stepInvade(a, counts);
    if (w.kothMatchOver) return;
  }
}

function stepInvade(a, counts) {
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
    if (a.progress > 0) a.progress = Math.max(0, a.progress - 1);
    if (a.progress <= 0) a.capturer = -1;
    return;
  }

  if (rivalTeams > 1 || (defN > 0 && bestN < defN * 2)) {
    a.contested = 1;
    return;
  }

  a.contested = 0;
  a.capturer = bestAtk;
  a.progress = Math.min(AGORA_CAPTURE_TICKS, a.progress + 1);

  if (a.progress >= AGORA_CAPTURE_TICKS) {
    a.phase = AGORA_PHASE_TUG;
    a.progress = 0;
    a.tug = 0;
    a.capturer = -1;
    a.contested = 0;
  }
}

function stepTug(w, a, counts) {
  const lead = leadingTeam(counts);

  if (lead.teams === 0) {
    a.contested = 0;
    if (a.tug > 0) a.tug = Math.max(0, a.tug - 1);
    if (a.tug <= 0) a.capturer = -1;
    return;
  }

  if (lead.teams > 1 && lead.bestN < lead.secondN * 2) {
    a.contested = 1;
    return;
  }

  a.contested = 0;
  const pusher = lead.best;
  if (a.capturer === pusher || a.capturer < 0 || a.tug <= 0) {
    a.capturer = pusher;
    a.tug = Math.min(AGORA_CAPTURE_TICKS, a.tug + 1);
  } else {
    a.tug = Math.max(0, a.tug - 1);
    if (a.tug <= 0) a.capturer = -1;
  }

  if (a.tug < AGORA_CAPTURE_TICKS || a.capturer < 0) return;

  if (a.capturer === (a.founder | 0)) {
    retakeAgora(a);
    return;
  }
  occupyAgora(w, a, a.capturer);
}

function retakeAgora(a) {
  a.owner = a.founder | 0;
  a.phase = AGORA_PHASE_LOCK;
  a.progress = 0;
  a.tug = 0;
  a.capturer = -1;
  a.contested = 0;
  a.captured = 0;
}

function occupyAgora(w, a, winner) {
  const next = winner | 0;
  a.owner = next;
  a.founder = next;
  a.phase = AGORA_PHASE_LOCK;
  a.progress = 0;
  a.tug = 0;
  a.capturer = -1;
  a.contested = 0;
  if ((w.agoraOccupyEndsMatch ?? 1) !== 0) {
    a.captured = 1;
    w.matchWinner = next;
    w.kothMatchOver = 1;
    return;
  }
  a.captured = 0;
}

function leadingTeam(counts) {
  let best = -1;
  let bestN = 0;
  let secondN = 0;
  let teams = 0;
  for (let o = 0; o < counts.length; o++) {
    const n = counts[o];
    if (n <= 0) continue;
    teams++;
    if (n > bestN) {
      secondN = bestN;
      bestN = n;
      best = o;
    } else if (n > secondN) {
      secondN = n;
    }
  }
  return { best, bestN, secondN, teams };
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
    mix(a.founder ?? a.owner);
    mix(a.x);
    mix(a.z);
    mix(a.progress);
    mix(a.tug ?? 0);
    mix(a.capturer);
    mix(a.contested);
    mix(a.captured);
    mix(a.phase ?? 0);
  }
  return h;
}
