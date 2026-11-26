import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { menuTargetsAreSquares, squareStickPick } from './squareStick.js';

// Agora squares: categories on the left, buildings on the right, Close under
// the categories so it hangs below the building column.
const build = {
  inner: [
    { kind: 'category', id: 'basic', x: 100, y: 100, w: 132, h: 74, ring: 'inner' },
    { kind: 'category', id: 'advanced', x: 100, y: 182, w: 132, h: 74, ring: 'inner' },
    { kind: 'close', x: 100, y: 346, w: 132, h: 74, ring: 'inner' },
  ],
  outer: [
    { kind: 'building', id: 'house', x: 240, y: 100, w: 214, h: 74, ring: 'outer' },
    { kind: 'building', id: 'barracks', x: 240, y: 182, w: 214, h: 74, ring: 'outer' },
    { kind: 'building', id: 'tower', x: 240, y: 264, w: 214, h: 74, ring: 'outer' },
  ],
};

// Two columns of orders, then Pause / Cancel on the bottom row.
const action = {
  inner: [],
  outer: [
    { kind: 'unit', id: 'villager', x: 100, y: 100, w: 214, h: 74 },
    { kind: 'unit', id: 'soldier', x: 322, y: 100, w: 214, h: 74 },
    { kind: 'unit', id: 'archer', x: 100, y: 182, w: 214, h: 74 },
    { kind: 'upgrade', id: 'steel', x: 322, y: 182, w: 214, h: 74 },
    { kind: 'pause', x: 100, y: 264, w: 214, h: 74 },
    { kind: 'cancel', x: 322, y: 264, w: 214, h: 74 },
  ],
};

describe('menuTargetsAreSquares', () => {
  it('accepts button boxes and leaves pie slices alone', () => {
    assert.equal(menuTargetsAreSquares(build), true);
    assert.equal(menuTargetsAreSquares({
      inner: [{ kind: 'category', id: 'basic', ang: -Math.PI / 2 }],
      outer: [],
    }), false);
  });
});

describe('squareStickPick', () => {
  it('points the stick at a button, including a full throw toward the left column', () => {
    const up = squareStickPick({ lx: 0, ly: -1, rx: 0, ry: 0 }, build);
    assert.equal(up.id, 'house');

    const left = squareStickPick({ lx: -1, ly: -1, rx: 0, ry: 0 }, build);
    assert.equal(left.kind, 'category');
    assert.equal(left.id, 'basic');

    const downRight = squareStickPick({ lx: 1, ly: 0.45, rx: 0, ry: 0 }, build);
    assert.equal(downRight.id, 'tower');

    const close = squareStickPick({ lx: -1, ly: 1, rx: 0, ry: 0 }, build);
    assert.equal(close.kind, 'close');
  });

  it('walks a production grid, utilities included', () => {
    const topRight = squareStickPick({ lx: 1, ly: -1, rx: 0, ry: 0 }, action);
    assert.equal(topRight.id, 'soldier');
    const bottomLeft = squareStickPick({ lx: -1, ly: 1, rx: 0, ry: 0 }, action);
    assert.equal(bottomLeft.kind, 'pause');
    const bottomRight = squareStickPick({ lx: 1, ly: 1, rx: 0, ry: 0 }, action);
    assert.equal(bottomRight.kind, 'cancel');
  });

  it('lets the stronger stick aim', () => {
    const pick = squareStickPick({ lx: 0, ly: -0.4, rx: -1, ry: -1 }, build);
    assert.equal(pick.id, 'basic');
  });

  it('clears when the stick is centered', () => {
    assert.equal(squareStickPick({ lx: 0, ly: 0, rx: 0, ry: 0 }, build), null);
    assert.equal(squareStickPick({ lx: 0.1, ly: -0.1, rx: 0, ry: 0 }, action), null);
  });

  it('keeps the aimed button across the gap until the next one is closer', () => {
    const aimed = squareStickPick({ lx: -1, ly: -1, rx: 0, ry: 0 }, build);
    assert.equal(aimed.id, 'basic');
    const slip = squareStickPick({ lx: -0.35, ly: -1, rx: 0, ry: 0 }, build, aimed);
    assert.equal(slip.id, 'basic');
    const crossed = squareStickPick({ lx: 0.2, ly: -1, rx: 0, ry: 0 }, build, aimed);
    assert.equal(crossed.id, 'house');
  });
});
