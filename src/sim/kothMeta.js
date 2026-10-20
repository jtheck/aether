// King of the Hill meta — crown, elimination, deed bounties.
// Lives on world.koth when mode is 'koth'. Deterministic; included in checksum.
//
// A seat is wiped on 0 pop, or after it has owned a completed agora and then
// owns none. The hill opens once three seats are in it. A death pays the
// purse, warriors, hill points, and the ladder only when three seats are in
// the fight, counting the one who died. After the hill has opened, fewer
// than three seats left ends it. Agora count does not change the purse.
// The king's death adds one hill point on a paying death.
// Losing an agora while the seat survives costs one hill point, floored at 0.

import * as fx from './fixed.js';
import { livingByOwner, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { addResource } from './resources.js';

export const MAX_KOTH_PLAYERS = 5;
/** Ticks (20 Hz) after a drop with no completed agora before that seat is revealed. */
export const KOTH_REVEAL_TICKS = 1200;
export const KOTH_TRAIN_GATE = 8;
export const KOTH_KILL_GATE = 10;
export const KOTH_RAZE_GATE = 1;
/** Opening drop headcount. Bounty bodies never push a seat past this. */
export const KOTH_DROP_HEADCOUNT = 42;
/** A death pays hill points only while this many seats are still in the fight. */
export const KOTH_SCORE_MIN = 3;
export const KOTH_BOUNTY_WARRIORS = 4;
const BOUNTY_LOG = 8;

const PURSE_1 = Object.freeze({ wood: 40, stone: 30, food: 80 });
const PURSE_2 = Object.freeze({ wood: 80, stone: 60, food: 160, mineral: 10 });

function emptyLifeArrays() {
  return {
    killsAtJoin: new Int32Array(MAX_KOTH_PLAYERS),
    razesAtJoin: new Int32Array(MAX_KOTH_PLAYERS),
    trainedAtJoin: new Int32Array(MAX_KOTH_PLAYERS),
    agoraSeen: new Uint8Array(MAX_KOTH_PLAYERS),
    exposed: new Uint8Array(MAX_KOTH_PLAYERS),
    bountyTick: new Int32Array(BOUNTY_LOG),
    bountyVictim: new Int8Array(BOUNTY_LOG),
    bountyPoints: new Int8Array(BOUNTY_LOG),
    bountyCount: 0,
    opened: 0,
  };
}

/** Fill arrays added after older checkpoints. */
export function ensureKothShape(koth) {
  if (!koth) return koth;
  if (!koth.established) koth.established = new Uint8Array(MAX_KOTH_PLAYERS);
  const fresh = emptyLifeArrays();
  for (const key of Object.keys(fresh)) {
    if (koth[key] == null) koth[key] = fresh[key];
  }
  if (koth.opened == null) koth.opened = 0;
  return koth;
}

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

  const koth = {
    active,
    eliminated,
    joinedAtTick,
    scores,
    kingOwner: 0,
    established,
    ...emptyLifeArrays(),
  };
  let seated = 0;
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) if (active[i]) seated++;
  koth.opened = seated >= KOTH_SCORE_MIN ? 1 : 0;
  koth.kingOwner = pickKing(koth);
  return koth;
}

