import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampXrHead,
  readQuestTouch,
  referenceOffset,
  shapeStick,
  stickAxes,
  xrJumpHead,
  lookDownOffset,
  smoothFlatDirection,
  yawBetween,
  XR_LOOK_FOLLOW,
  XR_LOOK_SNAP,
  XR_LOOK_DOWN,
} from './xrRig.js';

describe('readQuestTouch', () => {
  it('names the Quest 1 trigger, grip, stick, and face buttons', () => {
    const pad = {
      buttons: [
        { value: 0.4, pressed: true },
        { value: 1, pressed: true },
        { value: 1, pressed: true },
        { value: 0, pressed: false },
        { value: 1, pressed: true },
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

  it('reads Y/B and X/A from an xr-standard pad', () => {
    const buttons = [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false, value: 0 }));
    buttons[3].pressed = true;
    buttons[5].pressed = true;
    const touch = readQuestTouch({ mapping: 'xr-standard', buttons, axes: [0, 0, 0, 0] });
    assert.equal(touch.stickClick.pressed, true);
    assert.equal(touch.primary.pressed, true);
    assert.equal(touch.secondary.pressed, false);
    buttons[4].pressed = true;
    const cancel = readQuestTouch({ mapping: 'xr-standard', buttons, axes: [0, 0, 0, 0] });
    assert.equal(cancel.secondary.pressed, true);
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

describe('xrJumpHead', () => {
  it('keeps the height and stands back along the facing so the target is ahead', () => {
    const dest = xrJumpHead([0, 50, 0], [0, 1], { x: 100, z: 100 }, { floor: () => 0, maxY: 400, maxRange: 1000 });
    assert.equal(dest[1], 50);
    assert.equal(dest[0], 100);
    assert.ok(dest[2] < 100 && dest[2] > 40);
  });

  it('clamps into the play bounds', () => {
    const dest = xrJumpHead([0, 50, 0], [1, 0], { x: 500, z: 0 }, { floor: () => 0, maxY: 400, maxRange: 200 });
    assert.ok(Math.hypot(dest[0], dest[2]) <= 200.001);
  });
});

describe('lookDownOffset', () => {
  it('keeps the head in place while pitching the space down', () => {
    const head = [10, 80, -4];
    const t = lookDownOffset(head, [1, 0], XR_LOOK_DOWN);
    const hx = head[0];
    const hy = head[1];
    const hz = -head[2];
    const c = Math.cos(XR_LOOK_DOWN);
    const s = Math.sin(XR_LOOK_DOWN);
    const rx = hx;
    const ry = hy * c - hz * s;
    const rz = hy * s + hz * c;
    assert.ok(Math.abs(t.position.x - (hx - rx)) < 1e-9);
    assert.ok(Math.abs(t.position.y - (hy - ry)) < 1e-9);
    assert.ok(Math.abs(t.position.z - (hz - rz)) < 1e-9);
    assert.ok(t.orientation.x > 0);
  });
});

describe('yawBetween', () => {
  it('is zero when already aligned and ±π when opposite', () => {
    assert.ok(Math.abs(yawBetween([0, 1], [0, 1])) < 1e-9);
    assert.ok(Math.abs(Math.abs(yawBetween([0, 1], [0, -1])) - Math.PI) < 1e-9);
  });
});

describe('smoothFlatDirection', () => {
  const direction = (degrees) => {
    const angle = degrees * Math.PI / 180;
    return [Math.sin(angle), Math.cos(angle)];
  };

  it('follows the short arc across the angle wrap', () => {
    const from = direction(179);
    const target = direction(-179);
    const next = smoothFlatDirection(from, target, 0.1);
    assert.ok(next[1] < -0.99);
    assert.ok(Math.abs(yawBetween(next, target)) < Math.abs(yawBetween(from, target)));
  });

  it('catches a large turn faster, then rides out the final adjustment', () => {
    const from = direction(0);
    const largeTarget = direction(90);
    const smallTarget = direction(5);
    const large = smoothFlatDirection(from, largeTarget, 0.016);
    const small = smoothFlatDirection(from, smallTarget, 0.016);
    const largeFraction = yawBetween(from, large) / yawBetween(from, largeTarget);
    const smallFraction = yawBetween(from, small) / yawBetween(from, smallTarget);
    assert.ok(XR_LOOK_SNAP > XR_LOOK_FOLLOW);
    assert.ok(largeFraction > smallFraction * 2);
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
