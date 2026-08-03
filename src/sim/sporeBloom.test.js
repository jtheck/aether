import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { SCENERY } from './scenery.js';
import { checksum } from './checksum.js';
import {
  TREE_WOOD_PER_STAGE,
  canGrowTreeAt,
  growTreeAt,
  takeTreeUpdates,
} from './trees.js';
import {
  createField,
  TILE_SIZE_F,
  WORLD_HALF_F,
  TERRAIN,
  isSlowTile,
} from './field.js';
import {
  SPORE_BLOOM_COOLDOWN,
  SPORE_GROWTH_DELAY,
  SPORE_MIN_SEEDS,
  SPORE_OUTER_RADIUS,
  SPORE_TREE_STOCK,
  castSporeBloom,
  fellTreesInRadius,
  takeSporeBloomUpdates,
} from './sporeBloom.js';

function tileWorld(tx, tz) {
  return {
    x: fx.fromFloat((tx + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
    y: fx.fromFloat((tz + 0.5) * TILE_SIZE_F - WORLD_HALF_F),
  };
}

function fieldPatch(tx, tz, opts = {}) {
  const field = createField(1);
  const i = tz * field.width + tx;
  field.terrainTypes[i] = opts.terrain ?? TERRAIN.GRASS;
  field.pass[i] = opts.pass ?? 1;
  field.activeMask[i] = 1;
  if (opts.tree) {
    field.sceneryType[i] = SCENERY.TREE;
    field.treeStock[i] = opts.stock ?? TREE_WOOD_PER_STAGE * 4;
    field.slowMask[i] = 1;
  }
  return { field, i, tx, tz };
}

function growTreeAtPlantsAndPublishes() {
  const { field, i, tx, tz } = fieldPatch(60, 60);
  assert.equal(canGrowTreeAt(field, tx, tz), true);
  assert.ok(growTreeAt(field, i, SPORE_TREE_STOCK));
  assert.equal(field.sceneryType[i], SCENERY.TREE);
  assert.equal(field.treeStock[i], SPORE_TREE_STOCK);
  assert.equal(field.slowMask[i], 1);
  assert.equal(canGrowTreeAt(field, tx, tz), false);

  const patch = takeTreeUpdates(field);
  assert.ok(patch);
  assert.equal(patch.tiles[0], i);
  assert.equal(patch.stock[0], SPORE_TREE_STOCK);
}

function castFellsTreesAndQueuesSeeds() {
  const field = createField(1);
  // Cluster of trees near aim, empty ring beyond.
  const aimTx = 80;
  const aimTz = 80;
  const aim = tileWorld(aimTx, aimTz);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = aimTx + dx;
      const tz = aimTz + dz;
      const i = tz * field.width + tx;
      field.terrainTypes[i] = TERRAIN.GRASS;
      field.pass[i] = 1;
      field.sceneryType[i] = SCENERY.TREE;
      field.treeStock[i] = TREE_WOOD_PER_STAGE * 3;
      field.slowMask[i] = 1;
    }
  }
  // Stamp growable grass across the whole blast neighborhood.
  for (let dz = -6; dz <= 6; dz++) {
    for (let dx = -6; dx <= 6; dx++) {
      const tx = aimTx + dx;
      const tz = aimTz + dz;
      const i = tz * field.width + tx;
      if (field.sceneryType[i] === SCENERY.TREE) continue;
      field.terrainTypes[i] = TERRAIN.GRASS;
      field.pass[i] = 1;
      field.sceneryType[i] = SCENERY.NONE;
      field.treeStock[i] = 0;
    }
  }

  const w = createWorld(90);
  const myco = spawn(w, {
    x: aim.x - fx.fromInt(8),
    y: aim.y,
    type: UNIT.MYCO,
    owner: 0,
  });

  step(w, field, [{
    type: CMD.CAST,
    entities: [myco],
    tx: aim.x,
    ty: aim.y,
  }]);

  assert.ok(w.abilityCd[myco] > 0);
  assert.equal(w.abilityCd[myco], SPORE_BLOOM_COOLDOWN - 1);

  // Center trees should be gone.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (aimTz + dz) * field.width + (aimTx + dx);
      assert.equal(field.treeStock[i], 0, 'blast fells trees');
      assert.equal(field.sceneryType[i], SCENERY.NONE);
    }
  }

  assert.ok(w.treeGrowth.count > 0, 'seeds queued');
  assert.equal(field.slowMask[aimTz * field.width + aimTx], 0, 'fell clears slow');
  assert.equal(isSlowTile(field, aimTx, aimTz), false);

  const seedTi = w.treeGrowth.tile[0];
  const seedTz = Math.floor(seedTi / field.width);
  const seedTx = seedTi - seedTz * field.width;
  assert.equal(isSlowTile(field, seedTx, seedTz), false, 'pending seed not slow yet');

  const fxPatch = takeSporeBloomUpdates(w);
  assert.ok(fxPatch);
  assert.ok(fxPatch.dripCount > 0, 'felled trees publish drip FX');
  assert.ok(fxPatch.seedCount > 0);

  for (let t = 0; t < SPORE_GROWTH_DELAY + 20; t++) step(w, field, []);
  assert.ok(field.treeStock[seedTi] > 0, 'seed sprouted');
  assert.equal(field.slowMask[seedTi], 1, 'new tree slows');
  assert.equal(isSlowTile(field, seedTx, seedTz), true);
}

