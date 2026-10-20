import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { applyCommands, CMD } from './commands.js';
import { applyCasts } from './abilities.js';
import { addResource, getResource } from './resources.js';
import { createField } from './field.js';
import { step } from './step.js';
import { UNIT, getUnitDef, isVillagerLine } from './unitTypes.js';
import { unitPopCost } from './pop.js';
import { createWorld, spawn, ORDER } from './world.js';
import { applyGather } from './gather.js';
import { becomeBrigand, revertBrigand, BRIGAND_IDLE_REVERT_TICKS, brigandIdleSystem } from './brigand.js';
import { growTreeAt } from './trees.js';
import { worldToTile } from './field.js';
import { createBuilding, snapBuildingWorld } from './buildings.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

describe('villager brigand form', () => {
  it('brigand is military pop; villager line is gather-only', () => {
    assert.equal(UNIT.BRIGAND, 13);
    assert.equal(getUnitDef(UNIT.BRIGAND).name, 'Brigand');
    assert.equal(getUnitDef(UNIT.BRIGAND).category, 'military');
    assert.ok(isVillagerLine(UNIT.VILLAGER));
    assert.ok(!isVillagerLine(UNIT.BRIGAND));
    assert.ok(!isVillagerLine(UNIT.WARRIOR));
    assert.equal(unitPopCost(UNIT.BRIGAND), 1);
  });

  it('CMD.ATTACK on a unit turns a villager into a brigand', () => {
    const w = createWorld(40);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: foe }]);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    assert.equal(w.order[vill], ORDER.ATTACK);
    assert.equal(w.targetEntity[vill], foe);
    assert.equal(w.speed[vill], getUnitDef(UNIT.BRIGAND).speed);
  });

  it('CMD.ATTACK on a building turns a villager into a brigand', () => {
    const w = createWorld(41);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    const snapped = snapBuildingWorld('camp', fx.fromInt(24), 0);
    const b = createBuilding({
      owner: 1,
      type: 'camp',
      x: fx.toFloat(snapped.x),
      z: fx.toFloat(snapped.z),
    });
    b.built = 1;
    w.buildings.push(b);
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: -1, buildingIndex: 0 }]);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    assert.equal(w.targetBuilding[vill], 0);
  });

  it('attack-move does not flip a villager', () => {
    const w = createWorld(42);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [
      { type: CMD.ATTACK_MOVE, entities: [vill], tx: [fx.fromInt(20)], ty: [0] },
    ]);
    assert.equal(w.type[vill], UNIT.VILLAGER);
    assert.equal(w.order[vill], ORDER.ATTACK_MOVE);
  });

  it('move and stop put the basket back on', () => {
    const w = createWorld(43);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(12), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: foe }]);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    applyCommands(w, field, [
      { type: CMD.MOVE, entities: [vill], tx: [fx.fromInt(-8)], ty: [0] },
    ]);
    assert.equal(w.type[vill], UNIT.VILLAGER);
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: foe }]);
    applyCommands(w, field, [{ type: CMD.STOP, entities: [vill] }]);
    assert.equal(w.type[vill], UNIT.VILLAGER);
    assert.equal(w.order[vill], ORDER.IDLE);
  });

  it('gather reverts a brigand so they can work', () => {
    const w = createWorld(44);
    const field = openField();
    const tile = worldToTile(0) + worldToTile(0) * field.width;
    assert.ok(growTreeAt(field, tile, 20), 'tree planted');
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    becomeBrigand(w, vill);
    applyGather(w, field, [vill], tile);
    assert.equal(w.type[vill], UNIT.VILLAGER);
    assert.equal(w.order[vill], ORDER.GATHER);
  });

  it('killing the pointed target reverts to villager', () => {
    const w = createWorld(45);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    const foe = spawn(w, {
      x: fx.fromFloat(2),
      y: 0,
      type: UNIT.VILLAGER,
      owner: 1,
      hp: 6,
    });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: foe }]);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    for (let t = 0; t < 80; t++) step(w, field);
    assert.equal(w.alive[foe], 0);
    assert.equal(w.type[vill], UNIT.VILLAGER);
  });

  it('clamps hp when reverting to the villager cap', () => {
    const w = createWorld(46);
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0, hp: 50 });
    becomeBrigand(w, vill);
    w.hp[vill] = 65;
    revertBrigand(w, vill);
    assert.equal(w.type[vill], UNIT.VILLAGER);
    assert.equal(w.hp[vill], getUnitDef(UNIT.VILLAGER).hp);
  });

  it('ability cast spends 20 food and 10 wood once per villager', () => {
    const w = createWorld(52);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 100);
    addResource(w, 0, 'wood', 100);
    applyCasts(w, field, [vill], null, fx.fromInt(20), 0);
    assert.equal(getResource(w, 0, 'food'), 80);
    assert.equal(getResource(w, 0, 'wood'), 90);
    applyCasts(w, field, [vill], null, fx.fromInt(24), 0);
    assert.equal(getResource(w, 0, 'food'), 80, 'already brigand — no second spend');
    assert.equal(getResource(w, 0, 'wood'), 90);
  });

  it('ability cast flips a villager and stop puts the basket back', () => {
    const w = createWorld(49);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 100);
    addResource(w, 0, 'wood', 100);
    applyCasts(w, field, [vill], null, fx.fromInt(20), 0);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    assert.equal(w.order[vill], ORDER.ATTACK_MOVE);
    applyCommands(w, field, [{ type: CMD.STOP, entities: [vill] }]);
    assert.equal(w.type[vill], UNIT.VILLAGER);
  });

  it('idle brigands revert after the timeout', () => {
    const w = createWorld(48);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    becomeBrigand(w, vill);
    w.brigandIdle[vill] = BRIGAND_IDLE_REVERT_TICKS - 1;
    brigandIdleSystem(w);
    assert.equal(w.type[vill], UNIT.VILLAGER);
  });

  it('does not time out while attack-moving', () => {
    const w = createWorld(51);
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.BRIGAND, owner: 0 });
    w.order[vill] = ORDER.ATTACK_MOVE;
    w.hasTarget[vill] = 1;
    w.brigandIdle[vill] = BRIGAND_IDLE_REVERT_TICKS - 1;
    brigandIdleSystem(w);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    assert.equal(w.brigandIdle[vill], 0);
  });

  it('pauses idle timeout while melee engagement is active', () => {
    const w = createWorld(53);
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.BRIGAND, owner: 0 });
    const foe = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.WARRIOR, owner: 1 });
    w.order[vill] = ORDER.IDLE;
    w.engagementTarget[vill] = foe;
    w.brigandIdle[vill] = BRIGAND_IDLE_REVERT_TICKS - 1;
    brigandIdleSystem(w);
    assert.equal(w.type[vill], UNIT.BRIGAND);
    assert.equal(w.brigandIdle[vill], 0);
  });

  it('keeps the torch while ORDER.ATTACK still has a target', () => {
    const w = createWorld(50);
    const field = openField();
    const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [vill], target: foe }]);
    w.brigandIdle[vill] = BRIGAND_IDLE_REVERT_TICKS - 1;
    brigandIdleSystem(w);
    assert.equal(w.type[vill], UNIT.BRIGAND);
  });

  it('leaves soldiers alone', () => {
    const w = createWorld(47);
    const field = openField();
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [war], target: foe }]);
    assert.equal(w.type[war], UNIT.WARRIOR);
  });
});
