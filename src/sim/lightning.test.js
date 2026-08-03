import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField, TILE_SIZE_F, WORLD_HALF_F } from './field.js';
import { SCENERY } from './scenery.js';
import { TREE_WOOD_PER_STAGE } from './trees.js';
import { checksum } from './checksum.js';
import {
  LIGHTNING_COOLDOWN,
  LIGHTNING_HIT,
  LIGHTNING_IMPACT_SCATTER,
  LIGHTNING_STRIKE_RADIUS,
  takeLightningUpdates,
} from './lightning.js';
import { makeRng, rngRange } from './rng.js';

function fieldWithTree(tx = 50, tz = 50, stock = TREE_WOOD_PER_STAGE * 4) {
  const field = createField(1);
  const i = tz * field.width + tx;
  field.sceneryType[i] = SCENERY.TREE;
  field.slowMask[i] = 1;
  field.pass[i] = 1;
  field.treeStock[i] = stock;
  return { field, tx, tz, i };
}

function tileWorld(tx, tz) {
  return {
    x: fx.fromFloat((tx + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
    y: fx.fromFloat((tz + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
  };
}

function castStrikesRandomHostile() {
  const field = createField(1);
  const w = createWorld(40);
  const wizard = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WIZARD,
    owner: 0,
  });
  const foeA = spawn(w, {
    x: fx.fromInt(10),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const foeB = spawn(w, {
    x: fx.fromInt(12),
    y: fx.fromInt(2),
    type: UNIT.ARCHER,
    owner: 1,
  });
  const ally = spawn(w, {
    x: fx.fromInt(11),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const hpA = w.hp[foeA];
  const hpB = w.hp[foeB];
  const hpAlly = w.hp[ally];

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: fx.fromInt(11),
    ty: 0,
  }]);

  assert.ok(w.abilityCd[wizard] > 0);
  assert.equal(w.abilityCd[wizard], LIGHTNING_COOLDOWN - 1);
  assert.equal(w.hp[ally], hpAlly, 'allies are not struck');

  const hitA = w.hp[foeA] < hpA;
  const hitB = w.hp[foeB] < hpB;
  assert.ok(hitA !== hitB, 'exactly one hostile is struck');
  assert.ok(hitA || hitB, 'a hostile took damage');

  const fxPatch = takeLightningUpdates(w);
  assert.ok(fxPatch);
  assert.equal(fxPatch.count, 1);
  assert.equal(fxPatch.kind[0], LIGHTNING_HIT.UNIT);
}

function castIgnitesTreeWhenNoUnits() {
  const { field, i, tx, tz } = fieldWithTree(55, 55);
  const { x, y } = tileWorld(tx, tz);
  const w = createWorld(41);
  const wizard = spawn(w, {
    x: x - fx.fromInt(20),
    y,
    type: UNIT.WIZARD,
    owner: 0,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: x,
    ty: y,
  }]);

  assert.ok(field.treeBurn[i] > 0, 'tree is ignited');
  assert.ok(w.abilityCd[wizard] > 0);
  const fxPatch = takeLightningUpdates(w);
  assert.equal(fxPatch.kind[0], LIGHTNING_HIT.TREE);
}

function castGroundStrikeWhenEmpty() {
  const field = createField(1);
  const w = createWorld(42);
  const wizard = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WIZARD,
    owner: 0,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: fx.fromInt(40),
    ty: fx.fromInt(40),
  }]);

  assert.ok(w.abilityCd[wizard] > 0, 'empty ground still consumes cast');
  const fxPatch = takeLightningUpdates(w);
  assert.equal(fxPatch.kind[0], LIGHTNING_HIT.GROUND);
}

function cooldownBlocksRecast() {
  const field = createField(1);
  const w = createWorld(43);
  const wizard = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WIZARD,
    owner: 0,
  });
  spawn(w, {
    x: fx.fromInt(8),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: fx.fromInt(8),
    ty: 0,
  }]);
  takeLightningUpdates(w);
  const cd = w.abilityCd[wizard];
  assert.ok(cd > 0);

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: fx.fromInt(8),
    ty: 0,
  }]);
  assert.equal(takeLightningUpdates(w), null, 'recast while on CD publishes no FX');
  assert.equal(w.abilityCd[wizard], cd - 1);
}

function strikePickIsDeterministic() {
  function run(seed) {
    const field = createField(1);
    const w = createWorld(seed);
    spawn(w, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
    for (let n = 0; n < 5; n++) {
      spawn(w, {
        x: fx.fromInt(6 + n),
        y: fx.fromInt(n - 2),
        type: UNIT.ARCHER,
        owner: 1,
      });
    }
    step(w, field, [{
      type: CMD.CAST,
      entities: [0],
      tx: fx.fromInt(8),
      ty: 0,
    }]);
    const hps = [];
    for (let i = 1; i < w.count; i++) hps.push(w.hp[i]);
    return { checksum: checksum(w, field), hps, rng: w.rng.s };
  }

  const a = run(99);
  const b = run(99);
  assert.deepEqual(a.hps, b.hps);
  assert.equal(a.checksum, b.checksum);
  assert.equal(a.rng, b.rng);
}

function radiusConstantIsSane() {
  assert.ok(fx.toFloat(LIGHTNING_STRIKE_RADIUS) >= 20);
  assert.ok(fx.toFloat(LIGHTNING_STRIKE_RADIUS) <= 35);
  assert.ok(fx.toFloat(LIGHTNING_IMPACT_SCATTER) >= 6);
  assert.ok(fx.toFloat(LIGHTNING_IMPACT_SCATTER) <= 16);
  // Sanity: rngRange span for 3 candidates is [0,3).
  const r = makeRng(1);
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(rngRange(r, 0, 3));
  assert.ok(picks.has(0) && picks.has(1) && picks.has(2));
  assert.ok(!picks.has(3));
}

function impactIsScatteredOffTargetCenter() {
  const field = createField(1);
  const w = createWorld(77);
  const wizard = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WIZARD,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromInt(10),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [wizard],
    tx: fx.fromInt(10),
    ty: 0,
  }]);

  const fxPatch = takeLightningUpdates(w);
  assert.ok(fxPatch);
  const dx = fxPatch.x[0] - fx.toFloat(w.px[foe]);
  const dy = fxPatch.y[0] - fx.toFloat(w.py[foe]);
  const dist = Math.hypot(dx, dy);
  assert.ok(dist > 0.05, 'impact should not land exactly on unit center');
  assert.ok(dist <= fx.toFloat(LIGHTNING_IMPACT_SCATTER) * 1.45, 'scatter stays in band');
}

castStrikesRandomHostile();
castIgnitesTreeWhenNoUnits();
castGroundStrikeWhenEmpty();
cooldownBlocksRecast();
strikePickIsDeterministic();
radiusConstantIsSane();
impactIsScatteredOffTargetCenter();
console.log('lightning tests ok');
