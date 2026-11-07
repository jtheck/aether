// Engineer repair - slow HP restore for mechanical allies (buildings later).

import * as fx from './fixed.js';
import { UNIT, getUnitDef, isMechanical, pairSeparationDist } from './unitTypes.js';
import { unitMaxHp } from './namedUnit.js';
import { FINAL_ARRIVE, clearPath, queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';
import { isCarried } from './transport.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  SPATIAL_OWNER_SLOTS,
  spatialCellId,
} from './spatialGrid.js';

/** Stand-off / work range for repairs. Big hulls stand further out (see repairReach). */
export const REPAIR_RANGE = fx.fromFloat(4);

/** Auto-seek radius while idle. */
export const REPAIR_AGGRO = fx.fromFloat(28);
const REPAIR_AGGRO_SQ = fx.mul(REPAIR_AGGRO, REPAIR_AGGRO);

/** HP restored each pulse. */
export const REPAIR_AMOUNT = 2;
/** Ticks between repair pulses while in range. */
export const REPAIR_INTERVAL = 8;

/**
 * Buildings aren't in sim yet - reject anything that isn't a living mechanical unit.
 * @returns {boolean}
 */
export function canRepairTarget(w, engineer, target) {
  if (engineer < 0 || target < 0) return false;
  if (engineer >= w.count || target >= w.count) return false;
  if (!w.alive[engineer] || !w.alive[target]) return false;
  if (w.type[engineer] !== UNIT.ENGINEER) return false;
  if (w.owner[engineer] !== w.owner[target]) return false;
  if (isCarried(w, engineer) || isCarried(w, target)) return false;
  // Future: buildings would pass a different check here.
  if (!isMechanical(w.type[target])) return false;
  const maxHp = unitMaxHp(w, target, getUnitDef(w.type[target]).hp);
  return w.hp[target] < maxHp;
}

export function beginRepair(w, engineer, target) {
  if (
    engineer < 0 ||
    target < 0 ||
    engineer >= w.count ||
    target >= w.count ||
    !w.alive[engineer] ||
    !w.alive[target] ||
    w.type[engineer] !== UNIT.ENGINEER ||
    w.owner[engineer] !== w.owner[target] ||
    isCarried(w, engineer) ||
    isCarried(w, target) ||
    !isMechanical(w.type[target])
  ) {
    return false;
  }
  w.order[engineer] = ORDER.REPAIR;
  w.targetEntity[engineer] = target;
  if (w.targetBuilding) w.targetBuilding[engineer] = -1;
  clearEngagement(w, engineer);
  w.hasTarget[engineer] = 0;
  w.transportTarget[engineer] = -1;
  const stand = repairStandPoint(w, engineer, target);
  if (fx.dist2(w.px[engineer], w.py[engineer], w.px[target], w.py[target]) <= stand.reachSq) {
    clearPath(w, engineer);
    w.vx[engineer] = 0;
    w.vy[engineer] = 0;
  } else {
    queuePath(w, engineer, stand.x, stand.y);
  }
  return true;
}

/**
 * Center distance at which the engineer stops and works.
 * At least REPAIR_RANGE, and never inside the pair's soft-separation bubble —
 * the siege wagon's hull is wider than REPAIR_RANGE, so walking to its center
 * shoved it every tick.
 */
function repairReach(engineerType, targetType) {
  const sep = fx.fromFloat(pairSeparationDist(engineerType, targetType));
  return sep > REPAIR_RANGE ? sep : REPAIR_RANGE;
}

/** Point on the near side of the hull, outside the push radius. */
function repairStandPoint(w, engineer, target) {
  const reach = repairReach(w.type[engineer], w.type[target]);
  const dx = w.px[engineer] - w.px[target];
  const dy = w.py[engineer] - w.py[target];
  const dist = fx.len(dx, dy);
  const nx = dist > 0 ? fx.div(dx, dist) : fx.ONE;
  const ny = dist > 0 ? fx.div(dy, dist) : 0;
  // Path arrival stops up to FINAL_ARRIVE short of the ring. Count that band
  // as in range so the engineer works there instead of stepping into the hull.
  const work = reach + FINAL_ARRIVE;
  return {
    x: w.px[target] + fx.mul(nx, reach),
    y: w.py[target] + fx.mul(ny, reach),
    reachSq: fx.mul(work, work),
  };
}

