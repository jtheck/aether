// The simulation tick. state(n+1) = step(state(n), commands(n)).
//
// Order each tick:
//   1) apply commands (the only external input)
//   2) combat acquire + attacks
//   3) movement (path follow + separation)
//   4) advance the tick counter
//
// Determinism rules (enforced by discipline + the partition): no Date.now /
// performance.now, no Math.random (rng.js only), no DOM / Babylon, all math in
// fixed-point via fixed.js.

import * as fx from './fixed.js';
import { applyCommands } from './commands.js';
import { combatSystem } from './combat.js';
import { movementGoal, advanceWaypoint, checkStuck, planPathBudget } from './path.js';
import { getUnitDef } from './unitTypes.js';
import { ORDER } from './world.js';
import { WORLD_HALF } from './field.js';

const ARRIVE = fx.fromFloat(1.5);
const SEP_RADIUS = fx.fromFloat(3.0);
const SEP_PUSH = fx.fromFloat(0.35);
const SEP_CELL = fx.fromFloat(8);
const GRID_SEP_THRESHOLD = 400;

function pathBudget(count) {
  return Math.min(512, Math.max(96, count >> 3));
}

export function step(world, field, commands) {
  applyCommands(world, field, commands);
  combatSystem(world, field);
  planPathBudget(world, field, pathBudget(world.count));
  movementSystem(world, field);
  if (world.count < GRID_SEP_THRESHOLD || (world.tick & 1) === 0) {
    separationSystem(world);
  }
  world.tick++;
}

function movementSystem(w, field) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    const order = w.order[i];
    if (order === ORDER.IDLE) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    // In attack range — combat system zeroed velocity; don't re-move.
    if (order === ORDER.ATTACK && w.targetEntity[i] >= 0 && w.alive[w.targetEntity[i]]) {
      const def = getUnitDef(w.type[i]);
      const range2 = fx.mul(def.attackRange, def.attackRange);
      const d2 = fx.dist2(w.px[i], w.py[i], w.px[w.targetEntity[i]], w.py[w.targetEntity[i]]);
      if (d2 <= range2) continue;
    }

    const goal = movementGoal(w, field, i);
    if (!goal) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    checkStuck(w, field, i);

    const dx = goal.x - w.px[i];
    const dy = goal.y - w.py[i];
    const dist = fx.len(dx, dy);
    const speed = w.speed[i];

    if (dist <= ARRIVE) {
      advanceWaypoint(w, i, ARRIVE);
      if (w.navWpIndex[i] >= w.navWpCount[i]) {
        w.vx[i] = 0;
        w.vy[i] = 0;
        if (order === ORDER.MOVE) {
          w.order[i] = ORDER.IDLE;
          w.hasTarget[i] = 0;
        }
        // ATTACK_MOVE keeps order — combat acquire may pick a target.
      }
      continue;
    }

    const mx = fx.mul(fx.div(dx, dist), speed);
    const my = fx.mul(fx.div(dy, dist), speed);
    w.px[i] += mx;
    w.py[i] += my;
    w.vx[i] = mx;
    w.vy[i] = my;
  }
}

// Light separation so formations don't pile onto one pixel.
function separationSystem(w) {
  if (w.count >= GRID_SEP_THRESHOLD) {
    gridSeparation(w);
    return;
  }
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    for (let j = i + 1; j < w.count; j++) {
      if (!w.alive[j]) continue;
      if (isAttackPair(w, i, j)) continue;
      applySeparation(w, i, j);
    }
  }
}

function gridSeparation(w) {
  const buckets = new Map();
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    const key = sepCellKey(w.px[i], w.py[i]);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(i);
  }
  for (const bucket of buckets.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a];
        const j = bucket[b];
        if (isAttackPair(w, i, j)) continue;
        applySeparation(w, i, j);
      }
    }
  }
  // Neighbouring cells — units near cell edges still repel.
  for (const [key, bucket] of buckets) {
    const cx = (key >> 10) - 512;
    const cz = (key & 0x3ff) - 512;
    for (const [ox, oz] of [[0, 1], [1, -1], [1, 0], [1, 1]]) {
      const other = buckets.get(((cx + ox + 512) & 0x3ff) << 10 | ((cz + oz + 512) & 0x3ff));
      if (!other) continue;
      for (let a = 0; a < bucket.length; a++) {
        for (let b = 0; b < other.length; b++) {
          const i = bucket[a];
          const j = other[b];
          if (isAttackPair(w, i, j)) continue;
          applySeparation(w, i, j);
        }
      }
    }
  }
}

function sepCellKey(px, py) {
  const cx = fx.toInt(fx.div(px + WORLD_HALF, SEP_CELL));
  const cz = fx.toInt(fx.div(py + WORLD_HALF, SEP_CELL));
  return ((cx + 512) & 0x3ff) << 10 | ((cz + 512) & 0x3ff);
}

function applySeparation(w, i, j) {
  const dx = w.px[j] - w.px[i];
  const dy = w.py[j] - w.py[i];
  const dist = fx.len(dx, dy);
  const minDist = fx.mul(SEP_RADIUS, fx.fromFloat(getUnitDef(w.type[i]).size / 6 + getUnitDef(w.type[j]).size / 6));
  if (dist === 0 || dist >= minDist) return;
  const push = fx.div(fx.mul(SEP_PUSH, minDist - dist), dist);
  const px = fx.mul(dx, push);
  const py = fx.mul(dy, push);
  w.px[i] -= px;
  w.py[i] -= py;
  w.px[j] += px;
  w.py[j] += py;
}

function isAttackPair(w, i, j) {
  if (w.order[i] === ORDER.ATTACK && w.targetEntity[i] === j) return true;
  if (w.order[j] === ORDER.ATTACK && w.targetEntity[j] === i) return true;
  return false;
}
