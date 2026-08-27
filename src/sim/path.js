// Per-entity path storage + following helpers.

import * as fx from './fixed.js';
import { findPath, lineClear, worldToTile, TILE } from './field.js';
import { getUnitDef, isFlyer } from './unitTypes.js';
import { ORDER } from './world.js';
import { effectiveAttackRange, engagementPoint } from './engagement.js';

export const MAX_WAYPOINTS = 64;
export const MAX_REPATHS = 8;
export const PATH_REQUEST = {
  NONE: 0,
  LOS: 1,
  ASTAR: 2,
};
export const LOS_PATH_BUDGET = 1024;
export const ASTAR_PATH_BUDGET = 4;
/** Soft ceiling when auto-scaling A* for mass move backlogs. */
export const ASTAR_PATH_BUDGET_MAX = 128;

/** Waypoint accept: same tile OR within half a tile (v1 TILE²×0.25). */
const WAYPOINT_RADIUS_SQ = fx.mul(fx.mul(TILE, TILE), fx.fromFloat(0.25));
/** Final order completion radius (v1 WalkBehavior arrivalRadius 0.5). */
export const FINAL_ARRIVE = fx.fromFloat(1.2);
export const FINAL_ARRIVE_SQ = fx.mul(FINAL_ARRIVE, FINAL_ARRIVE);

/**
 * Soft gather disk for a multi-unit move. Big enough to cover a relaxed soft-sep
 * pack so a click inside the blob does not yank everyone onto one pixel.
 * Tuning: docs/unit-separation.md
 * @param {number} groupSize
 */
export function groupArriveRadius(groupSize) {
  const n = Math.max(1, groupSize | 0);
  return fx.fromFloat(Math.max(fx.toFloat(FINAL_ARRIVE), 1.4 * Math.sqrt(n)));
}

export function groupArriveRadiusSq(groupSize) {
  const r = groupArriveRadius(groupSize);
  return fx.mul(r, r);
}

export function wpBase(i) {
  return i * MAX_WAYPOINTS;
}

export function clearPath(w, i) {
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = PATH_REQUEST.NONE;
}

export function attackInRange(w, i) {
  if (w.order[i] !== ORDER.ATTACK || w.targetEntity[i] < 0) return false;
  const t = w.targetEntity[i];
  if (!w.alive[t]) return false;
  const def = getUnitDef(w.type[i]);
  const range = effectiveAttackRange(w, i, t);
  const range2 = fx.mul(range, range);
  const d2 = fx.dist2(w.px[i], w.py[i], w.px[t], w.py[t]);
  if (d2 > range2) return false;
  if (def.minRange > 0) {
    const min2 = fx.mul(def.minRange, def.minRange);
    if (d2 < min2) return false;
  }
  return true;
}

/** Stand just inside attack range of a target — avoids dog-piling on its center. */
export function attackStandPoint(w, i, target) {
  return engagementPoint(w, i, target);
}

/**
 * @param {object} w
 * @param {number} i
 * @param {number} destX
 * @param {number} destY
 * @param {{ slowAware?: boolean }} [opts]
 */
export function queuePath(w, i, destX, destY, opts = null) {
  w.navDestX[i] = destX;
  w.navDestY[i] = destY;
  w.repathCount[i] = 0;
  w.stuckTicks[i] = 0;
  clearPath(w, i);
  const slowAware = !!opts?.slowAware;
  if (w.pathSlowAware) w.pathSlowAware[i] = slowAware ? 1 : 0;
  // Slow-aware skips LOS shortcut (trees are passable but expensive).
  w.pathRequest[i] = slowAware ? PATH_REQUEST.ASTAR : PATH_REQUEST.LOS;
}

/** One straight-line waypoint if LOS is clear (always for flyers). */
export function tryQuickPath(w, field, i) {
  w.metrics.losAttempts++;
  const destX = w.navDestX[i];
  const destY = w.navDestY[i];
  if (!isFlyer(w.type[i]) && !lineClear(field, w.px[i], w.py[i], destX, destY)) {
    return false;
  }
  setSingleWaypoint(w, i, destX, destY);
  return true;
}

function setSingleWaypoint(w, i, x, y) {
  const base = wpBase(i);
  w.navWx[base] = x;
  w.navWy[base] = y;
  w.navWpCount[i] = 1;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = PATH_REQUEST.NONE;
}

/**
 * Compute and store a path from entity i to (destX, destY).
 * @param {boolean} [forceAstar] skip LOS shortcut (stuck/exhaustion repath)
 */
