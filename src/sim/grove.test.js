import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField, tileCenterX, tileCenterY } from './field.js';
import { createWorld } from './world.js';
import { createBuilding } from './buildings.js';
import { SCENERY } from './scenery.js';
import { step } from './step.js';
import {
  TREE_STOCK_GROVE_MAX,
  TREE_STOCK_NATURAL_MAX,
  TREE_WOOD_PER_STAGE,
} from './trees.js';
import {
  GROVE_GROW_INTERVAL_NEAR,
  GROVE_GROW_RADIUS_TILES,
  groveGrowCapForDist2,
  groveGrowIntervalForDist2,
  groveGrowthSystem,
} from './grove.js';

function plantTree(field, tx, tz, stock) {
  const i = tz * field.width + tx;
  field.sceneryType[i] = SCENERY.TREE;
  field.treeStock[i] = stock;
  field.slowMask[i] = 1;
  field.pass[i] = 1;
  return i;
}

function groveAt(tx, tz, opts = {}) {
  return createBuilding({
    owner: 0,
    type: 'grove',
    x: fx.toFloat(tileCenterX(tx)),
    z: fx.toFloat(tileCenterY(tz)),
    ...opts,
  });
}

function blankField() {
  return createField(1, { width: 80, height: 80 });
}

function fieldWithGroveTree(tx, tz, stock) {
  const field = blankField();
  const gx = 40;
  const gz = 40;
  const i = plantTree(field, tx, tz, stock);
  const w = createWorld(1);
  w.buildings = [groveAt(gx, gz)];
  return { field, w, i, gx, gz };
}

function capFadesWithDistance() {
  const r2 = GROVE_GROW_RADIUS_TILES * GROVE_GROW_RADIUS_TILES;
  assert.equal(groveGrowCapForDist2(0), TREE_STOCK_GROVE_MAX);
  assert.equal(groveGrowCapForDist2(r2), TREE_STOCK_NATURAL_MAX);
  assert.equal(groveGrowCapForDist2(r2 + 1), 0);
  assert.ok(groveGrowCapForDist2(r2 >> 2) > groveGrowCapForDist2((r2 * 3) >> 2));
  assert.equal(groveGrowIntervalForDist2(0), GROVE_GROW_INTERVAL_NEAR);
}

function finishedGroveFattensNearbyTree() {
  const { field, w, i } = fieldWithGroveTree(41, 40, TREE_STOCK_NATURAL_MAX);
  const start = field.treeStock[i];
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 8; t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.ok(field.treeStock[i] > start, 'nearby tree gains stock');
  assert.ok(field.treeStock[i] <= TREE_STOCK_GROVE_MAX);
}

function groveCanPushPastNaturalCap() {
  const { field, w, i } = fieldWithGroveTree(41, 40, TREE_STOCK_NATURAL_MAX);
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * (TREE_WOOD_PER_STAGE + 2); t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.ok(field.treeStock[i] > TREE_STOCK_NATURAL_MAX, 'center trees outgrow the old cap');
}

function unfinishedGroveDoesNotGrow() {
  const field = blankField();
  const i = plantTree(field, 41, 40, TREE_STOCK_NATURAL_MAX);
  const w = createWorld(1);
  w.buildings = [groveAt(40, 40, { built: 0 })];
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 4; t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.equal(field.treeStock[i], TREE_STOCK_NATURAL_MAX);
}

function ruinedGroveDoesNotGrow() {
  const { field, w, i } = fieldWithGroveTree(41, 40, TREE_STOCK_NATURAL_MAX);
  w.buildings[0].hp = 0;
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 4; t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.equal(field.treeStock[i], TREE_STOCK_NATURAL_MAX);
}

function doesNotPlantEmptyGrass() {
  const field = blankField();
  const empty = 41 * field.width + 40;
  field.pass[empty] = 1;
  const w = createWorld(1);
  w.buildings = [groveAt(40, 40)];
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 4; t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.equal(field.treeStock[empty], 0);
  assert.equal(field.sceneryType[empty], SCENERY.NONE);
}

function rimMatureTreeStaysCapped() {
  const field = blankField();
  const gx = 40;
  const gz = 40;
  const rim = gx + GROVE_GROW_RADIUS_TILES;
  const i = plantTree(field, rim, gz, TREE_STOCK_NATURAL_MAX);
  const w = createWorld(1);
  w.buildings = [groveAt(gx, gz)];
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 8; t++) {
    groveGrowthSystem(w, field);
    w.tick++;
  }
  assert.equal(field.treeStock[i], TREE_STOCK_NATURAL_MAX, 'rim stays at the natural cap');
}

function stepRunsGroveGrowth() {
  const { field, w, i } = fieldWithGroveTree(41, 40, TREE_STOCK_NATURAL_MAX);
  const start = field.treeStock[i];
  for (let t = 0; t < GROVE_GROW_INTERVAL_NEAR * 8; t++) step(w, field, []);
  assert.ok(field.treeStock[i] > start, 'step feeds grove growth');
}

capFadesWithDistance();
finishedGroveFattensNearbyTree();
groveCanPushPastNaturalCap();
unfinishedGroveDoesNotGrow();
ruinedGroveDoesNotGrow();
doesNotPlantEmptyGrass();
rimMatureTreeStaysCapped();
stepRunsGroveGrowth();
console.log('[PASS] grove growth fades out and fattens existing trees');
