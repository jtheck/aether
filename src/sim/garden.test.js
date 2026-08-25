import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildField, isPassable, isSlowTile, TERRAIN } from './field.js';
import {
  applyTableSilhouette,
  createFullCellMask,
  createFullCellRadius,
  cellCounts,
  chunkCornerKind,
  maxCellRadius,
  paintTerrainBrush,
  refreshTableTerrain,
  setCellEnabled,
  setCellRadius,
  silhouetteLoops,
  tileInTable,
  tileCenterWorld,
} from './tableShape.js';
import { encodeGarden, decodeGarden, fieldFromGarden } from './garden.js';
import { populateScenery } from './scenery.js';

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
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask,
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
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
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(isSlowTile(field, 1, 8), true);
    assert.equal(isPassable(field, 8, 8), true);
    assert.equal(isSlowTile(field, 8, 8), false);
  });

  it('keeps table-edge red/yellow after scenery populate', () => {
    const field = buildField(1, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    populateScenery(field, null, []);
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(isSlowTile(field, 1, 8), true);
    assert.equal(field.tableSlowMask[1 * 32 + 8], 1);
  });

  it('puts a red-then-yellow rim on every side of a removed chunk', () => {
    const field = buildField(1, { width: 48, height: 48 });
    const cellMask = createFullCellMask(48, 48, 16);
    cellMask[1 * 3 + 1] = 0;
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask,
      cellRadius: createFullCellRadius(48, 48, 16, 0),
    });
    const at = (tx, tz) => field.activeMask[tz * 48 + tx];
    assert.equal(at(24, 24), 0);
    assert.equal(at(16, 24), 0);
    assert.equal(at(31, 24), 0);
    assert.equal(at(24, 16), 0);
    assert.equal(at(24, 31), 0);
    assert.equal(isPassable(field, 15, 24), false);
    assert.equal(isSlowTile(field, 14, 24), true);
    assert.equal(isPassable(field, 32, 24), false);
    assert.equal(isSlowTile(field, 33, 24), true);
    assert.equal(isPassable(field, 24, 15), false);
    assert.equal(isSlowTile(field, 24, 14), true);
    assert.equal(isPassable(field, 24, 32), false);
    assert.equal(isSlowTile(field, 24, 33), true);
  });

  it('cuts an outside-corner fillet from the owning chunk', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const cellRadius = createFullCellRadius(32, 32, 16, 0);
    cellRadius[0] = 12;
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius,
    });
    assert.equal(tileInTable(field, field.tableShape, 0, 0), false);
    assert.equal(tileInTable(field, field.tableShape, 8, 8), true);
    assert.equal(chunkCornerKind(field.tableShape, 0, 0), 'outside corner');
  });

  it('fills an inside-corner fillet from the missing chunk', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const cellMask = makeLMask(32, 32, 16);
    const cellRadius = createFullCellRadius(32, 32, 16, 0);
    const { chunksX } = cellCounts(32, 32, 16);
    cellRadius[1 * chunksX + 1] = 12;
    applyTableSilhouette(field, { cellSize: 16, cellMask, cellRadius });
    assert.equal(chunkCornerKind(field.tableShape, 1, 1), 'inside corner');
    const c = tileCenterWorld(field, 16, 16);
    assert.ok(Math.hypot(c.x, c.z) < 4);
    assert.equal(tileInTable(field, field.tableShape, 16, 16), true);
    assert.equal(tileInTable(field, field.tableShape, 24, 24), false);
  });

  it('keeps a solid blocked rim on a max-radius outside corner', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const cellRadius = createFullCellRadius(32, 32, 16, 0);
    cellRadius[0] = Math.floor(maxCellRadius(16));
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius,
    });
    let blocked = 0;
    let walkableAgainstVoid = 0;
    for (let tz = 0; tz < 16; tz++) {
      for (let tx = 0; tx < 16; tx++) {
        const i = tz * 32 + tx;
        if (!field.activeMask[i]) continue;
        if (!isPassable(field, tx, tz)) {
          blocked++;
          continue;
        }
        const voidN =
          tx === 0 || tz === 0
          || field.activeMask[tz * 32 + tx - 1] === 0
          || field.activeMask[(tz - 1) * 32 + tx] === 0
          || field.activeMask[tz * 32 + tx + 1] === 0
          || field.activeMask[(tz + 1) * 32 + tx] === 0;
        if (voidN) walkableAgainstVoid++;
      }
    }
    assert.ok(blocked >= 20);
    assert.equal(walkableAgainstVoid, 0);
  });

  it('builds one rail loop and fillets only r>0 corners', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const cellMask = makeLMask(32, 32, 16);
    const cellRadius = createFullCellRadius(32, 32, 16, 0);
    setCellRadius({ cellMask, cellRadius, chunksX: 2, chunksZ: 2, cellSize: 16 }, 0, 0, 8);
    applyTableSilhouette(field, { cellSize: 16, cellMask, cellRadius });
    const loops = silhouetteLoops(field, field.tableShape);
    assert.equal(loops.length, 1);
    assert.ok(loops[0].length >= 8);
  });

  it('terrain paint refresh keeps the table rim and updates water pass', () => {
    const field = buildField(1, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    assert.equal(isPassable(field, 0, 8), false);
    const dirty = paintTerrainBrush(field, 8, 8, TERRAIN.WATER, 3);
    assert.ok(dirty.length > 0);
    refreshTableTerrain(field);
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(field.terrainTypes[8 * 32 + 8], TERRAIN.WATER);
    assert.equal(isPassable(field, 8, 8), false);
    paintTerrainBrush(field, 8, 8, TERRAIN.GRASS, 3);
    refreshTableTerrain(field);
    assert.equal(isPassable(field, 8, 8), true);
    assert.equal(isPassable(field, 0, 8), false);
  });
});

describe('garden v3', () => {
  it('roundtrips w/h/s/cs/cm/rr/t', () => {
    const field = buildField(99, { width: 32, height: 32 });
    const cellMask = makeLMask(32, 32, 16);
    const cellRadius = createFullCellRadius(32, 32, 16, 0);
    cellRadius[0] = 8;
    applyTableSilhouette(field, { cellSize: 16, cellMask, cellRadius });
    const json = encodeGarden(field, { name: 'test' });
    const g = decodeGarden(json);
    assert.equal(g.width, 32);
    assert.equal(g.height, 32);
    assert.equal(g.seed, 99);
    assert.equal(g.cellSize, 16);
    assert.deepEqual(Array.from(g.cellMask), Array.from(cellMask));
    assert.deepEqual(Array.from(g.cellRadius), Array.from(cellRadius));
    assert.equal(g.terrainTypes.length, 32 * 32);
    assert.equal(json.hl, undefined);
    assert.equal(json.cr, undefined);

    const again = fieldFromGarden(json);
    const json2 = encodeGarden(again);
    assert.equal(json2.cm, json.cm);
    assert.equal(json2.rr, json.rr);
    assert.equal(json2.t, json.t);
  });
});
