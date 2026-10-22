import assert from 'node:assert/strict';
import { createField, TERRAIN, worldToTile } from './field.js';
import { UNIT, unitSlowMul, DEFAULT_SLOW_MUL } from './unitTypes.js';
import * as fx from './fixed.js';
import {
  SCENERY,
  ROCK_STAGE_MAX,
  TREE_EDGE_FADE_TILES,
  TREE_EDGE_SCATTER_TILES,
  applyRockOccupancyFromStock,
  applyAuthoredScenery,
  clearSceneryCoveringTiles,
  clearSceneryOnWater,
  damageRock,
  defaultTreeStock,
  paintSceneryBrush,
  clearAllScenery,
  clearOffTableScenery,
  placeRockAt,
  populateScenery,
  SPAWN_CLEAR_RADIUS_TILES,
  rockFootprintRadius,
  rockFootprintRadiusForStock,
  rockStageFromStock,
  rockYield,
  takeRockUpdates,
  treeEdgeBonusStages,
} from './scenery.js';
import {
  TREE_STAGE_GROVE_MAX,
  TREE_STAGE_MAX,
  TREE_STOCK_GROVE_MAX,
  TREE_STOCK_NATURAL_MAX,
  TREE_WOOD_PER_STAGE,
} from './trees.js';
import { applyTableSilhouette, paintTerrainBrush, setCellEnabled } from './tableShape.js';

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
  assert.ok(rockYield(SCENERY.ROCK_PLAIN) >= 140, 'plain rocks last several hauls');
  assert.ok(rockYield(SCENERY.ROCK_MOSS) >= 240, 'moss rocks last a real deposit');
  assert.ok(rockYield(SCENERY.ROCK_SNOW) >= 400, 'snow rocks are the big pile');
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

function clearEmptiesTheMap() {
  const field = createField(1);
  field.pass.fill(1);
  field.activeMask.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  const tx = 40;
  const tz = 40;
  const i = tileAt(field, tx, tz);
  assert.ok(placeRockAt(field, tx, tz, SCENERY.ROCK_MOSS));
  assert.equal(passAt(field, tx, tz), 0);
  clearAllScenery(field);
  assert.equal(field.sceneryAuthored, true);
  assert.equal(field.sceneryType[i], SCENERY.NONE);
  assert.equal(field.rockStock[i], 0);
  assert.equal(passAt(field, tx, tz), 1, 'cleared rock stops blocking');
}

stagesMatchYield();
stageFromRemainingStock();
snowFootprintShrinksWithStock();
damageRockPublishesAndShrinks();
clearEmptiesTheMap();
paintBrushRespectsFootprints();
rocksPack();
sceneryDensityThinsTheBrush();
archerAndApcKeepMoreTreeSpeed();
edgeTreeFadeMatchesGrove();
reservedPadsCanKeepTrees();
offTableSceneryIsCleared();
waterBrushClearsScenery();
placementClearsCoveringResources();
paintSkipsStructureTiles();
console.log('scenery.test.js: ok (rock yield + stages + collision shrink + paint spacing + edge trees)');

function blankLand() {
  const field = createField(1);
  field.pass.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  return field;
}

