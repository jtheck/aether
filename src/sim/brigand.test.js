import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { applyCommands, CMD } from './commands.js';
import { createField } from './field.js';
import { step } from './step.js';
import { UNIT, getUnitDef, isVillagerLine } from './unitTypes.js';
import { unitPopCost } from './pop.js';
import { createWorld, spawn, ORDER } from './world.js';
import { applyGather } from './gather.js';
import { becomeBrigand, revertBrigand } from './brigand.js';
import { growTreeAt } from './trees.js';
import { worldToTile } from './field.js';
import { createBuilding, snapBuildingWorld } from './buildings.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

describe('villager brigand form', () => {
  it('is a villager-line civilian', () => {
    assert.equal(UNIT.BRIGAND, 13);
    assert.equal(getUnitDef(UNIT.BRIGAND).name, 'Brigand');
    assert.equal(getUnitDef(UNIT.BRIGAND).category, 'civilian');
    assert.ok(isVillagerLine(UNIT.VILLAGER));
    assert.ok(isVillagerLine(UNIT.BRIGAND));
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

  it('leaves soldiers alone', () => {
    const w = createWorld(47);
    const field = openField();
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    applyCommands(w, field, [{ type: CMD.ATTACK, entities: [war], target: foe }]);
    assert.equal(w.type[war], UNIT.WARRIOR);
  });
});
