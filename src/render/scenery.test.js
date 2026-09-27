import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { treeScaleForStage } from '../sim/trees.js';
import { treeFireHeight } from './treeFire.js';
import { treeBurnSinkDepth, treeBurnSinkDrop, treeTintRgb } from './scenery.js';

function luma(rgb) {
  return rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
}

describe('tree tint', () => {
  it('keeps natural-size tints on the old small→mature ramp', () => {
    const sapling = treeTintRgb(treeScaleForStage(1), 10);
    const mature = treeTintRgb(treeScaleForStage(6), 10);
    assert.ok(luma(sapling) > luma(mature), 'saplings stay brighter');
    assert.ok(sapling[1] > 0.2, 'saplings stay leafy');
  });

  it('keeps darkening past the natural cap instead of clamping', () => {
    const tile = 44;
    const natural = treeTintRgb(treeScaleForStage(6), tile);
    const giant = treeTintRgb(treeScaleForStage(12), tile);
    assert.ok(luma(giant) < luma(natural) - 0.01, 'grove scale is a darker stop');
  });

  it('lets same-size giants differ in color', () => {
    const scale = treeScaleForStage(11);
    const a = treeTintRgb(scale, 2);
    const b = treeTintRgb(scale, 9);
    const delta = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    assert.ok(delta > 0.02, 'overgrowth still has per-tile color scatter');
  });

  it('eases grove color in instead of switching at the cap', () => {
    const tile = 44;
    const mature = treeTintRgb(treeScaleForStage(6), tile);
    const justOver = treeTintRgb(treeScaleForStage(7), tile);
    const giant = treeTintRgb(treeScaleForStage(12), tile);
    const toMature = Math.abs(luma(justOver) - luma(mature));
    const toGiant = Math.abs(luma(justOver) - luma(giant));
    assert.ok(toMature < toGiant, 'first extra stage still reads as a mature tree');
  });
});

describe('burned tree sink', () => {
  it('buries the crown without changing scale', () => {
    const scale = treeScaleForStage(6);
    const depth = treeBurnSinkDepth(scale);
    assert.ok(depth > treeFireHeight(scale), 'the tip clears the surface');
    assert.equal(treeBurnSinkDrop(0, depth), 0);
    assert.equal(treeBurnSinkDrop(1, depth), depth);
    const mid = treeBurnSinkDrop(0.5, depth);
    assert.ok(mid > depth * 0.5, 'the drop starts right away');
    assert.ok(mid < depth);
  });
});
