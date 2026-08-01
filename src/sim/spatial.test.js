import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { ACQUIRE_PHASES, acquireTargets } from './combat.js';
import { createField } from './field.js';
import {
  ASTAR_PATH_BUDGET,
  LOS_PATH_BUDGET,
  PATH_REQUEST,
  planPathBudget,
  queuePath,
} from './path.js';
import { rebuildSpatialGrid } from './spatialGrid.js';
import { isHostile } from './teams.js';
import { WORLD_HALF_F } from './field.js';
import { getUnitDef, UNIT } from './unitTypes.js';
import { createWorld, MAX_ENTITIES, ORDER, spawn } from './world.js';

const LOAD_SPREAD = fx.mul(fx.fromInt(10), fx.fromInt(10));

function expectedTargets(w) {
  const expected = new Int32Array(w.count);
  expected.fill(-1);
  const load = new Uint16Array(w.count);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (i % ACQUIRE_PHASES !== w.tick % ACQUIRE_PHASES) continue;
    const def = getUnitDef(w.type[i]);
    if (def.category !== 'military' || def.aggroRange === 0) continue;
    const aggro2 = fx.mul(def.aggroRange, def.aggroRange);
    let best = -1;
    let bestScore = 0x7fffffff;
    for (let j = 0; j < w.count; j++) {
      if (i === j || !w.alive[j] || !isHostile(w.owner[i], w.owner[j])) continue;
      const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
      if (d2 > aggro2) continue;
      const score = d2 + load[j] * LOAD_SPREAD;
      if (score < bestScore || (score === bestScore && (best < 0 || j < best))) {
        best = j;
        bestScore = score;
      }
    }
    expected[i] = best;
    if (best >= 0) load[best]++;
  }
  return expected;
}

function combatSpatialMatchesBrute() {
  const w = createWorld(0x51a7);
  let s = 0x12345678;
  const random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  for (let i = 0; i < 256; i++) {
    spawn(w, {
      x: fx.fromInt((random() % 799) - 399),
      y: fx.fromInt((random() % 799) - 399),
      type: UNIT.WARRIOR + (i % 2),
      owner: i & 1,
    });
  }
  for (let i = 3; i < w.count; i++) {
    w.px[i] = fx.fromInt(200 + (i % 50) * 2);
    w.py[i] = fx.fromInt(200 + ((i / 50) | 0) * 2);
  }
  // Equal-distance tie and exact field boundaries.
  w.px[0] = fx.fromInt(0);
  w.py[0] = fx.fromInt(0);
  w.owner[0] = 0;
  w.px[1] = fx.fromInt(-4);
  w.py[1] = fx.fromInt(0);
  w.owner[1] = 1;
  w.px[2] = fx.fromInt(4);
  w.py[2] = fx.fromInt(0);
  w.owner[2] = 1;
  w.px[3] = fx.fromInt(-WORLD_HALF_F);
  w.py[3] = fx.fromInt(-WORLD_HALF_F);
  w.px[4] = fx.fromInt(WORLD_HALF_F);
  w.py[4] = fx.fromInt(WORLD_HALF_F);
  w.alive[5] = 0;

  const expected = expectedTargets(w);
  rebuildSpatialGrid(w.spatial, w);
  acquireTargets(w, createField(1));
  for (let i = 0; i < w.count; i++) {
    assert.equal(w.targetEntity[i], expected[i], `target mismatch for entity ${i}`);
  }
  assert.equal(w.targetEntity[0], 1, 'equal-distance targets must prefer the lower ID');
}

function capacityIsSafe() {
  const w = createWorld(1);
  w.count = 50000;
  w.targetEntity[49999] = 49998;
  assert.equal(w.targetEntity[49999], 49998);
  w.count = MAX_ENTITIES;
  assert.throws(() => spawn(w), /entity capacity exceeded/);
}

function configurePathRequests(w, count, request) {
  for (let i = 0; i < count; i++) {
    spawn(w, {
      x: fx.fromInt((i % 100) - 50),
      y: fx.fromInt(((i / 100) | 0) - 25),
      type: UNIT.VILLAGER,
    });
    w.order[i] = ORDER.MOVE;
    w.hasTarget[i] = 1;
    queuePath(w, i, w.px[i] + fx.fromInt(1), w.py[i]);
    w.pathRequest[i] = request;
  }
}

function pathBudgetsAreHardLimits() {
  const field = createField(2);
  field.pass.fill(1);
  const pinned = { losLimit: LOS_PATH_BUDGET, astarLimit: ASTAR_PATH_BUDGET };

  const los = createWorld(2);
  configurePathRequests(los, LOS_PATH_BUDGET + 904, PATH_REQUEST.LOS);
  planPathBudget(los, field, pinned);
  assert.equal(los.metrics.losAttempts, LOS_PATH_BUDGET);
  planPathBudget(los, field, pinned);
  assert.equal(los.metrics.losAttempts, LOS_PATH_BUDGET + 904);
  assert.equal(los.pathRequest.subarray(0, los.count).some((v) => v !== PATH_REQUEST.NONE), false);

  const astar = createWorld(3);
  configurePathRequests(astar, ASTAR_PATH_BUDGET + 4, PATH_REQUEST.ASTAR);
  planPathBudget(astar, field, pinned);
  assert.equal(astar.metrics.astarSearches, ASTAR_PATH_BUDGET);
  planPathBudget(astar, field, pinned);
  assert.equal(astar.metrics.astarSearches, ASTAR_PATH_BUDGET + 4);
}

combatSpatialMatchesBrute();
capacityIsSafe();
pathBudgetsAreHardLimits();
console.log('[PASS] spatial queries, capacity, and path budgets');
