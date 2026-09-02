// Per-owner resource banks (wood / stone / mineral / food).
//
// Deterministic sim state — mirrors tech.js: fixed-size per-owner storage,
// included in the checksum and checkpoint so lockstep peers stay in sync.
// No costs are enforced yet; this is the stockpile layer the economy builds on.

/** Cap owners that can hold resource banks (matches tech's headroom). */
export const MAX_RESOURCE_OWNERS = 16;

/** Bank kinds, in a fixed order used for storage indexing + checksum. */
export const RESOURCE_KINDS = /** @type {const} */ (['wood', 'stone', 'mineral', 'food']);
export const RESOURCE_COUNT = RESOURCE_KINDS.length;

/**
 * Resource amounts on a cost (skips pop — every train is 1 pop).
 * @param {Record<string, number> | null | undefined} cost
 * @returns {{ kind: string, amount: number }[]}
 */
export function resourceCostParts(cost) {
  if (!cost) return [];
  const parts = [];
  for (const kind of RESOURCE_KINDS) {
    const n = cost[kind] | 0;
    if (n > 0) parts.push({ kind, amount: n });
  }
  return parts;
}

/**
 * Compact HUD string, e.g. "25 · 15". Empty when free / missing. Pop omitted.
 * @param {Record<string, number> | null | undefined} cost
 */
export function formatResourceCost(cost) {
  return resourceCostParts(cost).map((p) => String(p.amount)).join(' · ');
}

/** @type {Readonly<Record<string, number>>} kind → slot index */
export const RESOURCE_INDEX = Object.freeze(
  RESOURCE_KINDS.reduce((m, k, i) => {
    m[k] = i;
    return m;
  }, /** @type {Record<string, number>} */ ({})),
);

/** Opening stockpile (v1-grounded starting bank; tweak freely). */
export const STARTING_RESOURCES = Object.freeze({ wood: 90, stone: 30, mineral: 5, food: 100 });

/**
 * @param {object} w
 * @returns {Int32Array}
 */
export function ensureResources(w) {
  const need = MAX_RESOURCE_OWNERS * RESOURCE_COUNT;
  if (!w.resources || w.resources.length < need) {
    const next = new Int32Array(need);
    if (w.resources) next.set(w.resources.subarray(0, Math.min(w.resources.length, need)));
    w.resources = next;
  }
  return w.resources;
}

function slot(owner, kindIndex) {
  return (owner | 0) * RESOURCE_COUNT + (kindIndex | 0);
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {string} kind
 * @returns {number}
 */
export function getResource(w, owner, kind) {
  const o = owner | 0;
  const k = RESOURCE_INDEX[kind];
  if (o < 0 || o >= MAX_RESOURCE_OWNERS || k == null) return 0;
  ensureResources(w);
  return w.resources[slot(o, k)] | 0;
}

/**
 * Add (or, with a negative amount, remove) resources. Clamps at 0.
 * @param {object} w
 * @param {number} owner
 * @param {string} kind
 * @param {number} amount
 */
export function addResource(w, owner, kind, amount) {
  const o = owner | 0;
  const k = RESOURCE_INDEX[kind];
  if (o < 0 || o >= MAX_RESOURCE_OWNERS || k == null || !amount) return;
  ensureResources(w);
  const i = slot(o, k);
  const next = (w.resources[i] | 0) + (amount | 0);
  w.resources[i] = next < 0 ? 0 : next;
  w.resourcesDirty = 1;
}

/**
 * Deduct a cost only if affordable. Returns true when the spend happened.
 * @param {object} w
 * @param {number} owner
 * @param {Record<string, number>} cost
 * @returns {boolean}
 */
export function spendResources(w, owner, cost) {
  if (!canAfford(w, owner, cost)) return false;
  for (const kind in cost) addResource(w, owner, kind, -(cost[kind] | 0));
  return true;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {Record<string, number>} cost
 * @returns {boolean}
 */
export function canAfford(w, owner, cost) {
  if (!cost) return true;
  for (const kind in cost) {
    if (RESOURCE_INDEX[kind] == null) continue;
    if (getResource(w, owner, kind) < (cost[kind] | 0)) return false;
  }
  return true;
}

/**
 * Same check against a HUD bank `{ wood, stone, mineral, food }` (skips pop).
 * @param {Record<string, number> | null | undefined} bank
 * @param {Record<string, number> | null | undefined} cost
 */
export function canAffordBank(bank, cost) {
  if (!cost) return true;
  for (const kind of RESOURCE_KINDS) {
    const need = cost[kind] | 0;
    if (need > 0 && (bank?.[kind] | 0) < need) return false;
  }
  return true;
}

/**
 * Resource kinds on a cost the bank cannot cover (skips pop).
 * @param {Record<string, number> | null | undefined} bank
 * @param {Record<string, number> | null | undefined} cost
 * @returns {string[]}
 */
export function lackingCostKinds(bank, cost) {
  const lack = [];
  for (const p of resourceCostParts(cost)) {
    if ((bank?.[p.kind] | 0) < p.amount) lack.push(p.kind);
  }
  return lack;
}

/**
 * Seed an owner's opening stockpile.
 * @param {object} w
 * @param {number} owner
 * @param {Record<string, number>} [amounts]
 */
export function grantStartingResources(w, owner, amounts = STARTING_RESOURCES) {
  const o = owner | 0;
  if (o < 0 || o >= MAX_RESOURCE_OWNERS) return;
  ensureResources(w);
  for (let k = 0; k < RESOURCE_COUNT; k++) {
    w.resources[slot(o, k)] = amounts[RESOURCE_KINDS[k]] | 0;
  }
  w.resourcesDirty = 1;
}

/**
 * Flat per-owner bank snapshot for the main thread (owner*RESOURCE_COUNT + kind).
 * @param {object | null | undefined} w
 * @returns {number[]}
 */
export function serializeResources(w) {
  if (!w?.resources) return [];
  const out = new Array(w.resources.length);
  for (let i = 0; i < w.resources.length; i++) out[i] = w.resources[i] | 0;
  return out;
}

/**
 * @param {object} w
 * @param {number[] | Int32Array | null | undefined} data
 */
export function applySerializedResources(w, data) {
  ensureResources(w);
  w.resources.fill(0);
  if (!data?.length) return;
  const n = Math.min(w.resources.length, data.length);
  for (let i = 0; i < n; i++) w.resources[i] = data[i] | 0;
}

/**
 * Read one owner's bank from a serialized flat array (main-thread HUD helper).
 * @param {number[] | Int32Array | null | undefined} flat
 * @param {number} owner
 * @returns {{ wood: number, stone: number, mineral: number, food: number }}
 */
export function ownerResourcesFrom(flat, owner) {
  const o = owner | 0;
  const base = o * RESOURCE_COUNT;
  const read = (k) => (flat && o >= 0 ? flat[base + k] | 0 : 0);
  return { wood: read(0), stone: read(1), mineral: read(2), food: read(3) };
}

/**
 * @param {number} h
 * @param {(v: number) => void} mix
 * @param {object | null | undefined} w
 */
export function mixResourceChecksum(h, mix, w) {
  if (!w?.resources) {
    mix(0);
    return h;
  }
  mix(w.resources.length);
  for (let i = 0; i < w.resources.length; i++) mix(w.resources[i] | 0);
  return h;
}
