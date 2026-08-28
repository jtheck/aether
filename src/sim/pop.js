// Village housing — villagers, engineers, and monks share one pop pool.
// Soft cap: completed villages (+ a little from the agora) set the comfort
// number. Training is never blocked; the free villager trickle just slows.

import { UNIT } from './unitTypes.js';

/** Housing granted by each completed village. */
export const POP_PER_VILLAGE = 15;
/** Housing granted by an owned agora (opening room before the first village). */
export const POP_PER_AGORA = 5;

/**
 * @param {number} typeId
 * @returns {number}
 */
export function unitPopCost(typeId) {
  const t = typeId | 0;
  return t === UNIT.VILLAGER || t === UNIT.ENGINEER || t === UNIT.MONK ? 1 : 0;
}

/**
 * Living + queued village-line pop for an owner.
 * @param {object} w
 * @param {number} owner
 * @param {{ owner: number, tracks?: { kind?: string, unitType?: number, count?: number }[] }[] | null | undefined} [buildings]
 */
export function ownerPopUsed(w, owner, buildings = w.buildings) {
  const o = owner | 0;
  let n = 0;
  if (w) {
    for (let i = 0; i < w.count; i++) {
      if (w.alive[i] && w.owner[i] === o) n += unitPopCost(w.type[i]);
    }
  }
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if ((bd.owner | 0) !== o) continue;
      const tracks = bd.tracks;
      if (!tracks?.length) continue;
      for (let t = 0; t < tracks.length; t++) {
        const tr = tracks[t];
        if (tr.kind !== 'unit') continue;
        n += unitPopCost(tr.unitType) * (tr.count | 0);
      }
    }
  }
  return n;
}

/**
 * @param {{ owner: number, type: string, built?: number }[] | null | undefined} buildings
 * @param {{ owner: number }[] | null | undefined} agoras
 * @param {number} owner
 */
export function ownerPopCap(buildings, agoras, owner) {
  const o = owner | 0;
  let n = 0;
  if (agoras) {
    for (let a = 0; a < agoras.length; a++) {
      if ((agoras[a].owner | 0) === o) n += POP_PER_AGORA;
    }
  }
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if ((bd.owner | 0) !== o || bd.type !== 'village') continue;
      if (bd.hp != null && (bd.hp | 0) <= 0) continue;
      if ((bd.built != null ? bd.built | 0 : 1) === 1) n += POP_PER_VILLAGE;
    }
  }
  return n;
}

/** True when living + queued village-line pop is at or past the soft cap. */
export function ownerAtPopSoftCap(w, owner) {
  return ownerPopUsed(w, owner) >= ownerPopCap(w.buildings, w.agoras, owner);
}
