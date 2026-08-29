import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_POSE_RATE, chasePoseXZ } from './poseInterp.js';

describe('chasePoseXZ', () => {
  it('moves toward the target without overshooting in one frame', () => {
    const a = chasePoseXZ(0, 0, 2, 0, 1 / 60, FOLLOW_POSE_RATE, { x: 0, z: 0 });
    assert.ok(a.x > 0 && a.x < 2);
    assert.equal(a.z, 0);
  });

  it('filters a 20Hz pose snap harder than a raw step', () => {
    const snap = 2;
    const a = chasePoseXZ(0, 0, snap, 0, 1 / 60, FOLLOW_POSE_RATE, { x: 0, z: 0 });
    assert.ok(a.x < snap * 0.25);
  });

  it('settles on the target after a short hold', () => {
    let x = 0;
    let z = 0;
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 40; i++) {
      ({ x, z } = chasePoseXZ(x, z, 8, -4, 1 / 60, FOLLOW_POSE_RATE, out));
    }
    assert.ok(Math.abs(x - 8) < 0.2);
    assert.ok(Math.abs(z + 4) < 0.2);
  });
});
