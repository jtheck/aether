import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampXrHead, readQuestTouch, referenceOffset, shapeStick, stickAxes } from './xrRig.js';

describe('readQuestTouch', () => {
  it('names the Quest 1 trigger, grip, stick, and face buttons', () => {
    const pad = {
      buttons: [
        { value: 0.4, pressed: true },
        { value: 1, pressed: true },
        { value: 1, pressed: true },
        { value: 1, pressed: true },
        { value: 0, pressed: false },
      ],
      axes: [0.5, -0.8],
    };
    const touch = readQuestTouch(pad);
    assert.equal(touch.trigger.value, 0.4);
    assert.equal(touch.grip.pressed, true);
    assert.equal(touch.stickClick.pressed, true);
    assert.equal(touch.primary.pressed, true);
    assert.equal(touch.secondary.pressed, false);
    assert.equal(touch.stickX, 0.5);
    assert.equal(touch.stickY, -0.8);
  });

  it('reads the stick from axes 2 and 3 when the touchpad slot is present', () => {
    const touch = readQuestTouch({
      buttons: [],
      axes: [0, 0, -0.4, 0.7],
    });
    assert.equal(touch.stickX, -0.4);
    assert.equal(touch.stickY, 0.7);
    assert.deepEqual(stickAxes([0.2, -0.3]), [0.2, -0.3]);
  });

  it('stays released when the gamepad is missing', () => {
    const touch = readQuestTouch(null);
    assert.equal(touch.trigger.pressed, false);
    assert.equal(touch.stickX, 0);
    assert.equal(touch.stickY, 0);
  });
});

describe('shapeStick', () => {
  it('ignores a stick that rests inside the deadzone', () => {
    assert.deepEqual(shapeStick(0.05, 0.28), [0, 0]);
  });

  it('ramps from zero once the stick leaves the deadzone', () => {
    const [x, y] = shapeStick(0, -0.35);
    assert.equal(x, 0);
    assert.ok(Math.abs(y) < 0.02);
    const pushed = shapeStick(0, -1);
    assert.ok(Math.abs(pushed[1]) > 0.9);
  });
});

describe('clampXrHead', () => {
  const bounds = {
    floor: () => 4,
    clearance: 6,
    maxY: 40,
    maxRange: 20,
  };

  it('stays above the ground and inside the play radius', () => {
    assert.deepEqual(clampXrHead([0, 1, 0], bounds), [0, 10, 0]);
    assert.deepEqual(clampXrHead([0, 80, 0], bounds), [0, 40, 0]);
    const far = clampXrHead([30, 12, 0], bounds);
    assert.ok(Math.hypot(far[0], far[2]) <= 20.001);
    assert.equal(far[1], 12);
  });
});

describe('referenceOffset', () => {
  it('moves a tracked head onto a scene point', () => {
    assert.deepEqual(referenceOffset([0, 1.6, 0], [10, 80, -4]), {
      x: -10,
      y: 1.6 - 80,
      z: -4,
    });
  });
});
