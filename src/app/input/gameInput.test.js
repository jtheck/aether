import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxSelectWinner,
  mergeBuildingSels,
  radialClickKind,
  screenPosInRect,
} from './buildingSelect.js';

describe('building multi / box select helpers', () => {
  it('shift-add merges buildings without duplicating keys', () => {
    const current = [
      { kind: 'building', index: 0 },
      { kind: 'agora', index: 0 },
    ];
    const extra = [
      { kind: 'agora', index: 0 },
      { kind: 'building', index: 2 },
    ];
    assert.deepEqual(mergeBuildingSels(current, extra), [
      { kind: 'building', index: 0 },
      { kind: 'agora', index: 0 },
      { kind: 'building', index: 2 },
    ]);
  });

  it('units win a mixed box; buildings win when no units hit', () => {
    assert.equal(boxSelectWinner(2, 3), 'units');
    assert.equal(boxSelectWinner(0, 2), 'buildings');
    assert.equal(boxSelectWinner(0, 0), 'none');
  });

  it('screen-rect test matches canvas-local box edges', () => {
    assert.equal(screenPosInRect({ x: 10, y: 20 }, 10, 40, 20, 50), true);
    assert.equal(screenPosInRect({ x: 9, y: 20 }, 10, 40, 20, 50), false);
    assert.equal(screenPosInRect(null, 0, 10, 0, 10), false);
  });

  it('hub click-through beats radial chrome so the building stays pickable', () => {
    assert.equal(radialClickKind({ picked: true, onHub: true, onChrome: true }), 'pick');
    assert.equal(radialClickKind({ picked: false, onHub: true, onChrome: true }), 'hub');
    assert.equal(radialClickKind({ picked: false, onHub: false, onChrome: true }), 'chrome');
    assert.equal(radialClickKind({ picked: false, onHub: false, onChrome: false }), 'world');
  });
});