function rocksPack() {
  const tight = { tight: true };
  const plains = blankLand();
  assert.ok(paintSceneryBrush(plains, 20, 20, SCENERY.ROCK_PLAIN, 0, tight).length > 0);
  assert.ok(paintSceneryBrush(plains, 21, 20, SCENERY.ROCK_PLAIN, 0, tight).length > 0, 'plain rocks sit on neighboring tiles');

  const moss = blankLand();
  assert.ok(paintSceneryBrush(moss, 20, 20, SCENERY.ROCK_MOSS, 0, tight).length > 0);
  assert.ok(paintSceneryBrush(moss, 22, 20, SCENERY.ROCK_MOSS, 0, tight).length > 0, 'moss rocks can sit two tiles apart');
  const before = moss.rockStock[tileAt(moss, 20, 20)];
  const beside = paintSceneryBrush(moss, 21, 20, SCENERY.ROCK_MOSS, 0, tight);
  assert.equal(beside.length, 0, 'painting a moss rock body does not add another');
  assert.notEqual(moss.sceneryType[tileAt(moss, 21, 20)], SCENERY.ROCK_MOSS);
  assert.equal(moss.rockStock[tileAt(moss, 20, 20)], before, 'painting its disc does not stack the rock');

  const pile = blankLand();
  const tx = 30;
  const tz = 30;
  assert.ok(paintSceneryBrush(pile, tx, tz, SCENERY.ROCK_PLAIN, 0, tight).length > 0);
  const i = tileAt(pile, tx, tz);
  const unit = rockYield(SCENERY.ROCK_PLAIN);
  assert.equal(pile.rockStock[i], unit);
  assert.equal(paintSceneryBrush(pile, tx, tz, SCENERY.ROCK_PLAIN, 0, tight).length, 0, 'painting the same rock does not stack it');
  assert.equal(pile.rockStock[i], unit);
  applyAuthoredScenery(pile);
  assert.equal(pile.rockStock[i], unit, 'a scenery refresh keeps the single rock');

  const grown = blankLand();
  paintSceneryBrush(grown, 12, 12, SCENERY.ROCK_PLAIN, 0, tight);
  paintSceneryBrush(grown, 12, 12, SCENERY.ROCK_PLAIN, 0, tight);
  populateScenery(grown, null, [], { keepExisting: true });
  assert.equal(grown.rockStock[tileAt(grown, 12, 12)], unit, 'generate leaves a painted rock as one');
}

