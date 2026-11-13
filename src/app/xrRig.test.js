import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampXrHead,
  readQuestTouch,
  referenceOffset,
  shapeStick,
  stickAxes,
  xrStickMotion,
  xrJumpHead,
  xrFitHead,
  xrBreaksFollow,
  xrBreaksAltitude,
  xrHoldHead,
  cycleXrAltitude,
  toggleXrFollow,
  XR_ALTITUDE_BANDS,
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

describe('xrStickMotion', () => {
  it('lets either stick pan, and adds both when they throw the same way', () => {
    const lone = xrStickMotion({ stickX: 0, stickY: -1 }, { stickX: 0, stickY: 0 });
    assert.equal(lone.forward, 1);
    assert.equal(lone.strafe, 0);
    assert.equal(lone.yaw, 0);
    assert.equal(lone.zoom, 0);
    const both = xrStickMotion(
      { stickX: 0, stickY: -1 },
      { stickX: 0, stickY: -1 },
    );
    assert.equal(both.forward, 2);
    assert.equal(both.strafe, 0);
    const right = xrStickMotion({ stickX: 1, stickY: 0 }, { stickX: 0, stickY: 0 });
    assert.equal(right.strafe, 1);
    assert.equal(right.forward, 0);
    const left = xrStickMotion({ stickX: -0.25, stickY: 0 }, { stickX: -0.25, stickY: 0 });
    assert.equal(left.strafe, -0.5);
    const nudge = xrStickMotion({ stickX: 0.05, stickY: 0 }, { stickX: 0, stickY: 0 });
    assert.equal(nudge.strafe, 0.05);
    assert.equal(nudge.yaw, 0);
  });

  it('keeps the first stick panning while the other turns, and pinches in place', () => {
    const yaw = xrStickMotion(
      { stickX: 0, stickY: -0.8 },
      { stickX: 0, stickY: 0.8 },
    );
    assert.ok(yaw.yaw > 0);
    assert.equal(yaw.zoom, 0);
    assert.equal(yaw.forward, 0.8);
    assert.equal(yaw.panHand, 'left');
    const held = xrStickMotion(
      { stickX: 0, stickY: -0.4 },
      { stickX: 0, stickY: 1 },
      'left',
    );
    assert.equal(held.forward, 0.4);
    assert.equal(held.panHand, 'left');
    assert.ok(held.yaw > yaw.yaw);
    const feather = xrStickMotion(
      { stickX: 0, stickY: -0.05 },
      { stickX: 0, stickY: 0.05 },
    );
    assert.ok(feather.yaw > 0);
    assert.ok(feather.yaw < yaw.yaw);
    assert.equal(feather.forward, 0.05);
    const pinch = xrStickMotion(
      { stickX: 0.8, stickY: 0 },
      { stickX: -0.8, stickY: 0 },
    );
    assert.equal(pinch.zoom, 0.8);
    assert.equal(pinch.yaw, 0);
    assert.equal(pinch.strafe, 0);
    const spread = xrStickMotion(
      { stickX: -1, stickY: 0 },
      { stickX: 1, stickY: 0 },
    );
    assert.equal(spread.zoom, -1);
    assert.equal(spread.strafe, 0);
  });

  it('does not quiet a turn, and still quiets a hard pinch', () => {
    const hard = xrStickMotion(
      { stickX: 1, stickY: -1 },
      { stickX: 1, stickY: 1 },
    );
    assert.ok(hard.yaw > 0);
    assert.equal(hard.strafe, 2);
    assert.equal(hard.forward, 1);
    const light = xrStickMotion(
      { stickX: 1, stickY: -0.2 },
      { stickX: 1, stickY: 0.2 },
    );
    assert.ok(light.yaw > 0);
    assert.ok(light.yaw < hard.yaw);
    assert.equal(light.strafe, 2);
    assert.equal(light.forward, 0.2);
    const lift = xrStickMotion(
      { stickX: 1, stickY: -1 },
      { stickX: -1, stickY: -1 },
    );
    assert.equal(lift.zoom, 1);
    assert.equal(lift.yaw, 0);
    assert.ok(lift.forward < 0.2);
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

describe('xrFitHead', () => {
  it('keeps the orbit distance and puts the look-down on the target', () => {
    const fit = xrFitHead([0, 80, 40], { x: 0, y: 4, z: 0 }, () => 2);
    assert.equal(fit.eye[0], 0);
    assert.equal(fit.eye[2], 40);
    assert.ok(Math.abs(fit.eye[1] - (2 + 40 * Math.tan(XR_LOOK_DOWN))) < 1e-6);
    assert.ok(fit.facing[1] < 0);
    const reach = (fit.eye[1] - 2) / Math.tan(XR_LOOK_DOWN);
    assert.ok(Math.abs(fit.eye[2] + fit.facing[1] * reach) < 1e-4);
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

describe('xr holds', () => {
  const bounds = { floor: () => 0, maxY: 400, maxRange: 1000, clearance: 6 };

  it('a pan drops follow, including the stick that stays down while turning', () => {
    assert.equal(xrBreaksFollow({ stickX: 0, stickY: -0.6 }, { stickX: 0, stickY: 0 }), true);
    assert.equal(xrBreaksFollow({ stickX: 0, stickY: -1 }, { stickX: 0, stickY: 1 }), true);
    assert.equal(xrBreaksFollow({ stickX: -1, stickY: 0 }, { stickX: 1, stickY: 0 }), false);
    assert.equal(xrBreaksAltitude({ stickX: -0.6, stickY: 0 }, { stickX: 0.6, stickY: 0 }), true);
    assert.equal(xrBreaksAltitude({ stickX: 0, stickY: -1 }, { stickX: 0, stickY: 0 }), false);
    assert.equal(xrBreaksFollow({ stickX: 0.05, stickY: 0 }, { stickX: 0, stickY: 0 }), false);
  });

  it('follow eases toward the selection and stands back; altitude eases to the band', () => {
    const followed = xrHoldHead([0, 50, 0], [0, 1], {
      dt: 0.1,
      bounds,
      follow: true,
      followAt: { x: 0, z: 100 },
      altitudeIndex: null,
    });
    assert.ok(followed[2] > 20 && followed[2] < 100);
    assert.equal(followed[1], 50);

    const slope = { ...bounds, floor: (_x, z) => z };
    const hugged = xrHoldHead([0, 50, 10], [0, 1], {
      dt: 0.016,
      bounds: slope,
      follow: false,
      altitudeIndex: 0,
    });
    assert.equal(hugged[0], 0);
    assert.equal(hugged[2], 10);
    assert.equal(hugged[1], 10 + XR_ALTITUDE_BANDS[0]);

    const lifted = xrHoldHead([0, 50, 0], [0, 1], {
      dt: 0.1,
      bounds,
      follow: false,
      altitudeIndex: 1,
    });
    assert.equal(lifted[0], 0);
    assert.equal(lifted[2], 0);
    assert.ok(lifted[1] < 50 && lifted[1] > XR_ALTITUDE_BANDS[1]);
  });

  it('a break leaves that axis where the sticks put it', () => {
    const stayed = xrHoldHead([4, 50, 8], [0, 1], {
      dt: 0.1,
      bounds,
      follow: true,
      followAt: { x: 0, z: 100 },
      altitudeIndex: 2,
      breakFollow: true,
      breakAltitude: true,
    });
    assert.deepEqual(stayed, [4, 50, 8]);
  });

  it('altitude clicks walk the three bands and follow is a toggle', () => {
    const rig = { altitudePick: null, altitudeIndex: null, follow: false, followAt: { x: 1, z: 2 } };
    assert.equal(cycleXrAltitude(rig), 0);
    assert.equal(cycleXrAltitude(rig), 1);
    assert.equal(cycleXrAltitude(rig), 2);
    assert.equal(cycleXrAltitude(rig), 0);
    rig.altitudeIndex = null;
    assert.equal(cycleXrAltitude(rig), 1);
    toggleXrFollow(rig);
    assert.equal(rig.follow, true);
    toggleXrFollow(rig);
    assert.equal(rig.follow, false);
    assert.equal(rig.followAt, null);
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
