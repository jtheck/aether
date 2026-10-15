// Combat — acquire targets, chase, deal damage on cooldown.

import * as fx from './fixed.js';
import { ATTACK_DELIVERY, getUnitDef, UNIT, unitAttacksBuildings, unitIdleHunts } from './unitTypes.js';
import { unitAttackDamage } from './namedUnit.js';
import { revertBrigand } from './brigand.js';
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
import { tickHolyArmorShields } from './holyArmor.js';
import { tryPriestHeal } from './priestHeal.js';
import { tickMana } from './mana.js';
import {
  applyDamageBuilding,
  attackBuildingStandPointOnField,
  buildingFootprintHalf,
  isEconomyCombatBuilding,
} from './buildingCombat.js';
import { isBuildingAlive } from './buildings.js';
import { applyDamageDoor, attackDoorInRange, attackDoorStandPointOnField, DOOR_BASH_REACH_F, isDoorAlive, nearestShutDoor } from './doorCombat.js';
import { lineClear } from './field.js';
import { clearAttackFocus, lockAttackFocus } from './world.js';

export const ACQUIRE_PHASES = 5;
/** Squared-distance penalty per existing attacker — spreads fire without ignoring nearer threats. */
const LOAD_SPREAD = fx.mul(fx.fromInt(10), fx.fromInt(10));
/** Must beat the current target by this much score before switching (anti-thrash). */
const REBALANCE_MARGIN = fx.mul(fx.fromInt(4), fx.fromInt(4));

export function combatSystem(w, field) {
  rebuildSpatialGrid(w.spatial, w);
  rebuildEngagementClaims(w);
  bashBlockingDoors(w, field);
  acquireTargets(w, field);
  resolveAttacks(w, field);
  tickMana(w);
}

/** Attack-move or move that runs into a shut door stops and breaks it. */
function bashBlockingDoors(w, field) {
  if (!w.doors?.length || !field) return;
  const reach = fx.fromFloat(DOOR_BASH_REACH_F);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.carriedBy?.[i] >= 0) continue;
    const order = w.order[i];
    if (order !== w.ORDER.ATTACK_MOVE && order !== w.ORDER.MOVE) continue;
    if (!w.hasTarget[i] || w.attackFocus?.[i]) continue;
    if (!unitAttacksBuildings(w.type[i])) continue;
    if (lineClear(field, w.px[i], w.py[i], w.tx[i], w.ty[i])) continue;
    const di = nearestShutDoor(w, w.px[i], w.py[i], reach);
    if (di < 0) continue;
    const door = w.doors[di];
    w.order[i] = w.ORDER.ATTACK;
    w.targetEntity[i] = -1;
    if (w.targetBuilding) w.targetBuilding[i] = -1;
    w.targetDoor[i] = di;
    lockAttackFocus(w, i);
    clearEngagement(w, i);
    const stand = attackDoorStandPointOnField(w, field, i, door);
    queuePath(w, i, stand.x, stand.y);
  }
}

export { kill };

function hasSquadMates(w, i) {
  const sid = w.squadId?.[i] | 0;
  if (sid === 0) return false;
  for (let j = 0; j < w.count; j++) {
    if (j === i || !w.alive[j]) continue;
    if ((w.squadId[j] | 0) === sid) return true;
  }
  return false;
}

function canAutoAcquire(w, i) {
  // Frogs underfoot — too busy gawking to pick a fight.
  if (w.distractCd[i] > 0) return false;
  if (w.carriedBy?.[i] >= 0) return false;
  const order = w.order[i];
  // ATTACK: periodic rebalance off dogpiled targets when alternatives exist.
  // CMD.ATTACK sets attackFocus so a clicked target is not stolen by nearest-foe.
  if (order === w.ORDER.ATTACK) return !w.attackFocus?.[i];
  const hunts = unitIdleHunts(w.type[i]);
  if (order === w.ORDER.ATTACK_MOVE) return hunts || hasSquadMates(w, i);
  if (order === w.ORDER.IDLE) return hunts;
  return false;
}

function targetScore(w, attacker, target, d2) {
  let load = w.targetLoad[target];
  // Don't count ourselves when re-scoring our current target.
  if (w.targetEntity[attacker] === target && load > 0) load--;
  return d2 + load * LOAD_SPREAD;
}

