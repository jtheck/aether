import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField, TERRAIN, tileCenterX, tileCenterY } from './field.js';
import { createWorld } from './world.js';
import { createBuilding } from './buildings.js';
import { SCENERY } from './scenery.js';
import { TREE_STOCK_NATURAL_MAX, TREE_BURN_TICKS, TREE_WOOD_PER_STAGE } from './trees.js';
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
  mushroomPlacementsForHost,
  overgrowthCountNear,
  paintDoodadBrush,
  wagonPlacementForTile,
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

  it('refuses a wagon on a tree but allows mushrooms', () => {
    const field = blank();
    field.terrainTypes.fill(TERRAIN.GRASS);
    plant(field, 16, 16, 20);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.WAGON), false);
    assert.equal(canPaintDoodadAt(field, 16, 16, DOODAD.MUSHROOM), true);
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
