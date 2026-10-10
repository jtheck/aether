import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS, TERRAIN, terrainCornerCell } from '../sim/field.js';
import {
  CELL_EMPTY,
  CELL_FULL,
  SHEET_JUNCTION,
  TERRAIN_DIFFUSE_LEVEL,
  TERRAIN_EMISSIVE,
  TERRAIN_LOOK,
  blobMask,
  compositeJunction,
  junctionKey,
  lookTexel,
  srgbMipChain,
  terrainLookColors,
  tileLayer,
} from './terrainLayers.js';

const G = TERRAIN.GRASS;
const D = TERRAIN.DIRT;
const W = TERRAIN.WATER;

/** Rows listed top (highest z) first, like a map drawing. */
function grid(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const types = new Uint8Array(width * height);
  const kind = { G, D, W };
  rows.forEach((row, r) => {
    const z = height - 1 - r;
    for (let x = 0; x < width; x++) types[z * width + x] = kind[row[x]];
  });
  return { types, width, height };
}

function layerAt(g, x, z) {
  const layer = tileLayer(g.types, g.width, g.height, x, z);
  return { sheet: layer >> 8, cell: layer & 255 };
}

describe('tileLayer', () => {
  it('draws grass solid and dirt under grass blobs', () => {
    const g = grid(['GGG', 'GDD', 'DDD']);
    assert.deepEqual(layerAt(g, 0, 2), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(g, 2, 0), { sheet: ATLAS.GRASS_DIRT, cell: CELL_EMPTY });
    const edge = layerAt(g, 1, 1);
    assert.equal(edge.sheet, ATLAS.GRASS_DIRT);
    assert.equal(edge.cell, terrainCornerCell(g.types, 3, 3, 1, 1, G));
  });

  it('picks the shore sheet from the land touching a water tile', () => {
    const g = grid(['GGWDD', 'WWWWW', 'WWWWW']);
    assert.equal(layerAt(g, 0, 1).sheet, ATLAS.GRASS_WATER);
    assert.equal(layerAt(g, 4, 1).sheet, ATLAS.DIRT_WATER);
    assert.equal(layerAt(g, 4, 1).cell, terrainCornerCell(g.types, 5, 3, 4, 1, D));
    assert.deepEqual(layerAt(g, 2, 0), { sheet: ATLAS.GRASS_WATER, cell: CELL_EMPTY });
  });

  it('composites water touched by both grass and dirt', () => {
    const g = grid(['GGDD', 'WWWW', 'WWWW']);
    const j = layerAt(g, 1, 1);
    assert.equal(j.sheet, SHEET_JUNCTION);
    const grass = terrainCornerCell(g.types, 4, 3, 1, 1, G);
    const dirt = terrainCornerCell(g.types, 4, 3, 1, 1, D);
    assert.equal(j.cell, junctionKey(dirt, grass));
    assert.ok(grass !== CELL_EMPTY && dirt !== CELL_EMPTY);
  });

  it('skips the composite when one layer covers the tile', () => {
    // Grass on every corner hides the water and any dirt.
    const covered = grid(['GDG', 'GWG', 'GGG']);
    assert.deepEqual(layerAt(covered, 1, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    // Dirt on every corner: grass blob over solid dirt is a grass–dirt cell.
    const dirty = grid(['GDD', 'DWD', 'DDD']);
    const l = layerAt(dirty, 1, 1);
    assert.equal(l.sheet, ATLAS.GRASS_DIRT);
    assert.equal(l.cell, terrainCornerCell(dirty.types, 3, 3, 1, 1, G));
  });

  it('only builds junction keys from partial cells', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const width = 24;
    const height = 24;
    const types = new Uint8Array(width * height);
    for (let i = 0; i < types.length; i++) types[i] = [G, D, W][Math.floor(rnd() * 3)];
    let junctions = 0;
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const layer = tileLayer(types, width, height, x, z);
        const sheet = layer >> 8;
        assert.ok(sheet <= SHEET_JUNCTION);
        if (sheet !== SHEET_JUNCTION) continue;
        junctions++;
        const cell = layer & 255;
        for (const part of [cell >> 4, cell & 15]) {
          assert.ok(part !== CELL_EMPTY && part !== CELL_FULL, `junction part ${part}`);
        }
      }
    }
    assert.ok(junctions > 0);
  });
});