/** Idle / attack-move / attack military: pick a hostile in aggro, preferring lower load. */
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
    let bestScore = 0x7fffffff;
    const prev = w.targetEntity[i];
    const wasAttack = w.order[i] === w.ORDER.ATTACK;

    const consider = (j) => {
      if (j === i || !w.alive[j] || !isHostile(w.owner[i], w.owner[j])) return;
      if (w.carriedBy?.[j] >= 0) return;
      w.metrics.combatCandidates++;
      const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
      if (d2 > aggro2) return;
      const score = targetScore(w, i, j, d2);
      if (
        score < bestScore ||
        (score === bestScore && (best < 0 || j < best))
      ) {
        bestScore = score;
        best = j;
      }
    };

    const bounds = queryCellBounds(w.px[i], w.py[i], def.aggroRange, grid);
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const cell = spatialCellId(x, z, grid);
        if (grid.overflowOwners || w.owner[i] >= SPATIAL_OWNER_SLOTS) {
          let j = grid.head[cell];
          while (j >= 0) {
            consider(j);
            j = grid.next[j];
          }
          continue;
        }
        for (let owner = 0; owner < SPATIAL_OWNER_SLOTS; owner++) {
          if (owner === w.owner[i] || !grid.activeOwners[owner]) continue;
          let j = grid.ownerHead[cell * SPATIAL_OWNER_SLOTS + owner];
          while (j >= 0) {
            consider(j);
            j = grid.ownerNext[j];
          }
        }
      }
    }

    if (best >= 0) {
      if (wasAttack && prev === best) continue;
      if (wasAttack && prev >= 0 && w.alive[prev]) {
        const prevD2 = fx.dist2(w.px[i], w.py[i], w.px[prev], w.py[prev]);
        if (prevD2 <= aggro2) {
          const prevScore = targetScore(w, i, prev, prevD2);
          if (bestScore + REBALANCE_MARGIN >= prevScore) continue;
        }
        w.targetLoad[prev] = Math.max(0, w.targetLoad[prev] - 1);
      }

      w.targetEntity[i] = best;
      if (w.targetBuilding) w.targetBuilding[i] = -1;
      if (w.targetDoor) w.targetDoor[i] = -1;
      if (w.attackFocus) w.attackFocus[i] = 0;
      w.order[i] = w.ORDER.ATTACK;
      claimEngagement(w, i, best);
      const stand = attackStandPoint(w, i, best);
      queuePath(w, i, stand.x, stand.y);
      continue;
    }

    if (!unitAttacksBuildings(w.type[i])) continue;
    const buildings = w.buildings;
    if (!buildings?.length) continue;
    const prevB = w.targetBuilding?.[i] ?? -1;
    if (wasAttack && prevB >= 0 && isBuildingAlive(buildings[prevB])) continue;

    // Prefer military / production buildings. Economy (camp/mine/farm/silo) is
    // fallback only — and attack-move keeps marching instead of peeling off.
    const allowEconomy = w.order[i] !== w.ORDER.ATTACK_MOVE;
    let bestBi = -1;
    let bestBd2 = 0x7fffffff;
    let bestEcon = -1;
    let bestEconD2 = 0x7fffffff;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (!isBuildingAlive(b) || !isHostile(w.owner[i], b.owner)) continue;
      w.metrics.combatCandidates++;
      const d2 = fx.dist2(w.px[i], w.py[i], b.x, b.z);
      const reach = def.aggroRange + buildingFootprintHalf(b.type);
      if (d2 > fx.mul(reach, reach)) continue;
      if (isEconomyCombatBuilding(b.type)) {
        if (!allowEconomy) continue;
        if (d2 < bestEconD2 || (d2 === bestEconD2 && (bestEcon < 0 || bi < bestEcon))) {
          bestEconD2 = d2;
          bestEcon = bi;
        }
        continue;
      }
      if (d2 < bestBd2 || (d2 === bestBd2 && (bestBi < 0 || bi < bestBi))) {
        bestBd2 = d2;
        bestBi = bi;
      }
    }
    if (bestBi < 0) bestBi = bestEcon;
    if (bestBi < 0) continue;

    w.targetEntity[i] = -1;
    w.targetBuilding[i] = bestBi;
    if (w.targetDoor) w.targetDoor[i] = -1;
    if (w.attackFocus) w.attackFocus[i] = 0;
    w.order[i] = w.ORDER.ATTACK;
    clearEngagement(w, i);
    const stand = attackBuildingStandPointOnField(w, field, i, buildings[bestBi]);
    queuePath(w, i, stand.x, stand.y);
  }
}

