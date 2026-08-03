import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { ORDER } from './world.js';
import { canRepairTarget, REPAIR_AMOUNT, REPAIR_INTERVAL } from './repair.js';

function engineerRepairsMechanical() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(10);
  const eng = spawn(w, { x: 0, y: 0, type: UNIT.ENGINEER, owner: 0 });
  const wagon = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WAGON,
    owner: 0,
    hp: 20,
  });
  assert.ok(canRepairTarget(w, eng, wagon));
  step(w, field, [{ type: CMD.ATTACK, entities: [eng], target: wagon }]);
  assert.equal(w.order[eng], ORDER.REPAIR);
  const before = w.hp[wagon];
  for (let t = 0; t < REPAIR_INTERVAL + 2; t++) step(w, field, []);
  assert.ok(w.hp[wagon] > before, 'wagon HP increases');
  assert.ok(w.hp[wagon] <= getUnitDef(UNIT.WAGON).hp);
}

function ignoresNonMechanical() {
  const w = createWorld(11);
  const eng = spawn(w, { x: 0, y: 0, type: UNIT.ENGINEER, owner: 0 });
  const warrior = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
    hp: 10,
  });
  assert.equal(canRepairTarget(w, eng, warrior), false);
}

function noAttackDamage() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(12);
  const eng = spawn(w, { x: 0, y: 0, type: UNIT.ENGINEER, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const hpBefore = w.hp[foe];
  step(w, field, [{ type: CMD.ATTACK, entities: [eng], target: foe }]);
  for (let t = 0; t < 80; t++) step(w, field, []);
  assert.equal(w.hp[foe], hpBefore, 'engineer deals no attack damage');
}

function autoSeeksDamagedNearby() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(13);
  spawn(w, { x: 0, y: 0, type: UNIT.ENGINEER, owner: 0 });
  const wagon = spawn(w, {
    x: fx.fromFloat(5),
    y: 0,
    type: UNIT.APC,
    owner: 0,
    hp: 30,
  });
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.ok(w.hp[wagon] > 30 || w.order[0] === ORDER.REPAIR);
  // Give it time to close and pulse.
  for (let t = 0; t < 120; t++) step(w, field, []);
  assert.ok(w.hp[wagon] >= 30 + REPAIR_AMOUNT, 'idle engineer eventually repairs');
}

engineerRepairsMechanical();
ignoresNonMechanical();
noAttackDamage();
autoSeeksDamagedNearby();
console.log('repair.test.js: ok');
