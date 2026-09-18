import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_CONFIRM_HIT_PX,
  SCENE_CONFIRM_LABEL,
  SCENE_CONFIRM_LIFT_PX,
  SCENE_CONFIRM_WORLD_LIFT,
  sceneConfirmCanvasPos,
  sceneConfirmHitAt,
  sceneConfirmWorldPos,
} from './sceneConfirm.js';

describe('scene confirm mark', () => {
  it('labels the mark 1^ and lifts it above the world point', () => {
    assert.equal(SCENE_CONFIRM_LABEL, '1^');
    assert.deepEqual(sceneConfirmWorldPos(10, 2, -4), {
      x: 10,
      y: 2 + SCENE_CONFIRM_WORLD_LIFT,
      z: -4,
    });
  });

  it('sits above the projected point in canvas space', () => {
    assert.deepEqual(sceneConfirmCanvasPos({ x: 200, y: 180 }), {
      x: 200,
      y: 180 - SCENE_CONFIRM_LIFT_PX,
    });
    assert.equal(sceneConfirmCanvasPos(null), null);
    assert.equal(sceneConfirmCanvasPos({ x: NaN, y: 10 }), null);
  });

  it('hits a circle around the mark and misses outside it', () => {
    const c = { x: 100, y: 80 };
    assert.equal(sceneConfirmHitAt(c, 100, 80), true);
    assert.equal(sceneConfirmHitAt(c, 100 + SCENE_CONFIRM_HIT_PX, 80), true);
    assert.equal(sceneConfirmHitAt(c, 100 + SCENE_CONFIRM_HIT_PX + 1, 80), false);
    assert.equal(sceneConfirmHitAt(null, 100, 80), false);
  });
});
