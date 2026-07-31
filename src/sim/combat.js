// Combat — acquire targets, chase, deal damage on cooldown.

import * as fx from './fixed.js';
import { ATTACK_DELIVERY, getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';
import { attackInRange, clearPath, queuePath, attackStandPoint } from './path.js';
import { applyDamage, kill } from './damage.js';
import { spawnProjectile } from './projectiles.js';
import {
  claimEngagement,
  clearEngagement,
  rebuildEngagementClaims,
} from './engagement.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  SPATIAL_OWNER_SLOTS,
  spatialCellId,
} from './spatialGrid.js';

export const ACQUIRE_PHASES = 5;

export function combatSystem(w, field) {
  rebuildSpatialGrid(w.spatial, w);
  rebuildEngagementClaims(w);
  acquireTargets(w, field);
  resolveAttacks(w);
}

export { kill };

function canAutoAcquire(w, i) {
  const order = w.order[i];
  if (order === w.ORDER.ATTACK_MOVE) return true;
  if (order === w.ORDER.IDLE) return true;
  return false;
}

/** Attack-move + idle military: pick nearest hostile in aggro range. */
export function acquireTargets(w, field) {
  const grid = w.spatial;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (!canAutoAcquire(w, i)) continue;
    if (i % ACQUIRE_PHASES !== w.tick % ACQUIRE_PHASES) continue;

    const def = getUnitDef(w.type[i]);
    if (def.category !== 'military' || def.aggroRange === 0) continue;

    const aggro2 = fx.mul(def.aggroRange, def.aggroRange);
    let best = -1;
    let bestD = aggro2 + 1;
    let bestLoad = 0x7fffffff;

    const bounds = queryCellBounds(w.px[i], w.py[i], def.aggroRange);
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const cell = spatialCellId(x, z);
        if (grid.overflowOwners || w.owner[i] >= SPATIAL_OWNER_SLOTS) {
          let j = grid.head[cell];
          while (j >= 0) {
            if (j !== i && w.alive[j] && isHostile(w.owner[i], w.owner[j])) {
              w.metrics.combatCandidates++;
              const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
              const load = w.targetLoad[j];
              if (
                d2 <= aggro2 &&
                (d2 < bestD ||
                  (d2 === bestD &&
                    (load < bestLoad || (load === bestLoad && (best < 0 || j < best)))))
              ) {
                bestD = d2;
                bestLoad = load;
                best = j;
              }
            }
            j = grid.next[j];
          }
          continue;
        }
        for (let owner = 0; owner < SPATIAL_OWNER_SLOTS; owner++) {
          if (owner === w.owner[i] || !grid.activeOwners[owner]) continue;
          let j = grid.ownerHead[cell * SPATIAL_OWNER_SLOTS + owner];
          while (j >= 0) {
            w.metrics.combatCandidates++;
            const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
            const load = w.targetLoad[j];
            if (
              d2 <= aggro2 &&
              (d2 < bestD ||
                (d2 === bestD &&
                  (load < bestLoad || (load === bestLoad && (best < 0 || j < best)))))
            ) {
              bestD = d2;
              bestLoad = load;
              best = j;
            }
            j = grid.ownerNext[j];
          }
        }
      }
    }

    if (best >= 0) {
      w.targetEntity[i] = best;
      w.order[i] = w.ORDER.ATTACK;
      claimEngagement(w, i, best);
      const stand = attackStandPoint(w, i, best);
      queuePath(w, i, stand.x, stand.y);
    }
  }
}

/** After a fight: resume attack-move destination if one remains, else idle. */
function endAttack(w, i) {
  w.targetEntity[i] = -1;
  clearEngagement(w, i);
  clearPath(w, i);
  if (w.hasTarget[i]) {
    w.order[i] = w.ORDER.ATTACK_MOVE;
    queuePath(w, i, w.tx[i], w.ty[i]);
  } else {
    w.order[i] = w.ORDER.IDLE;
  }
}

function resolveAttacks(w) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.order[i] !== w.ORDER.ATTACK) continue;

    const target = w.targetEntity[i];
    if (target < 0 || !w.alive[target]) {
      endAttack(w, i);
      continue;
    }

    const def = getUnitDef(w.type[i]);

    if (attackInRange(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      // Keep hasTarget — it marks a pending attack-move destination to resume.
      clearPath(w, i);
      if (w.attackCd[i] <= 0) {
        if (def.attackDelivery === ATTACK_DELIVERY.PROJECTILE) {
          spawnProjectile(w, {
            type: def.projectileType,
            owner: w.owner[i],
            source: i,
            target,
            x: w.px[i],
            y: w.py[i],
            aimX: w.px[target],
            aimY: w.py[target],
            damage: def.attackDamage,
          });
        } else {
          applyDamage(w, target, def.attackDamage, i);
        }
        w.attackCd[i] = def.attackCooldown;
        if (!w.alive[target]) endAttack(w, i);
      }
    }
  }

  for (let i = 0; i < w.count; i++) {
    if (w.attackCd[i] > 0) w.attackCd[i]--;
  }
}
