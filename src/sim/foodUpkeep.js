// Light food tax on living population (the HUD pop count).
//
// Each living unit accrues 1 toward a bite every tick; a bite costs 1 food
// every FOOD_UPKEEP_PERIOD ticks. Three opening villagers take ~20s to eat
// one food each — a slow drip, not a second economy. A hundred mouths still
// only ask for a couple of farmers.
//
// Empty banks do not go into debt: the remainder parks just shy of a bite
// so the next gathered food is not swallowed in a lump.

import { addResource, getResource, MAX_RESOURCE_OWNERS } from './resources.js';

/** Ticks (20 Hz) for one living unit to consume 1 food. */
export const FOOD_UPKEEP_PERIOD = 400;

/** @type {Int32Array} */
let popScratch = new Int32Array(0);

/**
 * @param {object} w
 * @returns {Int32Array}
 */
export function ensureFoodUpkeepAcc(w) {
  const need = MAX_RESOURCE_OWNERS;
  if (!w.foodUpkeepAcc || w.foodUpkeepAcc.length < need) {
    const next = new Int32Array(need);
    if (w.foodUpkeepAcc) next.set(w.foodUpkeepAcc.subarray(0, Math.min(w.foodUpkeepAcc.length, need)));
    w.foodUpkeepAcc = next;
  }
  return w.foodUpkeepAcc;
}

function countLivingByOwner(w) {
  if (popScratch.length < MAX_RESOURCE_OWNERS) popScratch = new Int32Array(MAX_RESOURCE_OWNERS);
  else popScratch.fill(0);
  const n = w.count | 0;
  for (let i = 0; i < n; i++) {
    if (!w.alive[i]) continue;
    const o = w.owner[i] | 0;
    if (o < 0 || o >= MAX_RESOURCE_OWNERS) continue;
    popScratch[o]++;
  }
  return popScratch;
}

/**
 * Per-tick drain. Safe no-op when the world has no banks / nobody alive.
 * @param {object} w
 */
export function tickFoodUpkeep(w) {
  if (!w) return;
  const acc = ensureFoodUpkeepAcc(w);
  const pop = countLivingByOwner(w);
  for (let o = 0; o < MAX_RESOURCE_OWNERS; o++) {
    const n = pop[o];
    let next = (acc[o] | 0) + n;
    if (next <= 0) {
      acc[o] = 0;
      continue;
    }
    while (next >= FOOD_UPKEEP_PERIOD) {
      if (getResource(w, o, 'food') <= 0) {
        next = FOOD_UPKEEP_PERIOD - 1;
        break;
      }
      addResource(w, o, 'food', -1);
      next -= FOOD_UPKEEP_PERIOD;
    }
    acc[o] = next;
  }
}

/**
 * @param {object | null | undefined} w
 * @returns {number[]}
 */
export function serializeFoodUpkeep(w) {
  if (!w?.foodUpkeepAcc) return [];
  const out = new Array(w.foodUpkeepAcc.length);
  for (let i = 0; i < w.foodUpkeepAcc.length; i++) out[i] = w.foodUpkeepAcc[i] | 0;
  return out;
}

/**
 * @param {object} w
 * @param {number[] | Int32Array | null | undefined} data
 */
export function applySerializedFoodUpkeep(w, data) {
  ensureFoodUpkeepAcc(w);
  w.foodUpkeepAcc.fill(0);
  if (!data?.length) return;
  const n = Math.min(w.foodUpkeepAcc.length, data.length);
  for (let i = 0; i < n; i++) w.foodUpkeepAcc[i] = data[i] | 0;
}

/**
 * @param {number} h
 * @param {(v: number) => void} mix
 * @param {object | null | undefined} w
 */
export function mixFoodUpkeepChecksum(h, mix, w) {
  if (!w?.foodUpkeepAcc) {
    mix(0);
    return h;
  }
  mix(w.foodUpkeepAcc.length);
  for (let i = 0; i < w.foodUpkeepAcc.length; i++) mix(w.foodUpkeepAcc[i] | 0);
  return h;
}