function endRepair(w, i) {
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  clearEngagement(w, i);
  clearPath(w, i);
  w.order[i] = ORDER.IDLE;
  w.hasTarget[i] = 0;
}

/** Closest damaged same-owner mechanical in aggro. Expects fresh `w.spatial`. */
function findDamagedMechanical(w, engineer) {
  const grid = w.spatial;
  const ox = w.px[engineer];
  const oy = w.py[engineer];
  const owner = w.owner[engineer];
  let best = -1;
  let bestD2 = 0x7fffffff;

  const consider = (j) => {
    if (j === engineer) return;
    if (!canRepairTarget(w, engineer, j)) return;
    const d2 = fx.dist2(ox, oy, w.px[j], w.py[j]);
    if (d2 > REPAIR_AGGRO_SQ) return;
    if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || j < best))) {
      bestD2 = d2;
      best = j;
    }
  };

  const bounds = queryCellBounds(ox, oy, REPAIR_AGGRO, grid);
  const useOwnerLists = !grid.overflowOwners && owner < SPATIAL_OWNER_SLOTS;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const cell = spatialCellId(x, z, grid);
      if (useOwnerLists) {
        let j = grid.ownerHead[cell * SPATIAL_OWNER_SLOTS + owner];
        while (j >= 0) {
          consider(j);
          j = grid.ownerNext[j];
        }
      } else {
        let j = grid.head[cell];
        while (j >= 0) {
          consider(j);
          j = grid.next[j];
        }
      }
    }
  }
  return best;
}

function pulseRepair(w, engineer, target) {
  const maxHp = unitMaxHp(w, target, getUnitDef(w.type[target]).hp);
  if (w.hp[target] >= maxHp) return false;
  // Reuse attackCd as repair cadence.
  if (w.attackCd[engineer] > 0) return true;
  w.hp[target] = Math.min(maxHp, w.hp[target] + REPAIR_AMOUNT);
  w.attackCd[engineer] = REPAIR_INTERVAL;
  return w.hp[target] < maxHp;
}

/**
 * Idle engineers auto-seek damaged mechanicals; REPAIR orders walk in and heal.
 */
export function repairSystem(w) {
  // Auto-seek used to scan all units per idle engineer - spatialize once.
  rebuildSpatialGrid(w.spatial, w);

  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || isCarried(w, i)) continue;
    if (w.type[i] !== UNIT.ENGINEER) continue;

    if (w.order[i] === ORDER.IDLE) {
      const target = findDamagedMechanical(w, i);
      if (target >= 0) beginRepair(w, i, target);
      continue;
    }

    if (w.order[i] !== ORDER.REPAIR) continue;

    const target = w.targetEntity[i];
    if (target < 0 || !w.alive[target] || !isMechanical(w.type[target])) {
      endRepair(w, i);
      continue;
    }
    const maxHp = unitMaxHp(w, target, getUnitDef(w.type[target]).hp);
    if (w.hp[target] >= maxHp) {
      endRepair(w, i);
      continue;
    }

    const stand = repairStandPoint(w, i, target);
    const d2 = fx.dist2(w.px[i], w.py[i], w.px[target], w.py[target]);
    if (d2 <= stand.reachSq) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      if (!pulseRepair(w, i, target)) endRepair(w, i);
    } else {
      // Chase a point beside the hull, not its center, so the approach
      // doesn't walk through the vehicle. Repath only when idle.
      w.navDestX[i] = stand.x;
      w.navDestY[i] = stand.y;
      if (w.navWpCount[i] === 0 && w.pathRequest[i] === 0) {
        queuePath(w, i, stand.x, stand.y);
      }
    }
  }
}
