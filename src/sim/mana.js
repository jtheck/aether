// Caster mana bank — 3 spells, regenerated over each ability's old cooldown.
// A living allied myco nearby applies a slight Spirit boost to regen.

import * as fx from './fixed.js';
import { TILE_SIZE_F } from './field.js';
import { queryCellBounds, spatialCellId } from './spatialGrid.js';
import { isAlly } from './teams.js';
import { getUnitDef, UNIT } from './unitTypes.js';

/** One ready spell. */
export const MANA_CHARGE = 100;
/** Spells a caster can keep banked. */
export const MANA_BANK = 3;
export const MANA_MAX = MANA_CHARGE * MANA_BANK;
/** Brief lock after a spend so one command frame cannot dump the bank. */
export const CAST_GCD = 8;
/** Keep in sync with abilities.js FIREBALL_COOLDOWN. */
export const WARLOCK_FIREBALL_PERIOD = 95;
/** ~6 tiles — same huddle as Holy Armor. */
export const MYCO_SPIRIT_RADIUS = fx.fromFloat(TILE_SIZE_F * 6);
const BASE_ACC = 5;
const SPIRIT_ACC = 6;

/** Ticks to regen one charge — match each ability's old cooldown. */
const PERIOD = {
  [UNIT.WARLOCK]: WARLOCK_FIREBALL_PERIOD,
  [UNIT.PRIEST]: 115,
  [UNIT.MYCO]: 120,
  [UNIT.SHAMAN]: 100,
  [UNIT.WIZARD]: 110,
};

/** @type {Uint8Array} */
let spiritMark = new Uint8Array(0);

export function isManaCaster(typeId) {
  return !!getUnitDef(typeId).primaryAbility;
}

export function manaPeriodForType(typeId) {
  return PERIOD[typeId | 0] | 0;
}

export function manaReadyCount(mana) {
  return Math.max(0, Math.min(MANA_BANK, ((mana | 0) / MANA_CHARGE) | 0));
}

export function canCastAbility(w, i) {
  if (i < 0 || i >= w.count || !w.alive[i]) return false;
  if (w.abilityCd[i] > 0) return false;
  if (!isManaCaster(w.type[i])) return false;
  return (w.mana?.[i] | 0) >= MANA_CHARGE;
}

export function spendMana(w, i) {
  if (!w.mana || (w.mana[i] | 0) < MANA_CHARGE) return false;
  w.mana[i] = (w.mana[i] | 0) - MANA_CHARGE;
  return true;
}

function ensureSpiritMark(n) {
  if (spiritMark.length < n) spiritMark = new Uint8Array(n);
}

function markSpiritNearMycos(w) {
  const n = w.count | 0;
  ensureSpiritMark(n);
  spiritMark.fill(0, 0, n);
  const grid = w.spatial;
  if (!grid) return;
  const radius = MYCO_SPIRIT_RADIUS;
  const radius2 = fx.mul(radius, radius);
  for (let i = 0; i < n; i++) {
    if (!w.alive[i] || w.type[i] !== UNIT.MYCO) continue;
    const owner = w.owner[i];
    const bounds = queryCellBounds(w.px[i], w.py[i], radius, grid);
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        let j = grid.head[spatialCellId(x, z, grid)];
        while (j >= 0) {
          const next = grid.next[j];
          if (
            j < n &&
            w.alive[j] &&
            isManaCaster(w.type[j]) &&
            isAlly(owner, w.owner[j]) &&
            fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]) <= radius2
          ) {
            spiritMark[j] = 1;
          }
          j = next;
        }
      }
    }
  }
}

/** Regen one charge over the ability's old cooldown; Spirit is +20%. */
export function tickMana(w) {
  if (!w?.mana) return;
  markSpiritNearMycos(w);
  const n = w.count | 0;
  for (let i = 0; i < n; i++) {
    if (!w.alive[i] || !isManaCaster(w.type[i])) continue;
    if ((w.mana[i] | 0) >= MANA_MAX) {
      w.manaAcc[i] = 0;
      continue;
    }
    const period = manaPeriodForType(w.type[i]);
    if (period <= 0) continue;
    w.manaAcc[i] = (w.manaAcc[i] | 0) + (spiritMark[i] ? SPIRIT_ACC : BASE_ACC);
    const need = period * BASE_ACC;
    while ((w.manaAcc[i] | 0) >= need && (w.mana[i] | 0) < MANA_MAX) {
      w.mana[i] = Math.min(MANA_MAX, (w.mana[i] | 0) + MANA_CHARGE);
      w.manaAcc[i] = (w.manaAcc[i] | 0) - need;
    }
  }
}
