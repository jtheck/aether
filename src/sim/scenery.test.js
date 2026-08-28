import assert from 'node:assert/strict';
import { createField } from './field.js';
import {
  SCENERY,
  ROCK_STAGE_MAX,
  applyRockOccupancyFromStock,
  damageRock,
  placeRockAt,
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

stagesMatchYield();
stageFromRemainingStock();
snowFootprintShrinksWithStock();
damageRockPublishesAndShrinks();
console.log('scenery.test.js: ok (rock yield + stages + collision shrink)');
