// Engineer repair — slow HP restore for mechanical allies (buildings later).

import * as fx from './fixed.js';
import { UNIT, getUnitDef, isMechanical } from './unitTypes.js';
import { clearPath, queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';
import { isCarried } from './transport.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  SPATIAL_OWNER_SLOTS,
  spatialCellId,
} from './spatialGrid.js';

/** Stand-off / work range for repairs. */
export const REPAIR_RANGE = fx.fromFloat(4);
const REPAIR_RANGE_SQ = fx.mul(REPAIR_RANGE, REPAIR_RANGE);

/** Auto-seek radius while idle. */
export const REPAIR_AGGRO = fx.fromFloat(28);
const REPAIR_AGGRO_SQ = fx.mul(REPAIR_AGGRO, REPAIR_AGGRO);

/** HP restored each pulse. */
export const REPAIR_AMOUNT = 2;
/** Ticks between repair pulses while in range. */
export const REPAIR_INTERVAL = 8;

/**
 * Buildings aren't in sim yet — reject anything that isn't a living mechanical unit.
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
  const maxHp = getUnitDef(w.type[target]).hp;
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
  clearEngagement(w, engineer);
  w.hasTarget[engineer] = 0;
  w.transportTarget[engineer] = -1;
  queuePath(w, engineer, w.px[target], w.py[target]);
  return true;
}

function endRepair(w, i) {
  w.targetEntity[i] = -1;
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
  const maxHp = getUnitDef(w.type[target]).hp;
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
  // Auto-seek used to scan all units per idle engineer — spatialize once.
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
    const maxHp = getUnitDef(w.type[target]).hp;
    if (w.hp[target] >= maxHp) {
      endRepair(w, i);
      continue;
    }

    const d2 = fx.dist2(w.px[i], w.py[i], w.px[target], w.py[target]);
    if (d2 <= REPAIR_RANGE_SQ) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      if (!pulseRepair(w, i, target)) endRepair(w, i);
    } else {
      // Chase the (possibly moving) mechanical without thrashing paths.
      w.navDestX[i] = w.px[target];
      w.navDestY[i] = w.py[target];
      if (w.navWpCount[i] === 0 && w.pathRequest[i] === 0) {
        queuePath(w, i, w.px[target], w.py[target]);
      }
    }
  }
}