/** Living seat with the highest hill score. Earliest join breaks a tie. */
export function pickKing(koth) {
  let best = -1;
  let bestScore = -1;
  let bestJoin = 0x7fffffff;
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    if (!koth.active[i] || koth.eliminated[i]) continue;
    const score = koth.scores[i] | 0;
    const join = koth.joinedAtTick[i] | 0;
    if (score > bestScore || (score === bestScore && join < bestJoin)) {
      bestScore = score;
      bestJoin = join;
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

/** Living seat wearing the crown, or -1 when nobody is in the fight. */
export function shownKing(koth) {
  if (!koth || koth.kingOwner == null) return -1;
  const id = koth.kingOwner | 0;
  if (id < 0 || id >= MAX_KOTH_PLAYERS) return -1;
  if (koth.active && (!koth.active[id] || koth.eliminated?.[id])) return -1;
  return id;
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

/** Events this match has already scored, oldest first. */
export function kothBountyList(koth) {
  if (!koth?.bountyTick) return [];
  const n = koth.bountyCount | 0;
  const out = [];
  for (let i = 0; i < n && i < BOUNTY_LOG; i++) {
    out.push({
      tick: koth.bountyTick[i] | 0,
      victim: koth.bountyVictim[i] | 0,
      points: koth.bountyPoints[i] | 0,
    });
  }
  return out;
}

function pushBounty(koth, tick, victim, points) {
  if (points <= 0) return;
  let i = koth.bountyCount | 0;
  if (i >= BOUNTY_LOG) {
    koth.bountyTick.copyWithin(0, 1);
    koth.bountyVictim.copyWithin(0, 1);
    koth.bountyPoints.copyWithin(0, 1);
    i = BOUNTY_LOG - 1;
  }
  koth.bountyTick[i] = tick | 0;
  koth.bountyVictim[i] = victim | 0;
  koth.bountyPoints[i] = points | 0;
  koth.bountyCount = i + 1;
}

/** Register a player joining mid-match at a specific tick. Score starts over. */
export function kothRegisterJoin(koth, playerId, tick, w) {
  if (!koth || playerId < 0 || playerId >= MAX_KOTH_PLAYERS) return;
  ensureKothShape(koth);
  koth.active[playerId] = 1;
  koth.eliminated[playerId] = 0;
  koth.established[playerId] = 0;
  koth.exposed[playerId] = 0;
  koth.agoraSeen[playerId] = 0;
  koth.scores[playerId] = 0;
  koth.joinedAtTick[playerId] = tick | 0;
  koth.killsAtJoin[playerId] = w?.ownerKills?.[playerId] | 0;
  koth.razesAtJoin[playerId] = w?.ownerRazes?.[playerId] | 0;
  koth.trainedAtJoin[playerId] = w?.ownerTrained?.[playerId] | 0;
  koth.kingOwner = pickKing(koth);
}

function ownerAgoraCount(agoras, owner) {
  if (!agoras) return 0;
  let n = 0;
  for (let i = 0; i < agoras.length; i++) {
    if ((agoras[i].owner | 0) === owner) n++;
  }
  return n;
}

function lifeCount(current, baseline, owner) {
  if (!current) return 0;
  return Math.max(0, (current[owner] | 0) - (baseline[owner] | 0));
}

function deedGates(w, owner) {
  const k = w.koth;
  const trained = lifeCount(w.ownerTrained, k.trainedAtJoin, owner);
  const kills = lifeCount(w.ownerKills, k.killsAtJoin, owner);
  const razes = lifeCount(w.ownerRazes, k.razesAtJoin, owner);
  let gates = 0;
  if (trained >= KOTH_TRAIN_GATE) gates++;
  if (kills >= KOTH_KILL_GATE) gates++;
  if (razes >= KOTH_RAZE_GATE) gates++;
  return gates;
}

function grantPurse(w, owner, purse) {
  for (const kind in purse) addResource(w, owner, kind, purse[kind]);
}

function grantWarriors(w, owner) {
  let room = KOTH_DROP_HEADCOUNT - livingByOwner(w, owner);
  if (room <= 0) return;
  const n = Math.min(KOTH_BOUNTY_WARRIORS, room);
  let x = 0;
  let y = 0;
  let found = false;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner) continue;
    x = w.px[i];
    y = w.py[i];
    found = true;
    break;
  }
  if (!found) return;
  for (let i = 0; i < n; i++) {
    spawn(w, {
      x: x + fx.fromFloat((i + 1) * 3),
      y,
      type: UNIT.WARRIOR,
      owner,
    });
  }
}

/** 0 pop, or every completed agora gone after this seat had owned one. */
function kothSeatWiped(w, owner) {
  if (livingByOwner(w, owner) <= 0) return true;
  const n = ownerAgoraCount(w.agoras, owner);
  if (n > 0) {
    w.koth.established[owner] = 1;
    return false;
  }
  return !!w.koth.established[owner];
}

function noteAgoraAndReveal(w, owner) {
  const k = w.koth;
  const n = ownerAgoraCount(w.agoras, owner);
  if (n > 0) k.established[owner] = 1;
  const seen = k.agoraSeen[owner] | 0;
  if (k.established[owner] && seen > n && n > 0) {
    k.scores[owner] = Math.max(0, (k.scores[owner] | 0) - 1);
  }
  k.agoraSeen[owner] = n;
  if (k.established[owner]) k.exposed[owner] = 0;
  else if ((w.tick | 0) >= (k.joinedAtTick[owner] | 0) + KOTH_REVEAL_TICKS) k.exposed[owner] = 1;
}

function payDeath(w, owner, kingAtStart) {
  const k = w.koth;
  const inFight = countSurvivors(k);
  const gates = k.established[owner] ? deedGates(w, owner) : 0;
  let gatePoints = 0;
  if (gates >= 2) gatePoints = 2;
  else if (gates === 1) gatePoints = 1;
  let points = gatePoints;
  if (gatePoints > 0 && owner === kingAtStart) points += 1;

  k.eliminated[owner] = 1;
  if (gatePoints <= 0 || inFight < KOTH_SCORE_MIN) return;

  const purse = gatePoints >= 2 ? PURSE_2 : PURSE_1;
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    if (!k.active[i] || k.eliminated[i]) continue;
    k.scores[i] = (k.scores[i] | 0) + points;
    grantPurse(w, i, purse);
    if (gatePoints >= 2) grantWarriors(w, i);
  }
  pushBounty(k, w.tick | 0, owner, points);
}

