// The simulation tick. state(n+1) = step(state(n), commands(n)).
//
// Order each tick:
//   1) apply commands (the only external input)
//   2) combat acquire + attacks
//   3) movement (path follow)
//   4) light separation (idle/stacked only — never fights path follow)
//   5) advance the tick counter
//
// Determinism rules (enforced by discipline + the partition): no Date.now /
// performance.now, no Math.random (rng.js only), no DOM / Babylon, all math in
// fixed-point via fixed.js.

import * as fx from './fixed.js';
import { applyCommands } from './commands.js';
import { combatSystem } from './combat.js';
import {
  movementGoal,
  advanceWaypoint,
  checkStuck,
  planPathBudget,
  attackInRange,
  atFinalDest,
  waypointReached,
  onPathExhausted,
  wpBase,
  MAX_REPATHS,
} from './path.js';
import { getUnitDef, UNIT_DEFS } from './unitTypes.js';
import { ORDER } from './world.js';
import { worldToTile, isPassable, isSlowTile } from './field.js';
import { TREE_SLOW_MULTIPLIER } from './scenery.js';
import { kothMetaStep } from './kothMeta.js';
import { rebuildSpatialGrid, spatialCellId } from './spatialGrid.js';
import { projectileSystem } from './projectiles.js';
import { treeBurnSystem } from './trees.js';

// Soft personal space ≈ right-click formation spacing (2.5 for warriors).
// Old code multiplied by an extra 2.5× factor, so idle post-combat piles
// kept drifting out to ~6+ and looked like endless turning/inching.
const SEP_PUSH = fx.fromFloat(0.2);
const MOVE_AVOID_PUSH = fx.fromFloat(0.06);
const SEP_MAX_STEP = fx.fromFloat(0.25);
const GRID_SEP_THRESHOLD = 400;
// Visit every source cell over eight deterministic ticks to bound dense idle work.
const SEP_PHASES = 8;
const SEP_NEIGHBORS = [[0, 1], [1, -1], [1, 0], [1, 1]];
const SEP_TYPE_COUNT = UNIT_DEFS.length;
const SEP_MIN_DIST = new Int32Array(SEP_TYPE_COUNT * SEP_TYPE_COUNT);
const SEP_MIN_DIST_SQ = new Int32Array(SEP_TYPE_COUNT * SEP_TYPE_COUNT);
for (let a = 0; a < SEP_TYPE_COUNT; a++) {
  for (let b = 0; b < SEP_TYPE_COUNT; b++) {
    const key = a * SEP_TYPE_COUNT + b;
    const spacing = Math.max(2.0, UNIT_DEFS[a].size / 6 + UNIT_DEFS[b].size / 6);
    SEP_MIN_DIST[key] = fx.fromFloat(spacing);
    SEP_MIN_DIST_SQ[key] = fx.mul(SEP_MIN_DIST[key], SEP_MIN_DIST[key]);
  }
}