export function planPath(w, field, i, destX, destY, forceAstar = false) {
  w.navDestX[i] = destX;
  w.navDestY[i] = destY;
  const slowAware = !!w.pathSlowAware?.[i];
  // Air units fly straight — never A* around ground blockers.
  if (isFlyer(w.type[i])) {
    setSingleWaypoint(w, i, destX, destY);
    w.stuckTicks[i] = 0;
    return;
  }
  if (!forceAstar && !slowAware && tryQuickPath(w, field, i)) {
    w.stuckTicks[i] = 0;
    return;
  }
  w.metrics.astarSearches++;
  const base = wpBase(i);
  const count = findPath(
    field,
    w.px[i],
    w.py[i],
    destX,
    destY,
    w.navWx.subarray(base, base + MAX_WAYPOINTS),
    w.navWy.subarray(base, base + MAX_WAYPOINTS),
    MAX_WAYPOINTS,
    slowAware ? { slowAware: true } : null,
  );
  w.stuckTicks[i] = 0;
  if (count > 0) {
    w.navWpCount[i] = count;
    w.navWpIndex[i] = 0;
    w.pathRequest[i] = PATH_REQUEST.NONE;
    return;
  }
  // No path — hold. Never aim straight through water/blocked tiles.
  clearPath(w, i);
}

function countPathRequests(w, requestType) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.pathRequest[i] === requestType) n++;
  }
  return n;
}

/**
 * Spread path work across ticks so mass move orders don't spike CPU.
 * When limits are omitted, scale with the pending backlog: LOS is cheap so the
 * whole queue clears in one tick; A* rises with demand up to ASTAR_PATH_BUDGET_MAX.
 * Pass explicit `{ losLimit, astarLimit }` to pin hard caps (tests / determinism).
 */
export function planPathBudget(w, field, opts = {}) {
  const losLimit = opts.losLimit ?? Math.max(LOS_PATH_BUDGET, countPathRequests(w, PATH_REQUEST.LOS));
  const pendingAstar = opts.astarLimit == null ? countPathRequests(w, PATH_REQUEST.ASTAR) : 0;
  const astarLimit = opts.astarLimit ?? Math.min(
    ASTAR_PATH_BUDGET_MAX,
    Math.max(ASTAR_PATH_BUDGET, Math.ceil(pendingAstar / 2)),
  );
  w.pathLosCursor = processPathRequests(
    w,
    field,
    PATH_REQUEST.LOS,
    losLimit,
    w.pathLosCursor,
  );
  w.pathAstarCursor = processPathRequests(
    w,
    field,
    PATH_REQUEST.ASTAR,
    astarLimit,
    w.pathAstarCursor,
  );
}

function processPathRequests(w, field, requestType, limit, cursor) {
  if (w.count === 0 || limit <= 0) return cursor;
  let serviced = 0;
  let scanned = 0;
  let i = cursor % w.count;
  while (serviced < limit && scanned < w.count) {
    const next = i + 1 >= w.count ? 0 : i + 1;
    scanned++;
    if (w.alive[i] && w.pathRequest[i] === requestType && needsPath(w, i)) {
      refreshAttackDestination(w, i);
      if (requestType === PATH_REQUEST.LOS) {
        if (!tryQuickPath(w, field, i)) w.pathRequest[i] = PATH_REQUEST.ASTAR;
      } else {
        planPath(w, field, i, w.navDestX[i], w.navDestY[i], true);
      }
      serviced++;
    } else if (!w.alive[i] || !needsPath(w, i)) {
      w.pathRequest[i] = PATH_REQUEST.NONE;
    }
    i = next;
  }
  return i;
}

function refreshAttackDestination(w, i) {
  if (w.order[i] !== ORDER.ATTACK || w.targetEntity[i] < 0 || !w.alive[w.targetEntity[i]]) return;
  const stand = attackStandPoint(w, i, w.targetEntity[i]);
  w.navDestX[i] = stand.x;
  w.navDestY[i] = stand.y;
}

function needsPath(w, i) {
  const order = w.order[i];
  if (order === ORDER.IDLE) return false;
  if (order === ORDER.MOVE || order === ORDER.ATTACK_MOVE) return w.hasTarget[i] !== 0;
  if (order === ORDER.ATTACK) return w.targetEntity[i] >= 0;
  if (order === ORDER.REPAIR) return w.targetEntity[i] >= 0;
  if (order === ORDER.GATHER) return w.gatherTile[i] >= 0;
  return false;
}