/** After combat / capture each tick — wipe seats, pay deeds, move the crown. */
export function kothMetaStep(w) {
  const k = w.koth;
  if (!k) return;
  ensureKothShape(k);
  if (countSurvivors(k) >= KOTH_SCORE_MIN) k.opened = 1;

  for (let owner = 0; owner < MAX_KOTH_PLAYERS; owner++) {
    if (!k.active[owner] || k.eliminated[owner]) continue;
    noteAgoraAndReveal(w, owner);
  }
  k.kingOwner = pickKing(k);
  const kingAtStart = k.kingOwner;

  for (let owner = 0; owner < MAX_KOTH_PLAYERS; owner++) {
    if (!k.active[owner] || k.eliminated[owner]) continue;
    if (!kothSeatWiped(w, owner)) continue;

    payDeath(w, owner, kingAtStart);

    const left = countSurvivors(k);
    if (left === 0 || (k.opened && left < KOTH_SCORE_MIN)) w.kothMatchOver = 1;
  }
  k.kingOwner = pickKing(k);
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
  mix(koth.opened | 0);
  const n = koth.bountyCount | 0;
  mix(n);
  for (let i = 0; i < MAX_KOTH_PLAYERS; i++) {
    mix(koth.active[i]);
    mix(koth.eliminated[i]);
    mix(koth.joinedAtTick[i]);
    mix(koth.scores[i]);
    mix(koth.established?.[i] ?? 0);
    mix(koth.killsAtJoin?.[i] ?? 0);
    mix(koth.razesAtJoin?.[i] ?? 0);
    mix(koth.trainedAtJoin?.[i] ?? 0);
    mix(koth.agoraSeen?.[i] ?? 0);
    mix(koth.exposed?.[i] ?? 0);
  }
  for (let i = 0; i < n && i < BOUNTY_LOG; i++) {
    mix(koth.bountyTick[i]);
    mix(koth.bountyVictim[i]);
    mix(koth.bountyPoints[i]);
  }
  return h;
}
