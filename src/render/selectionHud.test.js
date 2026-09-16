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
      { kind: 'building', typeKey: 'agora', name: 'Agora', count: 1 },
      { kind: 'building', typeKey: 'camp', name: 'Camp', count: 2 },
      { kind: 'building', typeKey: 'tavern', name: 'Tavern', count: 1 },
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
      { kind: 'unit', typeId: 5, name: 'Stumpey', count: 1, entityId: 0 },
      { kind: 'unit', typeId: 4, name: 'Lady', count: 1, entityId: 1 },
      { kind: 'unit', typeId: 5, name: 'Myco', count: 1 },
      { kind: 'unit', typeId: 1, name: 'Warrior', count: 1 },
    ]);
  });

  it('falls back to type names when nobody is named', () => {
    const world = { alive: [1, 1], type: [4, 4] };
    assert.deepEqual(selectionGroupsFromUnits([0, 1], world), [
      { kind: 'unit', typeId: 4, name: 'Priest', count: 2 },
    ]);
  });
});
