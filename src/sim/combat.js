// Combat — acquire targets, chase, deal damage on cooldown.

import * as fx from './fixed.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';
import { clearPath, queuePath, attackStandPoint } from './path.js';

export function combatSystem(w, field) {
  acquireTargets(w, field);
  resolveAttacks(w);
}

/** Attack-move: pick nearest hostile in aggro range. */
function acquireTargets(w, field) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.order[i] !== w.ORDER.ATTACK_MOVE) continue;

    const def = getUnitDef(w.type[i]);
    const aggro2 = fx.mul(def.aggroRange, def.aggroRange);
    let best = -1;
    let bestD = aggro2 + 1;

    for (let j = 0; j < w.count; j++) {
      if (!w.alive[j] || !isHostile(w.owner[i], w.owner[j])) continue;
      const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
      if (d2 <= aggro2 && d2 < bestD) {
        bestD = d2;
        best = j;
      }
    }

    if (best >= 0) {
      w.targetEntity[i] = best;
      w.order[i] = w.ORDER.ATTACK;
      const stand = attackStandPoint(w, i, best);
      queuePath(w, i, stand.x, stand.y);
    }
  }
}

function resolveAttacks(w) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.order[i] !== w.ORDER.ATTACK) continue;

    const target = w.targetEntity[i];
    if (target < 0 || !w.alive[target]) {
      w.order[i] = w.ORDER.IDLE;
      w.targetEntity[i] = -1;
      clearPath(w, i);
      continue;
    }

    const def = getUnitDef(w.type[i]);
    const range2 = fx.mul(def.attackRange, def.attackRange);
    const d2 = fx.dist2(w.px[i], w.py[i], w.px[target], w.py[target]);

    if (d2 <= range2) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      w.hasTarget[i] = 0;
      if (w.attackCd[i] <= 0) {
        w.hp[target] -= def.attackDamage;
        w.attackCd[i] = def.attackCooldown;
        if (w.hp[target] <= 0) {
          kill(w, target);
          w.order[i] = w.ORDER.IDLE;
          w.targetEntity[i] = -1;
          clearPath(w, i);
        }
      }
    }
  }

  for (let i = 0; i < w.count; i++) {
    if (w.attackCd[i] > 0) w.attackCd[i]--;
  }
}

export function kill(w, i) {
  w.alive[i] = 0;
  w.order[i] = w.ORDER.IDLE;
  w.targetEntity[i] = -1;
  w.hasTarget[i] = 0;
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
}
