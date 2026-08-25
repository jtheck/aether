import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildField, isPassable, isSlowTile } from './field.js';
import {
  applyTableSilhouette,
  createFullCellMask,
  cellCounts,
  setCellEnabled,
  silhouetteLoops,
  tileCenterWorld,
} from './tableShape.js';
import { encodeGarden, decodeGarden, fieldFromGarden } from './garden.js';

function makeLMask(width, height, cellSize = 16) {
  const { chunksX, chunksZ } = cellCounts(width, height, cellSize);
  const mask = createFullCellMask(width, height, cellSize);
  mask.fill(0);
  const shape = { cellMask: mask, chunksX, chunksZ };
  setCellEnabled(shape, 0, 0, true);
  setCellEnabled(shape, 1, 0, true);
  setCellEnabled(shape, 0, 1, true);
  return mask;
}

describe('table silhouette', () => {
  it('marks disabled cells void and L playable on remaining cells', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const cellMask = makeLMask(32, 32, 16);
    applyTableSilhouette(field, { cellSize: 16, cellMask, cornerRadius: 0 });
    assert.equal(field.activeMask[0], 1);
    const voidTx = 24;
    const voidTz = 24;
    assert.equal(field.activeMask[voidTz * 32 + voidTx], 0);
    assert.equal(isPassable(field, voidTx, voidTz), false);
  });

  it('marks edge-intersect tiles blocked and their neighbors slow', () => {
    const field = buildField(1, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cornerRadius: 0,
    });
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(isSlowTile(field, 1, 8), true);
    assert.equal(isPassable(field, 8, 8), true);
    assert.equal(isSlowTile(field, 8, 8), false);
  });

  it('cuts a center hole to void with a blocked rim', () => {
    const field = buildField(1, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cornerRadius: 0,
      holes: [{ x: 0, z: 0, r: 10 }],
    });
    const c = tileCenterWorld(field, 16, 16);
    assert.ok(Math.hypot(c.x, c.z) < 4);
    assert.equal(field.activeMask[16 * 32 + 16], 0);
    let rimBlocked = 0;
    for (let tz = 0; tz < 32; tz++) {
      for (let tx = 0; tx < 32; tx++) {
        if (field.activeMask[tz * 32 + tx] && !isPassable(field, tx, tz)) rimBlocked++;
      }
    }
    assert.ok(rimBlocked > 4);
  });

  it('builds an outer rail loop and a hole loop', () => {
    const field = buildField(1, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cornerRadius: 8,
      holes: [{ x: 0, z: 0, r: 10 }],
    });
    const loops = silhouetteLoops(field, field.tableShape);
    assert.ok(loops.length >= 2);
    assert.ok(loops[0].length >= 8);
    assert.ok(loops.some((loop) => loop.length >= 30));
  });
});

describe('garden v3', () => {
  it('roundtrips w/h/s/cs/cm/cr/hl/t', () => {
    const field = buildField(99, { width: 32, height: 32 });
    const cellMask = makeLMask(32, 32, 16);
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask,
      cornerRadius: 8,
      holes: [{ x: -20, z: 12, r: 6 }],
    });
    const json = encodeGarden(field, { name: 'test' });
    const g = decodeGarden(json);
    assert.equal(g.width, 32);
    assert.equal(g.height, 32);
    assert.equal(g.seed, 99);
    assert.equal(g.cellSize, 16);
    assert.equal(g.cornerRadius, 8);
    assert.equal(g.holes.length, 1);
    assert.equal(g.holes[0].r, 6);
    assert.deepEqual(Array.from(g.cellMask), Array.from(cellMask));
    assert.equal(g.terrainTypes.length, 32 * 32);

    const again = fieldFromGarden(json);
    const json2 = encodeGarden(again);
    assert.equal(json2.cm, json.cm);
    assert.equal(json2.cr, json.cr);
    assert.equal(json2.hl, json.hl);
    assert.equal(json2.t, json.t);
  });
});
