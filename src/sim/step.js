// The simulation tick. state(n+1) = step(state(n), commands(n)).
//
// Order each tick:
//   1) apply commands (the only external input)
//   2) combat acquire + attacks
//   3) movement (path follow)
//   4) soft separation (standing units + light moving avoidance — never fights path follow)
//   5) advance the tick counter
//
// Determinism rules (enforced by discipline + the partition): no Date.now /
// performance.now in gameplay, no Math.random (rng.js only), no DOM / Babylon,
// all math in fixed-point via fixed.js.
// Exception: when world.profileSim is set, performance.now() fills metrics.timing
// only — never read back into decisions or checksum.

import * as fx from './fixed.js';
import { applyCommands } from './commands.js';
import { buildingProductionSystem } from './buildingProduction.js';
import { combatSystem } from './combat.js';
import { towerCombatSystem } from './towerCombat.js';
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
import { getUnitDef, UNIT_DEFS, UNIT, unitFootprint, unitSteer, unitAccel, unitDecel, unitSlowMul, isFlyer } from './unitTypes.js';
import { ORDER } from './world.js';
import { continueRallyHop } from './buildings.js';
import { worldToTile, isPassable, isSlowTile } from './field.js';
import { kothMetaStep } from './kothMeta.js';
import { agoraCaptureSystem } from './agora.js';
import { rebuildSpatialGrid, spatialCellId } from './spatialGrid.js';
import { projectileSystem } from './projectiles.js';
import { treeBurnSystem } from './trees.js';
import { fireZoneSystem } from './fireZones.js';
import { pendingLightningSystem } from './lightning.js';
import { pulseFireZoneBuildings } from './buildingCombat.js';
import { frogSystem } from './frogs.js';
import { flushMycoDeathBursts, sporeGrowthSystem } from './sporeBloom.js';
import { monkKickSystem, isLobbing } from './monkKick.js';
import {
  transportAutoLoadSystem,
  syncCarriedPositions,
  isCarried,
} from './transport.js';
import { repairSystem } from './repair.js';
import {
  gatherSystem,
  campAutoAssignSystem,
  refreshEngineerAssists,
  gatherDefenseSystem,
  gatherNodeNear,
  beginGather,
  isFarmStroll,
  FARM_STROLL_SPEED,
} from './gather.js';
import { constructionSystem, constructionAssignSystem } from './construction.js';
import { idleWanderSystem, isIdleWander, IDLE_WANDER_SPEED } from './idleWander.js';
import { tickCombatStatus, FROST_MOVE_MUL } from './combatStatus.js';

/** Extra slow while gawking at frogs (stacks with terrain slow). */
const DISTRACT_MOVE_MUL = fx.fromFloat(0.55);
// Soft personal space — enough that meshes don't occupy the same pixel,
// not a parade grid. Old code multiplied by an extra 2.5× factor, so idle
// post-combat piles kept drifting out to ~6+ (endless turning/inching).
//
// Dense arrivals can't satisfy full spacing for every pair; without slack the
// pack ripples forever. Push only past SEP_SLACK.
//
// Knob table (values + gather jitter / arrive disk): docs/unit-separation.md
const SEP_PUSH = fx.fromFloat(0.42);
/** Soft shoulder-check while pathing — weak so routes still win. */
const MOVE_AVOID_PUSH = fx.fromFloat(0.22);
/** Near-pixel glue mid-march — stronger shove without restoring idle parade radius. */
const MOVE_AVOID_HARD = fx.fromFloat(0.38);
/** dist2 below this fraction of minDist² counts as hard overlap. */
const MOVE_AVOID_HARD_FRAC = fx.fromFloat(0.36);
const SEP_MAX_STEP = fx.fromFloat(0.30);
/** Hard mid-march unstack can step a bit farther per tick than idle sep. */
const MOVE_AVOID_HARD_MAX = fx.fromFloat(0.40);
/** Idle deep-pile bloom — peel stacked arrivals fast; rim still uses SEP_SLACK. */
const SEP_BLOOM_PUSH = fx.fromFloat(0.50);
const SEP_BLOOM_MAX = fx.fromFloat(0.45);
const SEP_BLOOM_FRAC = fx.fromFloat(0.40);
/** Stop separating once within this of minDist — kills overpack wave chatter. */
const SEP_SLACK = fx.fromFloat(0.28);
/**
 * Per-type heading blend (0–1), accel, and decel (world units / tick).
 * Authored on defs via `steer` / `accel` / `decel`, else size-scaled defaults.
 */
