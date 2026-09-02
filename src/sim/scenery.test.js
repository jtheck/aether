import assert from 'node:assert/strict';
import { createField, TERRAIN } from './field.js';
import { UNIT, unitSlowMul, DEFAULT_SLOW_MUL } from './unitTypes.js';
import * as fx from './fixed.js';
import {
  SCENERY,
  ROCK_STAGE_MAX,
  TREE_PAINT_CLEARANCE,
  applyRockOccupancyFromStock,
  damageRock,
  paintSceneryBrush,
  placeRockAt,
  populateScenery,
  rockFootprintRadius,
  rockFootprintRadiusForStock,
  rockStageFromStock,
  rockYield,
  takeRockUpdates,
} from './scenery.js';

function tileAt(field, tx, tz) {
  return tz * field.width + tx;
}

function passAt(field, tx, tz) {
  return field.pass[tz * field.width + tx];
}

function plant(kind, tx = 40, tz = 40) {
  const field = createField(1);
  field.pass.fill(1);
  assert.ok(placeRockAt(field, tx, tz, kind), 'rock planted');
  return { field, tx, tz, i: tileAt(field, tx, tz) };
}

function stagesMatchYield() {
  assert.equal(rockYield(SCENERY.ROCK_PLAIN) % ROCK_STAGE_MAX, 0);
  assert.equal(rockYield(SCENERY.ROCK_MOSS) % ROCK_STAGE_MAX, 0);
  assert.equal(rockYield(SCENERY.ROCK_SNOW) % ROCK_STAGE_MAX, 0);
  assert.ok(rockYield(SCENERY.ROCK_PLAIN) >= 80, 'plain rocks last several hauls');
  assert.ok(rockYield(SCENERY.ROCK_MOSS) >= 160, 'moss rocks last a real deposit');
  assert.ok(rockYield(SCENERY.ROCK_SNOW) >= 240, 'snow rocks are the big pile');
}

function stageFromRemainingStock() {
  const kind = SCENERY.ROCK_SNOW;
  const full = rockYield(kind);
  assert.equal(rockStageFromStock(kind, full), ROCK_STAGE_MAX);
  assert.equal(rockStageFromStock(kind, 1), 1);
  assert.equal(rockStageFromStock(kind, 0), 0);
  assert.equal(rockFootprintRadiusForStock(kind, full), 2);
  assert.equal(rockFootprintRadiusForStock(kind, Math.ceil(full * 0.5)), 1);
  assert.equal(rockFootprintRadiusForStock(kind, 1), 0);
  assert.equal(rockFootprintRadiusForStock(kind, 0), -1);
}

function snowFootprintShrinksWithStock() {
  const { field, tx, tz, i } = plant(SCENERY.ROCK_SNOW);
  assert.equal(passAt(field, tx + 2, tz), 0, 'full snow rock blocks the outer ring');
  assert.equal(passAt(field, tx, tz), 0, 'center is blocked');

  // Drop into the mid band (radius 1).
  const mid = rockYield(SCENERY.ROCK_SNOW) / 2;
  field.rockStock[i] = mid;
  applyRockOccupancyFromStock(field);
  assert.equal(passAt(field, tx + 2, tz), 1, 'outer ring opens at mid stock');
  assert.equal(passAt(field, tx + 1, tz), 0, 'inner ring still blocks');

  field.rockStock[i] = 1;
  applyRockOccupancyFromStock(field);
  assert.equal(passAt(field, tx + 1, tz), 1, 'inner ring opens on the last stage');
  assert.equal(passAt(field, tx, tz), 0, 'nub still occupies its tile');

  field.rockStock[i] = 0;
  applyRockOccupancyFromStock(field);
  assert.equal(field.sceneryType[i], SCENERY.NONE, 'depleted rock is cleared');
  assert.equal(passAt(field, tx, tz), 1, 'center becomes walkable');
}

function damageRockPublishesAndShrinks() {
  const { field, tx, tz, i } = plant(SCENERY.ROCK_MOSS);
  assert.equal(rockFootprintRadius(SCENERY.ROCK_MOSS), 1);
  assert.equal(passAt(field, tx + 1, tz), 0, 'moss rock starts as a 3×3');

  takeRockUpdates(field);
  const full = field.rockStock[i];
  // Chip down to stage 3 (radius 0).
  const target = rockYield(SCENERY.ROCK_MOSS) / ROCK_STAGE_MAX * 3;
  const removed = damageRock(field, i, full - target);
  assert.equal(removed, full - target);
  assert.equal(passAt(field, tx + 1, tz), 1, 'rim unblocks when the stage drops');
  assert.equal(passAt(field, tx, tz), 0, 'center stays blocked while stock remains');

  const patch = takeRockUpdates(field);
  assert.ok(patch, 'damage publishes a rock update');
  assert.equal(patch.tiles[0], i);
  assert.equal(patch.stock[0], target);

  damageRock(field, i, target);
  assert.equal(field.rockStock[i], 0);
  assert.equal(field.sceneryType[i], SCENERY.NONE);
  assert.equal(passAt(field, tx, tz), 1, 'gone rock leaves no blocker');
}

