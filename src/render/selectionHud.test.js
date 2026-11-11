import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectionGroupsFromBuildings,
  selectionGroupsFromUnits,
  selectionHudIconKey,
  selectionHudSlot,
} from './selectionHud.js';

describe('selectionHud building groups', () => {
  it('groups selected agoras and placeables by type with counts', () => {
    const groups = selectionGroupsFromBuildings(
      [
        { kind: 'agora', index: 0 },
        { kind: 'building', index: 0 },
        { kind: 'building', index: 2 },
        { kind: 'building', index: 1 },
      ],
      [
        { type: 'camp' },
        { type: 'tavern' },
        { type: 'camp' },
      ],
      [{ owner: 0 }],
    );
    assert.deepEqual(groups, [
      {
        kind: 'building',
        typeKey: 'agora',
        name: 'Agora',
        count: 1,
        members: [{ kind: 'agora', index: 0 }],
        bar: null,
      },
      {
        kind: 'building',
        typeKey: 'camp',
        name: 'Camp',
        count: 2,
        members: [{ kind: 'building', index: 0 }, { kind: 'building', index: 2 }],
        bar: null,
      },
      {
        kind: 'building',
        typeKey: 'tavern',
        name: 'Tavern',
        count: 1,
        members: [{ kind: 'building', index: 1 }],
        bar: null,
      },
    ]);
  });

  it('skips missing buildings and empty selections', () => {
    assert.deepEqual(selectionGroupsFromBuildings(null, [], []), []);
    assert.deepEqual(
      selectionGroupsFromBuildings(
        [{ kind: 'building', index: 4 }, { kind: 'agora', index: 1 }],
        [{ type: 'farm' }],
        [{ owner: 0 }],
      ),
      [],
    );
  });

  it('uses distinct icon keys and pick slots for units vs buildings', () => {
    assert.deepEqual(selectionHudSlot({ kind: 'unit', typeId: 3 }), {
      kind: 'unit',
      typeId: 3,
    });
    assert.deepEqual(selectionHudSlot({ kind: 'unit', typeId: 5, entityId: 2 }), {
      kind: 'unit',
      typeId: 5,
      entityId: 2,
    });
    assert.deepEqual(selectionHudSlot({ kind: 'building', typeKey: 'camp' }), {
      kind: 'building',
      typeKey: 'camp',
    });
    assert.equal(selectionHudIconKey({ kind: 'unit', typeId: 3 }), 'u:3');
    assert.equal(selectionHudIconKey({ kind: 'building', typeKey: 'camp' }), 'b:camp');
  });

  it('pools building health and leaves agoras without a bar', () => {
    const groups = selectionGroupsFromBuildings(
      [
        { kind: 'agora', index: 0 },
        { kind: 'building', index: 0 },
        { kind: 'building', index: 1 },
      ],
      [
        { type: 'camp', hp: 40, maxHp: 100, owner: 1 },
        { type: 'camp', hp: 80, maxHp: 100, owner: 1 },
      ],
      [{ owner: 0 }],
    );
    assert.equal(groups[0].bar, null);
    assert.deepEqual(groups[1].bar, {
      ratio: 0.6,
      hp: 60,
      owner: 1,
      building: true,
      manaReady: 0,
      seatsFilled: 0,
    });
  });
});

describe('selectionHud unit groups', () => {
  it('uses character names when present and still groups unnamed types', () => {
    const world = {
      alive: [1, 1, 1, 1],
      type: [5, 4, 5, 1],
    };
    const names = new Map([[0, 'Stumpey'], [1, 'Lady']]);
    const groups = selectionGroupsFromUnits([0, 1, 2, 3], world, (i) => names.get(i));
    assert.deepEqual(groups, [
      { kind: 'unit', typeId: 5, name: 'Stumpey', count: 1, entityId: 0, ids: [0], bar: fullBar(60) },
      { kind: 'unit', typeId: 4, name: 'Lady', count: 1, entityId: 1, ids: [1], bar: fullBar(50) },
      { kind: 'unit', typeId: 5, name: 'Myco', count: 1, ids: [2], bar: fullBar(60) },
      { kind: 'unit', typeId: 1, name: 'Warrior', count: 1, ids: [3], bar: fullBar(120) },
    ]);
  });

  it('falls back to type names when nobody is named', () => {
    const world = { alive: [1, 1], type: [4, 4] };
    assert.deepEqual(selectionGroupsFromUnits([0, 1], world), [
      { kind: 'unit', typeId: 4, name: 'Priest', count: 2, ids: [0, 1], bar: fullBar(50) },
    ]);
  });

  it('pools chip health and keeps mana and seats on a single unit', () => {
    const world = {
      alive: [1, 1, 1, 1],
      type: [1, 1, 7, 10],
      hp: [60, 1, 40, 30],
      owner: [2, 2, 2, 3],
      mana: [0, 0, 200, 0],
    };
    const groups = selectionGroupsFromUnits([0, 1, 2, 3], world, null, (i) => (i === 3 ? 4 : 0));
    assert.deepEqual(groups[0].bar, {
      ratio: 61 / 240,
      hp: 31,
      owner: 2,
      building: false,
      manaReady: 0,
      seatsFilled: 0,
    });
    assert.deepEqual(groups[1].bar, {
      ratio: 40 / 50,
      hp: 40,
      owner: 2,
      building: false,
      manaReady: 2,
      seatsFilled: 0,
    });
    assert.deepEqual(groups[2].bar, {
      ratio: 0.5,
      hp: 30,
      owner: 3,
      building: false,
      manaReady: 0,
      seatsFilled: 4,
    });
  });
});

function fullBar(hp, owner = 0) {
  return { ratio: 1, hp, owner, building: false, manaReady: 0, seatsFilled: 0 };
}
