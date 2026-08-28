import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxSelectWinner,
  inspectForeignOnClick,
  mergeBuildingSels,
  radialClickKind,
  radialHubFramedBuilding,
  screenPosInRect,
  twoFingerConsumesBuildUi,
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

  it('hub miss still picks the framed building', () => {
    const framed = { kind: 'building', index: 3 };
    assert.deepEqual(
      radialHubFramedBuilding({ picked: false, onHub: true }, framed),
      framed,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: true, onHub: true }, framed),
      null,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: false, onHub: false }, framed),
      null,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: false, onHub: true }, null),
      null,
    );
  });

  it('foreign LMB inspects when idle and stays an order click with troops selected', () => {
    assert.equal(inspectForeignOnClick(false), true);
    assert.equal(inspectForeignOnClick(true), false);
  });

  it('2-finger tap consumes placement, building selection, and an open radial', () => {
    assert.equal(twoFingerConsumesBuildUi(true, false, false), true);
    assert.equal(twoFingerConsumesBuildUi(false, true, false), true);
    assert.equal(twoFingerConsumesBuildUi(false, false, true), true);
    assert.equal(twoFingerConsumesBuildUi(false, false, false), false);
  });
});
