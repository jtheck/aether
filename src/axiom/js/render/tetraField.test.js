import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTetraPlacements, isSlowTetraDevice, tetraGridStep } from './tetraField.js';

describe('tetra field grid', () => {
  it('halves the instance count on a slow device', () => {
    const full = buildTetraPlacements(false);
    const half = buildTetraPlacements(true);
    assert.equal(full.step, 0.75);
    assert.ok(Math.abs(half.step - 0.75 * Math.SQRT2) < 1e-9);
    const ratio = half.count / full.count;
    assert.ok(ratio > 0.4 && ratio < 0.6, `expected about half, got ${half.count}/${full.count}`);
  });

  it('treats <=4 GB or a coarse 4-core device as slow', () => {
    assert.equal(isSlowTetraDevice({ deviceMemory: 4, hardwareConcurrency: 8 }, () => ({ matches: false })), true);
    assert.equal(isSlowTetraDevice({ deviceMemory: 8, hardwareConcurrency: 8 }, () => ({ matches: false })), false);
    assert.equal(isSlowTetraDevice({ hardwareConcurrency: 4 }, () => ({ matches: true })), true);
    assert.equal(isSlowTetraDevice({ hardwareConcurrency: 4 }, () => ({ matches: false })), false);
  });

  it('writes a static identity translation with Y left at 0', () => {
    const { matrices, xs, zs, count } = buildTetraPlacements(false);
    assert.equal(matrices.length, count * 16);
    assert.equal(matrices[12], xs[0]);
    assert.equal(matrices[13], 0);
    assert.equal(matrices[14], zs[0]);
    assert.equal(matrices[15], 1);
  });
});
