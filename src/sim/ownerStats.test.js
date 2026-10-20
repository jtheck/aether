import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { kill } from './damage.js';
import { applyDamageBuilding } from './buildingCombat.js';
import { addGatherIncome } from './storage.js';
import { grantStartingResources, spendResources } from './resources.js';
import { noteResourceRefund } from './ownerStats.js';
import { UNIT } from './unitTypes.js';
import * as fx from './fixed.js';

describe('match tallies', () => {
  it('counts a loss, a raze, gathered income, and net spend', () => {
    const w = createWorld(1);
    grantStartingResources(w, 0, { wood: 0, stone: 0, mineral: 0, food: 0 });
    spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
    spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.VILLAGER, owner: 1 });
    kill(w, 1);
    assert.equal(w.ownerLosses[1], 1);
    assert.equal(w.ownerKills[0] ?? 0, 0);

    w.buildings = [{ owner: 1, type: 'camp', built: 1, hp: 5, x: 0, z: 0 }];
    applyDamageBuilding(w, null, 0, 5, 0);
    assert.equal(w.ownerRazes[0], 1);
    assert.equal(w.ownerBuildingsLost[1], 1);

    const banked = addGatherIncome(w, 0, 'wood', 25);
    assert.equal(banked, 25);
    assert.equal(w.ownerGathered[0], 25);

    assert.equal(spendResources(w, 0, { wood: 10 }), true);
    assert.equal(w.ownerSpent[0], 10);
    noteResourceRefund(w, 0, { wood: 4 });
    assert.equal(w.ownerSpent[0], 6);
    assert.equal(w.ownerGathered[0], 25);
  });
});
