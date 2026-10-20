// Per-owner match tallies. Any mode. KOTH reads the life delta off kills,
// razes, and trained. The score screen reads the whole set.

import { MAX_RESOURCE_OWNERS, RESOURCE_COUNT, RESOURCE_INDEX } from './resources.js';

function copyInto(next, prev) {
  if (!prev) return;
  next.set(prev.subarray(0, Math.min(prev.length, next.length)));
}

function ensure(w) {
  if (
    w.ownerKills?.length >= MAX_RESOURCE_OWNERS
    && w.ownerLosses?.length >= MAX_RESOURCE_OWNERS
    && w.ownerGathered?.length >= MAX_RESOURCE_OWNERS * RESOURCE_COUNT
    && w.ownerSpent?.length >= MAX_RESOURCE_OWNERS * RESOURCE_COUNT
  ) return;
  const kills = new Int32Array(MAX_RESOURCE_OWNERS);
  const razes = new Int32Array(MAX_RESOURCE_OWNERS);
  const trained = new Int32Array(MAX_RESOURCE_OWNERS);
  const losses = new Int32Array(MAX_RESOURCE_OWNERS);
  const buildingsLost = new Int32Array(MAX_RESOURCE_OWNERS);
  const gathered = new Int32Array(MAX_RESOURCE_OWNERS * RESOURCE_COUNT);
  const spent = new Int32Array(MAX_RESOURCE_OWNERS * RESOURCE_COUNT);
  copyInto(kills, w.ownerKills);
  copyInto(razes, w.ownerRazes);
  copyInto(trained, w.ownerTrained);
  copyInto(losses, w.ownerLosses);
  copyInto(buildingsLost, w.ownerBuildingsLost);
  copyInto(gathered, w.ownerGathered);
  copyInto(spent, w.ownerSpent);
  w.ownerKills = kills;
  w.ownerRazes = razes;
  w.ownerTrained = trained;
  w.ownerLosses = losses;
  w.ownerBuildingsLost = buildingsLost;
  w.ownerGathered = gathered;
  w.ownerSpent = spent;
}

function bump(arr, owner) {
  const o = owner | 0;
  if (o < 0 || o >= arr.length) return;
  arr[o] = (arr[o] | 0) + 1;
}

function addKind(arr, owner, kind, amount) {
  const o = owner | 0;
  const k = RESOURCE_INDEX[kind];
  const n = amount | 0;
  if (o < 0 || o >= MAX_RESOURCE_OWNERS || k == null || !n) return;
  const i = o * RESOURCE_COUNT + k;
  const next = (arr[i] | 0) + n;
  arr[i] = next < 0 ? 0 : next;
}

/** A hostile unit this owner struck down. */
export function noteOwnerKill(w, owner) {
  if (!w) return;
  ensure(w);
  bump(w.ownerKills, owner);
}

/** A unit this owner lost, whoever struck it. */
export function noteOwnerLoss(w, owner) {
  if (!w) return;
  ensure(w);
  bump(w.ownerLosses, owner);
}

/** A finished hostile building this owner ruined. */
export function noteOwnerRaze(w, owner) {
  if (!w) return;
  ensure(w);
  bump(w.ownerRazes, owner);
}

/** A finished building this owner lost. */
export function noteBuildingLost(w, owner) {
  if (!w) return;
  ensure(w);
  bump(w.ownerBuildingsLost, owner);
}

/** A unit this owner trained after the opening drop. */
export function noteOwnerTrained(w, owner) {
  if (!w) return;
  ensure(w);
  bump(w.ownerTrained, owner);
}

/** Map income that actually entered the bank. */
export function noteGathered(w, owner, kind, amount) {
  if (!w || (amount | 0) <= 0) return;
  ensure(w);
  addKind(w.ownerGathered, owner, kind, amount);
}

/** A real spend. Negative amounts are refunds and do not pass 0. */
export function noteSpent(w, owner, kind, amount) {
  if (!w || !(amount | 0)) return;
  ensure(w);
  addKind(w.ownerSpent, owner, kind, amount);
}

/** Cancelled build or train. Pulls the cost back out of spent. */
export function noteResourceRefund(w, owner, cost) {
  if (!w || !cost) return;
  for (const kind in cost) noteSpent(w, owner, kind, -(cost[kind] | 0));
}

function kindTotal(arr, owner) {
  if (!arr) return 0;
  let n = 0;
  const base = (owner | 0) * RESOURCE_COUNT;
  for (let k = 0; k < RESOURCE_COUNT; k++) n += arr[base + k] | 0;
  return n;
}

function kindSplit(arr, owner) {
  const base = (owner | 0) * RESOURCE_COUNT;
  return {
    wood: arr?.[base] | 0,
    stone: arr?.[base + 1] | 0,
    mineral: arr?.[base + 2] | 0,
    food: arr?.[base + 3] | 0,
  };
}

/** Wire snapshot. One row per owner slot. */
export function serializeOwnerStats(w) {
  if (!w?.ownerKills) return null;
  const out = [];
  for (let i = 0; i < MAX_RESOURCE_OWNERS; i++) {
    out.push({
      kills: w.ownerKills[i] | 0,
      losses: w.ownerLosses?.[i] | 0,
      trained: w.ownerTrained?.[i] | 0,
      razes: w.ownerRazes?.[i] | 0,
      buildingsLost: w.ownerBuildingsLost?.[i] | 0,
      gathered: kindTotal(w.ownerGathered, i),
      spent: kindTotal(w.ownerSpent, i),
      gatheredBy: kindSplit(w.ownerGathered, i),
      spentBy: kindSplit(w.ownerSpent, i),
    });
  }
  return out;
}

export function mixOwnerStats(h, mix, w) {
  if (!w?.ownerKills) return h;
  for (let i = 0; i < w.ownerKills.length; i++) {
    mix(w.ownerKills[i]);
    mix(w.ownerRazes?.[i] ?? 0);
    mix(w.ownerTrained?.[i] ?? 0);
    mix(w.ownerLosses?.[i] ?? 0);
    mix(w.ownerBuildingsLost?.[i] ?? 0);
  }
  const gathered = w.ownerGathered;
  const spent = w.ownerSpent;
  const n = gathered?.length ?? 0;
  for (let i = 0; i < n; i++) {
    mix(gathered[i]);
    mix(spent?.[i] ?? 0);
  }
  return h;
}
