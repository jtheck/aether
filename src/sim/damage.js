// Shared deterministic damage/death path for melee and projectile impacts.

import { clearPath, queuePath, attackStandPoint } from './path.js';
import { claimEngagement } from './engagement.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';

/**
 * @param {object} w
 * @param {number} target
 * @param {number} amount
 * @param {number} [source] attacker entity id (−1 if none)
 */
export function applyDamage(w, target, amount, source = -1) {
  if (target < 0 || target >= w.count || !w.alive[target] || amount <= 0) return false;
  w.hp[target] -= amount;
  if (w.hp[target] <= 0) {
    kill(w, target);
    return true;
  }
  if (source >= 0) tryRetaliate(w, target, source);
  return true;
}

/** Idle / attack-move victims chase the unit that just hurt them. */
function tryRetaliate(w, victim, attacker) {
  if (attacker < 0 || attacker >= w.count || !w.alive[attacker]) return;
  if (!isHostile(w.owner[victim], w.owner[attacker])) return;
  const order = w.order[victim];
  if (order !== w.ORDER.IDLE && order !== w.ORDER.ATTACK_MOVE) return;
  const def = getUnitDef(w.type[victim]);
  if (def.category !== 'military') return;

  w.targetEntity[victim] = attacker;
  w.order[victim] = w.ORDER.ATTACK;
  claimEngagement(w, victim, attacker);
  const stand = attackStandPoint(w, victim, attacker);
  queuePath(w, victim, stand.x, stand.y);
}

export function kill(w, i) {
  if (i < 0 || i >= w.count || !w.alive[i]) return;
  w.alive[i] = 0;
  w.order[i] = w.ORDER.IDLE;
  w.targetEntity[i] = -1;
  w.hasTarget[i] = 0;
  w.vx[i] = 0;
  w.vy[i] = 0;
  if (w.engagementTarget) w.engagementTarget[i] = -1;
  if (w.engagementSlot) w.engagementSlot[i] = -1;
  clearPath(w, i);
}
