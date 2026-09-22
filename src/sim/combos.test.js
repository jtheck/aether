import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD, applyCommands } from './commands.js';
import { createField } from './field.js';
import { getResource, grantStartingResources } from './resources.js';
import { canPreviewPlaceBuilding, isPlaceableBuilding } from './buildings.js';
import {
  AGORA_FOUND_MINERAL,
  COMBO,
  agoraFoundCost,
  canAffordAgoraFound,
  classifyCastSelection,
  selectionHasAgoraFound,
} from './combos.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  if (field.activeMask) field.activeMask.fill(1);
  return field;
}

function crew(w, extra = []) {
  const ids = [];
  for (let n = 0; n < 4; n++) {
    ids.push(spawn(w, { x: fx.fromInt(20 + n * 2), y: 0, type: UNIT.VILLAGER, owner: 0 }));
  }
  ids.push(spawn(w, { x: fx.fromInt(30), y: 0, type: UNIT.ENGINEER, owner: 0 }));
  for (const spec of extra) {
    ids.push(spawn(w, { x: fx.fromInt(34), y: fx.fromInt(2), ...spec, owner: spec.owner ?? 0 }));
  }
  return ids;
}

describe('combo classify', () => {
  it('matches 4 villagers + engineer; extra warriors ok; casters block', () => {
    const w = createWorld(8);
    const base = crew(w);
    assert.equal(selectionHasAgoraFound(w, base), true);
    assert.equal(classifyCastSelection(w, base), COMBO.AGORA_FOUND);

    const w2 = createWorld(8);
    const ids2 = crew(w2, [{ type: UNIT.WARRIOR }]);
    assert.equal(selectionHasAgoraFound(w2, ids2), true);

    const w3 = createWorld(8);
    const ids3 = crew(w3, [{ type: UNIT.WIZARD }]);
    assert.equal(selectionHasAgoraFound(w3, ids3), false);
    assert.equal(classifyCastSelection(w3, ids3), COMBO.COMPOUND);
  });

  it('costs half a mineral stack plus all wood and stone', () => {
    assert.equal(AGORA_FOUND_MINERAL, 30);
    assert.equal(canAffordAgoraFound({ mineral: 29 }), false);
    assert.equal(canAffordAgoraFound({ mineral: 30, wood: 0, stone: 0 }), true);
    assert.deepEqual(agoraFoundCost({ wood: 80, stone: 45, mineral: 40, food: 12 }), {
      mineral: 30,
      wood: 80,
      stone: 45,
    });
  });
});

describe('agora found place', () => {
  it('stays off the radial but previews when the bank has 30 mineral', () => {
    assert.equal(isPlaceableBuilding('agora'), false);
    const field = openField();
    const snapX = fx.fromInt(0);
    const snapZ = fx.fromInt(0);
    assert.equal(canPreviewPlaceBuilding(field, 'agora', snapX, snapZ, { mineral: 29 }), false);
    assert.equal(canPreviewPlaceBuilding(field, 'agora', snapX, snapZ, { mineral: 30, wood: 0 }), true);
  });

  it('rejects a caster crew or a broke mineral bank', () => {
    const field = openField();
    const w = createWorld(12);
    grantStartingResources(w, 0, { wood: 80, stone: 40, mineral: 20, food: 50 });
    const ids = crew(w);
    w.buildings = [];
    w.agoras = [];
    applyCommands(w, field, [{
      type: CMD.PLACE_BUILDING,
      playerId: 0,
      buildingType: 'agora',
      entities: ids,
      tx: 0,
      ty: 0,
    }]);
    assert.equal(w.buildings.length, 0);

    grantStartingResources(w, 0, { wood: 80, stone: 40, mineral: 40, food: 50 });
    const wiz = spawn(w, { x: fx.fromInt(40), y: 0, type: UNIT.WIZARD, owner: 0 });
    applyCommands(w, field, [{
      type: CMD.PLACE_BUILDING,
      playerId: 0,
      buildingType: 'agora',
      entities: [...ids, wiz],
      tx: 0,
      ty: 0,
    }]);
    assert.equal(w.buildings.length, 0);
  });

  it('spends 30 mineral and zeroes wood/stone; cancel refunds the snapshot', () => {
    const field = openField();
    const w = createWorld(16);
    grantStartingResources(w, 0, { wood: 80, stone: 45, mineral: 40, food: 12 });
    const ids = crew(w);
    w.buildings = [];
    w.agoras = [];
    applyCommands(w, field, [{
      type: CMD.PLACE_BUILDING,
      playerId: 0,
      buildingType: 'agora',
      entities: ids,
      tx: 0,
      ty: 0,
    }]);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.buildings[0].type, 'agora');
    assert.equal(w.buildings[0].built, 0);
    assert.equal(getResource(w, 0, 'mineral'), 10);
    assert.equal(getResource(w, 0, 'wood'), 0);
    assert.equal(getResource(w, 0, 'stone'), 0);
    assert.equal(getResource(w, 0, 'food'), 12);
    assert.deepEqual(w.buildings[0].refundCost, { wood: 80, stone: 45, mineral: 30, food: 0 });

    applyCommands(w, field, [{
      type: CMD.CANCEL_CONSTRUCTION,
      playerId: 0,
      buildingIndex: 0,
    }]);
    assert.equal(w.buildings[0].hp, 0);
    assert.equal(getResource(w, 0, 'mineral'), 40);
    assert.equal(getResource(w, 0, 'wood'), 80);
    assert.equal(getResource(w, 0, 'stone'), 45);
    assert.equal(getResource(w, 0, 'food'), 12);
  });

  it('promotes a finished site into a live agora', () => {
    const field = openField();
    const w = createWorld(20);
    grantStartingResources(w, 0, { wood: 20, stone: 10, mineral: 30, food: 8 });
    const ids = crew(w);
    w.buildings = [];
    w.agoras = [];
    applyCommands(w, field, [{
      type: CMD.PLACE_BUILDING,
      playerId: 0,
      buildingType: 'agora',
      entities: ids,
      tx: 0,
      ty: 0,
    }]);
    const site = w.buildings[0];
    site.buildProgress = site.buildTime - 1;
    w.px[ids[0]] = site.x;
    w.py[ids[0]] = site.z;
    assert.equal(w.order[ids[0]], ORDER.BUILD);
    step(w, field, []);
    assert.equal(site.built, 1);
    assert.equal(site.hp, 0);
    assert.equal(w.agoras.length, 1);
    assert.equal(w.agoras[0].owner, 0);
    assert.equal(w.agoras[0].x, site.x);
    assert.equal(w.agoras[0].z, site.z);
  });
});
