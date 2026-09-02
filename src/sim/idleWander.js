// Idle amble — leftover civilians / mycos pick a heading and walk (mycos
// weave through trees); engineers
// who have stood around long enough hop to another owned building. Work
// assignment (gather / construct / repair) runs first so a free hand can still
// get a job. Wander is a short MOVE that settles back to IDLE on arrival.

import * as fx from './fixed.js';
import { ORDER, clearAttackFocus } from './world.js';
import { UNIT } from './unitTypes.js';
import { queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { countTreesAlongLine, snapToPassable } from './field.js';
import { isCarried } from './transport.js';
import { isBuildingAlive } from './buildings.js';

/** Ticks between villager / myco amble attempts (~5s at 20 Hz). */
export const VILLAGER_WANDER_PERIOD = 100;
export const MYCO_WANDER_PERIOD = 100;
/** Engineers wait longer before leaving a post (~10s). */
export const ENGINEER_WANDER_PERIOD = 200;

export const VILLAGER_WANDER_MIN_F = 10;
export const VILLAGER_WANDER_MAX_F = 22;
/** Same trigger as villagers, much longer legs. */
export const MYCO_WANDER_MIN_F = 48;
export const MYCO_WANDER_MAX_F = 96;
/** Cap while ambling — a walk, not the gather/order run. */
export const IDLE_WANDER_SPEED = fx.fromFloat(0.56);
/** Stand-off when an engineer walks up to a building. */
const ENGINEER_LOITER_MIN_F = 8;
const ENGINEER_LOITER_MAX_F = 18;

const MIN_STEP_SQ = fx.mul(fx.fromFloat(4), fx.fromFloat(4));

const HEADINGS = [
  [1, 0], [2, 1], [1, 1], [1, 2],
  [0, 1], [-1, 2], [-1, 1], [-2, 1],
  [-1, 0], [-2, -1], [-1, -1], [-1, -2],
  [0, -1], [1, -2], [1, -1], [2, -1],
];

function hash2(a, b) {
  return (
    Math.imul((a + 1) | 0, 2654435761) ^
    Math.imul((b + 1) | 0, 1597334677)
  ) >>> 0;
}

function wanderDue(tick, i, period, salt) {
  return ((tick + Math.imul(i + 1, salt) + 17) % period) === 0;
}

function headingPoint(px, py, h, minF, maxF) {
  const span = (maxF - minF) | 0;
  const dist = minF + (h % (span + 1));
  const dir = HEADINGS[(h >>> 8) & 15];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  return {
    x: px + fx.fromFloat((dir[0] / len) * dist),
    y: py + fx.fromFloat((dir[1] / len) * dist),
  };
}

function snapDest(field, x, y) {
  const snapped = field ? snapToPassable(field, x, y) : null;
  return snapped ? { x: snapped.x, y: snapped.y } : { x, y };
}

function beginWanderMove(w, i, destX, destY, opts = null) {
  if (fx.dist2(w.px[i], w.py[i], destX, destY) <= MIN_STEP_SQ) return false;
  clearAttackFocus(w, i);
  clearEngagement(w, i);
  w.order[i] = ORDER.WANDER;
  w.hasTarget[i] = 1;
  w.tx[i] = destX;
  w.ty[i] = destY;
  w.transportTarget[i] = -1;
  queuePath(w, i, destX, destY, opts);
  return true;
}

function wanderHeading(w, field, i, minF, maxF, opts = null) {
  const raw = headingPoint(w.px[i], w.py[i], hash2(w.tick, i), minF, maxF);
  const dest = snapDest(field, raw.x, raw.y);
  return beginWanderMove(w, i, dest.x, dest.y, opts);
}

/** Same hop length as the hashed heading; pick the direction that crosses the most trees. */
function wanderMycoHeading(w, field, i) {
  const h = hash2(w.tick, i);
  const span = (MYCO_WANDER_MAX_F - MYCO_WANDER_MIN_F) | 0;
  const dist = MYCO_WANDER_MIN_F + (h % (span + 1));
  const preferred = (h >>> 8) & 15;
  let bestX = 0;
  let bestY = 0;
  let bestScore = -1;
  for (let k = 0; k < 16; k++) {
    const raw = headingAlong(w.px[i], w.py[i], k, dist);
    const dest = snapDest(field, raw.x, raw.y);
    const score = countTreesAlongLine(field, w.px[i], w.py[i], dest.x, dest.y);
    if (score > bestScore || (score === bestScore && k === preferred)) {
      bestScore = score;
      bestX = dest.x;
      bestY = dest.y;
    }
  }
  return beginWanderMove(w, i, bestX, bestY, { treeSeek: true });
}

function headingAlong(px, py, dirIndex, dist) {
  const dir = HEADINGS[dirIndex & 15];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  return {
    x: px + fx.fromFloat((dir[0] / len) * dist),
    y: py + fx.fromFloat((dir[1] / len) * dist),
  };
}

function pickEngineerBuilding(w, i) {
  const buildings = w.buildings;
  if (!buildings?.length) return -1;
  const owner = w.owner[i];
  let nearest = -1;
  let nearestD = 0x7fffffffffff;
  let n = 0;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if ((b.owner | 0) !== owner || !isBuildingAlive(b)) continue;
    n++;
    const d = fx.dist2(w.px[i], w.py[i], b.x, b.z);
    if (d < nearestD || (d === nearestD && (nearest < 0 || bi < nearest))) {
      nearestD = d;
      nearest = bi;
    }
  }
  if (n === 0) return -1;
  if (n === 1) return nearest;
  const h = hash2(w.tick, i);
  let skip = h % (n - 1);
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if ((b.owner | 0) !== owner || !isBuildingAlive(b) || bi === nearest) continue;
    if (skip === 0) return bi;
    skip--;
  }
  return nearest;
}

