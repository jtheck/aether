import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField, worldToTile } from './field.js';
import { growTreeAt } from './trees.js';
import { SCENERY } from './scenery.js';
import { getResource } from './resources.js';
import { GATHER_CARRY_CAP } from './gather.js';

function plantRockAt(field, tx, tz, kind, stock, footRadius) {
  const tile = tz * field.width + tx;
  field.sceneryType[tile] = kind;
  field.rockStock[tile] = stock;
  for (let dz = -footRadius; dz <= footRadius; dz++) {
    for (let dx = -footRadius; dx <= footRadius; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      field.pass[z * field.width + x] = 0;
    }
  }
  return tile;
}

function plantTreeAt(field, x, z, stock) {
  const tx = worldToTile(x);
  const tz = worldToTile(z);
  const tile = tz * field.width + tx;
  assert.ok(growTreeAt(field, tile, stock), 'tree planted');
  return tile;
}

function gathersAndDeposits() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(20);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 30);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'villager takes the gather order');

  for (let t = 0; t < 160; t++) step(w, field, []);

  assert.ok(field.treeStock[tile] < 30, 'tree stock is being harvested');
  assert.ok(
    getResource(w, 0, 'wood') >= GATHER_CARRY_CAP,
    `owner banked at least one load (got ${getResource(w, 0, 'wood')})`,
  );
}

function onlyVillagersGather() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(21);
  const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 10);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [warrior], tile }]);
  assert.equal(w.order[warrior], ORDER.IDLE, 'non-villager ignores gather');
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a warrior');
}

function depletesThenIdles() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(22);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 6);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  for (let t = 0; t < 240; t++) step(w, field, []);

  assert.equal(field.treeStock[tile], 0, 'node fully depleted');
  assert.equal(getResource(w, 0, 'wood'), 6, 'all remaining wood banked');
  assert.equal(w.order[vill], ORDER.IDLE, 'villager idles once the node is gone');
}

function needsADropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(23);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 30);
  // No agora / camp / mine for owner 0.
  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  for (let t = 0; t < 200; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'wood'), 0, 'nothing banked without a drop-off');
  assert.ok(w.carriedAmt[vill] > 0, 'villager still holds its load');
}

function campAutoAssignsIdleVillagers() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(24);
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, 4, 0, 30);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0 }];

  // No manual command — the camp should recruit the idle villager on its own.
  for (let t = 0; t < 200; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'idle villager auto-assigned to the camp');
  assert.ok(getResource(w, 0, 'wood') > 0, 'camp economy banks wood without orders');
}

function engineerExtendsCampRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(25);
  // Villager sits just outside the base camp reach (28) — inside 36 with an engineer.
  const vill = spawn(w, { x: fx.fromFloat(34), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, 32, 0, 30);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0 }];

  for (let t = 0; t < 60; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.IDLE, 'out-of-reach villager is left alone');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood before the radius extends');

  spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.ENGINEER, owner: 0 });
  for (let t = 0; t < 220; t++) step(w, field, []);
  assert.ok(getResource(w, 0, 'wood') > 0, 'engineer-extended reach recruits the villager');
}

function minesPlainRockForMineral() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(26);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const rockTile = plantRockAt(field, cx, cz, SCENERY.ROCK_PLAIN, 12, 0);
  const vill = spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(10), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'villager takes the mine order');
  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.ok(field.rockStock[rockTile] < 12, 'rock is being chipped');
  assert.ok(getResource(w, 0, 'mineral') > 0, 'plain rock banks mineral');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a rock');
}

function minesMossRockForStone() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(27);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  // Moss rock has a radius-1 footprint — the villager must mine from the rim.
  const rockTile = plantRockAt(field, cx, cz, SCENERY.ROCK_MOSS, 56, 1);
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(14), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.ok(getResource(w, 0, 'stone') > 0, 'moss rock banks stone');
  assert.equal(getResource(w, 0, 'mineral'), 0, 'no mineral from a moss rock');
}

function farmsFoodInPlace() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(28);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const farmTile = cz * field.width + cx;
  field.foodNode[farmTile] = 1;
  // The farm is its own drop-off — the worker banks food without hauling.
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: farmTile }]);
  for (let t = 0; t < 200; t++) step(w, field, []);

  assert.ok(getResource(w, 0, 'food') > 0, 'farm banks food worked in place');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a farm');
  assert.ok(field.foodNode[farmTile] === 1, 'food node never depletes');
}

function farmAutoAssignsIdleVillagers() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(29);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const farmTile = cz * field.width + cx;
  field.foodNode[farmTile] = 1;
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 220; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'idle villager auto-assigned to the farm');
  assert.ok(getResource(w, 0, 'food') > 0, 'farm economy banks food without orders');
}

gathersAndDeposits();
minesPlainRockForMineral();
minesMossRockForStone();
farmsFoodInPlace();
farmAutoAssignsIdleVillagers();
onlyVillagersGather();
depletesThenIdles();
needsADropOff();
campAutoAssignsIdleVillagers();
engineerExtendsCampRadius();
console.log('gather.test.js: ok (wood + stone + mineral + food)');
