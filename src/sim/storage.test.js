import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { createBuilding } from './buildings.js';
import { addResource, getResource, grantStartingResources } from './resources.js';
import {
  BASE_SLOTS,
  MAX_RESOURCE_SLOTS,
  SLOT_AMOUNT,
  SLOT_VIS,
  SILO_ATTACH_RANGE_F,
  addGatherIncome,
  countSiloPairs,
  filledSlotCount,
  overflowCredit,
  overflowHintLabel,
  ownerResourceCap,
  ownerSlotCount,
  slotVisual,
  takeStorageOverflow,
  unpairedSiloSource,
} from './storage.js';

function worldWith(buildings) {
  const w = createWorld(1);
  w.buildings = buildings;
  return w;
}

function camp(x, z, extra = {}) {
  return createBuilding({ owner: 0, type: 'camp', x, z, ...extra });
}
function farm(x, z, extra = {}) {
  return createBuilding({ owner: 0, type: 'farm', x, z, ...extra });
}
function mine(x, z, extra = {}) {
  return createBuilding({ owner: 0, type: 'mine', x, z, ...extra });
}
function silo(x, z, extra = {}) {
  return createBuilding({ owner: 0, type: 'silo', x, z, ...extra });
}

describe('silo pairing', () => {
  it('counts a silo next to a camp as one wood pair', () => {
    const buildings = [camp(0, 0), silo(8, 0)];
    assert.equal(countSiloPairs(buildings, 0, 'camp'), 1);
    assert.equal(ownerSlotCount(buildings, 0, 'wood'), BASE_SLOTS + 3);
  });

  it('ignores a silo sitting past attach range', () => {
    const buildings = [camp(0, 0), silo(SILO_ATTACH_RANGE_F + 8, 0)];
    assert.equal(countSiloPairs(buildings, 0, 'camp'), 0);
    assert.equal(ownerSlotCount(buildings, 0, 'wood'), BASE_SLOTS);
  });

  it('needs two farms and two silos for the second food row', () => {
    const one = [farm(0, 0), silo(8, 0), farm(40, 0)];
    assert.equal(countSiloPairs(one, 0, 'farm'), 1);
    assert.equal(ownerSlotCount(one, 0, 'food'), 9);

    const two = [farm(0, 0), silo(8, 0), farm(40, 0), silo(48, 0)];
    assert.equal(countSiloPairs(two, 0, 'farm'), 2);
    assert.equal(ownerSlotCount(two, 0, 'food'), MAX_RESOURCE_SLOTS);
  });

  it('one silo between two farms still counts as one pair', () => {
    const buildings = [farm(0, 0), farm(12, 0), silo(6, 0)];
    assert.equal(countSiloPairs(buildings, 0, 'farm'), 1);
  });

  it('two silos on one farm stay at one pair', () => {
    const buildings = [farm(0, 0), silo(8, 0), silo(0, 8)];
    assert.equal(countSiloPairs(buildings, 0, 'farm'), 1);
    assert.ok(unpairedSiloSource(buildings, 0, 'farm') == null);
  });

  it('stone and mineral share mine pairs', () => {
    const buildings = [mine(0, 0), silo(8, 0)];
    assert.equal(ownerSlotCount(buildings, 0, 'stone'), 9);
    assert.equal(ownerSlotCount(buildings, 0, 'mineral'), 9);
    assert.equal(ownerSlotCount(buildings, 0, 'wood'), BASE_SLOTS);
  });

  it('skips unbuilt silos and wrecks', () => {
    const buildings = [
      farm(0, 0),
      silo(8, 0, { built: 0 }),
      silo(0, 8, { hp: 0 }),
    ];
    assert.equal(countSiloPairs(buildings, 0, 'farm'), 0);
  });

  it('does not pair another owner\'s silo', () => {
    const buildings = [
      camp(0, 0),
      createBuilding({ owner: 1, type: 'silo', x: 8, z: 0 }),
    ];
    assert.equal(countSiloPairs(buildings, 0, 'camp'), 0);
  });
});

