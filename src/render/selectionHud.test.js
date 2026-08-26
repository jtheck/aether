import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectionGroupsFromBuildings,
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
    assert.deepEqual(selectionHudSlot({ kind: 'building', typeKey: 'camp' }), {
      kind: 'building',
      typeKey: 'camp',
    });
    assert.equal(selectionHudIconKey({ kind: 'unit', typeId: 3 }), 'u:3');
    assert.equal(selectionHudIconKey({ kind: 'building', typeKey: 'camp' }), 'b:camp');
  });
});