/** After a fight: resume attack-move destination if one remains, else idle. */
function endAttack(w, i) {
  clearAttackFocus(w, i);
  clearEngagement(w, i);
  clearPath(w, i);
  if (w.hasTarget[i]) {
    w.order[i] = w.ORDER.ATTACK_MOVE;
    queuePath(w, i, w.tx[i], w.ty[i]);
  } else {
    w.order[i] = w.ORDER.IDLE;
  }
  revertBrigand(w, i);
}

function resolveAttacks(w, field) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.carriedBy?.[i] >= 0) continue;
    // Idle priests may top off the huddle. A fight only swaps the shot they
    // are about to fire, and only when most of that heal would land.
    if (w.order[i] === w.ORDER.IDLE) {
      if (w.type[i] === UNIT.PRIEST) tryPriestHeal(w, i, true);
      continue;
    }
    if (w.order[i] !== w.ORDER.ATTACK) continue;
    // Distracted units don't pick new fights, but a frog-confused unit may
    // already be locked onto an ally — let that swing through.

    const target = w.targetEntity[i];
    const bi = w.targetBuilding?.[i] ?? -1;
    const b = bi >= 0 ? w.buildings?.[bi] : null;
    const di = w.targetDoor?.[i] ?? -1;
    const door = di >= 0 ? w.doors?.[di] : null;
    const unitOk = target >= 0 && w.alive[target] && !(w.carriedBy?.[target] >= 0);
    const buildingOk = isBuildingAlive(b) && unitAttacksBuildings(w.type[i]);
    const doorOk = isDoorAlive(door) && unitAttacksBuildings(w.type[i]);
    if (!unitOk && !buildingOk && !doorOk) {
      endAttack(w, i);
      continue;
    }

    const def = getUnitDef(w.type[i]);

    if (doorOk) {
      if (attackDoorInRange(w, i, door)) {
        w.vx[i] = 0;
        w.vy[i] = 0;
        clearPath(w, i);
        if (w.attackCd[i] <= 0) {
          if (def.attackDelivery === ATTACK_DELIVERY.PROJECTILE) {
            spawnProjectile(w, {
              type: def.projectileType,
              owner: w.owner[i],
              source: i,
              target: -1,
              targetDoor: di,
              x: w.px[i],
              y: w.py[i],
              aimX: door.x,
              aimY: door.z,
              damage: unitAttackDamage(w, i, def.attackDamage),
            });
          } else {
            applyDamageDoor(w, field, di, unitAttackDamage(w, i, def.attackDamage));
          }
          w.attackCd[i] = def.attackCooldown;
          if (!isDoorAlive(w.doors?.[di])) endAttack(w, i);
        }
      }
      continue;
    }

    if (attackInRange(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      // Keep hasTarget — it marks a pending attack-move destination to resume.
      clearPath(w, i);
      if (w.attackCd[i] <= 0) {
        if (w.type[i] === UNIT.PRIEST && tryPriestHeal(w, i, false)) {
          // Shared attack cooldown spent on the heal. Smite waits.
        } else if (unitOk) {
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
              damage: unitAttackDamage(w, i, def.attackDamage),
            });
          } else {
            applyDamage(w, target, unitAttackDamage(w, i, def.attackDamage), i);
          }
          w.attackCd[i] = def.attackCooldown;
          if (!w.alive[target]) endAttack(w, i);
        } else {
          if (def.attackDelivery === ATTACK_DELIVERY.PROJECTILE) {
            spawnProjectile(w, {
              type: def.projectileType,
              owner: w.owner[i],
              source: i,
              target: -1,
              targetBuilding: bi,
              x: w.px[i],
              y: w.py[i],
              aimX: b.x,
              aimY: b.z,
              damage: unitAttackDamage(w, i, def.attackDamage),
            });
          } else {
            applyDamageBuilding(w, field, bi, unitAttackDamage(w, i, def.attackDamage));
          }
          w.attackCd[i] = def.attackCooldown;
          if (!isBuildingAlive(w.buildings?.[bi])) endAttack(w, i);
        }
      }
    }
  }

  for (let i = 0; i < w.count; i++) {
    if (w.attackCd[i] > 0) w.attackCd[i]--;
    if (w.abilityCd[i] > 0) w.abilityCd[i]--;
    if (w.distractCd[i] > 0) {
      w.distractCd[i]--;
      // Confusion ends — stop beating up your own team.
      if (w.distractCd[i] === 0) {
        const t = w.targetEntity[i];
        if (
          t >= 0 &&
          w.alive[t] &&
          w.owner[t] === w.owner[i] &&
          w.order[i] === w.ORDER.ATTACK
        ) {
          endAttack(w, i);
        }
      }
    }
  }
  tickHolyArmorShields(w);
}