export function atFinalDest(w, i) {
  return fx.dist2(w.px[i], w.py[i], w.navDestX[i], w.navDestY[i]) <= FINAL_ARRIVE_SQ;
}

export function waypointReached(w, i) {
  if (w.navWpCount[i] === 0) return false;
  const base = wpBase(i) + w.navWpIndex[i];
  const wx = w.navWx[base];
  const wy = w.navWy[base];
  if (worldToTile(w.px[i]) === worldToTile(wx) && worldToTile(w.py[i]) === worldToTile(wy)) {
    return true;
  }
  return fx.dist2(w.px[i], w.py[i], wx, wy) <= WAYPOINT_RADIUS_SQ;
}

/** When waypoints are done but still far from click — repath (never charge through water). */
export function onPathExhausted(w, field, i) {
  const remaining2 = fx.dist2(w.px[i], w.py[i], w.navDestX[i], w.navDestY[i]);
  if (remaining2 <= FINAL_ARRIVE_SQ) {
    clearPath(w, i);
    return;
  }
  if (w.repathCount[i] < MAX_REPATHS) {
    w.repathCount[i]++;
    clearPath(w, i);
    w.pathRequest[i] = PATH_REQUEST.ASTAR;
    return;
  }
  // Out of repaths and no LOS — stop. Better than walking into water.
  clearPath(w, i);
}

/** Refresh path if empty — prefer full plan over LOS-only. */
export function ensurePath(w, field, i) {
  if (
    (w.navWpCount[i] === 0 || w.navWpIndex[i] >= w.navWpCount[i]) &&
    w.repathCount[i] < MAX_REPATHS &&
    w.pathRequest[i] === PATH_REQUEST.NONE
  ) {
    w.pathRequest[i] = PATH_REQUEST.LOS;
  }
}

/** Current movement goal — waypoint or final destination. Returns { x, y } fixed. */
export function movementGoal(w, field, i) {
  if (w.order[i] === ORDER.ATTACK && w.targetEntity[i] >= 0) {
    const t = w.targetEntity[i];
    if (w.alive[t]) {
      if (attackInRange(w, i)) {
        clearPath(w, i);
        return null;
      }
      const stand = attackStandPoint(w, i, t);
      w.navDestX[i] = stand.x;
      w.navDestY[i] = stand.y;
      if (w.navWpCount[i] === 0 && w.pathRequest[i] === PATH_REQUEST.NONE) {
        w.pathRequest[i] =
          w.stuckTicks[i] > 10 ? PATH_REQUEST.ASTAR : PATH_REQUEST.LOS;
      }
    }
  } else if (needsPath(w, i)) {
    ensurePath(w, field, i);
  }
  if (w.navWpCount[i] === 0) {
    // Path pending — keep marching toward dest so orders don't freeze / stutter
    // while LOS→A* drains. Wall-slide blocks water/walls; A* corrects the route
    // when it lands. (LOS-only provisional used to zero vel on blocked clicks.)
    if (w.pathRequest[i] !== PATH_REQUEST.NONE && needsPath(w, i)) {
      return { x: w.navDestX[i], y: w.navDestY[i] };
    }
    return null;
  }
  const idx = w.navWpIndex[i];
  const base = wpBase(i) + idx;
  return { x: w.navWx[base], y: w.navWy[base] };
}

export function advanceWaypoint(w, i) {
  if (w.navWpCount[i] === 0) return false;
  if (w.navWpIndex[i] + 1 < w.navWpCount[i]) {
    w.navWpIndex[i]++;
    w.stuckTicks[i] = 0;
    return true;
  }
  return false;
}

/** Stuck detection — same-tick forced A* repath (v1: 30 ticks, cap 5). */
export function checkStuck(w, field, i) {
  const dx = w.px[i] - w.lastPx[i];
  const dy = w.py[i] - w.lastPy[i];
  const moved2 = fx.mul(dx, dx) + fx.mul(dy, dy);
  if (moved2 < fx.fromFloat(0.01)) {
    w.stuckTicks[i]++;
  } else {
    w.stuckTicks[i] = 0;
  }
  w.lastPx[i] = w.px[i];
  w.lastPy[i] = w.py[i];
  if (w.stuckTicks[i] > 30 && w.repathCount[i] < MAX_REPATHS) {
    w.stuckTicks[i] = 0;
    w.repathCount[i]++;
    clearPath(w, i);
    w.pathRequest[i] = PATH_REQUEST.ASTAR;
  }
}
