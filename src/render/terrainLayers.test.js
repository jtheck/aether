import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS, TERRAIN, layerCell, layerSheet, terrainCornerCell } from '../sim/field.js';
import {
  CELL_EMPTY,
  CELL_FULL,
  SHEET_BURN_JUNCTION,
  SHEET_DIRT_JUNCTION,
  SHEET_JUNCTION,
  SHEET_SHORE_JUNCTION,
  SHEET_SNOW_JUNCTION,
  TERRAIN_DIFFUSE_LEVEL,
  TERRAIN_EMISSIVE,
  TERRAIN_LOOK,
  blobMask,
  burnJunctionKey,
  compositeBurnJunction,
  compositeDirtJunction,
  compositeShoreJunction,
  compositeSnowJunction,
  shoreJunctionKey,
  snowJunctionKey,
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
  const kind = {
    G, D, W,
    R: TERRAIN.GRAVEL,
    T: TERRAIN.TILE,
    C: TERRAIN.DECORATIVE,
    S: TERRAIN.SCORCHED,
    H: TERRAIN.CHARRED,
    L: TERRAIN.LAVA,
    N: TERRAIN.SNOW,
    F: TERRAIN.FROZEN,
    Y: TERRAIN.SNOWGRASS,
  };
  rows.forEach((row, r) => {
    const z = height - 1 - r;
    for (let x = 0; x < width; x++) types[z * width + x] = kind[row[x]];
  });
  return { types, width, height };
}