function delayedGrowthSproutsTrees() {
  const field = createField(1);
  const tx = 70;
  const tz = 70;
  const i = tz * field.width + tx;
  field.terrainTypes[i] = TERRAIN.GRASS;
  field.pass[i] = 1;

  const w = createWorld(91);
  spawn(w, { x: 0, y: 0, type: UNIT.MYCO, owner: 0 });
  w.treeGrowth.tile[0] = i;
  w.treeGrowth.growAtTick[0] = w.tick + 2;
  w.treeGrowth.stock[0] = SPORE_TREE_STOCK;
  w.treeGrowth.count = 1;

  step(w, field, []);
  assert.equal(field.treeStock[i], 0, 'not yet');
  step(w, field, []);
  assert.equal(field.treeStock[i], 0, 'still waiting');
  step(w, field, []);
  assert.equal(field.treeStock[i], SPORE_TREE_STOCK, 'sprouts on schedule');
  assert.equal(field.sceneryType[i], SCENERY.TREE);
  assert.equal(w.treeGrowth.count, 0);
}

function castsAreDeterministic() {
  function run(seed) {
    const field = createField(seed);
    // Stamp a few trees + growable grass in a known area.
    for (let tz = 90; tz < 100; tz++) {
      for (let tx = 90; tx < 100; tx++) {
        const i = tz * field.width + tx;
        field.terrainTypes[i] = TERRAIN.GRASS;
        field.pass[i] = 1;
        if ((tx + tz) % 3 === 0) {
          field.sceneryType[i] = SCENERY.TREE;
          field.treeStock[i] = 21;
          field.slowMask[i] = 1;
        }
      }
    }
    const w = createWorld(seed);
    const myco = spawn(w, {
      x: tileWorld(95, 95).x,
      y: tileWorld(95, 95).y,
      type: UNIT.MYCO,
      owner: 0,
    });
    const aim = tileWorld(95, 95);
    for (let t = 0; t < SPORE_GROWTH_DELAY + 20; t++) {
      const cmds = t === 0
        ? [{ type: CMD.CAST, entities: [myco], tx: aim.x, ty: aim.y }]
        : [];
      step(w, field, cmds);
    }
    takeSporeBloomUpdates(w);
    takeTreeUpdates(field);
    return checksum(w, field);
  }
  assert.equal(run(42), run(42));
}

function emptyGroundStillCasts() {
  const field = createField(1);
  // Open grass around aim — no trees; ring seeds should still land.
  for (let tz = 40; tz < 60; tz++) {
    for (let tx = 40; tx < 60; tx++) {
      const i = tz * field.width + tx;
      field.terrainTypes[i] = TERRAIN.GRASS;
      field.pass[i] = 1;
      field.activeMask[i] = 1;
      field.sceneryType[i] = SCENERY.NONE;
      field.treeStock[i] = 0;
    }
  }
  const aim = tileWorld(50, 50);
  const w = createWorld(92);
  const myco = spawn(w, { x: aim.x, y: aim.y, type: UNIT.MYCO, owner: 0 });
  assert.ok(castSporeBloom(w, field, myco, aim.x, aim.y));
  assert.equal(fellTreesInRadius(w, field, aim.x, aim.y, SPORE_OUTER_RADIUS), 0);
  assert.ok(w.treeGrowth.count >= SPORE_MIN_SEEDS, 'at least min seeds');
  const fxPatch = takeSporeBloomUpdates(w);
  assert.ok(fxPatch);
  assert.ok(fxPatch.seedCount >= SPORE_MIN_SEEDS);
  assert.ok(fxPatch.seedCount > SPORE_MIN_SEEDS, 'top-up goes beyond the floor');
}

growTreeAtPlantsAndPublishes();
castFellsTreesAndQueuesSeeds();
delayedGrowthSproutsTrees();
castsAreDeterministic();
emptyGroundStillCasts();
console.log('sporeBloom.test.js: ok');