const STEER_BY_TYPE = new Int32Array(UNIT_DEFS.length);
const ACCEL_BY_TYPE = new Int32Array(UNIT_DEFS.length);
const DECEL_BY_TYPE = new Int32Array(UNIT_DEFS.length);
for (let t = 0; t < UNIT_DEFS.length; t++) {
  STEER_BY_TYPE[t] = fx.fromFloat(unitSteer(t));
  ACCEL_BY_TYPE[t] = fx.fromFloat(unitAccel(t));
  DECEL_BY_TYPE[t] = fx.fromFloat(unitDecel(t));
}
/** Ignore leftover face below this when blending. */
const STEER_MIN_PREV = fx.fromFloat(0.02);
/**
 * Face·want below this ⇒ prioritize pivot (no full reverse rocket / orbit).
 * Still bleeds speed via decel instead of a hard zero.
 */
const TURN_PLACE_DOT = fx.fromFloat(0.57);
const GRID_SEP_THRESHOLD = 400;
// Visit every source cell over N deterministic ticks. Was 8 — dense arrivals
// rippled as a slow wave; 2 keeps cost bounded without the grotesque pulse.
const SEP_PHASES = 2;
const SEP_NEIGHBORS = [[0, 1], [1, -1], [1, 0], [1, 1]];
const SEP_TYPE_COUNT = UNIT_DEFS.length;
const SEP_MIN_DIST = new Int32Array(SEP_TYPE_COUNT * SEP_TYPE_COUNT);
const SEP_MIN_DIST_SQ = new Int32Array(SEP_TYPE_COUNT * SEP_TYPE_COUNT);
for (let a = 0; a < SEP_TYPE_COUNT; a++) {
  for (let b = 0; b < SEP_TYPE_COUNT; b++) {
    const key = a * SEP_TYPE_COUNT + b;
    // Footprints alone are size/6 (~1.25); floor is the main "how far apart" knob.
    const spacing = Math.max(2.9, unitFootprint(a) + unitFootprint(b));
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

  // Diagnostic only — never read timing back into gameplay / checksum.
  const profile = !!world.profileSim;
  const timing = profile ? {} : null;
  if (profile) world.metrics.timing = timing;
  else world.metrics.timing = null;
  const tAll = profile ? performance.now() : 0;

  const phase = (name, fn) => {
    if (!profile) {
      fn();
      return;
    }
    const t0 = performance.now();
    fn();
    timing[name] = performance.now() - t0;
  };

  phase('commands', () => applyCommands(world, field, commands));
  phase('buildings', () => buildingProductionSystem(world, field));
  phase('transport', () => transportAutoLoadSystem(world));
  phase('repair', () => repairSystem(world));
  phase('engineerAssist', () => refreshEngineerAssists(world));
  phase('autoGather', () => campAutoAssignSystem(world, field));
  phase('gatherDefense', () => gatherDefenseSystem(world, field));
  phase('gather', () => gatherSystem(world, field));
  phase('constructAssign', () => constructionAssignSystem(world, field));
  phase('construct', () => constructionSystem(world, field));
  phase('combat', () => combatSystem(world, field));
  phase('idleWander', () => idleWanderSystem(world, field));
  phase('lightning', () => pendingLightningSystem(world, field));
  phase('towers', () => towerCombatSystem(world));
  phase('projectiles', () => projectileSystem(world, field));
  phase('status', () => tickCombatStatus(world, field));
  phase('frogs', () => frogSystem(world, field));
  phase('monkKick', () => monkKickSystem(world, field));
  phase('trees', () => treeBurnSystem(field));
  phase('spore', () => sporeGrowthSystem(world, field));
  phase('koth', () => kothMetaStep(world));
  phase('agora', () => agoraCaptureSystem(world));
  phase('pathBudget', () => planPathBudget(world, field));
  phase('movement', () => movementSystem(world, field));
  phase('carried', () => syncCarriedPositions(world));
  phase('avoidance', () => movingAvoidanceSystem(world, field));
  phase('separation', () => separationSystem(world, field));
  // After movement so standing/walking through the patch uses current positions.
  phase('fireZones', () => {
    fireZoneSystem(world);
    pulseFireZoneBuildings(world, field);
  });
  // Late deaths (fire, etc.) after the spore phase still plant this tick.
  flushMycoDeathBursts(world, field);
  world.tick++;
  if (profile) timing.step = performance.now() - tAll;
}

function movementSystem(w, field) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    // Riders are glued to their transport in syncCarriedPositions.
    if (isCarried(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    // Mid-air from a monk stick-bonk — flight owns position this tick.
    if (isLobbing(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    const order = w.order[i];
    if (order === ORDER.IDLE) {
      // Bleed leftover momentum (blimps etc.) — never hard-zero a floaty coast.
      coastBrake(w, field, i);
      continue;
    }

    // In attack range — hold and strike; combat cleared the path.
    if (order === ORDER.ATTACK && attackInRange(w, i)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    // Engineer holding repair range — repairSystem owns cadence.
    if (order === ORDER.REPAIR) {
      // Still allow movement toward target when out of range (path active).
      if (w.navWpCount[i] === 0 && !w.pathRequest[i]) {
        w.vx[i] = 0;
        w.vy[i] = 0;
        continue;
      }
    }

    // Villager holding at a node / drop-off — gatherSystem owns cadence.
    if (order === ORDER.GATHER) {
      if (w.navWpCount[i] === 0 && !w.pathRequest[i]) {
        w.vx[i] = 0;
        w.vy[i] = 0;
        continue;
      }
    }

    // Builder holding at a construction site — constructionSystem owns cadence.
    if (order === ORDER.BUILD) {
      if (w.navWpCount[i] === 0 && !w.pathRequest[i]) {
        w.vx[i] = 0;
        w.vy[i] = 0;
        continue;
      }
    }

    // Final destination reached — settle the order (v1 arrivalRadius).
    if (
      (order === ORDER.MOVE || order === ORDER.WANDER || order === ORDER.ATTACK_MOVE) &&
      w.hasTarget[i] &&
      atFinalDest(w, i)
    ) {
      // Attack-moved a villager onto a resource? Put it to work — defensively, so
      // it fends off anything that wanders in and then goes back to the node.
      if (continueRallyHop(w, field, i)) continue;
      if (
        order === ORDER.ATTACK_MOVE &&
        w.type[i] === UNIT.VILLAGER &&
        tryBeginArrivalGather(w, field, i)
      ) {
        continue;
      }
      finishMove(w, i);
      continue;
    }

    let goal = movementGoal(w, field, i);
    if (!goal) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    checkStuck(w, field, i);
    // Stuck may have cleared the path for A* — keep sliding toward dest, or
    // refresh the active waypoint if one remains.
    if (w.navWpCount[i] > 0) {
      const base = wpBase(i) + w.navWpIndex[i];
      goal = { x: w.navWx[base], y: w.navWy[base] };
    } else if (w.pathRequest[i]) {
      goal = { x: w.navDestX[i], y: w.navDestY[i] };
    }

    if (waypointReached(w, i)) {
      if (advanceWaypoint(w, i)) {
        const base = wpBase(i) + w.navWpIndex[i];
        goal = { x: w.navWx[base], y: w.navWy[base] };
      } else {
        // Path exhausted — repath or seek final dest (do not go IDLE early).
        onPathExhausted(w, field, i);
        if (atFinalDest(w, i)) {
          if (continueRallyHop(w, field, i)) continue;
          if (
            order === ORDER.ATTACK_MOVE &&
            w.type[i] === UNIT.VILLAGER &&
            tryBeginArrivalGather(w, field, i)
          ) {
            continue;
          }
          finishMove(w, i);
          continue;
        }
        if (w.navWpCount[i] === 0) {
          // Gave up after max repaths — stop cleanly.
          if (w.repathCount[i] >= MAX_REPATHS && w.pathRequest[i] === 0) {
            if (continueRallyHop(w, field, i)) continue;
            if (
              order === ORDER.ATTACK_MOVE &&
              w.type[i] === UNIT.VILLAGER &&
              tryBeginArrivalGather(w, field, i)
            ) {
              continue;
            }
            finishMove(w, i);
            continue;
          }
          // Repath pending — keep sliding toward dest (no hard stop / stutter).
          if (w.pathRequest[i]) {
            goal = { x: w.navDestX[i], y: w.navDestY[i] };
          } else {
            w.vx[i] = 0;
            w.vy[i] = 0;
            continue;
          }
        } else {
          const base = wpBase(i) + w.navWpIndex[i];
          goal = { x: w.navWx[base], y: w.navWy[base] };
        }
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
    let speed = w.speed[i];
    // Trees / mud only snag ground units.
    if (!isFlyer(w.type[i]) && isSlowTile(field, currentTx, currentTz)) {
      speed = fx.mul(speed, unitSlowMul(w.type[i]));
    }
    if (w.distractCd[i] > 0) speed = fx.mul(speed, DISTRACT_MOVE_MUL);
    if (w.frostTicks?.[i] > 0) speed = fx.mul(speed, FROST_MOVE_MUL);
    if (isFarmStroll(w, field, i) && speed > FARM_STROLL_SPEED) speed = FARM_STROLL_SPEED;
    if (isIdleWander(w, i) && speed > IDLE_WANDER_SPEED) speed = IDLE_WANDER_SPEED;

    const typeId = w.type[i];
    const wantX = fx.div(dx, dist);
    const wantY = fx.div(dy, dist);

    // Ease facing toward the goal; gate translation on alignment.
    let dirX = wantX;
    let dirY = wantY;
    let align = fx.ONE;
    if (w.faceX && w.faceY) {
      const fLen = fx.len(w.faceX[i], w.faceY[i]);
      if (fLen > STEER_MIN_PREV) {
        const fx0 = fx.div(w.faceX[i], fLen);
        const fy0 = fx.div(w.faceY[i], fLen);
        align = fx.mul(fx0, wantX) + fx.mul(fy0, wantY);
        // Aim blend target: if >90° off, steer via a perpendicular first so
        // linear blend never collapses through zero on reverse orders.
        let aimX = wantX;
        let aimY = wantY;
        if (align < 0) {
          // Perp of face; pick the side closer to want (stable tie → +perp).
          let px = -fy0;
          let py = fx0;
          if (fx.mul(px, wantX) + fx.mul(py, wantY) < 0) {
            px = -px;
            py = -py;
          }
          aimX = px;
          aimY = py;
        }
        const blend = STEER_BY_TYPE[typeId] ?? STEER_BY_TYPE[0];
        const keep = fx.ONE - blend;
        let sx = fx.mul(keep, fx0) + fx.mul(blend, aimX);
        let sy = fx.mul(keep, fy0) + fx.mul(blend, aimY);
        const sLen = fx.len(sx, sy);
        if (sLen > 0) {
          dirX = fx.div(sx, sLen);
          dirY = fx.div(sy, sLen);
        }
      }
      w.faceX[i] = dirX;
      w.faceY[i] = dirY;
    }

    // Ground vehicles: pivot + coast when badly aimed (no reverse rocket).
    // Flyers: never lock — keep drifting on the steered nose (wide floaty arcs).
    // Old flyer lock coasted on *old* vx while face turned, then snapped.
    if (!isFlyer(typeId) && align < TURN_PLACE_DOT) {
      coastBrake(w, field, i);
      continue;
    }

    let targetSpeed;
    if (isFlyer(typeId)) {
      // align −1..1 → 0..1; floor so a 180° order still banks instead of stalling.
      // (Fixed add is plain + — there is no fx.add.)
      let alignSpeed = fx.mul(align + fx.ONE, fx.HALF);
      if (alignSpeed < fx.fromFloat(0.30)) alignSpeed = fx.fromFloat(0.30);
      targetSpeed = fx.mul(speed, alignSpeed);
    } else {
      // Alignment gates top speed (1 at aligned, 0 at TURN_PLACE_DOT).
      const alignSpan = fx.ONE - TURN_PLACE_DOT;
      const alignT = alignSpan > 0 ? fx.div(align - TURN_PLACE_DOT, alignSpan) : fx.ONE;
      targetSpeed = fx.mul(speed, alignT);
    }

    const accel = ACCEL_BY_TYPE[typeId] ?? ACCEL_BY_TYPE[0];
    const decel = DECEL_BY_TYPE[typeId] ?? DECEL_BY_TYPE[0];

    // Final-approach only: v_max ≈ √(2 a d). The old dist×0.4 cap slammed
    // heavies for half a straight cruise. Intermediate waypoints stay full speed.
    const onFinalLeg =
      w.navWpCount[i] === 0 || w.navWpIndex[i] + 1 >= w.navWpCount[i];
    if (onFinalLeg) {
      const stopCap = fx.sqrt(fx.mul(fx.mul(fx.fromFloat(2), decel), dist));
      if (stopCap < targetSpeed) targetSpeed = stopCap;
    }
    if (dist < targetSpeed) targetSpeed = dist;

    const pLen = fx.len(w.vx[i], w.vy[i]);
    let stepSpeed = targetSpeed;
    if (pLen + accel < targetSpeed) stepSpeed = pLen + accel;
    else if (pLen > targetSpeed + decel) stepSpeed = pLen - decel;

    const mx = fx.mul(dirX, stepSpeed);
    const my = fx.mul(dirY, stepSpeed);
    applyMoveWithSlide(w, field, i, mx, my);
  }
}

/**
 * A villager that attack-moved onto (or beside) a node starts gathering it in
 * defensive mode. Returns true when a gather was started. Kept here so the two
 * arrival sites share one policy.
 */
function tryBeginArrivalGather(w, field, i) {
  if (!field || (w.carriedAmt[i] | 0) > 0) return false; // don't ditch a haul
  const tile = gatherNodeNear(field, w.px[i], w.py[i]);
  if (tile < 0) return false;
  return beginGather(w, field, i, tile, 1);
}

function finishMove(w, i) {
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = 0;
  // Keep vx/vy — IDLE coastBrake bleeds them. Hard-zero felt like a dime stop
  // on dirigibles after an otherwise soft approach.
  w.hasTarget[i] = 0;
  // IDLE still auto-acquires; keeps render facing from treating sep nudges as walks.
  w.order[i] = ORDER.IDLE;
}

/** Bleed speed along current velocity (IDLE arrive coast / turn-in-place). */
function coastBrake(w, field, i) {
  const pLen = fx.len(w.vx[i], w.vy[i]);
  if (pLen === 0) return;
  const typeId = w.type[i];
  const decel = DECEL_BY_TYPE[typeId] ?? DECEL_BY_TYPE[0];
  if (pLen <= decel) {
    w.vx[i] = 0;
    w.vy[i] = 0;
    return;
  }
  const next = pLen - decel;
  const mx = fx.mul(fx.div(w.vx[i], pLen), next);
  const my = fx.mul(fx.div(w.vy[i], pLen), next);
  applyMoveWithSlide(w, field, i, mx, my);
}

/** Axis-by-axis wall slide — enter blocked tiles only when escaping them. */
function applyMoveWithSlide(w, field, i, mx, my) {
  const oldX = w.px[i];
  const oldY = w.py[i];
  const newX = oldX + mx;
  const newY = oldY + my;

  // Air units ignore ground impassability.
  if (isFlyer(w.type[i])) {
    w.px[i] = newX;
    w.py[i] = newY;
    w.vx[i] = mx;
    w.vy[i] = my;
    return;
  }

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
  if (isCarried(w, i)) return false;
  return w.vx[i] !== 0 || w.vy[i] !== 0;
}

/** Same-owner crowding candidate — movers and standers both count. */
function isAvoidanceUnit(w, i) {
  if (!w.alive[i] || isCarried(w, i) || isLobbing(w, i)) return false;
  return true;
}

function movingAvoidanceSystem(w, field) {
  if (w.count < GRID_SEP_THRESHOLD) {
    for (let i = 0; i < w.count; i++) {
      if (!isAvoidanceUnit(w, i)) continue;
      for (let j = i + 1; j < w.count; j++) {
        if (!isAvoidanceUnit(w, j) || w.owner[i] !== w.owner[j]) continue;
        // Need at least one mover — pure standers are separationSystem's job.
        if (!isMovingUnit(w, i) && !isMovingUnit(w, j)) continue;
        w.metrics.movingAvoidancePairs++;
        applyMovingAvoidance(w, field, i, j);
      }
    }
    return;
  }

  const grid = w.spatial;
  rebuildSpatialGrid(grid, w, isAvoidanceUnit, false);
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      const cell = spatialCellId(x, z, grid);
      if (cell % SEP_PHASES !== w.tick % SEP_PHASES) continue;
      for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
        for (let j = grid.next[i]; j >= 0; j = grid.next[j]) {
          if (w.owner[i] !== w.owner[j]) continue;
          if (!isMovingUnit(w, i) && !isMovingUnit(w, j)) continue;
          w.metrics.movingAvoidancePairs++;
          applyMovingAvoidance(w, field, i, j);
        }
      }
      for (let n = 0; n < SEP_NEIGHBORS.length; n++) {
        const nx = x + SEP_NEIGHBORS[n][0];
        const nz = z + SEP_NEIGHBORS[n][1];
        if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
        const other = spatialCellId(nx, nz, grid);
        for (let i = grid.head[cell]; i >= 0; i = grid.next[i]) {
          for (let j = grid.head[other]; j >= 0; j = grid.next[j]) {
            if (w.owner[i] !== w.owner[j]) continue;
            if (!isMovingUnit(w, i) && !isMovingUnit(w, j)) continue;
            w.metrics.movingAvoidancePairs++;
            applyMovingAvoidance(w, field, i, j);
          }
        }
      }
    }
  }
}

function applyMovingAvoidance(w, field, i, j) {
  if (!sameSepLayer(w, i, j)) return;
  const typePair = w.type[i] * SEP_TYPE_COUNT + w.type[j];
  const dx = w.px[j] - w.px[i];
  const dy = w.py[j] - w.py[i];
  const dist2 = fx.mul(dx, dx) + fx.mul(dy, dy);
  const hardLimit = fx.mul(SEP_MIN_DIST_SQ[typePair], MOVE_AVOID_HARD_FRAC);
  // Deep overlap: ignore slack so glued marchers actually peel apart.
  // Mild packing keeps slack so path follow still owns the route.
  if (dist2 < hardLimit) {
    applyPairPush(w, field, i, j, MOVE_AVOID_HARD, false, 0, MOVE_AVOID_HARD_MAX);
  } else {
    applyPairPush(w, field, i, j, MOVE_AVOID_PUSH, false);
  }
}

// Soft separation for units that aren't pathing — never fights an active route.
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
      const cell = spatialCellId(x, z, grid);
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
      const cell = spatialCellId(x, z, grid);
      if (cell % SEP_PHASES !== w.tick % SEP_PHASES) continue;
      if (grid.head[cell] < 0) continue;
      for (let n = 0; n < SEP_NEIGHBORS.length; n++) {
        const nx = x + SEP_NEIGHBORS[n][0];
        const nz = z + SEP_NEIGHBORS[n][1];
        if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
        const other = spatialCellId(nx, nz, grid);
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

/**
 * Soft personal space while standing. Path follow owns position while navigating
 * (nav waypoints or pending plan) — right-click ATTACK_MOVE holders used to stay
 * stacked forever because this required ORDER.IDLE.
 */
function canSeparate(w, i) {
  if (!w.alive[i] || isCarried(w, i) || isLobbing(w, i)) return false;
  if (w.navWpCount[i] > 0 || w.pathRequest[i]) return false;
  return true;
}

/** Air and ground don't shove each other — dirigibles aren't in the infantry pile. */
function sameSepLayer(w, i, j) {
  return isFlyer(w.type[i]) === isFlyer(w.type[j]);
}

function applySeparation(w, field, i, j) {
  // Small-count pairwise path does not prefilter; keep this guard authoritative.
  if (!canSeparate(w, i) || !canSeparate(w, j)) return;
  if (!sameSepLayer(w, i, j)) return;
  const typePair = w.type[i] * SEP_TYPE_COUNT + w.type[j];
  const dx = w.px[j] - w.px[i];
  const dy = w.py[j] - w.py[i];
  const dist2 = fx.mul(dx, dx) + fx.mul(dy, dy);
  const bloomLimit = fx.mul(SEP_MIN_DIST_SQ[typePair], SEP_BLOOM_FRAC);
  // Deep pile: ignore slack and shove harder so arrivals don't wave-pulse out.
  if (dist2 < bloomLimit) {
    applyPairPush(w, field, i, j, SEP_BLOOM_PUSH, false, 0, SEP_BLOOM_MAX);
  } else {
    applyPairPush(w, field, i, j, SEP_PUSH, false);
  }
}

/**
 * Soft radial push. Slack deadzone so near-spaced units stay put; exact stacks
 * still break. `asymmetric` moves only the higher id (stable). Optional
 * `slack`/`maxStep` let mid-march hard-unstack ignore the idle deadzone.
 */
function applyPairPush(w, field, i, j, strength, asymmetric, slack = SEP_SLACK, maxStep = SEP_MAX_STEP) {
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
  } else if (fx.abs(dy) < fx.fromFloat(0.08) && dist2 < SEP_MIN_DIST_SQ[typePair]) {
    // March columns are nearly collinear — add a stable lateral bias so the
    // pack can bloom into 2D instead of accordioning on one axis.
    dy = ((i * 31 + j * 17) & 1) ? fx.ONE : -fx.ONE;
    dist2 = fx.mul(dx, dx) + fx.mul(dy, dy);
  }
  const dist = fx.sqrt(dist2);
  const overlap = minDist - dist;
  if (overlap <= slack) return;
  // Only the hard overlap past slack — linear so stacks break, tiny near the edge.
  const hard = overlap - slack;
  let mag = fx.mul(strength, hard);
  if (mag > maxStep) mag = maxStep;
  // Unit direction i→j; displacement along that axis.
  const ux = fx.div(dx, dist);
  const uy = fx.div(dy, dist);
  if (asymmetric) {
    // Higher id yields — same relative close-rate as mutual ±mag/2 each.
    const step = mag;
    if (i > j) {
      w.px[i] -= fx.mul(ux, step);
      w.py[i] -= fx.mul(uy, step);
      revertIfBlocked(w, field, i, fx.mul(ux, step), fx.mul(uy, step));
    } else {
      w.px[j] += fx.mul(ux, step);
      w.py[j] += fx.mul(uy, step);
      revertIfBlocked(w, field, j, fx.mul(-ux, step), fx.mul(-uy, step));
    }
    return;
  }
  const px = fx.mul(ux, mag);
  const py = fx.mul(uy, mag);
  w.px[i] -= px;
  w.py[i] -= py;
  w.px[j] += px;
  w.py[j] += py;
  revertIfBlocked(w, field, i, px, py);
  revertIfBlocked(w, field, j, -px, -py);
}

function revertIfBlocked(w, field, i, undoX, undoY) {
  if (isFlyer(w.type[i])) return;
  if (!isPassable(field, worldToTile(w.px[i]), worldToTile(w.py[i]))) {
    w.px[i] += undoX;
    w.py[i] += undoY;
  }
}

function isAttackPair(w, i, j) {
  if (w.order[i] === ORDER.ATTACK && w.targetEntity[i] === j) return true;
  if (w.order[j] === ORDER.ATTACK && w.targetEntity[j] === i) return true;
  return false;
}
