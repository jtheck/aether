import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRUSH_RADIUS_BOTH,
  BRUSH_RADIUS_MAX,
  BRUSH_RADIUS_MIN,
  appendBrushStamps,
  brushOuterLoop,
  brushRadiusTarget,
  brushViewStamps,
  convexHull2,
  lassoOuterLoop,
  stepBrushRadius,
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

describe('brushRadiusTarget', () => {
  it('stays at the floor on a light pull and fills the large brush on a full squeeze', () => {
    assert.equal(brushRadiusTarget(0), BRUSH_RADIUS_MIN);
    assert.equal(brushRadiusTarget(1), BRUSH_RADIUS_BOTH);
    assert.equal(BRUSH_RADIUS_BOTH, BRUSH_RADIUS_MAX * 2);
    const mid = brushRadiusTarget(0.5);
    assert.ok(mid > BRUSH_RADIUS_MIN);
    assert.ok(mid < BRUSH_RADIUS_BOTH);
  });

  it('eases toward the pressure target and snaps from an empty brush', () => {
    assert.equal(stepBrushRadius(0, BRUSH_RADIUS_BOTH), BRUSH_RADIUS_BOTH);
    const eased = stepBrushRadius(BRUSH_RADIUS_MIN, BRUSH_RADIUS_BOTH);
    assert.ok(eased > BRUSH_RADIUS_MIN && eased < BRUSH_RADIUS_BOTH);
  });
});

describe('appendBrushStamps', () => {
  it('keeps a still stamp, then fills a long swipe', () => {
    const stamps = [];
    appendBrushStamps(stamps, 10, 10, 40);
    appendBrushStamps(stamps, 12, 10, 40);
    assert.equal(stamps.length, 1);
    appendBrushStamps(stamps, 200, 10, 40);
    assert.ok(stamps.length > 3);
    assert.equal(stamps.at(-1).x, 200);
  });
});

describe('brushOuterLoop', () => {
  it('inflates a stamp into a disk the hatch can ride', () => {
    const loop = brushOuterLoop([{ x: 100, y: 80, r: 40 }]);
    assert.ok(loop.length >= 3);
    const minX = Math.min(...loop.map((p) => p.x));
    const maxX = Math.max(...loop.map((p) => p.x));
    assert.ok(maxX - minX >= 80);
    assert.ok(minX < 100 && maxX > 100);
  });

  it('covers the live tip when it has not been committed yet', () => {
    const stamps = [{ x: 0, y: 0, r: 20 }];
    const view = brushViewStamps(stamps, 80, 0, 20);
    const loop = brushOuterLoop(view);
    const maxX = Math.max(...loop.map((p) => p.x));
    assert.ok(maxX >= 90);
  });
});
