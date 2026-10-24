import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bentBeamPoint, densifyLoop } from './xrLasso.js';

describe('bentBeamPoint', () => {
  it('bows toward gravity without moving either targeting endpoint', () => {
    const ray = { ox: 2, oy: 8, oz: 3, dx: 0, dy: 0, dz: 1 };
    assert.deepEqual(bentBeamPoint(ray, 10, 2, 0), { x: 2, y: 8, z: 3 });
    assert.deepEqual(bentBeamPoint(ray, 10, 2, 1), { x: 2, y: 8, z: 13 });
    assert.deepEqual(bentBeamPoint(ray, 10, 2, 0.5), { x: 2, y: 6, z: 8 });
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
