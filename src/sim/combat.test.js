import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { applyCommands, CMD } from './commands.js';
import { combatSystem } from './combat.js';
import { FROST_ATTACK_STEPS, FROST_ATTACK_WINDOW } from './combatStatus.js';
import { createField } from './field.js';
import { step } from './step.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { createWorld, spawn, ORDER } from './world.js';
import { applyDamage } from './damage.js';
import { chaseLeashRadius } from './leash.js';
import {
  applyStructureOccupancyAt,
  createBuilding,
  snapBuildingWorld,
} from './buildings.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function spawnLine(w, { attackerHp = 500, foeHp = 5000 } = {}) {
  const attacker = spawn(w, {
    x: fx.fromInt(0),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 0,
    hp: attackerHp,
  });
  const foeNear = spawn(w, {
    x: fx.fromInt(8),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 1,
    hp: foeHp,
  });
  const foeFar = spawn(w, {
    x: fx.fromInt(30),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 1,
    hp: foeHp,
  });
  return { attacker, foeNear, foeFar };
}

function runCombat(w, field, ticks) {
  for (let t = 0; t < ticks; t++) {
    combatSystem(w, field);
    w.tick++;
  }
}

describe('attack focus', () => {
  it('CMD.ATTACK keeps the clicked foe when a closer enemy is in aggro', () => {
    const w = createWorld(21);
    const field = openField();
    const { attacker, foeNear, foeFar } = spawnLine(w);
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [attacker], target: foeFar }]);
    assert.equal(w.targetEntity[attacker], foeFar);
    assert.equal(w.attackFocus[attacker], 1);
    for (let t = 0; t < 20; t++) step(w, field);
    assert.equal(w.targetEntity[attacker], foeFar, 'clicked target must not be stolen');
    assert.notEqual(w.targetEntity[attacker], foeNear);
  });

  it('idle hunt still acquires the nearest hostile', () => {
    const w = createWorld(22);
    const field = openField();
    const { attacker, foeNear } = spawnLine(w);
    runCombat(w, field, 8);
    assert.equal(w.order[attacker], ORDER.ATTACK);
    assert.equal(w.targetEntity[attacker], foeNear);
    assert.equal(w.attackFocus[attacker], 0);
  });

  it('attack-move still acquires the nearest hostile', () => {
    const w = createWorld(23);
    const field = openField();
    const { attacker, foeNear } = spawnLine(w);
    applyCommands(w, field, [
      { type: CMD.ATTACK_MOVE, entities: [attacker], tx: [fx.fromInt(40)], ty: [0] },
    ]);
    for (let t = 0; t < 12; t++) step(w, field);
    assert.equal(w.targetEntity[attacker], foeNear);
    assert.equal(w.attackFocus[attacker], 0);
  });

  it('auto-acquired ATTACK still rebalances onto a much nearer foe', () => {
    const w = createWorld(24);
    const field = openField();
    const { attacker, foeNear, foeFar } = spawnLine(w);
    w.order[attacker] = ORDER.ATTACK;
    w.targetEntity[attacker] = foeFar;
    runCombat(w, field, 8);
    assert.equal(w.targetEntity[attacker], foeNear);
  });

  it('CMD.ATTACK on a building is not stolen by a nearby unit', () => {
    const w = createWorld(25);
    const field = openField();
    const snapped = snapBuildingWorld('camp', fx.fromInt(24), 0);
    const b = createBuilding({
      owner: 1,
      type: 'camp',
      x: fx.toFloat(snapped.x),
      z: fx.toFloat(snapped.z),
    });
    b.built = 1;
    w.buildings.push(b);
    applyStructureOccupancyAt(field, b.type, b.x, b.z, true);
    const warrior = spawn(w, {
      x: fx.fromInt(0),
      y: fx.fromInt(0),
      type: UNIT.WARRIOR,
      owner: 0,
      hp: 500,
    });
    const foe = spawn(w, {
      x: fx.fromInt(8),
      y: fx.fromInt(0),
      type: UNIT.WARRIOR,
      owner: 1,
      hp: 5000,
    });
    applyCommands(w, field, [
      { type: CMD.ATTACK, entities: [warrior], target: -1, buildingIndex: 0 },
    ]);
    for (let t = 0; t < 16; t++) step(w, field);
    assert.equal(w.targetBuilding[warrior], 0);
    assert.equal(w.targetEntity[warrior], -1);
    assert.notEqual(w.targetEntity[warrior], foe);
  });
});

