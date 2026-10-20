import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTICLE_CULL_MAX_RANGE,
  PARTICLE_CULL_MIN_RANGE,
  cullRange,
  particleEyeDistSq,
  streamPullAccel,
} from './particleSystem.js';

describe('particle cull range', () => {
  it('caps ordinary puffs at the spark max', () => {
    assert.equal(cullRange(2.4, 1, 0), PARTICLE_CULL_MAX_RANGE);
    assert.equal(cullRange(0.02, 1, 0), PARTICLE_CULL_MIN_RANGE);
  });

  it('lets a body effect lift the cap', () => {
    assert.equal(cullRange(2.4, 1, 1600), 1600);
    assert.ok(Math.abs(cullRange(2.4, 0.55, 1600) - 880) < 1e-6);
  });

  it('measures cull distance on XZ only', () => {
    const eye = { x: 0, y: 50, z: 0 };
    assert.equal(particleEyeDistSq(eye, 30, 0, 40), 30 * 30 + 40 * 40);
  });
});

describe('stream pull', () => {
  const stream = { origin: [0, 0, 0], axis: [1, 0, 0], k: 32, delay: 0.1 };

  it('waits out the bloom, then accelerates onto the stream line', () => {
    assert.equal(streamPullAccel([0, 2, 0], stream, 0.05), null);
    const pull = streamPullAccel([3, 2, -1], stream, 0.2);
    assert.ok(Math.abs(pull[0]) < 1e-6);
    assert.ok(pull[1] < 0);
    assert.ok(pull[2] > 0);
  });

  it('leaves a seed already on the line alone', () => {
    const pull = streamPullAccel([4, 0, 0], stream, 0.4);
    assert.ok(Math.abs(pull[0]) < 1e-6);
    assert.ok(Math.abs(pull[1]) < 1e-6);
    assert.ok(Math.abs(pull[2]) < 1e-6);
  });
});
