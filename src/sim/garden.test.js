import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildField,
  createField,
  isPassable,
  isSlowTile,
  TERRAIN,
  DEFAULT_MAP_W,
  DEFAULT_MAP_H,
  STRESS_MAP_W,
  STRESS_MAP_H,
  TABLE_CHUNK_TILES,
  tilesForOddChunks,
  snapTilesToOddChunks,
} from './field.js';
import { createWorld } from './world.js';
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
  tableCornerPlinths,
  tableEdgeMidpoints,
  tableHasCenterBlock,
  tileInTable,
  tileCenterWorld,
} from './tableShape.js';
import { encodeGarden, decodeGarden, fieldFromGarden, applyGardenPlacements } from './garden.js';
import { populateScenery } from './scenery.js';
import { buildTesterGarden, TESTER_STARTING_RESOURCES } from './testerGarden.js';
import { UNIT_DEFS } from './unitTypes.js';
import { PLACEABLE_BUILDINGS } from './buildings.js';
import { getResource, STARTING_RESOURCES } from './resources.js';

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
    const field = createField(1, { width: 32, height: 32 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(isSlowTile(field, 1, 7), true);
    assert.equal(isPassable(field, 8, 8), true);
    assert.equal(isSlowTile(field, 8, 8), false);
    assert.equal(tableHasCenterBlock(field), false);
  });

  it('defaults every chunk to radius 0', () => {
    const field = buildField(1, { width: 48, height: 48 });
    applyTableSilhouette(field);
    assert.ok(field.tableShape.cellRadius.every((r) => r === 0));
  });

  it('plants a blocked center block on odd-chunk boards', () => {
    const field = createField(1, { width: 48, height: 48 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(48, 48, 16),
      cellRadius: createFullCellRadius(48, 48, 16, 0),
    });
    assert.equal(tableHasCenterBlock(field), true);
    assert.equal(isPassable(field, 24, 24), false);
    assert.equal(isPassable(field, 24, 20), false);
    assert.equal(isPassable(field, 24, 16), true);
    assert.equal(isSlowTile(field, 24, 18), true);
    assert.equal(isPassable(field, 8, 8), true);
  });

  it('places a block halfway along each table edge', () => {
    const field = createField(1, { width: 48, height: 48 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(48, 48, 16),
      cellRadius: createFullCellRadius(48, 48, 16, 0),
    });
    const mids = tableEdgeMidpoints(field);
    assert.equal(mids.length, 4);
    assert.ok(mids.some((p) => Math.abs(p.x) < 1 && p.z < -80 && p.oz < 0));
    assert.ok(mids.some((p) => Math.abs(p.x) < 1 && p.z > 80 && p.oz > 0));
    assert.ok(mids.some((p) => p.x < -80 && Math.abs(p.z) < 1 && p.ox < 0));
    assert.ok(mids.some((p) => p.x > 80 && Math.abs(p.z) < 1 && p.ox > 0));
    assert.equal(field.tableEdgeBlocks.length, 4);
    assert.equal(field.tableCornerBlocks.length, 4);
    assert.equal(tableCornerPlinths(field).length, 4);
    assert.equal(isPassable(field, 0, 0), false);
    assert.equal(isPassable(field, 3, 3), false);
    assert.equal(isPassable(field, 8, 8), true);
    assert.equal(isPassable(field, 24, 0), false);
    assert.equal(isPassable(field, 24, 4), false);
    assert.equal(isPassable(field, 24, 7), true);
    assert.equal(isSlowTile(field, 24, 5), true);
  });

  it('drops the corner plinth when that chunk is filleted', () => {
    const field = createField(1, { width: 48, height: 48 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    const cellRadius = createFullCellRadius(48, 48, 16, 0);
    cellRadius[0] = 12;
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(48, 48, 16),
      cellRadius,
    });
    assert.equal(tableCornerPlinths(field).length, 3);
    assert.equal(field.tableCornerBlocks.length, 3);
  });

  it('keeps table-edge red/yellow after scenery populate', () => {
    const field = createField(1, { width: 32, height: 32 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    populateScenery(field, null, []);
    assert.equal(isPassable(field, 0, 8), false);
    assert.equal(isSlowTile(field, 1, 7), true);
    assert.equal(field.tableSlowMask[1 * 32 + 7], 1);
  });

  it('puts a red-then-yellow rim on every side of a removed chunk', () => {
    const field = createField(1, { width: 80, height: 80 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    const cellMask = createFullCellMask(80, 80, 16);
    cellMask[2 * 5 + 2] = 0;
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask,
      cellRadius: createFullCellRadius(80, 80, 16, 0),
    });
    const at = (tx, tz) => field.activeMask[tz * 80 + tx];
    assert.equal(at(40, 40), 0);
    assert.equal(at(32, 40), 0);
    assert.equal(at(47, 40), 0);
    assert.equal(at(40, 32), 0);
    assert.equal(at(40, 47), 0);
    assert.equal(tableEdgeMidpoints(field).length, 4);
    assert.equal(isPassable(field, 31, 40), false);
    assert.equal(isSlowTile(field, 30, 40), true);
    assert.equal(isPassable(field, 24, 40), true);
    assert.equal(isPassable(field, 48, 40), false);
    assert.equal(isSlowTile(field, 49, 40), true);
    assert.equal(isPassable(field, 55, 40), true);
    assert.equal(isPassable(field, 40, 31), false);
    assert.equal(isSlowTile(field, 40, 30), true);
    assert.equal(isPassable(field, 40, 24), true);
    assert.equal(isPassable(field, 40, 48), false);
    assert.equal(isSlowTile(field, 40, 49), true);
    assert.equal(isPassable(field, 40, 55), true);
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

describe('garden codec', () => {
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
    assert.equal(typeof json.rl, 'string');
    assert.equal(json2.rl, json.rl);
  });

  it('roundtrips authored scenery and placements', () => {
    const field = buildField(7, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    field.sceneryType[8 * 32 + 8] = 1;
    field.treeStock[8 * 32 + 8] = 28;
    const json = encodeGarden(field, {
      name: 'placed',
      units: [{ owner: 0, type: 1, tx: 10, tz: 10 }],
      buildings: [{ owner: 0, type: 'camp', x: 4, z: -4, yaw: 0 }],
      agoras: [{ owner: 0, x: 0, z: 0 }],
      startingResources: { wood: 400, stone: 50, mineral: 12, food: 80 },
    });
    assert.equal(json.v, 4);
    const g = decodeGarden(json);
    assert.equal(g.authoredScenery, true);
    assert.equal(g.sceneryType[8 * 32 + 8], 1);
    assert.equal(g.units.length, 1);
    assert.equal(g.buildings[0].type, 'camp');
    assert.equal(g.agoras.length, 1);
    assert.deepEqual(json.sr, [400, 50, 12, 80]);
    assert.deepEqual(g.startingResources, { wood: 400, stone: 50, mineral: 12, food: 80 });
    const again = fieldFromGarden(json);
    assert.equal(again.sceneryType[8 * 32 + 8], 1);

    const world = createWorld(7);
    applyGardenPlacements(world, again, g);
    assert.equal(world.count, 1);
    assert.equal(world.buildings.length, 1);
    assert.equal(world.agoras.length, 1);
    assert.equal(getResource(world, 0, 'wood'), 400);
    assert.equal(getResource(world, 0, 'mineral'), 12);
  });

  it('omits sr and uses the default opening bank', () => {
    const field = buildField(3, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    const json = encodeGarden(field, { agoras: [{ owner: 0, x: 0, z: 0 }] });
    assert.equal(json.sr, undefined);
    const g = decodeGarden(json);
    assert.equal(g.startingResources, null);
    const world = createWorld(3);
    applyGardenPlacements(world, field, g);
    assert.equal(getResource(world, 0, 'wood'), STARTING_RESOURCES.wood);
    assert.equal(getResource(world, 0, 'food'), STARTING_RESOURCES.food);
  });

  it('keeps live boards on odd 16-tile chunk counts', () => {
    assert.equal(DEFAULT_MAP_W % TABLE_CHUNK_TILES, 0);
    assert.equal(DEFAULT_MAP_H % TABLE_CHUNK_TILES, 0);
    assert.equal(STRESS_MAP_W % TABLE_CHUNK_TILES, 0);
    assert.equal(STRESS_MAP_H % TABLE_CHUNK_TILES, 0);
    assert.equal((DEFAULT_MAP_W / TABLE_CHUNK_TILES) % 2, 1);
    assert.equal((DEFAULT_MAP_H / TABLE_CHUNK_TILES) % 2, 1);
    assert.equal((STRESS_MAP_W / TABLE_CHUNK_TILES) % 2, 1);
    assert.equal((STRESS_MAP_H / TABLE_CHUNK_TILES) % 2, 1);
    assert.equal(tilesForOddChunks(12), 13 * TABLE_CHUNK_TILES);
    assert.equal(snapTilesToOddChunks(192), 13 * TABLE_CHUNK_TILES);
    assert.equal(snapTilesToOddChunks(128), 9 * TABLE_CHUNK_TILES);
  });

  it('builds a mirrored 2-player tester garden with one of everything', () => {
    const json = buildTesterGarden();
    const g = decodeGarden(json);
    assert.equal(g.name, 'unit tester');
    assert.equal(g.width, 144);
    assert.equal(g.height, 144);
    const unitTypes = new Set(UNIT_DEFS.map((d) => d.id));
    const buildingTypes = new Set(PLACEABLE_BUILDINGS.map((b) => b.id));
    const byOwnerUnits = { 0: new Set(), 1: new Set() };
    const byOwnerBuildings = { 0: new Set(), 1: new Set() };
    for (const u of g.units) {
      byOwnerUnits[u.owner]?.add(u.type);
    }
    for (const b of g.buildings) {
      byOwnerBuildings[b.owner]?.add(b.type);
    }
    assert.deepEqual([...byOwnerUnits[0]].sort((a, b) => a - b), [...unitTypes].sort((a, b) => a - b));
    assert.deepEqual([...byOwnerUnits[1]].sort((a, b) => a - b), [...unitTypes].sort((a, b) => a - b));
    assert.deepEqual([...byOwnerBuildings[0]].sort(), [...buildingTypes].sort());
    assert.deepEqual([...byOwnerBuildings[1]].sort(), [...buildingTypes].sort());
    assert.equal(g.agoras.length, 2);
    assert.ok(g.agoras.some((a) => a.owner === 0));
    assert.ok(g.agoras.some((a) => a.owner === 1));
    const last = g.width - 1;
    for (const u of g.units.filter((x) => x.owner === 0)) {
      assert.ok(g.units.some((o) => o.owner === 1 && o.type === u.type && o.tx === last - u.tx && o.tz === u.tz));
    }

    const field = fieldFromGarden(json);
    const world = createWorld(g.seed);
    applyGardenPlacements(world, field, g);
    assert.equal(world.count, UNIT_DEFS.length * 2);
    assert.equal(world.buildings.length, PLACEABLE_BUILDINGS.length * 2);
    assert.deepEqual(json.sr, [9999, 9999, 9999, 9999]);
    assert.equal(getResource(world, 0, 'wood'), TESTER_STARTING_RESOURCES.wood);
    assert.equal(getResource(world, 1, 'mineral'), TESTER_STARTING_RESOURCES.mineral);
  });
});
