import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField, refreshTerrainDerived, TERRAIN, TILE_SIZE_F, tileCenterX, tileCenterY, worldHalfFFromField } from './field.js';
import { encodeGarden, fieldFromGarden } from './garden.js';
import { createWorld } from './world.js';
import { createBuilding } from './buildings.js';
import { SCENERY } from './scenery.js';
import { TREE_STOCK_GROVE_MAX, TREE_STOCK_NATURAL_MAX, TREE_BURN_TICKS, TREE_WOOD_PER_STAGE } from './trees.js';
import { GROVE_GROW_INTERVAL_NEAR, groveGrowthSystem } from './grove.js';
import {
  DOODAD,
  MUSHROOM_AREA_MIN,
  MUSHROOM_HOST_STOCK,
  MUSHROOM_PER_HOST_MIN,
  MUSHROOM_PER_HOST_MAX,
  canPaintDoodadAt,
  collectDoodadSlots,
  collectDoodads,
  collectMushroomHostTiles,
  isGroveOvergrowth,
  isMatureOvergrowthHost,
  mushroomHostStatesNear,
  mushroomHostSkirtRadius,
  TORCH_FIRE_ANCHOR,
  TORCH_VISION_TILES,
  forEachTorch,
  mushroomPlacementsForHost,
  overgrowthCountNear,
  paintDoodadBrush,
  applyStandardOccupancy,
  derrickPlacementForTile,
  standardPlacementForTile,
  torchPlacementForTile,
  wagonPlacementForTile,
  windvanePlacementForTile,
} from './doodads.js';

function plant(field, tx, tz, stock, burn = 0) {
  const i = tz * field.width + tx;
  field.sceneryType[i] = SCENERY.TREE;
  field.treeStock[i] = stock;
  field.treeBurn[i] = burn;
  field.slowMask[i] = 1;
  field.pass[i] = 1;
  return i;
}

function blank() {
  return createField(1, { width: 80, height: 80 });
}

function cluster(field, cx, cz, stock, n = MUSHROOM_AREA_MIN) {
  const tiles = [];
  for (let i = 0; i < n; i++) {
    tiles.push(plant(field, cx + i, cz, stock));
  }
  return tiles;
}