describe('terrainLookColors', () => {
  const { diffuse, emissive } = terrainLookColors();
  const old = (t, light, c) => {
    const look = TERRAIN_LOOK[t];
    return light * look.diffuseColor[c] + look.ambientColor[c] + TERRAIN_EMISSIVE[c];
  };

  it('keeps the sunlit look (both clamp)', () => {
    for (const t of [G, D, W]) {
      for (let c = 0; c < 3; c++) {
        assert.equal(Math.min(1, 1.4 * diffuse[c] + emissive[t][c]), Math.min(1, old(t, 1.4, c)));
      }
    }
  });

  it('matches the old per-ground shade under the default hemi', () => {
    for (const t of [G, D, W]) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(0.34 * diffuse[c] + emissive[t][c] - old(t, 0.34, c)) < 1e-9);
      }
    }
  });

  it('writes emissive bytes divided by the texture level', () => {
    const out = new Uint8Array(4);
    lookTexel(emissive, 1, 0, 0, out, 0);
    for (let c = 0; c < 3; c++) {
      assert.equal(out[c], Math.round((emissive[G][c] / TERRAIN_DIFFUSE_LEVEL) * 255));
    }
    assert.equal(out[3], 255);
  });
});

/** RGBA sheet of `size`², filled per pixel by `fn(x, y) → [r, g, b]`. */
function sheet(size, fn) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const [r, g, b] = fn(x, y);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  return px;
}

describe('blobMask and compositeJunction', () => {
  const size = 32;
  const cellPx = size / 4;
  const GRASS = [90, 110, 60];
  const DIRT = [100, 85, 60];
  const WATER = [70, 125, 135];
  // Blob covers the left half of every cell.
  const inBlob = (x) => x % cellPx < cellPx / 2;
  const sheets = {
    gd: sheet(size, (x) => (inBlob(x) ? GRASS : DIRT)),
    gw: sheet(size, (x) => (inBlob(x) ? GRASS : WATER)),
    dw: sheet(size, (x) => (inBlob(x) ? DIRT : WATER)),
  };

  it('finds the shared blob from the three sheets', () => {
    const mask = blobMask(sheets, size);
    assert.ok(mask[3 * size + 1] > 0.99);
    assert.ok(mask[3 * size + cellPx - 2] < 0.01);
  });

  it('puts grass over dirt over water', () => {
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = inBlob(x) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    // Same blob layout in both cells, so dirt sits exactly under the grass.
    compositeJunction(sheets, mask, size, junctionKey(3, 0), out, weights);
    assert.deepEqual([...out.slice(0, 3)], GRASS);
    assert.deepEqual([...weights.slice(0, 3)], [1, 0, 0]);
    const o = (cellPx - 1) * 4;
    assert.deepEqual([...out.slice(o, o + 3)], WATER);
    assert.deepEqual([...weights.slice((cellPx - 1) * 3, cellPx * 3)], [0, 0, 1]);
  });

  it('shows the dirt blob where grass is absent', () => {
    // Grass cell 0 has no blob; dirt cell 3 is fully covered.
    const blob = (x, y) => y < cellPx && x >= 3 * cellPx;
    const own = {
      gd: sheet(size, (x, y) => (blob(x, y) ? GRASS : DIRT)),
      gw: sheet(size, (x, y) => (blob(x, y) ? GRASS : WATER)),
      dw: sheet(size, (x, y) => (blob(x, y) ? DIRT : WATER)),
    };
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = blob(x, y) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    compositeJunction(own, mask, size, junctionKey(3, 0), out, weights);
    // gw(water) + dw(dirt) − dw(water) at an out-of-blob pixel.
    const o = (cellPx - 1) * 4;
    assert.deepEqual([...out.slice(o, o + 3)], DIRT);
    assert.deepEqual([...weights.slice((cellPx - 1) * 3, cellPx * 3)], [0, 1, 0]);
  });
});

describe('srgbMipChain', () => {
  it('builds every level down to 1×1 and averages in linear light', () => {
    const size = 4;
    const px = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = i % 2 === 0 ? 255 : 0;
      px.set([v, v, v, 255], i * 4);
    }
    const levels = srgbMipChain(px, size);
    assert.equal(levels.length, 3);
    assert.equal(levels[2].length, 4);
    // Half white, half black is linear 0.5, which is sRGB 188.
    assert.equal(levels[1][0], 188);
    assert.equal(levels[2][0], 188);
    assert.equal(levels[2][3], 255);
  });
});