function archerAndApcKeepMoreTreeSpeed() {
  assert.ok(Math.abs(fx.toFloat(unitSlowMul(UNIT.VILLAGER)) - DEFAULT_SLOW_MUL) < 0.001);
  assert.ok(fx.toFloat(unitSlowMul(UNIT.ARCHER)) > 0.7, 'archer woods snag is light');
  assert.ok(fx.toFloat(unitSlowMul(UNIT.APC)) > 0.75, 'APC pushes through brush');
}

stagesMatchYield();
stageFromRemainingStock();
snowFootprintShrinksWithStock();
damageRockPublishesAndShrinks();
paintBrushRespectsFootprints();
archerAndApcKeepMoreTreeSpeed();
console.log('scenery.test.js: ok (rock yield + stages + collision shrink + paint spacing)');

function blankLand() {
  const field = createField(1);
  field.pass.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  return field;
}

function countKind(field, kind, x0, z0, x1, z1) {
  const found = [];
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (field.sceneryType[z * field.width + x] === kind) found.push({ x, z });
    }
  }
  return found;
}

function paintBrushRespectsFootprints() {
  const trees = blankLand();
  const dirtyTrees = paintSceneryBrush(trees, 40, 40, SCENERY.TREE, 3);
  const planted = countKind(trees, SCENERY.TREE, 37, 37, 43, 43);
  assert.ok(dirtyTrees.length > 0, 'tree brush plants something');
  assert.ok(planted.length < dirtyTilesInDisc(3), 'tree brush is sparser than every tile');
  for (let i = 0; i < planted.length; i++) {
    for (let j = i + 1; j < planted.length; j++) {
      const dx = Math.abs(planted[i].x - planted[j].x);
      const dz = Math.abs(planted[i].z - planted[j].z);
      assert.ok(Math.max(dx, dz) > TREE_PAINT_CLEARANCE, 'painted trees keep a Chebyshev moat');
    }
  }

  const { field, tx, tz } = plant(SCENERY.ROCK_MOSS);
  field.terrainTypes.fill(TERRAIN.GRASS);
  assert.equal(placeRockAt(field, tx + 1, tz, SCENERY.ROCK_MOSS), false, 'moss footprints do not overlap');
  const stacked = paintSceneryBrush(field, tx + 1, tz, SCENERY.ROCK_MOSS, 0);
  assert.equal(stacked.length, 0, 'paint refuses a rock that would overlap');

  const rocks = blankLand();
  paintSceneryBrush(rocks, 40, 40, SCENERY.ROCK_MOSS, 3);
  const moss = countKind(rocks, SCENERY.ROCK_MOSS, 37, 37, 43, 43);
  assert.ok(moss.length >= 1, 'moss brush plants at least one rock');
  for (let i = 0; i < moss.length; i++) {
    for (let j = i + 1; j < moss.length; j++) {
      const dist = Math.hypot(moss[i].x - moss[j].x, moss[i].z - moss[j].z);
      assert.ok(dist >= 4, 'painted moss rocks keep their footprints');
    }
  }

  const snow = blankLand();
  assert.ok(placeRockAt(snow, 40, 40, SCENERY.ROCK_SNOW));
  const erased = paintSceneryBrush(snow, 42, 40, SCENERY.NONE, 0);
  assert.ok(erased.length > 0, 'erase on a footprint tile clears the rock');
  assert.equal(snow.sceneryType[40 * snow.width + 40], SCENERY.NONE);

  const authored = blankLand();
  authored.terrainTypes[tileAt(authored, 41, 40)] = TERRAIN.DIRT;
  paintSceneryBrush(authored, 40, 40, SCENERY.TREE, 0);
  assert.ok(placeRockAt(authored, 50, 50, SCENERY.ROCK_MOSS));
  populateScenery(authored, null, [], { keepExisting: true });
  assert.equal(authored.sceneryType[tileAt(authored, 40, 40)], SCENERY.TREE, 'generate keeps painted trees');
  assert.equal(authored.sceneryType[tileAt(authored, 50, 50)], SCENERY.ROCK_MOSS, 'generate keeps painted rocks');
}

function dirtyTilesInDisc(radius) {
  const r2 = radius * radius;
  let n = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz <= r2) n++;
    }
  }
  return n;
}
