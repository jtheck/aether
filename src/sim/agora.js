// Agora capture — contest from the right while the pad is owned, then unlock
// a neutral tug anyone can fight (about a third of the clock). Positions are
// Q16.16 world xz. Deterministic; included in checksum.

import * as fx from './fixed.js';

/** 5 tiles × 4 world units (legacy occupation radius). */
export const AGORA_OCCUPATION_RADIUS = fx.fromFloat(20);
const OCC_R2 = fx.mul(AGORA_OCCUPATION_RADIUS, AGORA_OCCUPATION_RADIUS);

/** ~9s at 20 Hz while contesting an owned pad (lock phase). */
export const AGORA_CAPTURE_TICKS = 180;
/** Neutral fight is about a third of the clock (~4.5s). */
export const AGORA_TUG_TICKS = 90;

/** Locked home — contest walks in from the right. */
export const AGORA_PHASE_LOCK = 0;
/** Unlocked / technically neutral — anyone can gain from the left. */
export const AGORA_PHASE_TUG = 1;

export const AGORA_RITE_NONE = 0;
/** Halfway beat — melt the lock row, then seed-build the tug row. */
export const AGORA_RITE_UNLOCK = 1;
/** Last pip + all-dot wishes before occupy / retake / victory. */
export const AGORA_RITE_FINALE = 2;

/** ~1.7s at 20 Hz — covers the unlock line trick. */
export const AGORA_UNLOCK_HOLD_TICKS = 34;
/** ~1.3s at 20 Hz — last pip, then compiled wishes. */
export const AGORA_FINALE_HOLD_TICKS = 26;

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
    direction: 0,
    hold: 0,
    rite: AGORA_RITE_NONE,
  };
}

/** @param {{ owner: number, x: number, z: number }[]} list */
export function createAgoras(list) {
  return list.map((a) => createAgora(a.owner, a.x, a.z));
}

/** Capture chips only while someone is on the pad or the meter is still live. */
export function agoraOverlayActive(a) {
  if (!a || (a.captured | 0)) return false;
  return (a.hold | 0) > 0
    || (a.rite | 0) !== AGORA_RITE_NONE
    || (a.contested | 0) !== 0
    || (a.capturer | 0) >= 0
    || (a.progress | 0) > 0
    || (a.tug | 0) > 0;
}

/**
 * How far a capture has gone: 0 quiet, 0–1 lock bar, 1–2 tug bar.
 * Match AI uses this as the “how loud is the pad” signal.
 */
export function agoraCaptureScore(a) {
  if (!a || (a.captured | 0)) return 0;
  if ((a.phase | 0) === AGORA_PHASE_TUG) {
    return 1 + ((a.tug | 0) / AGORA_TUG_TICKS);
  }
  return (a.progress | 0) / AGORA_CAPTURE_TICKS;
}

/** Home pad — current owner or original founder. */
export function agoraForOwner(agoras, owner) {
  if (!agoras) return null;
  const o = owner | 0;
  for (let i = 0; i < agoras.length; i++) {
    const a = agoras[i];
    if ((a.owner | 0) === o || (a.founder | 0) === o) return a;
  }
  return null;
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
    direction: a.direction | 0,
    hold: a.hold | 0,
    rite: a.rite | 0,
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
    if (tickAgoraHold(w, a)) {
      if (w.kothMatchOver) return;
      continue;
    }

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
    a.contested = 0;
    a.direction = 0;
    a.rite = AGORA_RITE_UNLOCK;
    a.hold = AGORA_UNLOCK_HOLD_TICKS;
  }
}

function tickAgoraHold(w, a) {
  if ((a.hold | 0) <= 0) return false;
  a.hold -= 1;
  if (a.hold > 0) return true;
  const rite = a.rite | 0;
  a.rite = AGORA_RITE_NONE;
  if (rite === AGORA_RITE_FINALE) resolveAgoraFinale(w, a);
  return true;
}

function beginAgoraFinale(a) {
  a.rite = AGORA_RITE_FINALE;
  a.hold = AGORA_FINALE_HOLD_TICKS;
  a.contested = 0;
  a.direction = 1;
}

function resolveAgoraFinale(w, a) {
  if (a.capturer < 0) return;
  if (a.capturer === (a.founder | 0)) retakeAgora(a);
  else occupyAgora(w, a, a.capturer);
}

function stepTug(w, a, counts) {
  const lead = leadingTeam(counts);

  if (lead.teams === 0) {
    a.contested = 0;
    if (a.tug > 0) {
      a.direction = -1;
      a.tug = Math.max(0, a.tug - 1);
    } else {
      a.direction = 0;
    }
    if (a.tug <= 0) a.capturer = -1;
    return;
  }

  if (lead.teams > 1 && lead.bestN < lead.secondN * 2) {
    a.contested = 1;
    a.direction = 0;
    return;
  }

  a.contested = 0;
  const pusher = lead.best;
  if (a.capturer === pusher || a.capturer < 0 || a.tug <= 0) {
    a.capturer = pusher;
    a.direction = 1;
    a.tug = Math.min(AGORA_TUG_TICKS, a.tug + 1);
  } else {
    a.direction = -1;
    a.tug = Math.max(0, a.tug - 1);
    if (a.tug <= 0) a.capturer = -1;
  }

  if (a.tug < AGORA_TUG_TICKS || a.capturer < 0) return;
  beginAgoraFinale(a);
}

function retakeAgora(a) {
  a.owner = a.founder | 0;
  a.phase = AGORA_PHASE_LOCK;
  a.progress = 0;
  a.tug = 0;
  a.capturer = -1;
  a.contested = 0;
  a.captured = 0;
  a.direction = 0;
  a.hold = 0;
  a.rite = AGORA_RITE_NONE;
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
  a.direction = 0;
  a.hold = 0;
  a.rite = AGORA_RITE_NONE;
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
    mix(a.direction ?? 0);
    mix(a.hold ?? 0);
    mix(a.rite ?? 0);
  }
  return h;
}
