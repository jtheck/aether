import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCameraFollowTypingTarget, selectionCentroidXZ } from './cameraFollow.js';

describe('selectionCentroidXZ', () => {
  it('averages selected living units', () => {
    const c = selectionCentroidXZ({
      count: 4,
      selected: [0, 1, 1, 0],
      alive: [1, 1, 1, 1],
      renderX: [0, 10, 30, 99],
      renderZ: [0, 4, 8, 99],
    });
    assert.deepEqual(c, { x: 20, z: 6 });
  });

  it('skips dead units and dead buildings', () => {
    const c = selectionCentroidXZ({
      count: 2,
      selected: [1, 1],
      alive: [1, 0],
      renderX: [6, 100],
      renderZ: [2, 100],
      selectedBuildings: [
        { kind: 'building', index: 0 },
        { kind: 'building', index: 1 },
      ],
      buildings: [
        { x: 10, z: 4, hp: 8 },
        { x: 50, z: 50, hp: 0 },
      ],
    });
    assert.deepEqual(c, { x: 8, z: 3 });
  });

  it('includes agoras and treats missing building hp as standing', () => {
    const c = selectionCentroidXZ({
      count: 0,
      selected: [],
      alive: [],
      renderX: [],
      renderZ: [],
      selectedBuildings: [
        { kind: 'agora', index: 0 },
        { kind: 'building', index: 0 },
      ],
      buildings: [{ x: 4, z: 8 }],
      agoras: [{ x: 2, z: 2 }],
    });
    assert.deepEqual(c, { x: 3, z: 5 });
  });

  it('returns null when nothing selected is alive', () => {
    assert.equal(selectionCentroidXZ({
      count: 1,
      selected: [1],
      alive: [0],
      renderX: [1],
      renderZ: [1],
    }), null);
    assert.equal(selectionCentroidXZ({}), null);
  });
});

describe('isCameraFollowTypingTarget', () => {
  it('treats form controls as typing targets', () => {
    assert.equal(isCameraFollowTypingTarget({ tagName: 'INPUT' }), true);
    assert.equal(isCameraFollowTypingTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isCameraFollowTypingTarget({ tagName: 'BUTTON' }), true);
    assert.equal(isCameraFollowTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isCameraFollowTypingTarget({ tagName: 'CANVAS' }), false);
    assert.equal(isCameraFollowTypingTarget(null), false);
  });
});
