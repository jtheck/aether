// Resource bank slots + silo attach.
//
// Each kind has 12 icons (1–9, a–c). The first 6 are always unlocked. A silo
// paired with a source building (camp / mine / farm) unlocks 7–9; a second
// pair unlocks a–c. Stone and mineral share mines. Caps are soft: income past
// the unlocked cap is cut to 25% (see overflowCredit) instead of being hard
// rejected, so refunds and spends stay on the uncapped addResource path.

import * as fx from './fixed.js';
import { addResource, getResource, RESOURCE_KINDS } from './resources.js';

export const RESOURCE_SLOT_LABELS = Object.freeze([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c',
]);

export const BASE_SLOTS = 6;
export const SLOTS_PER_SILO = 3;
export const MAX_SILO_PAIRS = 2;
export const MAX_RESOURCE_SLOTS = RESOURCE_SLOT_LABELS.length;

/** World units per filled icon. Mineral is scarce; the others match a ~6-icon start. */
export const SLOT_AMOUNT = Object.freeze({
  wood: 20,
  stone: 15,
  mineral: 5,
  food: 20,
});

/** Building a silo must sit next to, per bank kind. */
export const SILO_SOURCE_TYPE = Object.freeze({
  wood: 'camp',
  stone: 'mine',
  mineral: 'mine',
  food: 'farm',
});

/**
 * Center-to-center reach. Adjacent farm (3) + silo (2) is 10; this allows a
 * tile or two of slack so a silo can sit on the path beside the worksite.
 */
export const SILO_ATTACH_RANGE_F = 20;
const SILO_ATTACH_RANGE = fx.fromFloat(SILO_ATTACH_RANGE_F);
const SILO_ATTACH_RANGE_SQ = fx.mul(SILO_ATTACH_RANGE, SILO_ATTACH_RANGE);
const SILO_ATTACH_RANGE_SQ_F = SILO_ATTACH_RANGE_F * SILO_ATTACH_RANGE_F;

/** Overflow income = 1/4, with leftover spread across ticks so bites of 2 still trickle. */
export const OVERFLOW_NUM = 1;
export const OVERFLOW_DEN = 4;

export const SLOT_VIS = Object.freeze({ OFF: 0, ON: 1, OVERFLOW: 2 });

/**
 * @param {object | null | undefined} b
 * @returns {boolean}
 */
export function isLiveStorageBuilding(b) {
  if (!b) return false;
  if (b.built != null && (b.built | 0) === 0) return false;
  if (b.hp != null && (b.hp | 0) <= 0) return false;
  return true;
}

/**
 * @param {object} a
 * @param {object} b
 * @param {'fixed' | 'world'} space
 */
function distSq(a, b, space) {
  if (space === 'world') {
    const dx = +a.x - +b.x;
    const dz = +a.z - +b.z;
    return dx * dx + dz * dz;
  }
  return fx.dist2(a.x, a.z, b.x, b.z);
}

function rangeSq(space) {
  return space === 'world' ? SILO_ATTACH_RANGE_SQ_F : SILO_ATTACH_RANGE_SQ;
}

/** @param {object} a @param {object} b @param {'fixed' | 'world'} [space] */
export function withinSiloAttach(a, b, space = 'fixed') {
  return distSq(a, b, space) <= rangeSq(space);
}

/**
 * How many unique silo↔source pairs this owner has. Each silo and each source
 * may pair at most once, nearest-first in building-array order.
 * @param {object[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} sourceType
 * @param {'fixed' | 'world'} [space]
 */
export function countSiloPairs(buildings, owner, sourceType, space = 'fixed') {
  if (!buildings?.length || !sourceType) return 0;
  const o = owner | 0;
  /** @type {object[]} */
  const silos = [];
  /** @type {object[]} */
  const sources = [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== o || !isLiveStorageBuilding(b)) continue;
    if (b.type === 'silo') silos.push(b);
    else if (b.type === sourceType) sources.push(b);
  }
  if (!silos.length || !sources.length) return 0;

  const used = new Uint8Array(sources.length);
  const limit = rangeSq(space);
  let pairs = 0;
  for (let s = 0; s < silos.length && pairs < MAX_SILO_PAIRS; s++) {
    let best = -1;
    let bestD = 0;
    for (let t = 0; t < sources.length; t++) {
      if (used[t]) continue;
      const d = distSq(silos[s], sources[t], space);
      if (d > limit) continue;
      if (best < 0 || d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best < 0) continue;
    used[best] = 1;
    pairs++;
  }
  return pairs;
}

/**
 * First live source of `sourceType` that is not already paired with a silo.
 * @param {object[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} sourceType
 * @param {'fixed' | 'world'} [space]
 * @returns {object | null}
 */
export function unpairedSiloSource(buildings, owner, sourceType, space = 'fixed') {
  if (!buildings?.length || !sourceType) return null;
  const o = owner | 0;
  /** @type {object[]} */
  const silos = [];
  /** @type {object[]} */
  const sources = [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== o || !isLiveStorageBuilding(b)) continue;
    if (b.type === 'silo') silos.push(b);
    else if (b.type === sourceType) sources.push(b);
  }
  if (!sources.length) return null;

  const used = new Uint8Array(sources.length);
  const limit = rangeSq(space);
  for (let s = 0; s < silos.length; s++) {
    let best = -1;
    let bestD = 0;
    for (let t = 0; t < sources.length; t++) {
      if (used[t]) continue;
      const d = distSq(silos[s], sources[t], space);
      if (d > limit) continue;
      if (best < 0 || d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best >= 0) used[best] = 1;
  }
  for (let t = 0; t < sources.length; t++) {
    if (!used[t]) return sources[t];
  }
  return null;
}