export function step(world, field, commands) {
  world.metrics.combatCandidates = 0;
  world.metrics.separationPairs = 0;
  world.metrics.movingAvoidancePairs = 0;
  world.metrics.losAttempts = 0;
  world.metrics.astarSearches = 0;
  world.metrics.projectileSpawned = 0;
  world.metrics.projectileHits = 0;
  world.metrics.projectileMisses = 0;
  world.metrics.projectileOverflow = 0;
  applyCommands(world, field, commands);
  combatSystem(world, field);
  projectileSystem(world, field);
  treeBurnSystem(field);
  kothMetaStep(world);
  planPathBudget(world, field);
  movementSystem(world, field);
  movingAvoidanceSystem(world, field);
  separationSystem(world, field);
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

    // In attack range — hold and strike; combat cleared the path.
    if (order === ORDER.ATTACK && attackInRange(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    // Final destination reached — settle the order (v1 arrivalRadius).
    if (
      (order === ORDER.MOVE || order === ORDER.ATTACK_MOVE) &&
      w.hasTarget[i] &&
      atFinalDest(w, i)
    ) {
      finishMove(w, i, order);
      continue;
    }

    let goal = movementGoal(w, field, i);
    if (!goal) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    checkStuck(w, field, i);
    // Stuck may have rebuilt the path — refresh goal.
    if (w.navWpCount[i] > 0) {
      const base = wpBase(i) + w.navWpIndex[i];
      goal = { x: w.navWx[base], y: w.navWy[base] };
    }

    if (waypointReached(w, i)) {
      if (advanceWaypoint(w, i)) {
        const base = wpBase(i) + w.navWpIndex[i];
        goal = { x: w.navWx[base], y: w.navWy[base] };
      } else {
        // Path exhausted — repath or seek final dest (do not go IDLE early).
        onPathExhausted(w, field, i);
        if (atFinalDest(w, i)) {
          finishMove(w, i, order);
          continue;
        }
        if (w.navWpCount[i] === 0) {
          // Gave up after max repaths, or A* found nothing — stop cleanly.
          if (w.repathCount[i] >= MAX_REPATHS) {
            finishMove(w, i, order);
          } else {
            w.vx[i] = 0;
            w.vy[i] = 0;
          }
          continue;
        }
        const base = wpBase(i) + w.navWpIndex[i];
        goal = { x: w.navWx[base], y: w.navWy[base] };
      }
    }

    const dx = goal.x - w.px[i];
    const dy = goal.y - w.py[i];
    const dist = fx.len(dx, dy);
    if (dist === 0) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    const currentTx = worldToTile(w.px[i]);
    const currentTz = worldToTile(w.py[i]);
    const speed = isSlowTile(field, currentTx, currentTz)
      ? fx.mul(w.speed[i], TREE_SLOW_MULTIPLIER)
      : w.speed[i];
    // Don't overshoot the goal in one tick (reduces orbit jitter).
    const stepDist = dist < speed ? dist : speed;
    const mx = fx.mul(fx.div(dx, dist), stepDist);
    const my = fx.mul(fx.div(dy, dist), stepDist);
    applyMoveWithSlide(w, field, i, mx, my);
  }
}

function finishMove(w, i, order) {
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = 0;
  w.vx[i] = 0;
  w.vy[i] = 0;
  if (order === ORDER.MOVE) {
    w.order[i] = ORDER.IDLE;
    w.hasTarget[i] = 0;
  }
  // ATTACK_MOVE keeps order — combat acquire may pick a target.
}

/** Axis-by-axis wall slide — enter blocked tiles only when escaping them. */
function applyMoveWithSlide(w, field, i, mx, my) {
  const oldX = w.px[i];
  const oldY = w.py[i];
  const newX = oldX + mx;
  const newY = oldY + my;

  const oldTx = worldToTile(oldX);
  const oldTz = worldToTile(oldY);
  const newTx = worldToTile(newX);
  const newTz = worldToTile(newY);

  const wasPassable = isPassable(field, oldTx, oldTz);
  const isNewPassable = isPassable(field, newTx, newTz);

  if (!wasPassable || isNewPassable) {
    w.px[i] = newX;
    w.py[i] = newY;
    w.vx[i] = mx;
    w.vy[i] = my;
    return;
  }

  const xOnlyPassable = isPassable(field, worldToTile(newX), oldTz);
  const yOnlyPassable = isPassable(field, oldTx, worldToTile(newY));

  if (!xOnlyPassable && !yOnlyPassable) {
    w.vx[i] = 0;
    w.vy[i] = 0;
    return;
  }
  if (!xOnlyPassable) {
    w.py[i] = newY;
    w.vx[i] = 0;
    w.vy[i] = my;
    return;
  }
  if (!yOnlyPassable) {
    w.px[i] = newX;
    w.vx[i] = mx;
    w.vy[i] = 0;
    return;
  }
  // Diagonal corner: drop the larger axis to hug the wall.
  if (fx.abs(mx) > fx.abs(my)) {
    w.py[i] = newY;
    w.vx[i] = 0;
    w.vy[i] = my;
  } else {
    w.px[i] = newX;
    w.vx[i] = mx;
    w.vy[i] = 0;
  }
}

function isMovingUnit(w, i) {
  return w.vx[i] !== 0 || w.vy[i] !== 0;
}

function movingAvoidanceSystem(w, field) {
  if (w.count < GRID_SEP_THRESHOLD) {
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || !isMovingUnit(w, i)) continue;
      for (let j = i + 1; j < w.count; j++) {
        if (!w.alive[j] || !isMovingUnit(w, j) || w.owner[i] !== w.owner[j]) continue;
        w.metrics.movingAvoidancePairs++;
        applyMovingAvoidance(w, field, i, j);
      }
    }
    return;
  }

  const grid = w.spatial;
  rebuildSpatialGrid(grid, w, isMovingUnit, false);
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      const cell = spatialCellId(x, z);
      if (cell % SEP_PHASES !== w.tick % SEP_PHASES) continue;
      for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
        for (let j = grid.next[i]; j >= 0; j = grid.next[j]) {
          if (w.owner[i] !== w.owner[j]) continue;
          w.metrics.movingAvoidancePairs++;
          applyMovingAvoidance(w, field, i, j);
        }
      }
      for (let n = 0; n < SEP_NEIGHBORS.length; n++) {
        const nx = x + SEP_NEIGHBORS[n][0];
        const nz = z + SEP_NEIGHBORS[n][1];
        if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
        const other = spatialCellId(nx, nz);
        for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
          for (let j = grid.head[other]; j >= 0; j = grid.next[j]) {
            if (w.owner[i] !== w.owner[j]) continue;
            w.metrics.movingAvoidancePairs++;
            applyMovingAvoidance(w, field, i, j);
          }
        }
      }
    }
  }
}