function sceneryDensityThinsTheBrush() {
  const full = dirtyTilesInDisc(4);
  const sparse = blankLand();
  paintSceneryBrush(sparse, 40, 40, SCENERY.TREE, 4, { density: 0.35, salt: 1 });
  const first = countKind(sparse, SCENERY.TREE, 36, 36, 44, 44).length;
  assert.ok(first > 0 && first < full, 'one stroke keeps a subset');
  paintSceneryBrush(sparse, 40, 40, SCENERY.TREE, 4, { density: 0.35, salt: 1 });
  assert.equal(countKind(sparse, SCENERY.TREE, 36, 36, 44, 44).length, first, 'the same stroke does not fill the gaps');
  for (let salt = 2; salt <= 8; salt++) {
    paintSceneryBrush(sparse, 40, 40, SCENERY.TREE, 4, { density: 0.35, salt });
  }
  const later = countKind(sparse, SCENERY.TREE, 36, 36, 44, 44).length;
  assert.ok(later > first, 'a new stroke adds trees on the same ground');

  const erased = blankLand();
  paintSceneryBrush(erased, 12, 12, SCENERY.TREE, 2);
  const before = countKind(erased, SCENERY.TREE, 10, 10, 14, 14).length;
  paintSceneryBrush(erased, 12, 12, SCENERY.NONE, 2, { density: 0.45, salt: 3 });
  const mid = countKind(erased, SCENERY.TREE, 10, 10, 14, 14).length;
  assert.ok(mid > 0 && mid < before, 'erase follows density');
  for (let salt = 4; salt <= 12; salt++) {
    paintSceneryBrush(erased, 12, 12, SCENERY.NONE, 2, { density: 0.45, salt });
  }
  assert.ok(countKind(erased, SCENERY.TREE, 10, 10, 14, 14).length < mid, 'another erase stroke removes more');
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
  assert.equal(dirtyTrees.length, dirtyTilesInDisc(3), 'tree brush fills every land tile');
  assert.equal(planted.length, dirtyTilesInDisc(3), 'painted trees sit on neighboring tiles');
  assert.equal(trees.sceneryType[tileAt(trees, 40, 40)], SCENERY.TREE);
  assert.equal(trees.sceneryType[tileAt(trees, 41, 40)], SCENERY.TREE);

  const { field, tx, tz } = plant(SCENERY.ROCK_MOSS);
  field.terrainTypes.fill(TERRAIN.GRASS);
  assert.equal(placeRockAt(field, tx + 1, tz, SCENERY.ROCK_MOSS), false, 'moss footprints do not overlap');
  const replaced = paintSceneryBrush(field, tx + 1, tz, SCENERY.ROCK_PLAIN, 0, { tight: true });
  assert.ok(replaced.length > 0, 'painting a different rock replaces the one under the brush');
  assert.equal(field.sceneryType[tileAt(field, tx, tz)], SCENERY.NONE);
  assert.equal(field.sceneryType[tileAt(field, tx + 1, tz)], SCENERY.ROCK_PLAIN);
  assert.equal(field.rockStock[tileAt(field, tx, tz)], 0);

  const grove = blankLand();
  assert.ok(paintSceneryBrush(grove, 8, 8, SCENERY.ROCK_PLAIN, 0, { tight: true }).length > 0);
  const overRock = paintSceneryBrush(grove, 8, 8, SCENERY.TREE, 0);
  assert.equal(grove.sceneryType[tileAt(grove, 8, 8)], SCENERY.TREE, 'a tree paint replaces the rock');
  assert.equal(grove.rockStock[tileAt(grove, 8, 8)], 0);
  assert.ok(overRock.some((t) => t.x === 8 && t.z === 8));
  assert.ok(paintSceneryBrush(grove, 8, 9, SCENERY.ROCK_MOSS, 0, { tight: true }).length > 0);
  assert.equal(grove.sceneryType[tileAt(grove, 8, 9)], SCENERY.ROCK_MOSS, 'a rock paint replaces the tree');
  assert.equal(grove.treeStock[tileAt(grove, 8, 9)], 0);

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
  assert.ok(erased.some((t) => t.x === 40 && t.z === 40), 'erase dirties the rock center');
  assert.equal(snow.sceneryType[40 * snow.width + 40], SCENERY.NONE);

  const skirt = blankLand();
  assert.ok(placeRockAt(skirt, 40, 40, SCENERY.ROCK_SNOW));
  const skirtErased = paintSceneryBrush(skirt, 44, 40, SCENERY.NONE, 0);
  assert.ok(skirtErased.some((t) => t.x === 40 && t.z === 40), 'erase on the visible skirt clears the rock');
  assert.equal(skirt.sceneryType[40 * skirt.width + 40], SCENERY.NONE);
  const far = blankLand();
  assert.ok(placeRockAt(far, 40, 40, SCENERY.ROCK_SNOW));
  const missed = paintSceneryBrush(far, 48, 40, SCENERY.NONE, 0);
  assert.equal(missed.length, 0, 'erase past the mesh leaves the rock');
  assert.equal(far.sceneryType[40 * far.width + 40], SCENERY.ROCK_SNOW);

  const plain = blankLand();
  assert.ok(placeRockAt(plain, 40, 40, SCENERY.ROCK_PLAIN));
  const plainErased = paintSceneryBrush(plain, 41, 40, SCENERY.NONE, 0);
  assert.ok(plainErased.some((t) => t.x === 40 && t.z === 40), 'erase beside a small rock clears it');
  assert.equal(plain.sceneryType[40 * plain.width + 40], SCENERY.NONE);

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

function edgeTreeFadeMatchesGrove() {
  const extraMax = TREE_STAGE_GROVE_MAX - TREE_STAGE_MAX;
  assert.equal(treeEdgeBonusStages(0), extraMax);
  assert.equal(treeEdgeBonusStages(TREE_EDGE_FADE_TILES), 0);
  assert.equal(treeEdgeBonusStages(TREE_EDGE_FADE_TILES + 4), 0);
  assert.ok(treeEdgeBonusStages(4) > treeEdgeBonusStages(12), 'bonus fades inward');
  assert.ok(
    treeEdgeBonusStages(14, 0) > treeEdgeBonusStages(14, 1),
    'scatter breaks the contour',
  );

  const seed = 0x51de;
  const field = createField(seed, { width: 80, height: 80 });
  field.pass.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  applyTableSilhouette(field, { suppressCenterBlock: true });

  const midTx = 40;
  const midTz = 40;
  const inlandPastScatter = TREE_EDGE_FADE_TILES + TREE_EDGE_SCATTER_TILES;
  const interior = defaultTreeStock(midTx, midTz, seed);
  assert.equal(defaultTreeStock(midTx, midTz, seed, field), interior, 'deep interior keeps the hash roll');
  assert.ok(interior <= TREE_STOCK_NATURAL_MAX);

  const rim = defaultTreeStock(2, midTz, seed, field);
  const rimHash = defaultTreeStock(2, midTz, seed);
  assert.ok(rim > rimHash, 'rim adds grove stages on the same roll');
  assert.ok(rim > TREE_STOCK_NATURAL_MAX, 'rim reaches grove giants');
  assert.ok(rim <= TREE_STOCK_GROVE_MAX);
  assert.equal(rim % TREE_WOOD_PER_STAGE, 0);

  populateScenery(field, null, []);
  let interiorMax = 0;
  let rimMax = 0;
  for (let tz = 0; tz < field.height; tz++) {
    for (let tx = 0; tx < field.width; tx++) {
      const i = tz * field.width + tx;
      if (field.sceneryType[i] !== SCENERY.TREE) continue;
      const stock = field.treeStock[i];
      const d = Math.min(tx, tz, field.width - 1 - tx, field.height - 1 - tz);
      if (d >= inlandPastScatter) interiorMax = Math.max(interiorMax, stock);
      if (d <= 2) rimMax = Math.max(rimMax, stock);
    }
  }
  assert.ok(interiorMax > 0 && rimMax > 0, 'seeded populate plants both bands');
  assert.ok(interiorMax <= TREE_STOCK_NATURAL_MAX, 'deep interior populate stays natural');
  assert.ok(rimMax > interiorMax, 'populate rim outgrows the interior');
}

function reservedPadsCanKeepTrees() {
  const seed = 0x51de;
  const cleared = createField(seed, { width: 80, height: 80 });
  cleared.pass.fill(1);
  cleared.terrainTypes.fill(TERRAIN.GRASS);
  const kept = createField(seed, { width: 80, height: 80 });
  kept.pass.fill(1);
  kept.terrainTypes.fill(TERRAIN.GRASS);
  populateScenery(cleared, null, [[0, 0]]);
  populateScenery(kept, null, [[0, 0]], { reserveTrees: false });
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  let clearedTrees = 0;
  let keptTrees = 0;
  for (let dz = -SPAWN_CLEAR_RADIUS_TILES; dz <= SPAWN_CLEAR_RADIUS_TILES; dz++) {
    for (let dx = -SPAWN_CLEAR_RADIUS_TILES; dx <= SPAWN_CLEAR_RADIUS_TILES; dx++) {
      if (dx * dx + dz * dz > SPAWN_CLEAR_RADIUS_TILES ** 2) continue;
      const i = (cz + dz) * cleared.width + cx + dx;
      if (cleared.sceneryType[i] === SCENERY.TREE) clearedTrees++;
      if (kept.sceneryType[i] === SCENERY.TREE) keptTrees++;
    }
  }
  assert.equal(clearedTrees, 0);
  assert.ok(keptTrees > 0, 'KOTH drops should keep trees on the pad');
}

function waterBrushClearsScenery() {
  const field = blankLand();
  const w = field.width;
  assert.ok(paintSceneryBrush(field, 10, 10, SCENERY.TREE, 0).length > 0);
  assert.ok(paintSceneryBrush(field, 14, 10, SCENERY.ROCK_SNOW, 0, { tight: true }).length > 0);
  assert.ok(paintSceneryBrush(field, 10, 16, SCENERY.TREE, 0).length > 0);
  field.doodadType[10 * w + 12] = 2;
  paintTerrainBrush(field, 10, 10, TERRAIN.WATER, 2);
  const cleared = clearSceneryOnWater(field, 10, 10, 2);
  assert.ok(cleared.length > 0);
  applyAuthoredScenery(field);
  assert.equal(field.terrainTypes[10 * w + 10], TERRAIN.WATER);
  assert.equal(field.sceneryType[10 * w + 10], SCENERY.NONE);
  assert.equal(field.treeStock[10 * w + 10], 0);
  assert.equal(field.sceneryType[10 * w + 14], SCENERY.NONE);
  assert.equal(field.rockStock[10 * w + 14], 0);
  assert.equal(field.doodadType[10 * w + 12], 0);
  assert.equal(field.sceneryType[16 * w + 10], SCENERY.TREE);
  assert.equal(passAt(field, 14, 10), 1);
}

function paintSkipsStructureTiles() {
  const field = blankLand();
  field.structureClaim = new Uint8Array(field.width * field.height);
  field.structureClaim[tileAt(field, 20, 20)] = 1;
  field.structureClaim[tileAt(field, 21, 20)] = 1;
  assert.equal(paintSceneryBrush(field, 20, 20, SCENERY.TREE, 0).length, 0, 'a tree does not stamp a building tile');
  assert.equal(field.sceneryType[tileAt(field, 20, 20)], SCENERY.NONE);
  assert.ok(paintSceneryBrush(field, 19, 20, SCENERY.TREE, 0).length > 0, 'the next tile is still open');
  assert.equal(
    paintSceneryBrush(field, 22, 20, SCENERY.ROCK_MOSS, 0, { tight: true }).length,
    0,
    'a rock disc that covers a building tile does not stamp',
  );
  assert.notEqual(field.sceneryType[tileAt(field, 22, 20)], SCENERY.ROCK_MOSS);
  assert.ok(
    paintSceneryBrush(field, 24, 20, SCENERY.ROCK_PLAIN, 0, { tight: true }).some((t) => t.x === 24 && t.z === 20),
    'a rock whose disc misses the building still stamps',
  );
}

function placementClearsCoveringResources() {
  const field = blankLand();
  assert.ok(paintSceneryBrush(field, 20, 20, SCENERY.TREE, 0).length > 0);
  assert.ok(placeRockAt(field, 30, 30, SCENERY.ROCK_MOSS));
  assert.ok(paintSceneryBrush(field, 8, 8, SCENERY.TREE, 0).length > 0);
  const dirty = clearSceneryCoveringTiles(field, [
    { tx: 20, tz: 20 },
    { tx: 30, tz: 30 },
  ]);
  assert.ok(dirty.length > 0);
  assert.equal(field.sceneryType[tileAt(field, 20, 20)], SCENERY.NONE);
  assert.equal(field.treeStock[tileAt(field, 20, 20)], 0);
  assert.equal(field.sceneryType[tileAt(field, 30, 30)], SCENERY.NONE);
  assert.equal(field.rockStock[tileAt(field, 30, 30)], 0);
  assert.equal(passAt(field, 30, 30), 1);
  assert.equal(field.sceneryType[tileAt(field, 8, 8)], SCENERY.TREE);
}

function offTableSceneryIsCleared() {
  const field = createField(1, { width: 32, height: 32 });
  field.pass.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  applyTableSilhouette(field, { suppressCenterBlock: true });
  assert.ok(paintSceneryBrush(field, 4, 4, SCENERY.TREE, 0).length > 0);
  assert.ok(placeRockAt(field, 20, 20, SCENERY.ROCK_PLAIN));
  setCellEnabled(field.tableShape, 0, 0, false);
  applyTableSilhouette(field, field.tableShape);
  assert.equal(clearOffTableScenery(field), true);
  assert.equal(field.sceneryType[4 * 32 + 4], SCENERY.NONE);
  assert.equal(field.treeStock[4 * 32 + 4], 0);
  assert.equal(field.sceneryType[20 * 32 + 20], SCENERY.ROCK_PLAIN);
  assert.equal(clearOffTableScenery(field), false);
}
