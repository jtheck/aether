import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundFireDetail,
  treeFireDetail,
  treeCanopySmokeBuild,
  TREE_SMOKE_WARM_MS,
} from './fireBudget.js';

describe('fire lod budget', () => {
  it('keeps a close lone tree on several tongues', () => {
    const d = treeFireDetail(10, 1);
    assert.equal(d.anchorCount, 6);
    assert.ok(d.density > 0.7);
    assert.equal(d.wisps, 3);
    assert.equal(d.smoke, true);
    assert.equal(d.embers, true);
    assert.equal(d.plumeMul, 2);
  });

  it('ramps canopy smoke from visible time even without burn ticks', () => {
    assert.equal(treeCanopySmokeBuild(0, 0), 0);
    assert.ok(treeCanopySmokeBuild(900, 0) > 0.05);
    assert.ok(treeCanopySmokeBuild(TREE_SMOKE_WARM_MS, 0) > 0.4);
    assert.ok(treeCanopySmokeBuild(TREE_SMOKE_WARM_MS, 800) > treeCanopySmokeBuild(TREE_SMOKE_WARM_MS, 0));
  });

  it('thins a grove so total tongues stay bounded', () => {
    const one = treeFireDetail(10, 1);
    const many = treeFireDetail(10, 16);
    const oneWeight = one.anchorCount * one.density * one.wisps;
    const manyWeight = many.anchorCount * many.density * many.wisps * 16;
    assert.ok(many.anchorCount < one.anchorCount);
    assert.ok(many.density < one.density);
    assert.equal(many.embers, false);
    assert.equal(many.smoke, true);
    assert.ok(manyWeight < oneWeight * 4, 'sixteen trees cost a few times one tree, not sixteen');
  });

  it('drops far trees to a couple of tongues and no smoke', () => {
    const far = treeFireDetail(140, 1);
    const mid = treeFireDetail(100, 12);
    const near = treeFireDetail(10, 1);
    assert.equal(far.anchorCount, 2);
    assert.equal(far.smoke, false);
    assert.equal(mid.smoke, true);
    assert.equal(far.embers, false);
    assert.ok(far.density < near.density);
  });

  it('shares ground-fire hearths across a volley', () => {
    const one = groundFireDetail(10, 1);
    const many = groundFireDetail(10, 10);
    assert.ok(one.sites >= 3);
    assert.ok(many.sites <= 2);
    assert.ok(many.sites * many.density * 10 < one.sites * one.density * 4);
  });
});