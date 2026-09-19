import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull2,
  lassoOuterLoop,
} from './gamepadLasso.js';

describe('convexHull2', () => {
  it('keeps the outer square and drops the interior point', () => {
    const hull = convexHull2([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ]);
    assert.equal(hull.length, 4);
    assert.equal(hull.some((p) => p.x === 5 && p.y === 5), false);
  });
});

describe('lassoOuterLoop', () => {
  it('keeps only the outer hull of a scribble that cuts through itself', () => {
    const loop = lassoOuterLoop([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
      { x: 20, y: 20 },
      { x: 35, y: 8 },
    ]);
    assert.equal(loop.length, 4);
    assert.equal(loop.some((p) => p.x === 20 && p.y === 20), false);
    assert.equal(screenHas(loop, 0, 0), true);
    assert.equal(screenHas(loop, 40, 40), true);
  });
});

function screenHas(pts, x, y) {
  return pts.some((p) => p.x === x && p.y === y);
}
