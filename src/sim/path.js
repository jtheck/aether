// Per-entity path storage + following helpers.

import * as fx from './fixed.js';
import { findPath, lineClear } from './field.js';
import { getUnitDef } from './unitTypes.js';
import { ORDER } from './world.js';

export const MAX_WAYPOINTS = 32;
const MARCH_STEP = fx.fromFloat(24);

export function wpBase(i) {
  return i * MAX_WAYPOINTS;
}

export function clearPath(w, i) {
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
}

export function attackInRange(w, i) {
  if (w.order[i] !== ORDER.ATTACK || w.targetEntity[i] < 0) return false;
  const t = w.targetEntity[i];
  if (!w.alive[t]) return false;
  const def = getUnitDef(w.type[i]);
  const range2 = fx.mul(def.attackRange, def.attackRange);
  return fx.dist2(w.px[i], w.py[i], w.px[t], w.py[t]) <= range2;
}

/** Stand just inside attack range of a target — avoids dog-piling on its center. */
export function attackStandPoint(w, i, target) {
  const def = getUnitDef(w.type[i]);
  const standoff = fx.mul(def.attackRange, fx.fromFloat(0.85));
  const dx = w.px[i] - w.px[target];
  const dy = w.py[i] - w.py[target];
  const dist = fx.len(dx, dy);
  if (dist === 0) return { x: w.px[i], y: w.py[i] };
  const nx = fx.div(dx, dist);
  const ny = fx.div(dy, dist);
  return {
    x: w.px[target] + fx.mul(nx, standoff),
    y: w.py[target] + fx.mul(ny, standoff),
  };
}

export function queuePath(w, i, destX, destY) {
  w.navDestX[i] = destX;
  w.navDestY[i] = destY;
  clearPath(w, i);
}

/** One straight-line waypoint if LOS is clear. */
export function tryQuickPath(w, field, i) {
  const destX = w.navDestX[i];
  const destY = w.navDestY[i];
  if (!lineClear(field, w.px[i], w.py[i], destX, destY)) return false;
  const base = wpBase(i);
  w.navWx[base] = destX;
  w.navWy[base] = destY;
  w.navWpCount[i] = 1;
  w.navWpIndex[i] = 0;
  return true;
}

/** March toward dest when A* fails — good enough for dense crowds. */
function fallbackMarch(w, i, destX, destY) {
  const dx = destX - w.px[i];
  const dy = destY - w.py[i];
  const dist = fx.len(dx, dy);
  if (dist === 0) return false;
  const step = dist <= MARCH_STEP ? dist : MARCH_STEP;
  const base = wpBase(i);
  w.navWx[base] = w.px[i] + fx.mul(fx.div(dx, dist), step);
  w.navWy[base] = w.py[i] + fx.mul(fx.div(dy, dist), step);
  w.navWpCount[i] = 1;
  w.navWpIndex[i] = 0;
  return true;
}

/** Compute and store a path from entity i's position to (destX, destY). */
export function planPath(w, field, i, destX, destY) {
  w.navDestX[i] = destX;
  w.navDestY[i] = destY;
  if (tryQuickPath(w, field, i)) {
    w.stuckTicks[i] = 0;
    return;
  }
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
  );
  w.navWpCount[i] = count;
  w.navWpIndex[i] = 0;
  w.stuckTicks[i] = 0;
  if (count === 0) fallbackMarch(w, i, destX, destY);
}

/** Spread path work across ticks so mass move orders don't spike CPU. */
export function planPathBudget(w, field, limit) {
  let planned = 0;
  let scanned = 0;
  let i = w.pathCursor % w.count;

  while (planned < limit && scanned < w.count) {
    if (i >= w.count) i = 0;
    scanned++;
    const next = i + 1 >= w.count ? 0 : i + 1;

    if (w.alive[i] && w.navWpCount[i] === 0 && needsPath(w, i)) {
      let destX = w.navDestX[i];
      let destY = w.navDestY[i];
      if (w.order[i] === ORDER.ATTACK && w.targetEntity[i] >= 0 && w.alive[w.targetEntity[i]]) {
        const stand = attackStandPoint(w, i, w.targetEntity[i]);
        destX = stand.x;
        destY = stand.y;
        w.navDestX[i] = destX;
        w.navDestY[i] = destY;
      }
      if (!tryQuickPath(w, field, i)) {
        planPath(w, field, i, destX, destY);
      }
      planned++;
    }

    i = next;
  }

  w.pathCursor = i;
}

function needsPath(w, i) {
  const order = w.order[i];
  if (order === ORDER.IDLE) return false;
  if (order === ORDER.MOVE || order === ORDER.ATTACK_MOVE) return w.hasTarget[i] !== 0;
  if (order === ORDER.ATTACK) return w.targetEntity[i] >= 0;
  return false;
}

/** Refresh path if destination moved or path is exhausted / line blocked. */
export function ensurePath(w, field, i) {
  if (w.navWpCount[i] === 0 || w.navWpIndex[i] >= w.navWpCount[i]) {
    tryQuickPath(w, field, i);
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
      if (w.navWpCount[i] === 0 || w.stuckTicks[i] > 10) {
        tryQuickPath(w, field, i);
      }
    }
  } else {
    ensurePath(w, field, i);
  }
  if (w.navWpCount[i] === 0) return null;
  const idx = w.navWpIndex[i];
  const base = wpBase(i) + idx;
  return { x: w.navWx[base], y: w.navWy[base] };
}

/** Advance waypoint index when entity arrives at current goal. */
export function advanceWaypoint(w, i, arriveDist) {
  if (w.navWpCount[i] === 0) return;
  const base = wpBase(i) + w.navWpIndex[i];
  const dx = w.navWx[base] - w.px[i];
  const dy = w.navWy[base] - w.py[i];
  const dist = fx.len(dx, dy);
  if (dist <= arriveDist && w.navWpIndex[i] + 1 < w.navWpCount[i]) {
    w.navWpIndex[i]++;
    w.stuckTicks[i] = 0;
  }
}

/** Stuck detection — queue repath after N ticks with negligible movement. */
export function checkStuck(w, field, i) {
  const dx = w.px[i] - w.lastPx[i];
  const dy = w.py[i] - w.lastPy[i];
  const moved = fx.len(dx, dy);
  if (moved < fx.fromFloat(0.05)) {
    w.stuckTicks[i]++;
  } else {
    w.stuckTicks[i] = 0;
  }
  w.lastPx[i] = w.px[i];
  w.lastPy[i] = w.py[i];
  if (w.stuckTicks[i] > 25 && w.navWpCount[i] > 0) {
    clearPath(w, i);
  }
}