/**
 * @param {object[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} kind
 * @param {'fixed' | 'world'} [space]
 */
export function ownerSlotCount(buildings, owner, kind, space = 'fixed') {
  const source = SILO_SOURCE_TYPE[kind];
  const pairs = countSiloPairs(buildings, owner, source, space);
  return BASE_SLOTS + Math.min(MAX_SILO_PAIRS, pairs) * SLOTS_PER_SILO;
}

/**
 * @param {object[] | null | undefined} buildings
 * @param {number} owner
 * @param {string} kind
 * @param {'fixed' | 'world'} [space]
 */
export function ownerResourceCap(buildings, owner, kind, space = 'fixed') {
  return ownerSlotCount(buildings, owner, kind, space) * (SLOT_AMOUNT[kind] | 0);
}

/**
 * @param {number} amount
 * @param {number} unlocked
 * @param {string} kind
 */
export function filledSlotCount(amount, unlocked, kind) {
  const n = amount | 0;
  if (n <= 0 || (unlocked | 0) <= 0) return 0;
  const slot = SLOT_AMOUNT[kind] | 0;
  if (slot <= 0) return 0;
  const filled = Math.ceil(n / slot);
  return filled < unlocked ? filled : unlocked | 0;
}

/**
 * First locked slot to flash on a wasted return (`7` or `a`), or null
 * when every icon is already unlocked.
 * @param {number} unlocked
 */
export function overflowHintLabel(unlocked) {
  const u = unlocked | 0;
  if (u < 0 || u >= MAX_RESOURCE_SLOTS) return null;
  return RESOURCE_SLOT_LABELS[u] ?? null;
}

/**
 * @param {number} slotIndex 0..11
 * @param {number} filled
 * @param {number} [_unlocked]
 * @param {boolean} [_atCap]
 */
export function slotVisual(slotIndex, filled, _unlocked, _atCap) {
  return (slotIndex | 0) < (filled | 0) ? SLOT_VIS.ON : SLOT_VIS.OFF;
}

/**
 * HUD-only: wasted haul returns this tick. Drain with takeStorageOverflow.
 * @param {object} w
 * @param {number} owner
 * @param {string} kind
 * @param {string | null} hint
 */
export function noteStorageOverflow(w, owner, kind, hint) {
  if (!w.storageOverflow) w.storageOverflow = [];
  w.storageOverflow.push({ owner: owner | 0, kind, hint: hint || null });
}

/**
 * @param {object | null | undefined} w
 * @returns {{ owner: number, kind: string, hint: string | null }[] | null}
 */
export function takeStorageOverflow(w) {
  const ev = w?.storageOverflow;
  if (!ev?.length) return null;
  w.storageOverflow = [];
  return ev;
}

/**
 * Deterministic 25% of `amount`. Remainder is paid on some ticks so a farm
 * bite of 2 still credits over time (floor(2/4) would otherwise be zero).
 * @param {number} amount
 * @param {number} tick
 */
export function overflowCredit(amount, tick) {
  const a = amount | 0;
  if (a <= 0) return 0;
  const q = (a * OVERFLOW_NUM / OVERFLOW_DEN) | 0;
  const r = a % OVERFLOW_DEN;
  const extra = r && ((tick | 0) % OVERFLOW_DEN) < r ? 1 : 0;
  return q + extra;
}

/**
 * Gather / farm income. Refunds and spends must keep using addResource.
 * @param {object} w
 * @param {number} owner
 * @param {string} kind
 * @param {number} amount
 * @param {boolean} [asReturn] haul drop-off (not an in-place farm bite)
 * @returns {number} amount actually banked
 */
export function addGatherIncome(w, owner, kind, amount, asReturn = false) {
  const add = amount | 0;
  if (add <= 0) return 0;
  const cap = ownerResourceCap(w.buildings, owner, kind, 'fixed');
  const current = getResource(w, owner, kind);
  let credited = 0;
  if (current < cap) {
    const room = cap - current;
    if (add <= room) {
      addResource(w, owner, kind, add);
      return add;
    }
    addResource(w, owner, kind, room);
    const spill = overflowCredit(add - room, w.tick);
    if (spill) addResource(w, owner, kind, spill);
    credited = room + spill;
  } else {
    credited = overflowCredit(add, w.tick);
    if (credited) addResource(w, owner, kind, credited);
  }
  if (asReturn && credited < add) {
    const slots = ownerSlotCount(w.buildings, owner, kind, 'fixed');
    noteStorageOverflow(w, owner, kind, overflowHintLabel(slots));
  }
  return credited;
}

/**
 * HUD snapshot for one owner. `space` is `world` for serialized buildings.
 * @param {object[] | null | undefined} buildings
 * @param {number} owner
 * @param {{ wood?: number, stone?: number, mineral?: number, food?: number }} bank
 * @param {'fixed' | 'world'} [space]
 */
export function ownerStorageView(buildings, owner, bank, space = 'world') {
  /** @type {Record<string, { amount: number, slots: number, cap: number, filled: number, atCap: boolean, hint: string | null }>} */
  const out = {};
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const kind = RESOURCE_KINDS[i];
    const amount = bank?.[kind] | 0;
    const slots = ownerSlotCount(buildings, owner, kind, space);
    const cap = slots * (SLOT_AMOUNT[kind] | 0);
    const atCap = amount >= cap;
    out[kind] = {
      amount,
      slots,
      cap,
      filled: filledSlotCount(amount, slots, kind),
      atCap,
      hint: atCap ? overflowHintLabel(slots) : null,
    };
  }
  return out;
}
