// King of the Hill meta — king crown, elimination scoring, longevity tracking.
// Lives on world.koth when mode is 'koth'. Deterministic; included in checksum.
//
// A seat is wiped on 0 pop, or after it has owned a completed agora and then
// owns none (multiple pads are fine; the last one cannot fall).

import { livingByOwner } from './world.js';

export const MAX_KOTH_PLAYERS = 5;

/**
 * @param {number[]} activePlayerIds — slot ids (owners) in this match
 */
export function createKothMeta(activePlayerIds) {
  const active = new Uint8Array(MAX_KOTH_PLAYERS);
  const eliminated = new Uint8Array(MAX_KOTH_PLAYERS);
  const joinedAtTick = new Int32Array(MAX_KOTH_PLAYERS);
  const scores = new Int32Array(MAX_KOTH_PLAYERS);
  const established = new Uint8Array(MAX_KOTH_PLAYERS);

  for (const id of activePlayerIds) {
    if (id < 0 || id >= MAX_KOTH_PLAYERS) continue;
    active[id] = 1;
    joinedAtTick[id] = 0;
  }

  let kingOwner = activePlayerIds.length ? pickLongestLiving(active, eliminated, joinedAtTick) : 0;

  return { active, eliminated, joinedAtTick, scores, kingOwner, established };
}

function pickLongestLiving(active, eliminated, joinedAtTick) {
  let best = -1;
  let bestJoin = 0x7fffffff;
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    if (!active[i] || eliminated[i]) continue;
    if (joinedAtTick[i] < bestJoin) {
      bestJoin = joinedAtTick[i];
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

/** Active seats that have already been combat-wiped. */
export function kothWipedOwners(koth) {
  const active = koth?.active;
  const eliminated = koth?.eliminated;
  if (!active || !eliminated) return [];
  const out = [];
  const n = Math.min(MAX_KOTH_PLAYERS, active.length, eliminated.length);
  for (let i = 0; i < n; i++) {
    if (active[i] && eliminated[i]) out.push(i);
  }
  return out;
}

/** Register a player joining mid-match at a specific tick. */
export function kothRegisterJoin(koth, playerId, tick) {
  if (!koth || playerId < 0 || playerId >= MAX_KOTH_PLAYERS) return;
  koth.active[playerId] = 1;
  koth.eliminated[playerId] = 0;
  if (koth.established) koth.established[playerId] = 0;
  koth.joinedAtTick[playerId] = tick;
  if (koth.kingOwner < 0 || koth.eliminated[koth.kingOwner]) {
    koth.kingOwner = pickLongestLiving(koth.active, koth.eliminated, koth.joinedAtTick);
  }
}

function ownerAgoraCount(agoras, owner) {
  if (!agoras) return 0;
  let n = 0;
  for (let i = 0; i < agoras.length; i++) {
    if ((agoras[i].owner | 0) === owner) n++;
  }
  return n;
}

/** 0 pop, or every completed agora gone after this seat had owned one. */
function kothSeatWiped(w, owner) {
  if (livingByOwner(w, owner) <= 0) return true;
  const n = ownerAgoraCount(w.agoras, owner);
  if (n > 0) {
    if (w.koth.established) w.koth.established[owner] = 1;
    return false;
  }
  return !!(w.koth.established && w.koth.established[owner]);
}

/** After combat / capture each tick — wipe 0-pop or last-agora seats, score, transfer king. */
export function kothMetaStep(w) {
  const k = w.koth;
  if (!k) return;

  for (let owner = 0; owner < MAX_KOTH_PLAYERS; owner++) {
    if (!k.active[owner] || k.eliminated[owner]) continue;
    if (!kothSeatWiped(w, owner)) continue;

    k.eliminated[owner] = 1;
    const survivors = countSurvivors(k);
    for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
      if (k.active[i] && !k.eliminated[i]) k.scores[i] += 1;
    }

    if (owner === k.kingOwner) {
      k.kingOwner = pickLongestLiving(k.active, k.eliminated, k.joinedAtTick);
    }

    // KOTH persists with a single survivor: the king stays on the field and
    // spectators keep watching until someone elects to join (which resets the
    // match) or the king leaves. Only a true wipe — no living active owners at
    // all — ends the round here; the shard winds down separately when the active
    // roster empties.
    if (survivors === 0) {
      w.kothMatchOver = 1;
    }
  }
}

function countSurvivors(k) {
  let n = 0;
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    if (k.active[i] && !k.eliminated[i]) n++;
  }
  return n;
}

export function mixKothChecksum(h, mix, koth) {
  if (!koth) return h;
  mix(koth.kingOwner);
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    mix(koth.active[i]);
    mix(koth.eliminated[i]);
    mix(koth.joinedAtTick[i]);
    mix(koth.scores[i]);
    mix(koth.established?.[i] ?? 0);
  }
  return h;
}
