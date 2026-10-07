import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeAnchoredOrbit, xrShadowDepth } from './xrEye.js';

describe('writeAnchoredOrbit', () => {
  it('looks at the ground under the head from the desktop orbit angle', () => {
    const out = new Float32Array(16);
    const radius = writeAnchoredOrbit(out, 10, 30, -4, 5, 0, Math.PI / 3.2);
    assert.equal(radius, 25);
    const sinB = Math.sin(Math.PI / 3.2);
    const cosB = Math.cos(Math.PI / 3.2);
    assert.ok(Math.abs(out[12] - (10 + 25 * sinB)) < 1e-6);
    assert.ok(Math.abs(out[13] - (5 + 25 * cosB)) < 1e-6);
    assert.ok(Math.abs(out[14] - -4) < 1e-6);
    assert.ok(out[13] > 5);
  });

  it('keeps the ground under the head inside the first shadow slice', () => {
    for (const radius of [12, 25, 40, 80]) {
      for (const cascades of [2, 3, 4]) {
        const { near, far } = xrShadowDepth(radius);
        const range = far - near;
        const ratio = far / near;
        const p = 1 / cascades;
        const log = near * ratio ** p;
        const uniform = near + range * p;
        const firstFar = 0.5 * (log - uniform) + uniform;
        assert.ok(radius < firstFar, `radius ${radius} cascades ${cascades}`);
        assert.ok(radius < far);
      }
    }
  });
});
