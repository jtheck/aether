// Costs layer: placement / training / research charge the owner's bank, are
// rejected when unaffordable, and refund on cancel. Kept headless + deterministic.

import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { buildField } from './field.js';
import { applyCommands, CMD } from './commands.js';
import { getResource, grantStartingResources, addResource } from './resources.js';
import { getBuildingCost, BUILDING_MENU_UNITS } from './buildings.js';
import { UNIT, getUnitCost } from './unitTypes.js';

function fund(w, owner, amts) {
  grantStartingResources(w, owner, amts);
}

/** Flatten a field to open, buildable ground so tests isolate the economy. */
function clearField(field) {
  field.pass.fill(1);
  field.activeMask?.fill(1);
  field.slowMask?.fill(0);
  field.structureSlowMask?.fill(0);
  field.treeStock?.fill(0);
  field.rockStock?.fill(0);
  field.sceneryType?.fill(0);
  return field;
}

function placementChargesAndGates() {
  const field = clearField(buildField(7, { width: 64, height: 64 }));
  const w = createWorld(7);
  w.buildings = [];
  // Broke: placement is rejected, nothing built, nothing spent.
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'camp', tx: fx32(32), ty: fx32(32) },
  ]);
  assert.equal(w.buildings.length, 0, 'cannot place a camp while broke');

  // Funded: placement succeeds and deducts exactly the camp cost.
  fund(w, 0, { wood: 100, stone: 0, mineral: 0, food: 0 });
  const cost = getBuildingCost('camp');
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'camp', tx: fx32(32), ty: fx32(32) },
  ]);
  assert.equal(w.buildings.length, 1, 'camp placed once affordable');
  assert.equal(getResource(w, 0, 'wood'), 100 - (cost.wood | 0), 'camp wood deducted');
}

function trainingChargesGatesAndRefunds() {
  const field = clearField(buildField(8, { width: 64, height: 64 }));
  const w = createWorld(8);
  w.buildings = [];
  fund(w, 0, { wood: 200, stone: 0, mineral: 0, food: 0 });
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'village', tx: fx32(32), ty: fx32(32) },
  ]);
  assert.equal(w.buildings.length, 1, 'village placed');
  // Buildings place as construction sites; raise it so training is allowed.
  w.buildings[0].built = 1;
  w.buildings[0].buildProgress = w.buildings[0].buildTime | 0;

  // Villagers trickle from the village — they are not a train option.
  addResource(w, 0, 'food', 100);
  applyCommands(w, field, [
    { type: CMD.QUEUE_TRAIN, playerId: 0, buildingIndex: 0, unitKey: 'villager' },
  ]);
  assert.equal((w.buildings[0].tracks?.length | 0), 0, 'village no longer trains villagers');
  addResource(w, 0, 'food', -getResource(w, 0, 'food'));

  // Monk costs food; owner has none → training rejected, no track.
  applyCommands(w, field, [
    { type: CMD.QUEUE_TRAIN, playerId: 0, buildingIndex: 0, unitKey: 'monk' },
  ]);
  assert.equal((w.buildings[0].tracks?.length | 0), 0, 'no monk queued without food');

  // Give food → queue succeeds and charges; cancel refunds it.
  addResource(w, 0, 'food', 100);
  const foodBefore = getResource(w, 0, 'food');
  const woodBefore = getResource(w, 0, 'wood');
  const mCost = getUnitCost(UNIT.MONK);
  applyCommands(w, field, [
    { type: CMD.QUEUE_TRAIN, playerId: 0, buildingIndex: 0, unitKey: 'monk' },
    { type: CMD.QUEUE_TRAIN, playerId: 0, buildingIndex: 0, unitKey: 'monk' },
  ]);
  assert.equal(getResource(w, 0, 'food'), foodBefore - 2 * (mCost.food | 0), 'two monks charged food');
  assert.equal(getResource(w, 0, 'wood'), woodBefore - 2 * (mCost.wood | 0), 'two monks charged wood');
  const trackCount = w.buildings[0].tracks[0].count | 0;
  assert.equal(trackCount, 2, 'two monks queued');

  applyCommands(w, field, [
    { type: CMD.CANCEL_TRAIN, playerId: 0, buildingIndex: 0 },
  ]);
  assert.equal(getResource(w, 0, 'food'), foodBefore, 'cancel refunds unspawned monks');
  assert.equal(w.buildings[0].tracks.length, 0, 'queue cleared on cancel');
}

function menuKeysCovered() {
  // Every trainable menu unit has a cost entry (or intentionally free {}).
  for (const key in BUILDING_MENU_UNITS) {
    const cost = getUnitCost(BUILDING_MENU_UNITS[key]);
    assert.ok(cost && typeof cost === 'object', `unit ${key} has a cost object`);
  }
}

function fx32(n) {
  return (n * 65536) | 0;
}

placementChargesAndGates();
trainingChargesGatesAndRefunds();
menuKeysCovered();
console.log('economy.test.js: ok (charge + gate + refund)');
