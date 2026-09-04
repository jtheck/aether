import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { applyCommands, CMD } from './commands.js';
import { combatSystem } from './combat.js';
import { createField } from './field.js';
import { step } from './step.js';
import { UNIT } from './unitTypes.js';
import { createWorld, spawn, ORDER } from './world.js';
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