function applyMovingAvoidance(w, field, i, j) {
  applyPairPush(w, field, i, j, MOVE_AVOID_PUSH);
}

// Soft separation for idle units that somehow overlap — never while pathing.
function separationSystem(w, field) {
  if (w.count >= GRID_SEP_THRESHOLD) {
    gridSeparation(w, field);
    return;
  }
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    for (let j = i + 1; j < w.count; j++) {
      if (!w.alive[j]) continue;
      if (isAttackPair(w, i, j)) continue;
      applySeparation(w, field, i, j);
    }
  }
}

function gridSeparation(w, field) {
  const grid = w.spatial;
  rebuildSpatialGrid(grid, w, canSeparate, false);
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      const cell = spatialCellId(x, z);
      if (cell % SEP_PHASES !== w.tick % SEP_PHASES) continue;
      for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
        for (let j = grid.next[i]; j >= 0; j = grid.next[j]) {
          w.metrics.separationPairs++;
          if (isAttackPair(w, i, j)) continue;
          applySeparation(w, field, i, j);
        }
      }
    }
  }
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      const cell = spatialCellId(x, z);
      if (cell % SEP_PHASES !== w.tick % SEP_PHASES) continue;
      if (grid.head[cell] < 0) continue;
      for (let n = 0; n < SEP_NEIGHBORS.length; n++) {
        const nx = x + SEP_NEIGHBORS[n][0];
        const nz = z + SEP_NEIGHBORS[n][1];
        if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
        const other = spatialCellId(nx, nz);
        if (grid.head[other] < 0) continue;
        for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
          for (let j = grid.head[other]; j >= 0; j = grid.next[j]) {
            w.metrics.separationPairs++;
            if (isAttackPair(w, i, j)) continue;
            applySeparation(w, field, i, j);
          }
        }
      }
    }
  }
}

function canSeparate(w, i) {
  return (
    w.navWpCount[i] === 0 &&
    !w.hasTarget[i] &&
    w.order[i] === ORDER.IDLE
  );
}

function applySeparation(w, field, i, j) {
  // Small-count pairwise path does not prefilter; keep this guard authoritative.
  if (!canSeparate(w, i) || !canSeparate(w, j)) return;
  applyPairPush(w, field, i, j, SEP_PUSH);
}

/** Soft radial push; clamps near-zero 1/dist spikes and breaks exact overlaps. */
function applyPairPush(w, field, i, j, strength) {
  let dx = w.px[j] - w.px[i];
  let dy = w.py[j] - w.py[i];
  const typePair = w.type[i] * SEP_TYPE_COUNT + w.type[j];
  const minDist = SEP_MIN_DIST[typePair];
  let dist2 = fx.mul(dx, dx) + fx.mul(dy, dy);
  if (dist2 >= SEP_MIN_DIST_SQ[typePair]) return;
  if (dist2 === 0) {
    // Exact stacks used to be skipped forever; pick a stable unit axis from ids.
    const axis = (i * 31 + j * 17) & 3;
    if (axis === 0) { dx = fx.ONE; dy = 0; }
    else if (axis === 1) { dx = -fx.ONE; dy = 0; }
    else if (axis === 2) { dx = 0; dy = fx.ONE; }
    else { dx = 0; dy = -fx.ONE; }
    dist2 = fx.ONE;
  }
  const dist = fx.sqrt(dist2);
  let push = fx.div(fx.mul(strength, minDist - dist), dist);
  if (push > SEP_MAX_STEP) push = SEP_MAX_STEP;
  const px = fx.mul(dx, push);
  const py = fx.mul(dy, push);
  w.px[i] -= px;
  w.py[i] -= py;
  w.px[j] += px;
  w.py[j] += py;
  if (!isPassable(field, worldToTile(w.px[i]), worldToTile(w.py[i]))) {
    w.px[i] += px;
    w.py[i] += py;
  }
  if (!isPassable(field, worldToTile(w.px[j]), worldToTile(w.py[j]))) {
    w.px[j] -= px;
    w.py[j] -= py;
  }
}

function isAttackPair(w, i, j) {
  if (w.order[i] === ORDER.ATTACK && w.targetEntity[i] === j) return true;
  if (w.order[j] === ORDER.ATTACK && w.targetEntity[j] === i) return true;
  return false;
}
