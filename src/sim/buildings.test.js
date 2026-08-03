import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { applyCommands, CMD } from './commands.js';
import { buildField } from './field.js';
import * as fx from './fixed.js';
import { serializeBuildings, isPlaceableBuilding } from './buildings.js';

describe('buildings place', () => {
  it('PLACE_BUILDING appends to w.buildings', () => {
    const w = createWorld(1);
    w.buildings = [];
    const field = buildField(1, { width: 64, height: 64 });
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'barracks',
        tx: fx.fromFloat(10),
        ty: fx.fromFloat(20),
        yaw: 0,
      },
    ]);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.buildings[0].type, 'barracks');
    assert.equal(w.buildings[0].owner, 0);
    const ser = serializeBuildings(w.buildings);
    assert.ok(Math.abs(ser[0].x - 10) < 0.01);
    assert.ok(Math.abs(ser[0].z - 20) < 0.01);
  });

  it('rejects unknown types', () => {
    assert.equal(isPlaceableBuilding('nope'), false);
    const w = createWorld(2);
    w.buildings = [];
    const field = buildField(2, { width: 64, height: 64 });
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'castle',
        tx: 0,
        ty: 0,
      },
    ]);
    assert.equal(w.buildings.length, 0);
  });
});