function wanderEngineer(w, field, i) {
  const bi = pickEngineerBuilding(w, i);
  if (bi < 0) return false;
  const b = w.buildings[bi];
  const raw = headingPoint(b.x, b.z, hash2(w.tick ^ 0x9e3779b9, i), ENGINEER_LOITER_MIN_F, ENGINEER_LOITER_MAX_F);
  const dest = snapDest(field, raw.x, raw.y);
  return beginWanderMove(w, i, dest.x, dest.y);
}

function canIdleWander(w, i) {
  if (!w.alive[i] || isCarried(w, i)) return false;
  if (w.order[i] !== ORDER.IDLE) return false;
  if ((w.distractCd?.[i] | 0) > 0) return false;
  if ((w.navWpCount[i] | 0) > 0 || (w.pathRequest[i] | 0) !== 0) return false;
  return true;
}

export function isIdleWander(w, i) {
  return w.order[i] === ORDER.WANDER;
}

/**
 * After work assign: leftover idle villagers / mycos / engineers take a walk.
 * @param {object} w
 * @param {object} field
 */
export function idleWanderSystem(w, field) {
  if (!field) return;
  for (let i = 0; i < w.count; i++) {
    if (!canIdleWander(w, i)) continue;
    const type = w.type[i];
    if (type === UNIT.VILLAGER) {
      if ((w.carriedAmt?.[i] | 0) > 0) continue;
      if (!wanderDue(w.tick, i, VILLAGER_WANDER_PERIOD, 13)) continue;
      wanderHeading(w, field, i, VILLAGER_WANDER_MIN_F, VILLAGER_WANDER_MAX_F);
      continue;
    }
    if (type === UNIT.MYCO) {
      if (!wanderDue(w.tick, i, MYCO_WANDER_PERIOD, 13)) continue;
      wanderMycoHeading(w, field, i);
      continue;
    }
    if (type === UNIT.ENGINEER) {
      if (!wanderDue(w.tick, i, ENGINEER_WANDER_PERIOD, 19)) continue;
      wanderEngineer(w, field, i);
    }
  }
}
