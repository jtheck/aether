import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arcBeamPoint, densifyLoop, handleButtonPoint, pickHandleButton } from './xrLasso.js';

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

  it('a ray from above the order pad hits it, and a far ray does not', () => {
    const p = handleButtonPoint(aim, 0);
    const press = { ox: p.x, oy: p.y, oz: p.z, dx: 0, dy: -1, dz: 0 };
    assert.equal(pickHandleButton(aim, press), 0);
    const select = handleButtonPoint(aim, 1);
    assert.equal(pickHandleButton(aim, { ox: select.x, oy: select.y, oz: select.z, dx: 0, dy: -1, dz: 0 }), 1);
    assert.equal(pickHandleButton(aim, { ox: 3, oy: 3, oz: 3, dx: 0, dy: -1, dz: 0 }), null);
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