describe('chase leash', () => {
  it('rope is 2.5× aggro, with a short floor for units that only retaliate', () => {
    const warrior = chaseLeashRadius(getUnitDef(UNIT.WARRIOR));
    assert.equal(
      warrior,
      fx.div(fx.mul(fx.fromFloat(55), fx.fromInt(5)), fx.fromInt(2)),
    );
    assert.equal(chaseLeashRadius(getUnitDef(UNIT.APC)), fx.fromFloat(32));
  });

  function pushPastLeash(w, i) {
    const limit = chaseLeashRadius(getUnitDef(w.type[i]));
    w.px[i] = w.leashX[i] + limit + fx.fromInt(4);
    w.py[i] = w.leashY[i];
    w.vx[i] = 0;
    w.vy[i] = 0;
  }

  it('an idle chase walks home once the foe is out of reach past the rope', () => {
    const w = createWorld(31);
    const field = openField();
    const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp: 500 });
    const foe = spawn(w, { x: fx.fromInt(20), y: 0, type: UNIT.WARRIOR, owner: 1, hp: 5000 });
    for (let t = 0; t < 8 && w.order[warrior] !== ORDER.ATTACK; t++) step(w, field);
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.leashActive[warrior], 1);
    const homeX = w.leashX[warrior];
    const homeY = w.leashY[warrior];
    pushPastLeash(w, warrior);
    w.px[foe] = w.px[warrior] + fx.fromInt(20);
    w.py[foe] = w.py[warrior];
    step(w, field);
    assert.equal(w.order[warrior], ORDER.MOVE);
    assert.equal(w.tx[warrior], homeX);
    assert.equal(w.ty[warrior], homeY);
    assert.equal(w.leashDrop[warrior], foe);
    for (let t = 0; t < 12; t++) step(w, field);
    assert.notEqual(w.order[warrior], ORDER.ATTACK);
    assert.notEqual(w.targetEntity[warrior], foe);
  });

  it('keeps swinging past the rope while the foe is still in reach', () => {
    const w = createWorld(32);
    const field = openField();
    const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp: 500 });
    const foe = spawn(w, { x: fx.fromInt(20), y: 0, type: UNIT.WARRIOR, owner: 1, hp: 5000 });
    for (let t = 0; t < 8 && w.order[warrior] !== ORDER.ATTACK; t++) step(w, field);
    pushPastLeash(w, warrior);
    w.px[foe] = w.px[warrior] + fx.fromFloat(3);
    w.py[foe] = w.py[warrior];
    step(w, field);
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.targetEntity[warrior], foe);
    w.px[foe] = w.px[warrior] + fx.fromInt(20);
    step(w, field);
    assert.equal(w.order[warrior], ORDER.MOVE);
  });

  it('attack-move resumes the march and does not reacquire that foe', () => {
    const w = createWorld(33);
    const field = openField();
    const dest = fx.fromInt(220);
    const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp: 500 });
    const foe = spawn(w, { x: fx.fromInt(20), y: 0, type: UNIT.WARRIOR, owner: 1, hp: 5000 });
    applyCommands(w, field, [
      { type: CMD.ATTACK_MOVE, entities: [warrior], tx: [dest], ty: [0] },
    ]);
    for (let t = 0; t < 12 && w.order[warrior] !== ORDER.ATTACK; t++) step(w, field);
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.leashActive[warrior], 1);
    pushPastLeash(w, warrior);
    w.px[foe] = w.px[warrior] + fx.fromInt(20);
    w.py[foe] = 0;
    step(w, field);
    assert.equal(w.order[warrior], ORDER.ATTACK_MOVE);
    assert.equal(w.tx[warrior], dest);
    assert.equal(w.leashDrop[warrior], foe);
    for (let t = 0; t < 12; t++) step(w, field);
    assert.notEqual(w.targetEntity[warrior], foe);
    assert.notEqual(w.order[warrior], ORDER.MOVE);
  });

  it('a clicked attack is not roped', () => {
    const w = createWorld(34);
    const field = openField();
    const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp: 500 });
    const foe = spawn(w, { x: fx.fromInt(30), y: 0, type: UNIT.WARRIOR, owner: 1, hp: 5000 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [warrior], target: foe }]);
    assert.equal(w.attackFocus[warrior], 1);
    assert.equal(w.leashActive[warrior], 0);
    w.px[warrior] = fx.fromInt(180);
    w.px[foe] = fx.fromInt(210);
    for (let t = 0; t < 20; t++) step(w, field);
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.targetEntity[warrior], foe);
    assert.equal(w.leashActive[warrior], 0);
  });

  it('retaliation is roped from the spot where the hit landed', () => {
    const w = createWorld(35);
    const field = openField();
    const monk = spawn(w, { x: 0, y: 0, type: UNIT.MONK, owner: 0, hp: 70 });
    const foe = spawn(w, { x: fx.fromInt(6), y: 0, type: UNIT.WARRIOR, owner: 1, hp: 5000 });
    applyDamage(w, monk, 5, foe);
    assert.equal(w.order[monk], ORDER.ATTACK);
    assert.equal(w.targetEntity[monk], foe);
    assert.equal(w.leashActive[monk], 1);
    const homeX = w.leashX[monk];
    pushPastLeash(w, monk);
    w.px[foe] = w.px[monk] + fx.fromInt(20);
    step(w, field);
    assert.equal(w.order[monk], ORDER.MOVE);
    assert.equal(w.tx[monk], homeX);
    assert.equal(w.leashDrop[monk], foe);
  });
});

describe('frost attack slow', () => {
  it('recovers attack cooldown at the same 0.28 rate as movement', () => {
    const w = createWorld(36);
    const field = openField();
    const open = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const chilled = spawn(w, { x: fx.fromInt(6), y: 0, type: UNIT.WARRIOR, owner: 0 });
    w.attackCd[open] = 50;
    w.attackCd[chilled] = 50;
    w.frostTicks[chilled] = 200;
    runCombat(w, field, FROST_ATTACK_WINDOW);
    assert.equal(w.attackCd[open], 50 - FROST_ATTACK_WINDOW);
    assert.equal(w.attackCd[chilled], 50 - FROST_ATTACK_STEPS);
  });
});
