// Priest heal — same attack cooldown as smite. Holy Armor stays on abilityCd.
// Render-only pulses ride priestHealFx; they are not part of the checksum.

import * as fx from './fixed.js';
import { getUnitDef, isMechanical, UNIT } from './unitTypes.js';
import { unitMaxHp } from './namedUnit.js';
import { isAlly } from './teams.js';
import { queryCellBounds, spatialCellId } from './spatialGrid.js';

/**
 * Flat pulse. Half of 50 HP, the band priest / wizard / villager sit on.
 */
export const PRIEST_HEAL_AMOUNT = 25;

/**
 * Huddle, not smite range. Smite still reaches ~45; a heal only reaches
 * the group standing with the priest (~6 tiles).
 */
export const PRIEST_HEAL_RANGE = fx.fromFloat(24);

/** Cap on pulses published in one sim tick. */
export const PRIEST_HEAL_FX_MAX = 24;

/**
 * In a fight, at least three quarters of the pulse must land.
 * A 13 HP scratch used to cancel the smite and waste almost half the heal.
 * Idle priests may still top a smaller wound off.
 * @param {number} missing
 * @param {number} [amount]
 */
export function priestHealLandsMost(missing, amount = PRIEST_HEAL_AMOUNT) {
  const gap = missing | 0;
  const heal = amount | 0;
  if (gap <= 0 || heal <= 0) return false;
  if (gap >= heal) return true;
  return gap * 4 >= heal * 3;
}

export function createPriestHealFxStore() {
  return {
    count: 0,
    x: [],
    y: [],
  };
}

function pushPriestHealFx(w, x, y) {
  const store = w.priestHealFx;
  if (!store || (store.count | 0) >= PRIEST_HEAL_FX_MAX) return;
  store.x.push(fx.toFloat(x));
  store.y.push(fx.toFloat(y));
  store.count++;
}

/** Drain heal pulses for worker → main publish (render-only). */
export function takePriestHealUpdates(w) {
  const store = w.priestHealFx;
  if (!store || store.count === 0) return null;
  const n = store.count;
  const patch = {
    count: n,
    x: store.x.slice(0, n),
    y: store.y.slice(0, n),
  };
  store.x.length = 0;
  store.y.length = 0;
  store.count = 0;
  return patch;
}

function missingHp(w, i) {
  const maxHp = unitMaxHp(w, i, getUnitDef(w.type[i]).hp);
  return maxHp - (w.hp[i] | 0);
}

/**
 * Ally in the heal huddle who should receive this pulse.
 * Expects a fresh spatial grid. Mechanicals are never candidates.
 * @param {boolean} allowOverheal idle priests top off small wounds
 * @returns {number} entity index, or -1
 */
export function findPriestHealTarget(w, priest, allowOverheal) {
  const range2 = fx.mul(PRIEST_HEAL_RANGE, PRIEST_HEAL_RANGE);
  const grid = w.spatial;
  const ox = w.px[priest];
  const oy = w.py[priest];
  const owner = w.owner[priest];
  let best = -1;
  let bestLanded = 0;
  let bestD2 = 0x7fffffff;

  const consider = (j) => {
    if (!w.alive[j] || (w.carriedBy?.[j] >= 0)) return;
    if (!isAlly(owner, w.owner[j])) return;
    if (isMechanical(w.type[j])) return;
    const missing = missingHp(w, j);
    if (missing <= 0) return;
    if (!allowOverheal && !priestHealLandsMost(missing)) return;
    const d2 = j === priest ? 0 : fx.dist2(ox, oy, w.px[j], w.py[j]);
    if (d2 > range2) return;
    const landed = missing > PRIEST_HEAL_AMOUNT ? PRIEST_HEAL_AMOUNT : missing;
    if (
      landed > bestLanded ||
      (landed === bestLanded && (d2 < bestD2 || (d2 === bestD2 && (best < 0 || j < best))))
    ) {
      bestLanded = landed;
      bestD2 = d2;
      best = j;
    }
  };

  const bounds = queryCellBounds(ox, oy, PRIEST_HEAL_RANGE, grid);
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      let j = grid.head[spatialCellId(x, z, grid)];
      while (j >= 0) {
        consider(j);
        j = grid.next[j];
      }
    }
  }
  return best;
}

/** Clamp a pulse onto the target and start the shared attack cooldown. */
export function applyPriestHeal(w, priest, target) {
  const missing = missingHp(w, target);
  if (missing <= 0) return false;
  const gain = missing < PRIEST_HEAL_AMOUNT ? missing : PRIEST_HEAL_AMOUNT;
  w.hp[target] = (w.hp[target] | 0) + gain;
  w.attackCd[priest] = getUnitDef(w.type[priest]).attackCooldown;
  pushPriestHealFx(w, w.px[target], w.py[target]);
  return true;
}

/**
 * Spend the attack cooldown on a heal when a valid ally is in the huddle.
 * Confused priests keep swinging. Returns true when a heal landed.
 */
export function tryPriestHeal(w, priest, allowOverheal) {
  if (w.type[priest] !== UNIT.PRIEST) return false;
  if (!w.alive[priest] || (w.carriedBy?.[priest] >= 0)) return false;
  if ((w.distractCd[priest] | 0) > 0) return false;
  if ((w.attackCd[priest] | 0) > 0) return false;
  const target = findPriestHealTarget(w, priest, allowOverheal);
  if (target < 0) return false;
  return applyPriestHeal(w, priest, target);
}
