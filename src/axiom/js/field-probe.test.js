import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { probeSites } from './field-probe.js';

describe('probeSites', () => {
  it('places left and right on camera right', () => {
    const pose = {
      x: 10,
      y: 4,
      z: -2,
      billboard: { rx: 1, ry: 0, rz: 0 },
    };
    const s = probeSites(pose, 2);
    assert.equal(s.here.x, 10);
    assert.equal(s.left.x, 8);
    assert.equal(s.right.x, 12);
    assert.equal(s.left.y, 4);
    assert.equal(s.right.z, -2);
  });
});
