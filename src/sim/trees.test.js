import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { buildField, createField, TILE_SIZE_F, WORLD_HALF_F } from './field.js';
import { SCENERY, populateScenery } from './scenery.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { PROJECTILE } from './projectileTypes.js';
import { spawnProjectile, projectileSystem } from './projectiles.js';
import { step } from './step.js';
import {
  TREE_BURN_DAMAGE,
  TREE_BURN_DAMAGE_INTERVAL,
  TREE_IGNITE_DAMAGE,
  TREE_WOOD_PER_STAGE,
  applyTreeSplash,
  damageTree,
  igniteTree,
  takeTreeUpdates,
  treeScaleForStage,
  treeStageFromStock,
  treeBurnSystem,
} from './trees.js';

function fieldWithTree(tx = 50, tz = 50, stock = TREE_WOOD_PER_STAGE * 4) {
  const field = createField(1);
  const i = tz * field.width + tx;
  field.sceneryType[i] = SCENERY.TREE;
  field.slowMask[i] = 1;
  field.pass[i] = 1;
  field.treeStock[i] = stock;
  return { field, tx, tz, i };
}

function tileWorld(tx, tz) {
  return {
    x: fx.fromFloat((tx + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
    y: fx.fromFloat((tz + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
  };
}

function stagesAndScales() {
  assert.equal(treeStageFromStock(42), 6);
  assert.equal(treeStageFromStock(28), 4);
  assert.equal(treeStageFromStock(22), 4);
  assert.equal(treeStageFromStock(21), 3);
  assert.equal(treeStageFromStock(7), 1);
  assert.equal(treeStageFromStock(0), 0);
  assert.ok(treeScaleForStage(6) > treeScaleForStage(4));
  assert.ok(treeScaleForStage(1) < treeScaleForStage(2));
  assert.equal(treeScaleForStage(0), 0);
}

function damageShrinksThenFells() {
  const { field, i } = fieldWithTree(40, 40, TREE_WOOD_PER_STAGE * 2);
  assert.equal(damageTree(field, i, TREE_WOOD_PER_STAGE), TREE_WOOD_PER_STAGE);
  assert.equal(field.treeStock[i], TREE_WOOD_PER_STAGE);
  assert.equal(field.sceneryType[i], SCENERY.TREE);
  assert.equal(damageTree(field, i, TREE_WOOD_PER_STAGE), TREE_WOOD_PER_STAGE);
  assert.equal(field.treeStock[i], 0);
  assert.equal(field.sceneryType[i], SCENERY.NONE);
  assert.equal(field.slowMask[i], 0);
}

function burnConsumesStages() {
  const { field, i } = fieldWithTree(41, 41, TREE_WOOD_PER_STAGE * 3);
  igniteTree(field, i);
  assert.ok(field.treeBurn[i] > 0);
  // First interval damage happens when burn % INTERVAL === 0 after decrements.
  for (let t = 0; t < TREE_BURN_DAMAGE_INTERVAL; t++) treeBurnSystem(field);
  assert.equal(field.treeStock[i], TREE_WOOD_PER_STAGE * 3 - TREE_BURN_DAMAGE);
}

function fireballSplashIgnitesNearbyTree() {
  const { field, i, tx, tz } = fieldWithTree(60, 60, TREE_WOOD_PER_STAGE * 4);
  const { x, y } = tileWorld(tx, tz);
  const before = field.treeStock[i];
  const hit = applyTreeSplash(field, x, y, fx.fromFloat(5));
  assert.equal(hit, true);
  assert.ok(field.treeBurn[i] > 0);
  assert.equal(field.treeStock[i], before - TREE_IGNITE_DAMAGE, 'ignite does not delete stock');
}

function fireballProjectileBurnsTreesThroughStep() {
  const { field, i, tx, tz } = fieldWithTree(70, 70, TREE_WOOD_PER_STAGE * 4);
  const { x, y } = tileWorld(tx, tz);
  const w = createWorld(4);
  const caster = spawn(w, {
    x: x - fx.fromInt(20),
    y,
    type: UNIT.WARLOCK,
    owner: 0,
  });
  spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: caster,
    target: -1,
    x: x - fx.fromInt(8),
    y,
    aimX: x,
    aimY: y,
    damage: 10,
  });
  for (let t = 0; t < 40 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.equal(w.projectiles.activeCount, 0);
  assert.ok(field.treeBurn[i] > 0 || field.treeStock[i] < TREE_WOOD_PER_STAGE * 4);
}

function populateAssignsVariedStock() {
  const field = buildField(7);
  populateScenery(field, null, []);
  let trees = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < field.sceneryType.length; i++) {
    if (field.sceneryType[i] !== SCENERY.TREE) continue;
    trees++;
    const s = field.treeStock[i];
    if (s < min) min = s;
    if (s > max) max = s;
    assert.ok(s % TREE_WOOD_PER_STAGE === 0);
    assert.ok(s >= TREE_WOOD_PER_STAGE * 2);
    assert.ok(s <= TREE_WOOD_PER_STAGE * 6);
  }
  assert.ok(trees > 100, 'expected a forest of trees');
  assert.ok(min < max, 'stocks should vary across trees');
  assert.ok(max >= TREE_WOOD_PER_STAGE * 5, 'upper sizes should appear');
}

function dirtyUpdatesPublish() {
  const { field, i } = fieldWithTree(12, 12, TREE_WOOD_PER_STAGE * 2);
  takeTreeUpdates(field); // clear
  damageTree(field, i, TREE_WOOD_PER_STAGE);
  const updates = takeTreeUpdates(field);
  assert.ok(updates);
  assert.equal(updates.tiles.length, 1);
  assert.equal(updates.tiles[0], i);
  assert.equal(updates.stock[0], TREE_WOOD_PER_STAGE);
}

function stepRunsBurnSystem() {
  const { field, i } = fieldWithTree(15, 15, TREE_WOOD_PER_STAGE * 2);
  igniteTree(field, i);
  const w = createWorld(1);
  const before = field.treeStock[i];
  for (let t = 0; t < TREE_BURN_DAMAGE_INTERVAL; t++) step(w, field, []);
  assert.ok(field.treeStock[i] < before);
}

stagesAndScales();
damageShrinksThenFells();
burnConsumesStages();
fireballSplashIgnitesNearbyTree();
fireballProjectileBurnsTreesThroughStep();
populateAssignsVariedStock();
dirtyUpdatesPublish();
stepRunsBurnSystem();
console.log('[PASS] tree stock, burn, and fireball ignition');
