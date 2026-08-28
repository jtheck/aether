// Shared deterministic damage/death path for melee and projectile impacts.

import { clearPath, queuePath, attackStandPoint } from './path.js';
import { claimEngagement } from './engagement.js';
import { getUnitDef, isTransport } from './unitTypes.js';
import { isHostile } from './teams.js';
import { unloadPassengers } from './transport.js';

/**
 * @param {object} w
 * @param {number} target
 * @param {number} amount
 * @param {number} [source] attacker entity id (−1 if none)
 */
export function applyDamage(w, target, amount, source = -1) {
  if (target < 0 || target >= w.count || !w.alive[target] || amount <= 0) return false;
  let remain = amount;
  const shield = w.shieldHp?.[target] ?? 0;
  if (shield > 0) {
    if (shield >= remain) {
      w.shieldHp[target] = shield - remain;
      if (w.shieldHp[target] <= 0) {
        w.shieldHp[target] = 0;
        w.shieldTicks[target] = 0;
      }
      if (source >= 0) tryRetaliate(w, target, source);
      return true;
    }
    remain -= shield;
    w.shieldHp[target] = 0;
    w.shieldTicks[target] = 0;
  }
  w.hp[target] -= remain;
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
  // Too busy staring at frogs.
  if (w.distractCd?.[victim] > 0) return;
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
  // Spill passengers alive before clearing the hull.
  if (isTransport(w.type[i])) {
    unloadPassengers(w, i, null, null);
  }
  // Drop out of a living transport's passenger set.
  if (w.carriedBy) w.carriedBy[i] = -1;
  if (w.transportTarget) w.transportTarget[i] = -1;
  w.alive[i] = 0;
  w.order[i] = w.ORDER.IDLE;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  w.hasTarget[i] = 0;
  w.vx[i] = 0;
  w.vy[i] = 0;
  if (w.shieldHp) w.shieldHp[i] = 0;
  if (w.shieldTicks) w.shieldTicks[i] = 0;
  if (w.engagementTarget) w.engagementTarget[i] = -1;
  if (w.engagementSlot) w.engagementSlot[i] = -1;
  clearPath(w, i);
}
