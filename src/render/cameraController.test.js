import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_ZIP_RATE, chaseToward } from './cameraController.js';

describe('chaseToward', () => {
  it('moves toward the target without overshooting in one frame', () => {
    const a = chaseToward(0, 0, 100, 0, 1 / 60, FOLLOW_ZIP_RATE);
    assert.ok(a.x > 0 && a.x < 100);
    assert.equal(a.z, 0);
  });

  it('settles on the target after a short hold', () => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < 30; i++) {
      ({ x, z } = chaseToward(x, z, 80, -40, 1 / 60, FOLLOW_ZIP_RATE));
    }
    assert.ok(Math.abs(x - 80) < 0.5);
    assert.ok(Math.abs(z + 40) < 0.5);
  });

  it('stays put when already on the target', () => {
    const a = chaseToward(5, 7, 5, 7, 0.016, FOLLOW_ZIP_RATE);
    assert.equal(a.x, 5);
    assert.equal(a.z, 7);
  });
});
