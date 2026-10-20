// Villager ↔ brigand: temporary torch form. Pointed CMD.ATTACK or the villager
// ability cast flips the basket for a torch; move / stop / gather / build /
// deposit, or idle timeout without a fight puts the villager back.

import { UNIT, getUnitDef } from './unitTypes.js';
import { isBuildingAlive } from './buildings.js';
import { isDoorAlive } from './doorCombat.js';
import { ORDER } from './world.js';
import { isCarried } from './transport.js';

/** ~20s at 20 Hz — brigand form without an active fight. */
export const BRIGAND_IDLE_REVERT_TICKS = 400;

function setUnitType(w, i, type) {
  if (!w.alive[i] || w.type[i] === type) return false;
  const next = getUnitDef(type);
  w.type[i] = type;
  w.speed[i] = next.speed;
  if (w.hp[i] > next.hp) w.hp[i] = next.hp;
  return true;
}

/** Drop civilian work markers so a finished swing does not resume as a brigand. */
function clearCivilianWork(w, i) {
  if (w.gatherTile) w.gatherTile[i] = -1;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  if (w.gatherAct) w.gatherAct[i] = 0;
  if (w.buildTarget) w.buildTarget[i] = -1;
}

function markBrigandForm(w, i) {
  if (w.brigandIdle) w.brigandIdle[i] = 0;
}

export function becomeBrigand(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  clearCivilianWork(w, i);
  if (!setUnitType(w, i, UNIT.BRIGAND)) return false;
  markBrigandForm(w, i);
  return true;
}

export function revertBrigand(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.BRIGAND) return false;
  if (!setUnitType(w, i, UNIT.VILLAGER)) return false;
  if (w.brigandIdle) w.brigandIdle[i] = 0;
  return true;
}

function brigandHasAttackTarget(w, i) {
  const target = w.targetEntity[i];
  if (target >= 0 && w.alive[target] && !(w.carriedBy?.[target] >= 0)) return true;
  const bi = w.targetBuilding?.[i] ?? -1;
  if (bi >= 0 && isBuildingAlive(w.buildings?.[bi])) return true;
  const di = w.targetDoor?.[i] ?? -1;
  if (di >= 0 && isDoorAlive(w.doors?.[di])) return true;
  return false;
}

/** True while the torch form should not time out (fight or hunt march). */
export function brigandInFight(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.BRIGAND) return false;
  if (isCarried(w, i)) return false;
  const order = w.order[i];
  if (order === ORDER.ATTACK_MOVE) return true;
  if (order === ORDER.ATTACK) return brigandHasAttackTarget(w, i);
  const foe = w.engagementTarget?.[i] ?? -1;
  if (foe >= 0 && w.alive[foe]) return true;
  return false;
}

/** Revert brigands who are not in a pointed fight (see BRIGAND_IDLE_REVERT_TICKS). */
export function brigandIdleSystem(w) {
  if (!w.brigandIdle) return;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.type[i] !== UNIT.BRIGAND) continue;
    if (brigandInFight(w, i)) {
      w.brigandIdle[i] = 0;
      continue;
    }
    const next = (w.brigandIdle[i] | 0) + 1;
    if (next >= BRIGAND_IDLE_REVERT_TICKS) revertBrigand(w, i);
    else w.brigandIdle[i] = next;
  }
}
