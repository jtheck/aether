import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTICLE_CULL_MAX_RANGE,
  PARTICLE_CULL_MIN_RANGE,
  cullRange,
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
});