describe('grove mushroom doodads', () => {
  it('ignores natural-cap trees', () => {
    const field = blank();
    const i = plant(field, 40, 40, MUSHROOM_HOST_STOCK);
    assert.equal(isGroveOvergrowth(field, i), false);
    assert.equal(isMatureOvergrowthHost(field, 40, 40), false);
    assert.deepEqual(collectMushroomHostTiles(field), []);
    assert.equal(collectDoodads(field).length, 0);
  });

  it('treats the first wood past the natural cap as overgrowth', () => {
    const field = blank();
    const i = plant(field, 40, 40, MUSHROOM_HOST_STOCK + 1);
    assert.equal(isGroveOvergrowth(field, i), true);
    assert.equal(isMatureOvergrowthHost(field, 40, 40), false, 'one giant is not a stand');
  });

  it('waits until a neighborhood of overgrowth is mature', () => {
    const field = blank();
    cluster(field, 40, 40, MUSHROOM_HOST_STOCK + 8, MUSHROOM_AREA_MIN - 1);
    assert.equal(collectMushroomHostTiles(field).length, 0);
    plant(field, 42, 40, MUSHROOM_HOST_STOCK + 8);
    const hosts = collectMushroomHostTiles(field);
    assert.equal(hosts.length, MUSHROOM_AREA_MIN);
    const doodads = collectDoodads(field);
    assert.ok(doodads.length >= MUSHROOM_AREA_MIN * MUSHROOM_PER_HOST_MIN);
    assert.ok(doodads.every((d) => d.type === DOODAD.MUSHROOM));
  });

  it('drops a burning overgrowth host', () => {
    const field = blank();
    cluster(field, 40, 40, MUSHROOM_HOST_STOCK + 8);
    field.treeBurn[40 * field.width + 40] = TREE_BURN_TICKS;
    assert.equal(isGroveOvergrowth(field, 40 * field.width + 40), false);
    assert.ok(overgrowthCountNear(field, 41, 40) < MUSHROOM_AREA_MIN);
    assert.equal(collectMushroomHostTiles(field).length, 0);
  });

  it('places a stable cluster around each mature host', () => {
    const field = blank();
    const tiles = cluster(field, 36, 36, MUSHROOM_HOST_STOCK + 12);
    const a = mushroomPlacementsForHost(field, tiles[0]);
    const b = mushroomPlacementsForHost(field, tiles[0]);
    assert.ok(a.length >= MUSHROOM_PER_HOST_MIN && a.length <= MUSHROOM_PER_HOST_MAX);
    assert.deepEqual(a, b);
    assert.ok(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
    assert.ok(a.every((p) => p.host === tiles[0]));
  });

  function distFromTile(field, tx, tz, p) {
    const half = worldHalfFFromField(field);
    const cx = (tx + 0.5) * TILE_SIZE_F - half;
    const cz = (tz + 0.5) * TILE_SIZE_F - half;
    return Math.hypot(p.x - cx, p.z - cz);
  }

  it('rings old-growth hosts outside the canopy skirt', () => {
    const field = blank();
    const tx = 40;
    const tz = 40;
    const i = plant(field, tx, tz, TREE_STOCK_GROVE_MAX);
    const skirt = mushroomHostSkirtRadius(TREE_STOCK_GROVE_MAX);
    assert.ok(skirt > 8, 'a grove giant skirt is many times the old fixed ring');
    const list = mushroomPlacementsForHost(field, i);
    assert.ok(list.every((p) => distFromTile(field, tx, tz, p) > skirt));
    const early = plant(field, 8, 8, MUSHROOM_HOST_STOCK + 1);
    const earlySkirt = mushroomHostSkirtRadius(MUSHROOM_HOST_STOCK + 1);
    const earlyList = mushroomPlacementsForHost(field, early);
    const earlyMin = Math.min(...earlyList.map((p) => distFromTile(field, 8, 8, p)));
    const giantMin = Math.min(...list.map((p) => distFromTile(field, tx, tz, p)));
    assert.ok(earlyMin > earlySkirt);
    assert.ok(giantMin > earlyMin, 'bigger trees push the cluster farther out');
  });

  it('keeps a cluster on the open side of a neighboring giant', () => {
    const field = blank();
    const host = plant(field, 40, 40, TREE_STOCK_GROVE_MAX);
    plant(field, 41, 40, TREE_STOCK_GROVE_MAX);
    const skirt = mushroomHostSkirtRadius(TREE_STOCK_GROVE_MAX);
    const list = mushroomPlacementsForHost(field, host);
    assert.ok(list.every((p) => distFromTile(field, 41, 40, p) > skirt));
  });

  it('leaves authored mushrooms on empty ground in a tight cluster', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    const tx = 12;
    const tz = 14;
    const i = tz * field.width + tx;
    field.doodadType[i] = DOODAD.MUSHROOM;
    const list = mushroomPlacementsForHost(field, i);
    assert.ok(list.every((p) => {
      const d = distFromTile(field, tx, tz, p);
      return d >= 1.2 && d <= 2.55;
    }));
  });

  it('rechecks neighbors when a dirty tile crosses the line', () => {
    const field = blank();
    const first = plant(field, 20, 20, MUSHROOM_HOST_STOCK + 4);
    plant(field, 21, 20, MUSHROOM_HOST_STOCK + 4);
    const third = plant(field, 22, 20, MUSHROOM_HOST_STOCK);
    const before = mushroomHostStatesNear(field, [third]);
    assert.ok(before.every((s) => !s.live));
    field.treeStock[third] = MUSHROOM_HOST_STOCK + 4;
    const after = mushroomHostStatesNear(field, [third]);
    const live = after.filter((s) => s.live).map((s) => s.tile).sort((a, b) => a - b);
    assert.deepEqual(live, [first, first + 1, third].sort((a, b) => a - b));
  });

  it('clears a stand when one host is felled', () => {
    const field = blank();
    const tiles = cluster(field, 10, 10, MUSHROOM_HOST_STOCK + 6);
    field.treeStock[tiles[0]] = 0;
    const states = mushroomHostStatesNear(field, [tiles[0]]);
    assert.ok(states.every((s) => !s.live));
    assert.equal(collectMushroomHostTiles(field).length, 0);
  });

  it('stamps and erases authored doodads without touching pass', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.pass.fill(1);
    const tx = 12;
    const tz = 14;
    const i = tz * field.width + tx;
    const passBefore = field.pass[i];
    assert.equal(canPaintDoodadAt(field, tx, tz, DOODAD.WAGON), true);
    assert.ok(paintDoodadBrush(field, tx, tz, DOODAD.WAGON).length);
    assert.equal(field.doodadType[i], DOODAD.WAGON);
    assert.equal(field.pass[i], passBefore);
    assert.equal(field.sceneryType[i], SCENERY.NONE);
    const wagon = wagonPlacementForTile(field, i);
    assert.equal(wagon.type, DOODAD.WAGON);
    assert.ok(wagon.roll > 2);
    const slots = collectDoodadSlots(field);
    assert.ok(slots.some((s) => s.kind === DOODAD.WAGON && s.tile === i));
    paintDoodadBrush(field, tx, tz, DOODAD.NONE);
    assert.equal(field.doodadType[i], DOODAD.NONE);
    assert.equal(collectDoodadSlots(field).length, 0);
  });

  it('plants a torch upright on any live tile', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    const tx = 18;
    const tz = 22;
    const i = tz * field.width + tx;
    assert.equal(canPaintDoodadAt(field, tx, tz, DOODAD.TORCH), true);
    assert.ok(paintDoodadBrush(field, tx, tz, DOODAD.TORCH).length);
    const torch = torchPlacementForTile(field, i);
    assert.equal(torch.type, DOODAD.TORCH);
    assert.equal(torch.roll, 0);
    assert.equal(torch.yOff, 0);
    assert.equal(TORCH_FIRE_ANCHOR.name, 'fire_anchor');
    assert.ok(TORCH_FIRE_ANCHOR.y > 1);
    assert.ok(TORCH_VISION_TILES < 8);
    const slots = collectDoodadSlots(field);
    assert.ok(slots.some((s) => s.kind === DOODAD.TORCH && s.tile === i && s.key === `t:${i}`));
    let seen = 0;
    forEachTorch(field, (x, z) => {
      seen++;
      assert.equal(x, torch.x);
      assert.equal(z, torch.z);
    });
    assert.equal(seen, 1);
    plant(field, tx, tz, 20);
    field.tableEdge = new Uint8Array(field.width * field.height);
    field.terrainTypes[i] = TERRAIN.WATER;
    field.tableEdge[i] = 1;
    assert.equal(canPaintDoodadAt(field, tx, tz, DOODAD.TORCH), true);
    assert.equal(paintDoodadBrush(field, tx, tz, DOODAD.TORCH).length, 0);
    const wet = tz * field.width + (tx + 1);
    field.terrainTypes[wet] = TERRAIN.WATER;
    field.sceneryType[wet] = SCENERY.ROCK_PLAIN;
    field.tableEdge[wet] = 1;
    assert.equal(canPaintDoodadAt(field, tx + 1, tz, DOODAD.TORCH), true);
    assert.ok(paintDoodadBrush(field, tx + 1, tz, DOODAD.TORCH).length);
    assert.equal(field.doodadType[wet], DOODAD.TORCH);
  });

  it('plants a static derrick and a windvane', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    const derrickTile = 9 * field.width + 11;
    const vaneTile = 14 * field.width + 16;
    assert.ok(paintDoodadBrush(field, 11, 9, DOODAD.DERRICK).length);
    assert.ok(paintDoodadBrush(field, 16, 14, DOODAD.WINDVANE).length);
    const derrick = derrickPlacementForTile(field, derrickTile);
    const vane = windvanePlacementForTile(field, vaneTile);
    assert.equal(derrick.roll, 0);
    assert.equal(vane.roll, 0);
    assert.equal(derrick.scale, 1);
    assert.equal(vane.scale, 1);
    const slots = collectDoodadSlots(field);
    assert.ok(slots.some((s) => s.kind === DOODAD.DERRICK && s.key === `d:${derrickTile}`));
    assert.ok(slots.some((s) => s.kind === DOODAD.WINDVANE && s.key === `v:${vaneTile}`));
  });

  it('blocks a plus around a standard and keeps its banner', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.pass.fill(1);
    const tx = 20;
    const tz = 20;
    const w = field.width;
    const at = (x, z) => field.pass[z * w + x];
    const i = tz * w + tx;
    assert.ok(paintDoodadBrush(field, tx, tz, DOODAD.STANDARD, 0, { color: 4 }).length);
    assert.equal(field.doodadType[i], DOODAD.STANDARD);
    assert.equal(field.doodadColor[i], 4);
    assert.equal(at(tx, tz), 0);
    assert.equal(at(tx + 1, tz), 0);
    assert.equal(at(tx - 1, tz), 0);
    assert.equal(at(tx, tz + 1), 0);
    assert.equal(at(tx, tz - 1), 0);
    assert.equal(at(tx + 1, tz + 1), 1);
    const slot = collectDoodadSlots(field).find((s) => s.kind === DOODAD.STANDARD);
    assert.equal(slot.color, 4);
    assert.equal(slot.key, `s:${i}`);
    assert.equal(standardPlacementForTile(field, i).roll, 0);
    assert.equal(paintDoodadBrush(field, tx, tz, DOODAD.STANDARD, 0, { color: 4 }).length, 0);
    assert.ok(paintDoodadBrush(field, tx, tz, DOODAD.STANDARD, 0, { color: 2 }).length);
    assert.equal(field.doodadColor[i], 2);
    assert.equal(at(tx + 1, tz), 0);

    paintDoodadBrush(field, tx + 2, tz, DOODAD.STANDARD, 0, { color: 1 });
    paintDoodadBrush(field, tx, tz, DOODAD.NONE);
    assert.equal(at(tx, tz), 1);
    assert.equal(at(tx - 1, tz), 1);
    assert.equal(at(tx + 1, tz), 0);
    assert.equal(at(tx + 2, tz), 0);
    paintDoodadBrush(field, tx + 2, tz, DOODAD.NONE);
    assert.equal(at(tx + 1, tz), 1);
    assert.equal(at(tx + 2, tz), 1);

    paintDoodadBrush(field, tx, tz, DOODAD.STANDARD, 0, { color: 7 });
    field.terrainTypes[tz * w + (tx + 1)] = TERRAIN.WATER;
    field.tileType[tz * w + (tx + 1)] = 12;
    field.pass[tz * w + (tx + 1)] = 0;
    paintDoodadBrush(field, tx, tz, DOODAD.NONE);
    assert.equal(at(tx, tz), 1);
    assert.equal(at(tx + 1, tz), 0);

    paintDoodadBrush(field, tx, tz, DOODAD.STANDARD, 0, { color: 4 });
    refreshTerrainDerived(field);
    assert.equal(at(tx, tz), 1);
    applyStandardOccupancy(field);
    assert.equal(at(tx, tz), 0);
    assert.equal(at(tx, tz + 1), 0);
    const json = encodeGarden(field, { name: 'standard' });
    assert.ok(json.dc);
    const again = fieldFromGarden(json);
    assert.equal(again.doodadType[i], DOODAD.STANDARD);
    assert.equal(again.doodadColor[i], 4);
    assert.equal(again.pass[i], 0);
    assert.equal(again.pass[tz * w + (tx + 1)], 0);
    assert.equal(again.standardBlock[i], 1);
  });

  it('plants props on any live tile and keeps mushrooms on open ground', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    plant(field, 16, 16, 20);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.WAGON), true);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.DERRICK), true);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.WINDVANE), true);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.STANDARD), true);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.MUSHROOM), true);
    const wet = 16 * field.width + 18;
    field.terrainTypes[wet] = TERRAIN.WATER;
    field.tableEdge = new Uint8Array(field.width * field.height);
    field.tableEdge[wet] = 1;
    field.sceneryType[wet] = SCENERY.ROCK_PLAIN;
    assert.equal(canPaintDoodadAt(field, 18, 16, DOODAD.MUSHROOM), false);
    assert.equal(canPaintDoodadAt(field, 18, 16, DOODAD.WAGON), true);
    assert.ok(paintDoodadBrush(field, 18, 16, DOODAD.WAGON).length);
    assert.equal(field.doodadType[wet], DOODAD.WAGON);
    assert.ok(paintDoodadBrush(field, 16, 16, DOODAD.MUSHROOM).length);
    assert.ok(collectDoodads(field).some((d) => d.type === DOODAD.MUSHROOM));
  });

  it('sprouts after a finished grove fattens a nearby stand', () => {
    const field = blank();
    const gx = 40;
    const gz = 40;
    cluster(field, gx + 1, gz, TREE_STOCK_NATURAL_MAX, MUSHROOM_AREA_MIN);
    assert.equal(collectMushroomHostTiles(field).length, 0);
    const w = createWorld(1);
    w.buildings = [createBuilding({
      owner: 0,
      type: 'grove',
      x: fx.toFloat(tileCenterX(gx)),
      z: fx.toFloat(tileCenterY(gz)),
    })];
    for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * (TREE_WOOD_PER_STAGE + 2); t++) {
      groveGrowthSystem(w, field);
      w.tick++;
    }
    assert.ok(collectMushroomHostTiles(field).length >= MUSHROOM_AREA_MIN);
    assert.ok(collectDoodads(field).length >= MUSHROOM_AREA_MIN * MUSHROOM_PER_HOST_MIN);
  });
});
