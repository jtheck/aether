import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createField, TERRAIN } from './field.js';
import { applyWallOccupancy, placeWallOpening } from './walls.js';
import { applyDamageDoor, bindDoors, damageDoorsInRadius } from './doorCombat.js';
import { createWorld, spawn, ORDER } from './world.js';
import { applyCommands, CMD } from './commands.js';
import { step } from './step.js';
import { UNIT } from './unitTypes.js';
import * as fx from './fixed.js';

function walledField() {
  const field = createField(1, { width: 32, height: 32 });
  field.pass.fill(1);
  field.activeMask.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  field.tileType.fill(0);
  field.walls = {
    style: {},
    runs: [{ closed: false, points: [{ x: -16, z: 0 }, { x: 16, z: 0 }] }],
  };
  assert.equal(placeWallOpening(field.walls.runs, 0, 0.4, false, 8, false), true);
  applyWallOccupancy(field, field.walls);
  return field;
}

describe('door combat', () => {
  it('keeps a shut door blocked until it is broken open', () => {
    const field = walledField();
    const before = field.pass.slice();
    const world = createWorld(1);
    bindDoors(world, field);
    assert.equal(world.doors.length, 1);
    assert.equal(world.doors[0].open, 0);
    world.doors[0].hp = 15;
    assert.equal(applyDamageDoor(world, field, 0, 15), 15);
    assert.equal(world.doors[0].open, 1);
    assert.equal(field.walls.runs[0].openings[0].open, 1);
    let opened = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === 0 && field.pass[i] === 1) opened++;
    }
    assert.ok(opened >= 2, `door tiles opened ${opened}`);
  });

  it('ATTACK on a door walks up and breaks it', () => {
    const field = walledField();
    const world = createWorld(2);
    bindDoors(world, field);
    world.doors[0].hp = 20;
    const door = world.doors[0];
    const warrior = spawn(world, {
      x: door.x,
      y: door.z + fx.fromFloat(8),
      type: UNIT.WARRIOR,
      owner: 0,
    });
    applyCommands(world, field, [
      { type: CMD.ATTACK, entities: [warrior], target: -1, doorIndex: 0 },
    ]);
    assert.equal(world.order[warrior], ORDER.ATTACK);
    assert.equal(world.targetDoor[warrior], 0);
    for (let t = 0; t < 80; t++) step(world, field);
    assert.equal(world.doors[0].open, 1);
    assert.equal(world.targetDoor[warrior], -1);
  });

  it('attack-move onto a shut door breaks it, and a blast does too', () => {
    const field = walledField();
    const world = createWorld(3);
    bindDoors(world, field);
    const door = world.doors[0];
    const warrior = spawn(world, {
      x: door.x,
      y: door.z + fx.fromFloat(10),
      type: UNIT.WARRIOR,
      owner: 0,
    });
    applyCommands(world, field, [{
      type: CMD.ATTACK_MOVE,
      entities: [warrior],
      tx: [door.x],
      ty: [door.z],
    }]);
    assert.equal(world.order[warrior], ORDER.ATTACK);
    assert.equal(world.targetDoor[warrior], 0);

    const blasted = walledField();
    const boom = createWorld(4);
    bindDoors(boom, blasted);
    boom.doors[0].hp = 12;
    assert.equal(damageDoorsInRadius(boom, blasted, boom.doors[0].x, boom.doors[0].z, fx.fromFloat(4), 12), 1);
    assert.equal(boom.doors[0].open, 1);
    assert.equal(blasted.walls.runs[0].openings[0].open, 1);
  });
});
