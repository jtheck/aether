import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeCornerUv, canvasPointToNdc, canvasRectToNdc, inwardNormals } from './selectionBox.js';

describe('selection box NDC', () => {
  it('maps the full canvas to the NDC cube', () => {
    const ndc = canvasRectToNdc(0, 0, 200, 100, 200, 100);
    assert.equal(ndc.left, -1);
    assert.equal(ndc.right, 1);
    assert.equal(ndc.top, 1);
    assert.equal(ndc.bottom, -1);
  });

  it('flips canvas Y so the top edge is +NDC Y', () => {
    const ndc = canvasRectToNdc(0, 0, 50, 20, 200, 100);
    assert.equal(ndc.left, -1);
    assert.equal(ndc.right, -0.5);
    assert.equal(ndc.top, 1);
    assert.equal(ndc.bottom, 0.6);
  });

  it('picks the UV corner under the live pointer', () => {
    assert.deepEqual(activeCornerUv(10, 20, 80, 90, 80, 90), { u: 1, v: 1 });
    assert.deepEqual(activeCornerUv(10, 20, 80, 90, 10, 20), { u: 0, v: 0 });
    assert.deepEqual(activeCornerUv(10, 20, 80, 90, 10, 90), { u: 0, v: 1 });
    assert.deepEqual(activeCornerUv(10, 20, 80, 90, 80, 20), { u: 1, v: 0 });
  });

  it('maps a canvas pixel to NDC', () => {
    assert.deepEqual(canvasPointToNdc(0, 0, 200, 100), { x: -1, y: 1 });
    assert.deepEqual(canvasPointToNdc(200, 100, 200, 100), { x: 1, y: -1 });
  });

  it('points inward normals into a Y-down rectangle', () => {
    const { nx, ny } = inwardNormals([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ]);
    assert.ok(ny[0] > 0.5);
    assert.ok(nx[1] < -0.5);
    assert.ok(ny[2] < -0.5);
    assert.ok(nx[3] > 0.5);
  });
});
