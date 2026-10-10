import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { densifyLoop } from './xrLasso.js';

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