function layerAt(g, x, z) {
  const layer = tileLayer(g.types, g.width, g.height, x, z);
  return { sheet: layerSheet(layer), cell: layerCell(layer) };
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
        const sheet = layerSheet(layer);
        assert.ok(sheet <= SHEET_JUNCTION);
        if (sheet !== SHEET_JUNCTION) continue;
        junctions++;
        const cell = layerCell(layer);
        for (const part of [cell >> 4, cell & 15]) {
          assert.ok(part !== CELL_EMPTY && part !== CELL_FULL, `junction part ${part}`);
        }
      }
    }
    assert.ok(junctions > 0);
  });

  it('blends tile over gravel on the pave sheet', () => {
    const g = grid(['TTT', 'RRR']);
    assert.deepEqual(layerAt(g, 1, 1), { sheet: ATLAS.DECORATIVE_TILE, cell: CELL_EMPTY });
    const edge = layerAt(g, 1, 0);
    assert.equal(edge.sheet, ATLAS.TILE_GRAVEL);
    assert.equal(edge.cell, terrainCornerCell(g.types, 3, 2, 1, 0, TERRAIN.TILE));
    assert.notEqual(edge.cell, CELL_EMPTY);
    assert.notEqual(edge.cell, CELL_FULL);
  });

  it('meets grass and water on a hard edge', () => {
    const besideGrass = grid(['GG', 'RR']);
    assert.deepEqual(layerAt(besideGrass, 0, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(besideGrass, 0, 0), { sheet: ATLAS.TILE_GRAVEL, cell: CELL_EMPTY });
    const pond = grid(['RRR', 'RWR', 'RRR']);
    assert.deepEqual(layerAt(pond, 1, 1), { sheet: ATLAS.GRAVEL_DIRT, cell: CELL_FULL });
  });

  it('blends gravel and tile onto a dirt tile', () => {
    const gravel = grid(['RRR', 'DDD']);
    const edge = layerAt(gravel, 1, 0);
    assert.equal(edge.sheet, ATLAS.GRAVEL_DIRT);
    assert.equal(edge.cell, terrainCornerCell(gravel.types, 3, 2, 1, 0, TERRAIN.GRAVEL));
    assert.notEqual(edge.cell, CELL_EMPTY);
    assert.deepEqual(layerAt(gravel, 1, 1), { sheet: ATLAS.TILE_GRAVEL, cell: CELL_EMPTY });

    const tile = grid(['TTT', 'DDD']);
    const shore = layerAt(tile, 1, 0);
    assert.equal(shore.sheet, ATLAS.GRAVEL_DIRT);
    assert.equal(
      shore.cell,
      terrainCornerCell(tile.types, 3, 2, 1, 0, TERRAIN.GRAVEL, TERRAIN.TILE),
    );
    assert.deepEqual(layerAt(tile, 1, 1), { sheet: ATLAS.DECORATIVE_TILE, cell: CELL_EMPTY });
  });

  it('blends decorative onto tile and borrows the shores below it', () => {
    const onTile = grid(['CCC', 'TTT']);
    assert.deepEqual(layerAt(onTile, 1, 1), { sheet: ATLAS.DECORATIVE_TILE, cell: CELL_FULL });
    const edge = layerAt(onTile, 1, 0);
    assert.equal(edge.sheet, ATLAS.DECORATIVE_TILE);
    assert.equal(edge.cell, terrainCornerCell(onTile.types, 3, 2, 1, 0, TERRAIN.DECORATIVE));
    assert.notEqual(edge.cell, CELL_EMPTY);

    const onGravel = grid(['CCC', 'RRR']);
    const gravel = layerAt(onGravel, 1, 0);
    assert.equal(gravel.sheet, ATLAS.TILE_GRAVEL);
    assert.equal(gravel.cell, terrainCornerCell(onGravel.types, 3, 2, 1, 0, TERRAIN.DECORATIVE));

    const onDirt = grid(['CCC', 'DDD']);
    const dirt = layerAt(onDirt, 1, 0);
    assert.equal(dirt.sheet, ATLAS.GRAVEL_DIRT);
    assert.equal(dirt.cell, terrainCornerCell(onDirt.types, 3, 2, 1, 0, TERRAIN.DECORATIVE));

    const besideGrass = grid(['GG', 'CC']);
    assert.deepEqual(layerAt(besideGrass, 0, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(besideGrass, 0, 0), { sheet: ATLAS.DECORATIVE_TILE, cell: CELL_FULL });
  });

  it('stacks lava on charred on scorched', () => {
    const charred = grid(['HHH', 'SSS']);
    assert.deepEqual(layerAt(charred, 1, 1), { sheet: ATLAS.LAVA_CHARRED, cell: CELL_EMPTY });
    const scorchedEdge = layerAt(charred, 1, 0);
    assert.equal(scorchedEdge.sheet, ATLAS.CHARRED_SCORCHED);
    assert.equal(scorchedEdge.cell, terrainCornerCell(charred.types, 3, 2, 1, 0, TERRAIN.CHARRED));

    const lava = grid(['LLL', 'HHH']);
    assert.deepEqual(layerAt(lava, 1, 1), { sheet: ATLAS.LAVA_CHARRED, cell: CELL_FULL });
    const charredEdge = layerAt(lava, 1, 0);
    assert.equal(charredEdge.sheet, ATLAS.LAVA_CHARRED);
    assert.equal(charredEdge.cell, terrainCornerCell(lava.types, 3, 2, 1, 0, TERRAIN.LAVA));

    const onScorched = grid(['LLL', 'SSS']);
    assert.deepEqual(layerAt(onScorched, 1, 1), { sheet: ATLAS.LAVA_CHARRED, cell: CELL_FULL });
    const scorchedShore = layerAt(onScorched, 1, 0);
    assert.equal(scorchedShore.sheet, ATLAS.LAVA_SCORCHED);
    assert.equal(scorchedShore.cell, terrainCornerCell(onScorched.types, 3, 2, 1, 0, TERRAIN.LAVA));

    const onGrass = grid(['HHH', 'GGG']);
    assert.equal(layerAt(onGrass, 1, 0).sheet, ATLAS.CHARRED_GRASS);
    assert.deepEqual(layerAt(onGrass, 1, 1), { sheet: ATLAS.LAVA_CHARRED, cell: CELL_EMPTY });
    const onTurf = grid(['HHH', 'YYY']);
    assert.equal(layerAt(onTurf, 1, 0).sheet, ATLAS.CHARRED_SNOWGRASS);
    const onWater = grid(['HHH', 'WWW']);
    assert.equal(layerAt(onWater, 1, 0).sheet, ATLAS.CHARRED_WATER);
    const charredPond = grid(['HHH', 'HWH', 'HHH']);
    assert.deepEqual(layerAt(charredPond, 1, 1), { sheet: ATLAS.CHARRED_SCORCHED, cell: CELL_FULL });
  });

  it('blends the burn set onto dirt', () => {
    const scorched = grid(['SSS', 'DDD']);
    assert.deepEqual(layerAt(scorched, 1, 1), { sheet: ATLAS.CHARRED_SCORCHED, cell: CELL_EMPTY });
    const edge = layerAt(scorched, 1, 0);
    assert.equal(edge.sheet, ATLAS.SCORCHED_DIRT);
    assert.equal(edge.cell, terrainCornerCell(scorched.types, 3, 2, 1, 0, TERRAIN.SCORCHED));

    const lava = grid(['LLL', 'DDD']);
    const dirt = layerAt(lava, 1, 0);
    assert.equal(dirt.sheet, ATLAS.SCORCHED_DIRT);
    assert.equal(dirt.cell, terrainCornerCell(lava.types, 3, 2, 1, 0, TERRAIN.LAVA));

    const withGrass = grid(['GS', 'DD']);
    const j = layerAt(withGrass, 0, 0);
    assert.equal(j.sheet, SHEET_BURN_JUNCTION);
    const grass = terrainCornerCell(withGrass.types, 2, 2, 0, 0, TERRAIN.GRASS);
    const scorch = terrainCornerCell(withGrass.types, 2, 2, 0, 0, TERRAIN.SCORCHED);
    assert.ok(grass !== CELL_EMPTY && grass !== CELL_FULL);
    assert.ok(scorch !== CELL_EMPTY && scorch !== CELL_FULL);
    assert.equal(j.cell, burnJunctionKey(CELL_EMPTY, scorch, grass));

    const pond = grid(['LLL', 'LWL', 'LLL']);
    assert.deepEqual(layerAt(pond, 1, 1), { sheet: ATLAS.SCORCHED_DIRT, cell: CELL_FULL });
    const besideGrass = grid(['GG', 'LL']);
    assert.deepEqual(layerAt(besideGrass, 0, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(besideGrass, 0, 0), { sheet: ATLAS.LAVA_CHARRED, cell: CELL_FULL });
  });

  it('stacks frozen on snow and blends snow onto dirt', () => {
    const frozen = grid(['FFF', 'NNN']);
    assert.deepEqual(layerAt(frozen, 1, 1), { sheet: ATLAS.FROZEN_SNOW, cell: CELL_FULL });
    const snowEdge = layerAt(frozen, 1, 0);
    assert.equal(snowEdge.sheet, ATLAS.FROZEN_SNOW);
    assert.equal(snowEdge.cell, terrainCornerCell(frozen.types, 3, 2, 1, 0, TERRAIN.FROZEN));

    const snow = grid(['NNN', 'DDD']);
    assert.deepEqual(layerAt(snow, 1, 1), { sheet: ATLAS.FROZEN_SNOW, cell: CELL_EMPTY });
    const edge = layerAt(snow, 1, 0);
    assert.equal(edge.sheet, ATLAS.SNOW_DIRT);
    assert.equal(edge.cell, terrainCornerCell(snow.types, 3, 2, 1, 0, TERRAIN.SNOW));

    const onDirt = grid(['FFF', 'DDD']);
    const dirt = layerAt(onDirt, 1, 0);
    assert.equal(dirt.sheet, ATLAS.SNOW_DIRT);
    assert.equal(dirt.cell, terrainCornerCell(onDirt.types, 3, 2, 1, 0, TERRAIN.FROZEN));

    const withGrass = grid(['GN', 'DD']);
    const j = layerAt(withGrass, 0, 0);
    assert.equal(j.sheet, SHEET_SNOW_JUNCTION);
    const grass = terrainCornerCell(withGrass.types, 2, 2, 0, 0, TERRAIN.GRASS);
    const snowCell = terrainCornerCell(withGrass.types, 2, 2, 0, 0, TERRAIN.SNOW);
    assert.ok(grass !== CELL_EMPTY && grass !== CELL_FULL);
    assert.ok(snowCell !== CELL_EMPTY && snowCell !== CELL_FULL);
    assert.equal(j.cell, snowJunctionKey(snowCell, CELL_EMPTY, CELL_EMPTY, grass));

    const besideGrass = grid(['GG', 'NN']);
    assert.deepEqual(layerAt(besideGrass, 0, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(besideGrass, 0, 0), { sheet: ATLAS.FROZEN_SNOW, cell: CELL_EMPTY });

    const pond = grid(['NNN', 'NWN', 'NNN']);
    assert.deepEqual(layerAt(pond, 1, 1), { sheet: ATLAS.SNOW_DIRT, cell: CELL_FULL });

    const turf = grid(['NNN', 'YYY']);
    assert.deepEqual(layerAt(turf, 1, 1), { sheet: ATLAS.FROZEN_SNOW, cell: CELL_EMPTY });
    const turfEdge = layerAt(turf, 1, 0);
    assert.equal(turfEdge.sheet, ATLAS.SNOW_SNOWGRASS);
    assert.equal(turfEdge.cell, terrainCornerCell(turf.types, 3, 2, 1, 0, TERRAIN.SNOW));
    const turfOnDirt = grid(['YYY', 'DDD']);
    assert.equal(layerAt(turfOnDirt, 1, 0).sheet, ATLAS.SNOWGRASS_DIRT);
    const shore = grid(['YYY', 'WWW']);
    assert.equal(layerAt(shore, 1, 0).sheet, ATLAS.SNOWGRASS_WATER);
    const pool = grid(['YYY', 'YWY', 'YYY']);
    assert.deepEqual(layerAt(pool, 1, 1), { sheet: ATLAS.SNOWGRASS_DIRT, cell: CELL_FULL });
  });

  it('blends snow, scorched, and gravel onto water', () => {
    const snow = grid(['NNN', 'WWW']);
    const snowEdge = layerAt(snow, 1, 0);
    assert.equal(snowEdge.sheet, ATLAS.SNOW_WATER);
    assert.equal(snowEdge.cell, terrainCornerCell(snow.types, 3, 2, 1, 0, TERRAIN.SNOW));
    assert.notEqual(snowEdge.cell, CELL_EMPTY);
    assert.notEqual(snowEdge.cell, CELL_FULL);

    const frozen = grid(['FFF', 'WWW']);
    const frozenEdge = layerAt(frozen, 1, 0);
    assert.equal(frozenEdge.sheet, ATLAS.SNOW_WATER);
    assert.equal(frozenEdge.cell, terrainCornerCell(frozen.types, 3, 2, 1, 0, TERRAIN.FROZEN));

    const scorched = grid(['SSS', 'WWW']);
    assert.equal(layerAt(scorched, 1, 0).sheet, ATLAS.SCORCHED_WATER);
    const gravel = grid(['RRR', 'WWW']);
    assert.equal(layerAt(gravel, 1, 0).sheet, ATLAS.GRAVEL_WATER);
    const tile = grid(['TTT', 'WWW']);
    assert.equal(layerAt(tile, 1, 0).sheet, ATLAS.GRAVEL_WATER);

    const withDirt = grid(['ND', 'WW']);
    const j = layerAt(withDirt, 0, 0);
    assert.equal(j.sheet, SHEET_SHORE_JUNCTION);
    const snowCell = terrainCornerCell(withDirt.types, 2, 2, 0, 0, TERRAIN.SNOW);
    const dirt = terrainCornerCell(withDirt.types, 2, 2, 0, 0, TERRAIN.DIRT);
    assert.ok(snowCell !== CELL_EMPTY && snowCell !== CELL_FULL);
    assert.ok(dirt !== CELL_EMPTY && dirt !== CELL_FULL);
    assert.equal(j.cell, shoreJunctionKey(dirt, CELL_EMPTY, CELL_EMPTY, snowCell, CELL_EMPTY));

    const deep = grid(['WWW', 'WWW']);
    assert.deepEqual(layerAt(deep, 1, 0), { sheet: ATLAS.GRASS_WATER, cell: CELL_EMPTY });
  });

  it('composites a dirt tile touched by grass and gravel', () => {
    const g = grid(['GR', 'DD']);
    const j = layerAt(g, 0, 0);
    assert.equal(j.sheet, SHEET_DIRT_JUNCTION);
    const grass = terrainCornerCell(g.types, 2, 2, 0, 0, TERRAIN.GRASS);
    const gravel = terrainCornerCell(g.types, 2, 2, 0, 0, TERRAIN.GRAVEL);
    assert.ok(grass !== CELL_EMPTY && grass !== CELL_FULL);
    assert.ok(gravel !== CELL_EMPTY && gravel !== CELL_FULL);
    assert.equal(j.cell, junctionKey(gravel, grass));
    assert.deepEqual(layerAt(g, 0, 1), { sheet: ATLAS.GRASS_DIRT, cell: CELL_FULL });
    assert.deepEqual(layerAt(g, 1, 1), { sheet: ATLAS.TILE_GRAVEL, cell: CELL_EMPTY });
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

  it('lays grass over gravel over dirt', () => {
    const GRAVEL = [140, 140, 140];
    const blob = (x, y) => y < cellPx && x >= 3 * cellPx;
    const pair = {
      gd: sheet(size, (x, y) => (blob(x, y) ? GRASS : DIRT)),
      gv: sheet(size, (x, y) => (blob(x, y) ? GRAVEL : DIRT)),
    };
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = blob(x, y) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    const paint = (key) => compositeDirtJunction(pair, mask, size, key, out, weights);
    paint(junctionKey(3, 0));
    assert.deepEqual([...out.slice(0, 3)], GRAVEL);
    assert.deepEqual([...weights.slice(0, 3)], [0, 0, 1]);
    paint(junctionKey(0, 3));
    assert.deepEqual([...out.slice(0, 3)], GRASS);
    assert.deepEqual([...weights.slice(0, 3)], [1, 0, 0]);
    paint(junctionKey(0, 0));
    assert.deepEqual([...out.slice(0, 3)], DIRT);
    assert.deepEqual([...weights.slice(0, 3)], [0, 1, 0]);
  });

  it('lays grass over scorched over gravel', () => {
    const SCORCH = [120, 90, 40];
    const GRAVEL = [140, 140, 140];
    const blob = (x, y) => y < cellPx && x >= 3 * cellPx;
    const burn = {
      gd: sheet(size, (x, y) => (blob(x, y) ? GRASS : DIRT)),
      gv: sheet(size, (x, y) => (blob(x, y) ? GRAVEL : DIRT)),
      sd: sheet(size, (x, y) => (blob(x, y) ? SCORCH : DIRT)),
    };
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = blob(x, y) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    const paint = (key) => compositeBurnJunction(burn, mask, size, key, out, weights);
    paint(burnJunctionKey(CELL_EMPTY, 3, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], SCORCH);
    assert.deepEqual([...weights.slice(0, 3)], [0, 0, 1]);
    paint(burnJunctionKey(CELL_EMPTY, CELL_EMPTY, 3));
    assert.deepEqual([...out.slice(0, 3)], GRASS);
    assert.deepEqual([...weights.slice(0, 3)], [1, 0, 0]);
    paint(burnJunctionKey(3, CELL_EMPTY, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], GRAVEL);
    assert.deepEqual([...weights.slice(0, 3)], [0, 0, 1]);
  });

  it('lays grass over snow over scorched', () => {
    const SNOW = [197, 201, 218];
    const SCORCH = [120, 90, 40];
    const blob = (x, y) => y < cellPx && x >= 3 * cellPx;
    const snow = {
      gd: sheet(size, (x, y) => (blob(x, y) ? GRASS : DIRT)),
      gv: sheet(size, (x, y) => (blob(x, y) ? [140, 140, 140] : DIRT)),
      sd: sheet(size, (x, y) => (blob(x, y) ? SCORCH : DIRT)),
      sn: sheet(size, (x, y) => (blob(x, y) ? SNOW : DIRT)),
    };
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = blob(x, y) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    const paint = (key) => compositeSnowJunction(snow, mask, size, key, out, weights);
    paint(snowJunctionKey(3, CELL_EMPTY, CELL_EMPTY, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], SNOW);
    assert.deepEqual([...weights.slice(0, 3)], [0, 0, 1]);
    paint(snowJunctionKey(CELL_EMPTY, CELL_EMPTY, 3, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], SCORCH);
    assert.deepEqual([...weights.slice(0, 3)], [0, 0, 1]);
    paint(snowJunctionKey(CELL_EMPTY, CELL_EMPTY, CELL_EMPTY, 3));
    assert.deepEqual([...out.slice(0, 3)], GRASS);
    assert.deepEqual([...weights.slice(0, 3)], [1, 0, 0]);
    paint(snowJunctionKey(3, CELL_EMPTY, 3, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], SNOW);
  });

  it('lays snow over dirt over water', () => {
    const SNOW = [197, 201, 218];
    const blob = (x, y) => y < cellPx && x >= 3 * cellPx;
    const shore = {
      gd: sheet(size, (x, y) => (blob(x, y) ? GRASS : DIRT)),
      gw: sheet(size, (x, y) => (blob(x, y) ? GRASS : WATER)),
      dw: sheet(size, (x, y) => (blob(x, y) ? DIRT : WATER)),
      gv: sheet(size, () => DIRT),
      sd: sheet(size, () => DIRT),
      sn: sheet(size, (x, y) => (blob(x, y) ? SNOW : DIRT)),
      rw: sheet(size, () => WATER),
      cw: sheet(size, () => WATER),
      sw: sheet(size, (x, y) => (blob(x, y) ? SNOW : WATER)),
    };
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = blob(x, y) ? 1 : 0;
    const out = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 4);
    const paint = (key) => compositeShoreJunction(shore, mask, size, key, out, weights);
    paint(shoreJunctionKey(CELL_EMPTY, CELL_EMPTY, CELL_EMPTY, 3, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], SNOW);
    assert.deepEqual([...weights.slice(0, 4)], [0, 0, 0, 1]);
    paint(shoreJunctionKey(3, CELL_EMPTY, CELL_EMPTY, CELL_EMPTY, CELL_EMPTY));
    assert.deepEqual([...out.slice(0, 3)], DIRT);
    assert.deepEqual([...weights.slice(0, 4)], [0, 1, 0, 0]);
    paint(shoreJunctionKey(CELL_EMPTY, CELL_EMPTY, CELL_EMPTY, CELL_EMPTY, 3));
    assert.deepEqual([...out.slice(0, 3)], GRASS);
    assert.deepEqual([...weights.slice(0, 4)], [1, 0, 0, 0]);
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
