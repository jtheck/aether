// Combo recipes on a cast selection. First match wins: mixed-type recipes
// (agora found) beat same-type caster compounds.

import { getUnitDef, UNIT } from './unitTypes.js';
import { getResource } from './resources.js';
import { BASE_PYRAMID_BANK } from './storage.js';
import { applyCasts } from './abilities.js';

export const COMBO = {
  AGORA_FOUND: 'agora_found',
  COMPOUND: 'compound',
};

/** Half of the 12-icon mineral stack — six icons, same as a base pyramid. */
export const AGORA_FOUND_MINERAL = BASE_PYRAMID_BANK.mineral;

export function isCasterType(typeId) {
  return !!getUnitDef(typeId).primaryAbility;
}

export function isComboVillager(typeId) {
  return typeId === UNIT.VILLAGER || typeId === UNIT.BRIGAND;
}

/**
 * @param {object} w
 * @param {number[] | null | undefined} ids
 * @param {number} [owner] when >= 0, only that owner's units count
 */
export function tallyComboSelection(w, ids, owner = -1) {
  let villagers = 0;
  let engineers = 0;
  let casters = 0;
  /** @type {number[]} */
  const builders = [];
  if (!ids?.length || !w) return { villagers, engineers, casters, builders };
  const own = owner | 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k] | 0;
    if (i < 0 || i >= w.count || !w.alive[i]) continue;
    if (own >= 0 && (w.owner[i] | 0) !== own) continue;
    if (w.carriedBy && w.carriedBy[i] >= 0) continue;
    const type = w.type[i] | 0;
    if (isCasterType(type)) {
      casters++;
      continue;
    }
    if (isComboVillager(type)) {
      villagers++;
      builders.push(i);
      continue;
    }
    if (type === UNIT.ENGINEER) {
      engineers++;
      builders.push(i);
    }
  }
  return { villagers, engineers, casters, builders };
}

export function selectionHasAgoraFound(w, ids, owner = -1) {
  const t = tallyComboSelection(w, ids, owner);
  return t.villagers >= 4 && t.engineers >= 1 && t.casters === 0;
}

export function classifyCastSelection(w, ids, owner = -1) {
  if (selectionHasAgoraFound(w, ids, owner)) return COMBO.AGORA_FOUND;
  return COMBO.COMPOUND;
}

/**
 * @param {object} w
 * @param {number} owner
 */
export function ownerBank(w, owner) {
  return {
    wood: getResource(w, owner, 'wood'),
    stone: getResource(w, owner, 'stone'),
    mineral: getResource(w, owner, 'mineral'),
    food: getResource(w, owner, 'food'),
  };
}

/**
 * @param {{ wood?: number, stone?: number, mineral?: number, food?: number } | null | undefined} bank
 */
export function agoraFoundCost(bank) {
  return {
    mineral: AGORA_FOUND_MINERAL,
    wood: bank?.wood | 0,
    stone: bank?.stone | 0,
  };
}

/**
 * @param {{ wood?: number, stone?: number, mineral?: number, food?: number } | null | undefined} bank
 */
export function canAffordAgoraFound(bank) {
  return (bank?.mineral | 0) >= AGORA_FOUND_MINERAL;
}

export function cloneRefundCost(cost) {
  if (!cost) return null;
  return {
    wood: cost.wood | 0,
    stone: cost.stone | 0,
    mineral: cost.mineral | 0,
    food: cost.food | 0,
  };
}

/** Stray agora-found casts are client placement; type-similar still compounds. */
export function applyCastCombo(w, field, ids, abilityId, tx, ty) {
  if (classifyCastSelection(w, ids) === COMBO.AGORA_FOUND) return;
  applyCasts(w, field, ids, abilityId, tx, ty);
}
