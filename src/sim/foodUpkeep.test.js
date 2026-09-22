import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { createField } from './field.js';
import { addResource, getResource } from './resources.js';
import { createKothMeta } from './kothMeta.js';
import {
  FOOD_UPKEEP_PERIOD,
  FOOD_UPKEEP_PERIOD_KOTH,
  applySerializedFoodUpkeep,
  serializeFoodUpkeep,
  tickFoodUpkeep,
} from './foodUpkeep.js';

describe('food upkeep', () => {
  it('charges one food per living unit every period', () => {
    const w = createWorld(1);
    spawn(w, { type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 10);

    for (let t = 0; t < FOOD_UPKEEP_PERIOD - 1; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 10, 'no bite until the period fills');
    tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 9, 'one mouth, one food');
  });

  it('scales with population and stays per-owner', () => {
    const w = createWorld(2);
    spawn(w, { type: UNIT.VILLAGER, owner: 0 });
    spawn(w, { type: UNIT.WARRIOR, owner: 0, x: fx.fromInt(4) });
    spawn(w, { type: UNIT.ARCHER, owner: 1, x: fx.fromInt(-4) });
    addResource(w, 0, 'food', 20);
    addResource(w, 1, 'food', 20);

    const half = (FOOD_UPKEEP_PERIOD / 2) | 0;
    for (let t = 0; t < half; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 19, 'two mouths fill a bite in half a period');
    assert.equal(getResource(w, 1, 'food'), 20, 'the other seat has not reached a bite');

    for (let t = 0; t < half; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 18, 'two mouths keep the same cadence');
    assert.equal(getResource(w, 1, 'food'), 19, 'one mouth bites at the full period');
  });

  it('clamps at empty and does not bank unpaid debt', () => {
    const w = createWorld(3);
    spawn(w, { type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 1);

    for (let t = 0; t < FOOD_UPKEEP_PERIOD * 3; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 0, 'never goes negative');

    addResource(w, 0, 'food', 4);
    tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 3, 'one pending bite resumes, not a 3-food dump');
  });

  it('runs from step and ignores an empty house', () => {
    const field = createField(4);
    const w = createWorld(4);
    addResource(w, 0, 'food', 8);
    for (let t = 0; t < FOOD_UPKEEP_PERIOD; t++) step(w, field, []);
    assert.equal(getResource(w, 0, 'food'), 8, 'no pop, no drain');

    spawn(w, { type: UNIT.MONK, owner: 0 });
    for (let t = 0; t < FOOD_UPKEEP_PERIOD; t++) step(w, field, []);
    assert.equal(getResource(w, 0, 'food'), 7, 'step collects the same bite');
  });

  it('uses the slower KOTH cadence', () => {
    const w = createWorld(7);
    w.koth = createKothMeta([0]);
    spawn(w, { type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 10);

    for (let t = 0; t < FOOD_UPKEEP_PERIOD; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 10, 'skirmish period is not enough on the hill');

    for (let t = 0; t < FOOD_UPKEEP_PERIOD_KOTH - FOOD_UPKEEP_PERIOD - 1; t++) tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 10, 'no bite until the KOTH period fills');
    tickFoodUpkeep(w);
    assert.equal(getResource(w, 0, 'food'), 9, 'one mouth, one food, twice as slow');
  });

  it('round-trips the remainder', () => {
    const w = createWorld(5);
    spawn(w, { type: UNIT.VILLAGER, owner: 0 });
    addResource(w, 0, 'food', 5);
    for (let t = 0; t < 17; t++) tickFoodUpkeep(w);
    const snap = serializeFoodUpkeep(w);

    const w2 = createWorld(6);
    applySerializedFoodUpkeep(w2, snap);
    assert.deepEqual(serializeFoodUpkeep(w2).slice(0, snap.length), snap);
  });
});
