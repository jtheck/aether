import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectWorldToCanvas } from './screenProject.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('projectWorldToCanvas', () => {
  it('maps the origin through identity VP to the canvas center', () => {
    const out = { x: -1, y: -1 };
    assert.equal(projectWorldToCanvas(IDENTITY, 0, 0, 0, 200, 100, out), true);
    assert.equal(out.x, 100);
    assert.equal(out.y, 50);
  });

  it('flips NDC Y so +Y is the top of the canvas', () => {
    const out = { x: 0, y: 0 };
    assert.equal(projectWorldToCanvas(IDENTITY, 1, 1, 0, 200, 100, out), true);
    assert.equal(out.x, 200);
    assert.equal(out.y, 0);
  });

  it('rejects a degenerate clip w', () => {
    const out = { x: 9, y: 9 };
    assert.equal(projectWorldToCanvas(IDENTITY, 0, 0, 0, 100, 100, out), true);
    const zeroW = IDENTITY.slice();
    zeroW[15] = 0;
    assert.equal(projectWorldToCanvas(zeroW, 0, 0, 0, 100, 100, out), false);
    assert.equal(out.x, 50);
    assert.equal(out.y, 50);
  });
});
