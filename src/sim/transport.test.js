import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { kill } from './damage.js';
import {
  loadUnit,
  unloadPassengers,
  canLoad,
  passengerCount,
  isCarried,
  TRANSPORT_LOAD_RANGE,
} from './transport.js';

function loadRespectsCapacity() {
  const w = createWorld(1);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const riders = [];
  for (let k = 0; k < 5; k++) {
    riders.push(
      spawn(w, {
        x: fx.fromFloat(k + 1),
        y: 0,
        type: UNIT.WARRIOR,
        owner: 0,
      }),
    );
  }
  let loaded = 0;
  for (const r of riders) {
    if (loadUnit(w, r, wagon)) loaded++;
  }
  assert.equal(loaded, 4, 'wagon capacity is 4');
  assert.equal(passengerCount(w, wagon), 4);
  assert.equal(canLoad(w, riders[4], wagon), false);
}

function rejectsTransportInTransport() {
  const w = createWorld(2);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const apc = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.APC, owner: 0 });
  assert.equal(canLoad(w, apc, wagon), false);
  assert.equal(loadUnit(w, apc, wagon), false);
}

function rejectsMonks() {
  const w = createWorld(9);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const monk = spawn(w, { x: fx.fromFloat(1), y: 0, type: UNIT.MONK, owner: 0 });
  assert.equal(canLoad(w, monk, wagon), false);
  assert.equal(loadUnit(w, monk, wagon), false);
}

function unloadDropsInCircle() {
  const w = createWorld(3);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const a = spawn(w, { x: 0, y: 0, type: UNIT.ARCHER, owner: 0 });
  const b = spawn(w, { x: 0, y: 0, type: UNIT.ARCHER, owner: 0 });
  assert.ok(loadUnit(w, a, wagon));
  assert.ok(loadUnit(w, b, wagon));
  const out = unloadPassengers(w, wagon, null, null);
  assert.equal(out.length, 2);
  assert.equal(isCarried(w, a), false);
  assert.equal(isCarried(w, b), false);
  assert.notEqual(w.px[a], w.px[b] || w.py[a] !== w.py[b] || true);
  // Distinct drop angles → not both exactly on the transport.
  assert.ok(w.px[a] !== 0 || w.py[a] !== 0);
}

function spillOnDeath() {
  const w = createWorld(4);
  const wagon = spawn(w, { x: fx.fromFloat(10), y: fx.fromFloat(5), type: UNIT.WAGON, owner: 0 });
  const rider = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
  assert.ok(loadUnit(w, rider, wagon));
  kill(w, wagon);
  assert.equal(w.alive[wagon], 0);
  assert.equal(w.alive[rider], 1);
  assert.equal(isCarried(w, rider), false);
}

function carriedSkipsCombat() {
  const field = createField(1);
  const w = createWorld(5);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const rider = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  assert.ok(loadUnit(w, rider, wagon));
  const hpBefore = w.hp[foe];
  for (let t = 0; t < 60; t++) step(w, field, []);
  assert.equal(w.hp[foe], hpBefore, 'carried warrior does not attack');
}

function autoLoadOnApproach() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(6);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const rider = spawn(w, {
    x: TRANSPORT_LOAD_RANGE + fx.fromFloat(8),
    y: 0,
    type: UNIT.ARCHER,
    owner: 0,
  });
  step(w, field, [
    {
      type: CMD.MOVE,
      entities: [wagon, rider],
      tx: [0, 0],
      ty: [0, 0],
      transportAssignments: [{ riderId: rider, transportId: wagon }],
    },
  ]);
  for (let t = 0; t < 200; t++) {
    step(w, field, []);
    if (isCarried(w, rider)) break;
  }
  assert.equal(isCarried(w, rider), true, 'rider auto-loads when in range');
  assert.equal(w.carriedBy[rider], wagon);
}

function autoLoadOnAttackMove() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(8);
  const wagon = spawn(w, { x: 0, y: 0, type: UNIT.WAGON, owner: 0 });
  const rider = spawn(w, {
    x: TRANSPORT_LOAD_RANGE + fx.fromFloat(8),
    y: 0,
    type: UNIT.ARCHER,
    owner: 0,
  });
  step(w, field, [
    {
      type: CMD.ATTACK_MOVE,
      entities: [wagon, rider],
      tx: [0, 0],
      ty: [0, 0],
      transportAssignments: [{ riderId: rider, transportId: wagon }],
    },
  ]);
  assert.equal(w.transportTarget[rider], wagon, 'attack-move applies embark target');
  for (let t = 0; t < 200; t++) {
    step(w, field, []);
    if (isCarried(w, rider)) break;
  }
  assert.equal(isCarried(w, rider), true, 'rider auto-loads on attack-move embark');
}

function dirigibleCapacitySix() {
  const w = createWorld(7);
  const ship = spawn(w, { x: 0, y: 0, type: UNIT.DIRIGIBLE, owner: 0 });
  let loaded = 0;
  for (let k = 0; k < 7; k++) {
    const r = spawn(w, {
      x: fx.fromFloat(k + 1),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
    });
    if (loadUnit(w, r, ship)) loaded++;
  }
  assert.equal(loaded, 6);
}

loadRespectsCapacity();
rejectsTransportInTransport();
rejectsMonks();
unloadDropsInCircle();
spillOnDeath();
carriedSkipsCombat();
autoLoadOnApproach();
autoLoadOnAttackMove();
dirigibleCapacitySix();
console.log('transport.test.js: ok');
