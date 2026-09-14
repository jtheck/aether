// Villager ↔ brigand: the pointed attack is the form change.
// CMD.ATTACK flips a villager into a brigand; leaving that fight (move / stop /
// gather / build / endAttack) puts the basket back on.

import { UNIT, getUnitDef } from './unitTypes.js';

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

export function becomeBrigand(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  clearCivilianWork(w, i);
  return setUnitType(w, i, UNIT.BRIGAND);
}

export function revertBrigand(w, i) {
  if (!w.alive[i] || w.type[i] !== UNIT.BRIGAND) return false;
  return setUnitType(w, i, UNIT.VILLAGER);
}
