import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN, buildField } from '../sim/field.js';
import { applyTableSilhouette, createFullCellMask, createFullCellRadius } from '../sim/tableShape.js';
import { exitLabel, markChapterExit } from './exits.js';

describe('chapter exits', () => {
  it('paints a dirt road from the spawn to the pad', () => {
    const field = buildField(3, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    markChapterExit(field, 8, 20, { tx: 8, tz: 10, r: 4 });
    assert.equal(field.terrainTypes[10 * 32 + 8], TERRAIN.DIRT);
    assert.equal(field.terrainTypes[15 * 32 + 8], TERRAIN.DIRT);
  });

  it('labels a departing zone as EXIT', () => {
    assert.equal(exitLabel({ kind: 'escape', next: '/maps/chapter3.garden' }), 'EXIT');
    assert.equal(exitLabel({ kind: 'reach', label: 'Scout the far ridge' }), 'HERE');
  });
});