describe('overflow credit', () => {
  it('averages 25% over a den of ticks', () => {
    let sum = 0;
    for (let t = 0; t < 4; t++) sum += overflowCredit(10, t);
    assert.equal(sum, 10);
    let bites = 0;
    for (let t = 0; t < 4; t++) bites += overflowCredit(2, t);
    assert.equal(bites, 2);
  });

  it('cuts gather income once the unlocked cap is full', () => {
    const w = worldWith([]);
    grantStartingResources(w, 0, { wood: 0, stone: 0, mineral: 0, food: 0 });
    const cap = ownerResourceCap(w.buildings, 0, 'wood');
    addResource(w, 0, 'wood', cap);
    w.tick = 0;
    const got = addGatherIncome(w, 0, 'wood', 10);
    assert.equal(got, overflowCredit(10, 0));
    assert.equal(getResource(w, 0, 'wood'), cap + got);
  });

  it('banks in full under the cap, then 25% of the spill', () => {
    const w = worldWith([]);
    grantStartingResources(w, 0, { wood: 0, stone: 0, mineral: 0, food: 0 });
    const cap = ownerResourceCap(w.buildings, 0, 'wood');
    addResource(w, 0, 'wood', cap - 4);
    w.tick = 1;
    const got = addGatherIncome(w, 0, 'wood', 10);
    assert.equal(got, 4 + overflowCredit(6, 1));
  });

  it('refunds still use addResource and ignore the cap', () => {
    const w = worldWith([]);
    const cap = ownerResourceCap(w.buildings, 0, 'wood');
    addResource(w, 0, 'wood', cap + 80);
    assert.equal(getResource(w, 0, 'wood'), cap + 80);
  });

  it('a silo pair raises the wood cap', () => {
    const bare = worldWith([camp(0, 0)]);
    const paired = worldWith([camp(0, 0), silo(8, 0)]);
    assert.equal(ownerResourceCap(bare.buildings, 0, 'wood'), BASE_SLOTS * SLOT_AMOUNT.wood);
    assert.equal(ownerResourceCap(paired.buildings, 0, 'wood'), 9 * SLOT_AMOUNT.wood);
  });
});

describe('slot fill and blink', () => {
  it('shows an icon as soon as that slot has any stock', () => {
    assert.equal(filledSlotCount(0, 6, 'wood'), 0);
    assert.equal(filledSlotCount(1, 6, 'wood'), 1);
    assert.equal(filledSlotCount(20, 6, 'wood'), 1);
    assert.equal(filledSlotCount(21, 6, 'wood'), 2);
    assert.equal(filledSlotCount(200, 6, 'wood'), 6);
  });

  it('names 7 then a as the next locked slot', () => {
    assert.equal(overflowHintLabel(6), '7');
    assert.equal(overflowHintLabel(9), 'a');
    assert.equal(overflowHintLabel(12), null);
    assert.equal(slotVisual(0, 6, 6, true), SLOT_VIS.ON);
    assert.equal(slotVisual(6, 6, 6, true), SLOT_VIS.OFF);
  });

  it('notes a wasted haul return, not an in-place bite', () => {
    const w = worldWith([]);
    grantStartingResources(w, 0, { wood: 0, stone: 0, mineral: 0, food: 0 });
    addResource(w, 0, 'wood', ownerResourceCap(w.buildings, 0, 'wood'));
    w.tick = 0;
    addGatherIncome(w, 0, 'wood', 10, true);
    const ev = takeStorageOverflow(w);
    assert.equal(ev?.length, 1);
    assert.equal(ev[0].kind, 'wood');
    assert.equal(ev[0].hint, '7');
    addGatherIncome(w, 0, 'wood', 10, false);
    assert.equal(takeStorageOverflow(w), null);
  });

  it('notes overflow with no slot hint once every slot is unlocked', () => {
    const w = worldWith([
      farm(0, 0),
      silo(8, 0),
      farm(40, 0),
      silo(48, 0),
    ]);
    grantStartingResources(w, 0, { wood: 0, stone: 0, mineral: 0, food: 0 });
    addResource(w, 0, 'food', ownerResourceCap(w.buildings, 0, 'food'));
    w.tick = 0;
    addGatherIncome(w, 0, 'food', 10, true);
    const ev = takeStorageOverflow(w);
    assert.equal(ev?.length, 1);
    assert.equal(ev[0].kind, 'food');
    assert.equal(ev[0].hint, null);
  });
});
