import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { checksum } from './checksum.js';
import { applyDamage } from './damage.js';
import {
  HOLY_ARMOR_COOLDOWN,
  HOLY_ARMOR_DURATION,
  HOLY_ARMOR_RADIUS,
  applyAreaHolyArmor,
  holyArmorShieldAmount,
  takeHolyArmorUpdates,
} from './holyArmor.js';

function castBuffsFriendliesInRadius() {
  const field = createField(1);
  const w = createWorld(50);
  const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
  const allyNear = spawn(w, {
    x: fx.fromInt(6),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const allyFar = spawn(w, {
    x: fx.fromInt(40),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromInt(4),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [priest],
    tx: fx.fromInt(100),
    ty: fx.fromInt(100),
  }]);

  const amount = holyArmorShieldAmount(UNIT.PRIEST);
  assert.ok(w.abilityCd[priest] > 0);
  assert.equal(w.abilityCd[priest], HOLY_ARMOR_COOLDOWN - 1);
  assert.equal(w.shieldHp[priest], amount, 'self included');
  assert.equal(w.shieldHp[allyNear], amount, 'nearby ally shielded');
  assert.equal(w.shieldHp[allyFar], 0, 'out of radius not shielded');
  assert.equal(w.shieldHp[foe], 0, 'hostiles not shielded');
  assert.equal(w.shieldTicks[priest], HOLY_ARMOR_DURATION - 1);

  const fxPatch = takeHolyArmorUpdates(w);
  assert.ok(fxPatch);
  assert.equal(fxPatch.count, 1);
  assert.ok(fxPatch.radius[0] > 0);
}

function shieldAbsorbsThenExpires() {
  const field = createField(1);
  const w = createWorld(51);
  const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
  step(w, field, [{
    type: CMD.CAST,
    entities: [priest],
    tx: 0,
    ty: 0,
  }]);
  takeHolyArmorUpdates(w);

  const amount = w.shieldHp[priest];
  const hpBefore = w.hp[priest];
  assert.ok(amount > 0);

  applyDamage(w, priest, amount - 1, -1);
  assert.equal(w.hp[priest], hpBefore, 'full absorb leaves HP untouched');
  assert.equal(w.shieldHp[priest], 1);

  applyDamage(w, priest, 5, -1);
  assert.equal(w.shieldHp[priest], 0, 'shield breaks');
  assert.equal(w.shieldTicks[priest], 0);
  assert.equal(w.hp[priest], hpBefore - 4, 'overflow damages HP');

  // Fresh shield, then wait out duration via idle steps.
  applyAreaHolyArmor(w, 0, 0, 0, {
    radius: HOLY_ARMOR_RADIUS,
    amount: 8,
    duration: 3,
  });
  assert.equal(w.shieldHp[priest], 8);
  step(w, field, []);
  step(w, field, []);
  step(w, field, []);
  assert.equal(w.shieldHp[priest], 0, 'duration expiry clears absorb');
  assert.equal(w.shieldTicks[priest], 0);
}

function castsAreDeterministic() {
  function run(seed) {
    const field = createField(1);
    const w = createWorld(seed);
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    spawn(w, { x: fx.fromInt(5), y: fx.fromInt(2), type: UNIT.ARCHER, owner: 0 });
    spawn(w, { x: fx.fromInt(3), y: fx.fromInt(-4), type: UNIT.WARRIOR, owner: 1 });
    for (let t = 0; t < 40; t++) {
      const cmds = t === 0
        ? [{ type: CMD.CAST, entities: [priest], tx: 0, ty: 0 }]
        : [];
      step(w, field, cmds);
    }
    takeHolyArmorUpdates(w);
    return checksum(w, field);
  }
  assert.equal(run(77), run(77));
}

function shieldScalesFromPriestDamage() {
  const expected = Math.max(8, Math.round(getUnitDef(UNIT.PRIEST).attackDamage * 1.8));
  assert.equal(holyArmorShieldAmount(UNIT.PRIEST), expected);
}

castBuffsFriendliesInRadius();
shieldAbsorbsThenExpires();
castsAreDeterministic();
shieldScalesFromPriestDamage();
console.log('holyArmor.test.js: ok');
