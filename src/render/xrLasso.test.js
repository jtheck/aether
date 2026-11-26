import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcBeamPoint,
  densifyLoop,
  handleButtonPoint,
  pickHandleButton,
  wristAimLocal,
  wristControlGroupId,
  wristGroupCenter,
  wristTriFacing,
  WRIST_CONTROL_GROUPS,
} from './xrLasso.js';

describe('arcBeamPoint', () => {
  const ray = { ox: 2, oy: 8, oz: 3, dx: 0, dy: 0, dz: 1, ux: 1, uy: 0, uz: 0 };

  it('keeps both ends on the ray and bows the middle up', () => {
    const start = arcBeamPoint(ray, 10, 0);
    const end = arcBeamPoint(ray, 10, 1);
    const mid = arcBeamPoint(ray, 10, 0.5);
    assert.ok(Math.abs(start.x - 2) < 1e-5 && Math.abs(start.y - 8) < 1e-5 && Math.abs(start.z - 3) < 1e-5);
    assert.ok(Math.abs(end.x - 2) < 1e-5 && Math.abs(end.y - 8) < 1e-5 && Math.abs(end.z - 13) < 1e-5);
    assert.ok(Math.abs(mid.x - 2) < 1e-5);
    assert.ok(Math.abs(mid.z - 8) < 1e-4);
    assert.ok(mid.y > 8.2 && mid.y < 8.5);
  });

  it('ignores wrist roll', () => {
    const rolled = { ...ray, ux: 0, uy: 1, uz: 0 };
    const a = arcBeamPoint(ray, 10, 0.5);
    const b = arcBeamPoint(rolled, 10, 0.5);
    assert.ok(Math.abs(a.y - b.y) < 1e-6);
    assert.ok(Math.abs(a.x - b.x) < 1e-6);
  });
});

describe('handle buttons', () => {
  const aim = { ox: 0, oy: 1.5, oz: 0, dx: 0, dy: 0, dz: 1, ux: 0, uy: 1, uz: 0 };

  it('hits a group triangle and the pause pad, and misses the old face buttons', () => {
    assert.equal(handleButtonPoint(aim, 0), null);
    assert.equal(handleButtonPoint(aim, 1), null);
    const grp = handleButtonPoint(aim, 2);
    assert.equal(pickHandleButton(aim, { ox: grp.x, oy: grp.y, oz: grp.z, dx: 0, dy: -1, dz: 0 }), 2);
    const pause = handleButtonPoint({ ...aim, hand: 'left' }, 5);
    const group = handleButtonPoint({ ...aim, hand: 'left' }, 4);
    assert.equal(pickHandleButton({ ...aim, hand: 'left' }, { ox: pause.x, oy: pause.y, oz: pause.z, dx: 0, dy: -1, dz: 0 }), 5);
    assert.ok(Math.abs(pause.y - group.y) < 1e-4);
    assert.ok(pause.z < group.z);
    assert.equal(pickHandleButton(aim, { ox: 3, oy: 3, oz: 3, dx: 0, dy: -1, dz: 0 }), null);
    assert.deepEqual(WRIST_CONTROL_GROUPS.left, [0, 1, 4]);
    assert.equal(wristControlGroupId('left', 2), 0);
    assert.equal(wristControlGroupId('right', 4), 5);
  });

  it('lays group triangles up the arm, alternating like the flat column', () => {
    const a = handleButtonPoint({ ...aim, hand: 'left' }, 2);
    const b = handleButtonPoint({ ...aim, hand: 'left' }, 3);
    const c = handleButtonPoint({ ...aim, hand: 'left' }, 4);
    assert.ok(a.z > b.z && b.z > c.z);
    assert.ok(a.z - b.z > 0.03 && b.z - c.z > 0.03);
    assert.ok(Math.abs((a.z + c.z) * 0.5 - b.z) < 1e-4);
    assert.deepEqual(
      [0, 1, 2].map((i) => wristTriFacing('left', i)),
      [1, -1, 1],
    );
    assert.deepEqual(
      [0, 1, 2].map((i) => wristTriFacing('right', i)),
      [-1, 1, -1],
    );
    assert.ok(wristGroupCenter(0)[1] > wristGroupCenter(2)[1]);
  });

  it('marks where the other ray meets the bracer, and ignores a miss', () => {
    const center = wristGroupCenter(1);
    const hit = handleButtonPoint({ ...aim, hand: 'right' }, 3);
    const over = { ox: hit.x, oy: hit.y + 0.04, oz: hit.z, dx: 0, dy: -1, dz: 0 };
    const aimLocal = wristAimLocal({ ...aim, hand: 'right' }, over);
    assert.ok(aimLocal);
    assert.ok(Math.abs(aimLocal.z - center[1]) < 0.02);
    assert.equal(wristAimLocal(aim, { ox: 3, oy: 3, oz: 3, dx: 0, dy: -1, dz: 0 }), null);
  });
});

describe('densifyLoop', () => {
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];

  it('splits long edges, keeps corners, and carries z in y', () => {
    const pts = densifyLoop(square, 2.5, 100);
    assert.equal(pts.length, 16);
    assert.deepEqual(pts[4], { x: 10, y: 0 });
    assert.deepEqual(pts[8], { x: 10, y: 10 });
  });

  it('widens the step to stay under the point cap', () => {
    assert.ok(densifyLoop(square, 0.01, 40).length <= 40);
  });
});
