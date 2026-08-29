import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TINY_MAP_W,
  TABLE_CHUNK_TILES,
  TERRAIN,
  buildField,
  applySeededHeight,
  composeHeightMap,
  createField,
  generateHeightMap,
  paintRegionLift,
  tileHeightWorld,
} from './field.js';
import { encodeGarden, fieldFromGarden } from './garden.js';
import { applyTableSilhouette, createFullCellMask, createFullCellRadius } from './tableShape.js';

function chunkCenterHeight(field, cx, cz) {
  const tx = cx * TABLE_CHUNK_TILES + (TABLE_CHUNK_TILES >> 1);
  const tz = cz * TABLE_CHUNK_TILES + (TABLE_CHUNK_TILES >> 1);
  return field.heightMap[tz * field.width + tx];
}

function fullSilhouette(field) {
  applyTableSilhouette(field, {
    cellSize: TABLE_CHUNK_TILES,
    cellMask: createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES),
    cellRadius: createFullCellRadius(field.width, field.height, TABLE_CHUNK_TILES, 0),
  });
}

describe('chunk-scale relief', () => {
  it('varies height at chunk centers more than tiles inside one chunk', () => {
    const field = buildField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    const chunks = TINY_MAP_W / TABLE_CHUNK_TILES;
    const centers = [];
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) centers.push(chunkCenterHeight(field, cx, cz));
    }
    const centerRange = Math.max(...centers) - Math.min(...centers);

    const cx = 2;
    const cz = 2;
    const x0 = cx * TABLE_CHUNK_TILES;
    const z0 = cz * TABLE_CHUNK_TILES;
    let localMin = Infinity;
    let localMax = -Infinity;
    for (let z = z0 + 2; z < z0 + TABLE_CHUNK_TILES - 2; z++) {
      for (let x = x0 + 2; x < x0 + TABLE_CHUNK_TILES - 2; x++) {
        const h = field.heightMap[z * field.width + x];
        if (h < localMin) localMin = h;
        if (h > localMax) localMax = h;
      }
    }
    assert.ok(centerRange > 0.2);
    assert.ok(centerRange > (localMax - localMin) * 1.15);
  });

  it('adds chunk terraces on top of the tile-ripple height', () => {
    const ripples = createField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    generateHeightMap(ripples);
    const terraced = createField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    applySeededHeight(terraced);
    assert.notEqual(ripples.heightMap[40 * TINY_MAP_W + 40], terraced.heightMap[40 * TINY_MAP_W + 40]);
  });

  it('locks extra lift at the table rim', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    field.regionLift.fill(1);
    composeHeightMap(field);
    const rim = 8; // south-edge tile, locked to the rails
    assert.ok(Math.abs(field.heightMap[rim] - field.detailHeight[rim]) < 0.04);
    const inland = 20 * TINY_MAP_W + 20;
    const detail = field.detailHeight[inland];
    assert.ok(Math.abs(field.heightMap[inland] - (detail * 0.4 + 0.6)) < 0.02);
  });

  it('keeps water a shallow dish instead of a scaled cliff', () => {
    const field = buildField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    let found = false;
    for (let z = 1; z < field.height - 1 && !found; z++) {
      for (let x = 1; x < field.width - 1; x++) {
        if (field.terrainTypes[z * field.width + x] !== TERRAIN.WATER) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (field.terrainTypes[nz * field.width + nx] === TERRAIN.WATER) continue;
          const drop = tileHeightWorld(field, nx, nz) - tileHeightWorld(field, x, z);
          assert.ok(drop < 2.2, `shore drop ${drop}`);
          found = true;
          break;
        }
      }
    }
    assert.ok(found);
  });

  it('raise paint keeps terrain types and lifts the felt', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    const i = 20 * TINY_MAP_W + 20;
    const kind = field.terrainTypes[i];
    const before = field.heightMap[i];
    const dirty = paintRegionLift(field, 20, 20, 0.35, 2);
    assert.ok(dirty.length > 0);
    assert.equal(field.terrainTypes[i], kind);
    assert.ok(field.heightMap[i] > before);
  });

  it('restores seeded height when a garden only stores terrain types', () => {
    const src = buildField(77, { width: 32, height: 32 });
    fullSilhouette(src);
    const again = fieldFromGarden(encodeGarden(src));
    assert.ok(Math.abs(again.heightMap[8 * 32 + 8] - src.heightMap[8 * 32 + 8]) < 0.02);
    assert.ok(again.heightMap.some((h) => h > 0));
  });
});
