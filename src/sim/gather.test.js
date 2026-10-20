import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField, worldToTile, tileCenterX, tileCenterY } from './field.js';
import { growTreeAt } from './trees.js';
import { SCENERY, rockFootprintRadius, rockYield } from './scenery.js';
import { addResource, getResource } from './resources.js';
import { overflowCredit, ownerResourceCap } from './storage.js';
import {
  GATHER_ACT,
  GATHER_CARRY_CAP,
  FARM_PASSIVE_INTERVAL,
  campWorkRadius,
  campWorkRadiusWorld,
  nearestDropOff,
  refreshEngineerAssists,
  CAMP_WORK_RADIUS_F,
  SILO_WORK_RADIUS_PENALTY_F,
  WORK_RADIUS_RING_INSET_F,
  siloWorkRadiusWorld,
  workRadiusRingWorld,
  CREW_RADIUS_BONUS_F,
  ENGINEER_RADIUS_BONUS_F,
  ENGINEER_BONUS_LINGER_TICKS,
} from './gather.js';
import { applyWorldStructureOccupancy, createBuilding } from './buildings.js';

function plantRockAt(field, tx, tz, kind, stock, footRadius) {
  const tile = tz * field.width + tx;
  field.sceneryType[tile] = kind;
  field.rockStock[tile] = stock;
  for (let dz = -footRadius; dz <= footRadius; dz++) {
    for (let dx = -footRadius; dx <= footRadius; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      field.pass[z * field.width + x] = 0;
    }
  }
  return tile;
}

function plantTreeAt(field, x, z, stock) {
  const tx = worldToTile(x);
  const tz = worldToTile(z);
  const tile = tz * field.width + tx;
  assert.ok(growTreeAt(field, tile, stock), 'tree planted');
  return tile;
}

function gathersAndDeposits() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(20);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 30);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'villager takes the gather order');

  for (let t = 0; t < 160; t++) step(w, field, []);

  assert.ok(field.treeStock[tile] < 30, 'tree stock is being harvested');
  assert.ok(
    getResource(w, 0, 'wood') >= GATHER_CARRY_CAP,
    `owner banked at least one load (got ${getResource(w, 0, 'wood')})`,
  );
}

function returnsAllTheWayToTheDropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(36);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 40);
  const dropX = fx.fromFloat(20);
  w.agoras = [{ owner: 0, x: dropX, z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  let depositDist = -1;
  for (let t = 0; t < 280; t++) {
    const had = getResource(w, 0, 'wood');
    step(w, field, []);
    if (had === 0 && getResource(w, 0, 'wood') > 0) {
      depositDist = fx.dist2(w.px[vill], w.py[vill], dropX, 0);
      break;
    }
  }
  assert.ok(depositDist >= 0, 'villager banks a load at the agora');
  assert.ok(
    depositDist <= fx.mul(fx.fromFloat(5), fx.fromFloat(5)),
    `deposited at the building (dist2=${depositDist}), not from 16 units away`,
  );
}

function onlyVillagersGather() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(21);
  const warrior = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 10);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [warrior], tile }]);
  assert.equal(w.order[warrior], ORDER.IDLE, 'non-villager ignores gather');
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a warrior');
}

function depletesThenIdles() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(22);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 6);
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  for (let t = 0; t < 240; t++) step(w, field, []);

  assert.equal(field.treeStock[tile], 0, 'node fully depleted');
  assert.equal(getResource(w, 0, 'wood'), 6, 'all remaining wood banked');
  assert.equal(w.order[vill], ORDER.IDLE, 'villager idles once the node is gone');
}

function needsADropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(23);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 30);
  // No agora / camp / mine for owner 0.
  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  for (let t = 0; t < 200; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'wood'), 0, 'nothing banked without a drop-off');
  assert.ok(w.carriedAmt[vill] > 0, 'villager still holds its load');
}

function idleCarrierReturnsToNearestDropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(36);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 8;
  w.carriedKind[vill] = 1; // wood
  w.agoras = [{ owner: 0, x: fx.fromFloat(12), z: 0 }];

  for (let t = 0; t < 120; t++) step(w, field, []);

  assert.equal(w.carriedAmt[vill], 0, 'idle carrier banks at the nearest agora');
  assert.equal(getResource(w, 0, 'wood'), 8, 'the load lands in the bank');
  assert.equal(w.order[vill], ORDER.IDLE, 'idles after the drop-off');
}

function campDoesNotRecruitIdleCarriers() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(37);
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 7;
  w.carriedKind[vill] = 1;
  plantTreeAt(field, 4, 0, 30);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];

  let banked = 0;
  for (let t = 0; t < 80; t++) {
    step(w, field, []);
    banked = getResource(w, 0, 'wood');
    if (banked >= 7) break;
  }

  assert.ok(banked >= 7, 'camp check sends the carrier home before recruiting a new chop');
}

function campAutoAssignsIdleVillagers() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(24);
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, 4, 0, 30);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0 }];

  // No manual command — the camp should recruit the idle villager on its own.
  for (let t = 0; t < 200; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'idle villager auto-assigned to the camp');
  assert.ok(getResource(w, 0, 'wood') > 0, 'camp economy banks wood without orders');
}

function engineerExtendsCampRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(25);
  // Villager sits just outside the base camp reach — inside with an engineer.
  const vill = spawn(w, { x: fx.fromFloat(38), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, 32, 0, 30);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0 }];

  for (let t = 0; t < 60; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.IDLE, 'out-of-reach villager is left alone');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood before the radius extends');

  spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.ENGINEER, owner: 0 });
  for (let t = 0; t < 220; t++) step(w, field, []);
  assert.ok(getResource(w, 0, 'wood') > 0, 'engineer-extended reach recruits the villager');
}

function engineerRadiusBonusLingers() {
  const w = createWorld(4);
  w.buildings = [createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 })];
  const camp = w.buildings[0];
  const eng = spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.ENGINEER, owner: 0 });

  refreshEngineerAssists(w);
  const boosted = fx.toFloat(campWorkRadius(w, camp));
  assert.equal(boosted, CAMP_WORK_RADIUS_F + ENGINEER_RADIUS_BONUS_F, 'nearby engineer extends reach');

  w.px[eng] = fx.fromFloat(200);
  refreshEngineerAssists(w);
  assert.equal(fx.toFloat(campWorkRadius(w, camp)), boosted, 'bonus holds after the engineer walks off');

  w.tick = ENGINEER_BONUS_LINGER_TICKS + 1;
  refreshEngineerAssists(w);
  assert.equal(fx.toFloat(campWorkRadius(w, camp)), CAMP_WORK_RADIUS_F, 'bonus drops after the linger window');
}

function minesPlainRockForMineral() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(26);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const rockTile = plantRockAt(field, cx, cz, SCENERY.ROCK_PLAIN, rockYield(SCENERY.ROCK_PLAIN), 0);
  const vill = spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(10), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'villager takes the mine order');
  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.ok(field.rockStock[rockTile] < rockYield(SCENERY.ROCK_PLAIN), 'rock is being chipped');
  assert.ok(getResource(w, 0, 'mineral') > 0, 'plain rock banks mineral');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a rock');
}

function minesMossRockForStone() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(27);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  // Moss rock has a radius-1 footprint — the villager must mine from the rim.
  const rockTile = plantRockAt(
    field, cx, cz, SCENERY.ROCK_MOSS,
    rockYield(SCENERY.ROCK_MOSS),
    rockFootprintRadius(SCENERY.ROCK_MOSS),
  );
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(14), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.ok(getResource(w, 0, 'stone') > 0, 'moss rock banks stone');
  assert.equal(getResource(w, 0, 'mineral'), 0, 'no mineral from a moss rock');
}

function minesMossRockFromFarAway() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(42);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const rockTile = plantRockAt(
    field, cx, cz, SCENERY.ROCK_MOSS,
    rockYield(SCENERY.ROCK_MOSS),
    rockFootprintRadius(SCENERY.ROCK_MOSS),
  );
  // Far enough that they must walk to a rim stand — the old Chebyshev-corner
  // snap sat ~11.3 units out, past the 10-unit moss harvest reach.
  const vill = spawn(w, { x: fx.fromFloat(24), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(32), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  for (let t = 0; t < 400; t++) step(w, field, []);

  assert.ok(field.rockStock[rockTile] < rockYield(SCENERY.ROCK_MOSS), 'far villager still reaches the moss rim');
  assert.ok(getResource(w, 0, 'stone') > 0, 'banks stone after walking in');
}

function minesSnowRockFromFarAway() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(43);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const rockTile = plantRockAt(
    field, cx, cz, SCENERY.ROCK_SNOW,
    rockYield(SCENERY.ROCK_SNOW),
    rockFootprintRadius(SCENERY.ROCK_SNOW),
  );
  const vill = spawn(w, { x: fx.fromFloat(28), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.agoras = [{ owner: 0, x: fx.fromFloat(36), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: rockTile }]);
  for (let t = 0; t < 480; t++) step(w, field, []);

  assert.ok(field.rockStock[rockTile] < rockYield(SCENERY.ROCK_SNOW), 'far villager still reaches the snow rim');
  assert.ok(getResource(w, 0, 'stone') > 0, 'banks stone from a snow rock');
}

function farmsFoodInPlace() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(28);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const farmTile = cz * field.width + cx;
  field.foodNode[farmTile] = 1;
  // The farm is its own drop-off — the worker banks food without hauling.
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: farmTile }]);
  for (let t = 0; t < 200; t++) step(w, field, []);

  assert.ok(getResource(w, 0, 'food') > 0, 'farm banks food worked in place');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from a farm');
  assert.ok(field.foodNode[farmTile] === 1, 'food node never depletes');
  assert.equal(w.carriedAmt[vill], 0, 'farm workers never haul a load');
}

function farmAutoAssignsIdleVillagers() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(29);
  const cx = worldToTile(0);
  const cz = worldToTile(0);
  const farmTile = cz * field.width + cx;
  field.foodNode[farmTile] = 1;
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 220; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'idle villager auto-assigned to the farm');
  assert.ok(getResource(w, 0, 'food') > 0, 'farm economy banks food without orders');
}

function mineRecruitsRockNotWood() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(30);
  // A mine with BOTH a tree and a rock in reach must send workers to the rock.
  const rockTile = plantRockAt(field, worldToTile(fx.fromFloat(4)), worldToTile(0), SCENERY.ROCK_PLAIN, 120, 0);
  plantTreeAt(field, -4, 0, 120);
  w.buildings = [{ owner: 0, type: 'mine', x: 0, z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'mine recruits the idle villager');
  assert.ok(field.rockStock[rockTile] < 120, 'the rock is being mined');
  assert.ok(getResource(w, 0, 'mineral') > 0, 'mine banks mineral from the rock');
  assert.equal(getResource(w, 0, 'wood'), 0, 'mine never sends workers to chop wood');
}

function campRecruitsWoodNotRock() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(31);
  // Mirror image: a camp beside a rock must still only work wood.
  plantRockAt(field, worldToTile(fx.fromFloat(4)), worldToTile(0), SCENERY.ROCK_PLAIN, 120, 0);
  plantTreeAt(field, -4, 0, 120);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 320; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'camp recruits the idle villager');
  assert.ok(getResource(w, 0, 'wood') > 0, 'camp banks wood from the tree');
  assert.equal(getResource(w, 0, 'mineral'), 0, 'camp never sends workers to mine');
}

function farmWorkersWanderThePlot() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(35);
  const farmTile = worldToTile(0) * field.width + worldToTile(0);
  field.foodNode[farmTile] = 1;
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: farmTile }]);
  const cx = tileCenterX(worldToTile(0));
  const cz = tileCenterY(worldToTile(0));
  let sawMove = false;
  let sawChop = false;
  let maxD = 0;
  for (let t = 0; t < 280; t++) {
    const px = w.px[vill];
    const py = w.py[vill];
    step(w, field, []);
    if (w.gatherAct[vill] === GATHER_ACT.CHOP) sawChop = true;
    if (w.px[vill] !== px || w.py[vill] !== py) sawMove = true;
    const d = fx.dist2(w.px[vill], w.py[vill], cx, cz);
    if (d > maxD) maxD = d;
  }

  assert.ok(sawMove, 'farm worker walks around the plot');
  assert.ok(maxD <= fx.mul(fx.fromFloat(14), fx.fromFloat(14)), 'wander stays around the farm');
  assert.equal(w.carriedAmt[vill], 0, 'no carry visual on a farm');
  assert.ok(!sawChop, 'farm workers never chop');
  assert.equal(w.gatherAct[vill], GATHER_ACT.NONE, 'farm pose stays idle/walk');
  assert.ok(getResource(w, 0, 'food') > 0, 'food still banks while wandering');
}

function chopsAtTheNodeThenHauls() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(41);
  const vill = spawn(w, { x: fx.fromFloat(14), y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tile = plantTreeAt(field, 0, 0, 40);
  w.agoras = [{ owner: 0, x: fx.fromFloat(28), z: 0 }];

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  assert.equal(w.gatherAct[vill], GATHER_ACT.NONE, 'walk-up is not a chop');

  let sawChop = false;
  let sawChopWithLoad = false;
  let sawHaul = false;
  for (let t = 0; t < 240; t++) {
    step(w, field, []);
    const act = w.gatherAct[vill];
    if (act === GATHER_ACT.CHOP) {
      sawChop = true;
      if ((w.carriedAmt[vill] | 0) > 0) sawChopWithLoad = true;
    }
    if (act === GATHER_ACT.HAUL && (w.carriedAmt[vill] | 0) >= GATHER_CARRY_CAP) {
      sawHaul = true;
      break;
    }
  }
  assert.ok(sawChop, 'chops at the tree');
  assert.ok(sawChopWithLoad, 'keeps chopping after the first bite');
  assert.ok(sawHaul, 'switches to haul when the load is full');
}

function farmCapsAtOneWorker() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(32);
  const farmTile = worldToTile(0) * field.width + worldToTile(0);
  field.foodNode[farmTile] = 1;
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  // Three idle villagers all sit inside the farm's reach.
  const villagers = [
    spawn(w, { x: fx.fromFloat(3), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(5), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(7), y: 0, type: UNIT.VILLAGER, owner: 0 }),
  ];

  for (let t = 0; t < 220; t++) step(w, field, []);

  const working = villagers.filter((v) => w.order[v] === ORDER.GATHER).length;
  assert.equal(working, 1, 'a farm keeps a single farmer');
}

function farmClaimsSharedIdleBeforeCamp() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(61);
  const farmX = fx.fromFloat(12);
  const farmTile = worldToTile(0) * field.width + worldToTile(farmX);
  field.foodNode[farmTile] = 1;
  plantTreeAt(field, fx.fromFloat(4), 0, 80);
  // Camp is first in the list and covers the villager. The farm is closer.
  w.buildings = [
    { owner: 0, type: 'camp', x: 0, z: 0, built: 1 },
    { owner: 0, type: 'farm', x: farmX, z: 0, built: 1 },
  ];
  const vill = spawn(w, { x: fx.fromFloat(8), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 40; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'shared idle villager is put to work');
  assert.equal(w.gatherTile[vill], farmTile, 'farm claims them before the camp');
}

function farmPullsCampCrewOutsideItsCircle() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(62);
  const farmX = fx.fromFloat(48);
  const farmTile = worldToTile(0) * field.width + worldToTile(farmX);
  field.foodNode[farmTile] = 1;
  const tree = plantTreeAt(field, fx.fromFloat(4), 0, 80);
  w.buildings = [
    { owner: 0, type: 'camp', x: 0, z: 0, built: 1 },
    { owner: 0, type: 'farm', x: farmX, z: 0, built: 1 },
  ];
  const vill = spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 });
  // Skip the auto-assign cadence so the gather order lands before the farm pulls.
  w.tick = 1;
  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: tree }]);
  assert.equal(w.gatherTile[vill], tree, 'starts on the camp tree');

  for (let t = 0; t < 40; t++) step(w, field, []);

  assert.equal(w.gatherTile[vill], farmTile, 'open farm pulls camp crew even from outside its circle');
}

function farmLeavesHandGathererOutsideCamp() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(63);
  const farmX = fx.fromFloat(48);
  const farmTile = worldToTile(0) * field.width + worldToTile(farmX);
  field.foodNode[farmTile] = 1;
  const tree = plantTreeAt(field, fx.fromFloat(4), 0, 80);
  w.buildings = [{ owner: 0, type: 'farm', x: farmX, z: 0, built: 1 }];
  const vill = spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 });
  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: tree }]);

  for (let t = 0; t < 40; t++) step(w, field, []);

  assert.equal(w.gatherTile[vill], tree, 'a chopper outside every camp stays on the tree');
}

function emptyFarmPaysATenth() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(64);
  w.buildings = [{ owner: 0, type: 'farm', x: 0, z: 0, built: 1, hp: 10 }];
  const interval = FARM_PASSIVE_INTERVAL | 0;

  for (let t = 0; t < interval; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'food'), 1, 'an empty farm banks one food per trickle');
  for (let t = 0; t < interval; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'food'), 2, 'the trickle repeats');

  w.buildings[0].built = 0;
  w.tick = 0;
  step(w, field, []);
  assert.equal(getResource(w, 0, 'food'), 2, 'a site does not trickle');

  w.buildings[0].built = 1;
  w.buildings[0].hp = 0;
  w.tick = 0;
  step(w, field, []);
  assert.equal(getResource(w, 0, 'food'), 2, 'a wrecked farm does not trickle');

  w.buildings[0].hp = 10;
  const farmTile = worldToTile(0) * field.width + worldToTile(0);
  field.foodNode[farmTile] = 1;
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.order[vill] = ORDER.GATHER;
  w.gatherTile[vill] = farmTile;
  w.gatherCd[vill] = 0;
  w.tick = 0;
  step(w, field, []);
  assert.equal(getResource(w, 0, 'food'), 2 + 2, 'a farmer banks a full bite and the trickle stays off');
}

function farmManualGatherHonorsCap() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(38);
  const farmTile = worldToTile(0) * field.width + worldToTile(0);
  field.foodNode[farmTile] = 1;
  w.buildings = [{ owner: 0, type: 'farm', x: fx.fromFloat(0), z: 0 }];
  const villagers = [
    spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 }),
  ];

  step(w, field, [{ type: CMD.GATHER, entities: villagers, tile: farmTile }]);
  const working = villagers.filter((v) => w.order[v] === ORDER.GATHER).length;
  assert.equal(working, 1, 'right-clicking a farm does not pile the whole group on it');
}

function campCrewExtendsRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(44);
  const nearTree = plantTreeAt(field, fx.fromFloat(4), 0, 240);
  plantTreeAt(field, fx.fromFloat(32), 0, 80);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  const crew = [
    spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(3), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 }),
    spawn(w, { x: fx.fromFloat(5), y: 0, type: UNIT.VILLAGER, owner: 0 }),
  ];
  const far = spawn(w, { x: fx.fromFloat(34), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: crew, tile: nearTree }]);
  assert.equal(
    fx.toFloat(campWorkRadius(w, w.buildings[0], field)),
    CAMP_WORK_RADIUS_F + CREW_RADIUS_BONUS_F,
    'four gatherers add one radius tier',
  );

  for (let t = 0; t < 220; t++) step(w, field, []);
  assert.equal(w.order[far], ORDER.GATHER, 'staffed camp recruits past the base ring');
}

function crewOutsideTheRingDoesNotExtendIt() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(45);
  const farX = CAMP_WORK_RADIUS_F + 12;
  const farTree = plantTreeAt(field, fx.fromFloat(farX), 0, 80);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  const crew = [];
  for (let i = 0; i < 4; i++) {
    crew.push(spawn(w, { x: fx.fromFloat(farX), y: 0, type: UNIT.VILLAGER, owner: 0 }));
  }

  step(w, field, [{ type: CMD.GATHER, entities: crew, tile: farTree }]);
  assert.equal(
    fx.toFloat(campWorkRadius(w, w.buildings[0], field)),
    CAMP_WORK_RADIUS_F,
    'gatherers walked out past the ring do not grow it',
  );
  assert.equal(
    campWorkRadiusWorld(w, { owner: 0, type: 'camp', x: 0, z: 0, built: 1 }, w.buildings, field),
    CAMP_WORK_RADIUS_F,
    'the ring uses the same node check',
  );
}

function villagersStandingInsideExtendRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(46);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  for (let i = 0; i < 4; i++) {
    spawn(w, { x: fx.fromFloat(6 + i), y: 0, type: UNIT.VILLAGER, owner: 0 });
  }
  const camp = w.buildings[0];
  assert.equal(
    fx.toFloat(campWorkRadius(w, camp, field)),
    CAMP_WORK_RADIUS_F + CREW_RADIUS_BONUS_F,
    'four villagers standing in the circle extend it',
  );
  assert.equal(
    campWorkRadiusWorld(w, { owner: 0, type: 'camp', x: 0, z: 0, built: 1 }, [camp], field),
    CAMP_WORK_RADIUS_F + CREW_RADIUS_BONUS_F,
    'the drawn ring sees the same villagers',
  );

  for (let i = 0; i < w.count; i++) w.px[i] = fx.fromFloat(CAMP_WORK_RADIUS_F + 12);
  assert.equal(
    fx.toFloat(campWorkRadius(w, camp, field)),
    CAMP_WORK_RADIUS_F,
    'walking that crew out of the circle drops the bonus',
  );
}

function attackMoveStartsDefensiveGather() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(33);
  const tile = plantTreeAt(field, fx.fromFloat(6), 0, 120);
  w.agoras = [{ owner: 0, x: fx.fromFloat(0), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(-4), y: 0, type: UNIT.VILLAGER, owner: 0 });

  // Left-click / attack-move onto the tree — the villager should mine on arrival.
  step(w, field, [
    { type: CMD.ATTACK_MOVE, entities: [vill], tx: [fx.fromFloat(6)], ty: [fx.fromFloat(0)] },
  ]);
  for (let t = 0; t < 220; t++) step(w, field, []);

  assert.equal(w.order[vill], ORDER.GATHER, 'attack-move villager gathers on arrival');
  assert.equal(w.gatherDefensive[vill], 1, 'the arrival gather is defensive');
  assert.ok(field.treeStock[tile] < 120, 'the node is actually being worked');
  assert.ok(getResource(w, 0, 'wood') > 0, 'defensive farmer still banks its load');
}

function defensiveFarmerRetaliatesThenResumes() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(34);
  const tile = plantTreeAt(field, 0, 0, 80);
  w.agoras = [{ owner: 0, x: fx.fromFloat(8), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(-3), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [
    { type: CMD.ATTACK_MOVE, entities: [vill], tx: [fx.fromFloat(0)], ty: [fx.fromFloat(0)] },
  ]);
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(w.gatherDefensive[vill], 1, 'villager is farming defensively');

  // A fragile intruder wanders onto the plot.
  const foe = spawn(w, { x: fx.fromFloat(1), y: 0, type: UNIT.VILLAGER, owner: 1 });
  w.hp[foe] = 4;
  for (let t = 0; t < 240; t++) step(w, field, []);

  assert.equal(w.alive[foe], 0, 'defensive farmer cuts down the intruder');
  assert.equal(w.order[vill], ORDER.GATHER, 'and goes back to work afterward');
  assert.equal(w.gatherDefensive[vill], 1, 'still flagged defensive after the fight');
}

function stepUntilIdleNear(w, field, i, x, limit) {
  const dest = fx.fromFloat(x);
  const near = fx.mul(fx.fromFloat(3), fx.fromFloat(3));
  for (let t = 0; t < limit; t++) {
    step(w, field, []);
    if (w.order[i] === ORDER.IDLE && fx.dist2(w.px[i], w.py[i], dest, 0) <= near) return true;
  }
  return false;
}

function moveOrderLeavesTheResource() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(70);
  const tile = plantTreeAt(field, 0, 0, 80);
  // Camp and agora used to haul a parked villager home, then put them back on the tree.
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  w.agoras = [{ owner: 0, x: 0, z: 0 }];
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile, defensive: 1 }]);
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'villager is on the tree');
  assert.equal(w.gatherDefensive[vill], 1, 'left-click gather is defensive');
  assert.ok((w.carriedAmt[vill] | 0) > 0, 'already holding wood');

  step(w, field, [
    { type: CMD.ATTACK_MOVE, entities: [vill], tx: [fx.fromFloat(48)], ty: [0] },
  ]);
  assert.equal(w.gatherTile[vill], -1, 'the new click drops the node');
  assert.equal(w.gatherDefensive[vill], 0, 'defensive resume is cleared');
  assert.ok(w.manualHold[vill] > 0, 'the click parks them');

  assert.equal(stepUntilIdleNear(w, field, vill, 48, 200), true, 'they reach the click');
  const stock = field.treeStock[tile];
  for (let t = 0; t < 45; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.IDLE, 'they stay idle after arriving');
  assert.equal(w.gatherTile[vill], -1, 'they do not retake the tree');
  assert.ok(fx.toFloat(w.px[vill]) > 40, 'they do not walk back to the resource');
  assert.equal(field.treeStock[tile], stock, 'the tree is no longer being chopped');
}

function clickOnCampBanksTheLoad() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(72);
  plantTreeAt(field, fx.fromFloat(-24), 0, 80);
  const campX = fx.fromFloat(20);
  w.buildings = [{ owner: 0, type: 'camp', x: campX, z: 0, built: 1 }];
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 4;
  w.carriedKind[vill] = 1;

  step(w, field, [{ type: CMD.MOVE, entities: [vill], tx: [campX], ty: [0] }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'clicking the camp starts a drop-off');
  for (let t = 0; t < 200 && (w.carriedAmt[vill] | 0) > 0; t++) step(w, field, []);
  assert.equal(w.carriedAmt[vill], 0, 'a partial load is handed in');
  assert.equal(getResource(w, 0, 'wood'), 4, 'the camp banks the wood');
  assert.equal(w.order[vill], ORDER.IDLE, 'they stand at the camp afterward');
  for (let t = 0; t < 30; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.IDLE, 'they are not sent back to the tree');
}

function clickOnAgoraBanksTheLoad() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(73);
  const agoraX = fx.fromFloat(18);
  w.agoras = [{ owner: 0, x: agoraX, z: 0 }];
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 3;
  w.carriedKind[vill] = 1;

  step(w, field, [{ type: CMD.ATTACK_MOVE, entities: [vill], tx: [agoraX], ty: [0] }]);
  assert.equal(w.order[vill], ORDER.GATHER, 'clicking the agora starts a drop-off');
  for (let t = 0; t < 200 && (w.carriedAmt[vill] | 0) > 0; t++) step(w, field, []);
  assert.equal(w.carriedAmt[vill], 0, 'the load is handed in');
  assert.equal(getResource(w, 0, 'wood'), 3, 'the agora banks the wood');
  assert.equal(w.order[vill], ORDER.IDLE, 'they stand at the agora afterward');
}

function clickBesideCampKeepsTheLoad() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(74);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  const vill = spawn(w, { x: fx.fromFloat(30), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 4;
  w.carriedKind[vill] = 1;

  step(w, field, [{ type: CMD.MOVE, entities: [vill], tx: [fx.fromFloat(16)], ty: [0] }]);
  assert.equal(w.order[vill], ORDER.MOVE, 'a click off the camp is still a move');
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(w.carriedAmt[vill], 4, 'standing nearby does not bank the load');
}

function moveInsideTheCampRingStaysPut() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(71);
  const tile = plantTreeAt(field, fx.fromFloat(4), 0, 80);
  w.buildings = [{ owner: 0, type: 'camp', x: 0, z: 0, built: 1 }];
  const vill = spawn(w, { x: fx.fromFloat(4), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile }]);
  assert.equal(w.gatherDefensive[vill], 0, 'right-click gather is not defensive');

  step(w, field, [
    { type: CMD.MOVE, entities: [vill], tx: [fx.fromFloat(16)], ty: [0] },
  ]);
  assert.equal(stepUntilIdleNear(w, field, vill, 16, 120), true, 'they reach the spot inside the ring');
  for (let t = 0; t < 45; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.IDLE, 'the camp does not pull them back onto the tree');
  assert.notEqual(w.gatherTile[vill], tile);

  // Left standing idle in the ring, the camp puts them back to work.
  for (let t = 0; t < 20 * 12; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'an idle park in the ring wears off');
  assert.equal(w.manualHold[vill], 0);
}

function defensiveFarmerDropsAFoeWhoLeavesThePlot() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(35);
  plantTreeAt(field, 0, 0, 80);
  w.agoras = [{ owner: 0, x: fx.fromFloat(8), z: 0 }];
  const vill = spawn(w, { x: fx.fromFloat(-3), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [
    { type: CMD.ATTACK_MOVE, entities: [vill], tx: [fx.fromFloat(0)], ty: [fx.fromFloat(0)] },
  ]);
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(w.gatherDefensive[vill], 1, 'villager is farming defensively');

  const foe = spawn(w, { x: fx.fromFloat(1), y: 0, type: UNIT.VILLAGER, owner: 1, hp: 500 });
  let swinging = false;
  for (let t = 0; t < 80 && !swinging; t++) {
    step(w, field, []);
    swinging = w.order[vill] === ORDER.ATTACK;
  }
  assert.equal(swinging, true, 'farmer swings at a foe on the plot');

  w.px[foe] = fx.fromFloat(40);
  w.py[foe] = 0;
  step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'foe outside the plot ring ends the chase');
  assert.equal(w.targetEntity[vill], -1);
  assert.equal(w.gatherDefensive[vill], 1);
}

gathersAndDeposits();
returnsAllTheWayToTheDropOff();
chopsAtTheNodeThenHauls();
minesPlainRockForMineral();
minesMossRockForStone();
minesMossRockFromFarAway();
minesSnowRockFromFarAway();
farmsFoodInPlace();
farmWorkersWanderThePlot();
farmAutoAssignsIdleVillagers();
mineRecruitsRockNotWood();
campRecruitsWoodNotRock();
farmCapsAtOneWorker();
farmManualGatherHonorsCap();
farmClaimsSharedIdleBeforeCamp();
farmPullsCampCrewOutsideItsCircle();
farmLeavesHandGathererOutsideCamp();
emptyFarmPaysATenth();
campCrewExtendsRadius();
crewOutsideTheRingDoesNotExtendIt();
villagersStandingInsideExtendRadius();
attackMoveStartsDefensiveGather();
defensiveFarmerRetaliatesThenResumes();
moveOrderLeavesTheResource();
clickOnCampBanksTheLoad();
clickOnAgoraBanksTheLoad();
clickBesideCampKeepsTheLoad();
moveInsideTheCampRingStaysPut();
defensiveFarmerDropsAFoeWhoLeavesThePlot();
onlyVillagersGather();
depletesThenIdles();
needsADropOff();
idleCarrierReturnsToNearestDropOff();
campDoesNotRecruitIdleCarriers();
campAutoAssignsIdleVillagers();
engineerExtendsCampRadius();
engineerRadiusBonusLingers();
overflowCutsIncomeWithoutASilo();
siloBesideCampBanksTheFullLoad();
attachedSiloAcceptsDropOff();
attachedSiloDropOffWalksOntoOccupancy();
unattachedSiloIsNotADropOff();
unbuiltSiloIsNotADropOff();
attachedSiloExtendsGatherRadius();
siloGatherRadiusIsOneTileTighter();
unattachedSiloDoesNotExtendRadius();
attachedSiloExtendsFarmRadius();
console.log('gather.test.js: ok (wood + stone + mineral + food + wander + specialize + defend + storage + silo reach)');

function overflowCutsIncomeWithoutASilo() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(50);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 10;
  w.carriedKind[vill] = 1;
  w.agoras = [{ owner: 0, x: fx.fromFloat(6), z: 0 }];
  const cap = ownerResourceCap(w.buildings, 0, 'wood');
  addResource(w, 0, 'wood', cap);
  const tickAtDrop = w.tick;
  for (let t = 0; t < 160; t++) {
    if ((w.carriedAmt[vill] | 0) === 0) break;
    step(w, field, []);
  }
  const got = getResource(w, 0, 'wood');
  assert.ok(got > cap, 'overflow still trickles');
  assert.ok(got < cap + 10, `overflow is not a full load (got ${got}, cap ${cap})`);
  assert.ok(
    got <= cap + overflowCredit(10, tickAtDrop) + 3,
    'credited amount stays near 25%',
  );
}

function siloBesideCampBanksTheFullLoad() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(51);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 10;
  w.carriedKind[vill] = 1;
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 8, z: 0 }),
  ];
  const baseCap = ownerResourceCap([], 0, 'wood');
  addResource(w, 0, 'wood', baseCap);
  for (let t = 0; t < 80; t++) {
    if ((w.carriedAmt[vill] | 0) === 0) break;
    step(w, field, []);
  }
  assert.equal(w.carriedAmt[vill], 0, 'carrier emptied');
  assert.equal(getResource(w, 0, 'wood'), baseCap + 10, 'silo pair banks the load in full');
}

function attachedSiloAcceptsDropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(54);
  const siloX = fx.fromFloat(16);
  const vill = spawn(w, { x: siloX, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 10;
  w.carriedKind[vill] = 1;
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 16, z: 0 }),
  ];

  let depositDist = -1;
  for (let t = 0; t < 80; t++) {
    const had = getResource(w, 0, 'wood');
    step(w, field, []);
    if (had === 0 && getResource(w, 0, 'wood') > 0) {
      depositDist = fx.dist2(w.px[vill], w.py[vill], siloX, 0);
      break;
    }
  }
  assert.ok(depositDist >= 0, 'attached silo banks a hauled load');
  assert.ok(
    depositDist <= fx.mul(fx.fromFloat(5), fx.fromFloat(5)),
    `deposited at the silo (dist2=${depositDist}), not the camp`,
  );
}

function attachedSiloDropOffWalksOntoOccupancy() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(61);
  // Start past DROP_RANGE so the villager must walk onto the stamped footprint.
  const vill = spawn(w, { x: fx.fromFloat(28), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 10;
  w.carriedKind[vill] = 1;
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 16, z: 0 }),
  ];
  applyWorldStructureOccupancy(field, w);

  for (let t = 0; t < 200; t++) {
    if ((w.carriedAmt[vill] | 0) === 0) break;
    step(w, field, []);
  }
  assert.equal(w.carriedAmt[vill], 0, 'walked onto the silo and deposited');
  assert.ok(getResource(w, 0, 'wood') > 0, 'silo occupancy does not block drop-off');
}

function unattachedSiloIsNotADropOff() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(55);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.carriedAmt[vill] = 10;
  w.carriedKind[vill] = 1;
  w.buildings = [createBuilding({ owner: 0, type: 'silo', x: 0, z: 0 })];

  for (let t = 0; t < 80; t++) step(w, field, []);
  assert.equal(getResource(w, 0, 'wood'), 0, 'a lone silo is not a drop-off');
  assert.equal(w.carriedAmt[vill], 10, 'carrier still holds the load');
}

function unbuiltSiloIsNotADropOff() {
  const w = createWorld(56);
  const vill = spawn(w, { x: fx.fromFloat(16), y: 0, type: UNIT.VILLAGER, owner: 0 });
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 16, z: 0, built: 0 }),
  ];
  const drop = nearestDropOff(w, 0, w.px[vill], w.py[vill]);
  assert.ok(drop, 'the finished camp still accepts drop-off');
  assert.equal(drop.x, w.buildings[0].x, 'unbuilt silo is skipped');
  assert.equal(drop.y, w.buildings[0].z, 'path leads to the camp');
}

function attachedSiloExtendsGatherRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(57);
  // Camp reach + silo at 16 (one tile tighter). Villager + tree at 34
  // sit outside the camp circle and inside the silo's satellite circle.
  const vill = spawn(w, { x: fx.fromFloat(34), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, fx.fromFloat(32), 0, 30);
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 16, z: 0 }),
  ];

  for (let t = 0; t < 220; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'silo circle recruits past the camp ring');
  assert.ok(getResource(w, 0, 'wood') > 0, 'silo-extended camp banks wood');
}

function siloGatherRadiusIsOneTileTighter() {
  assert.equal(siloWorkRadiusWorld(CAMP_WORK_RADIUS_F), CAMP_WORK_RADIUS_F - SILO_WORK_RADIUS_PENALTY_F);
  assert.equal(workRadiusRingWorld(CAMP_WORK_RADIUS_F), CAMP_WORK_RADIUS_F - WORK_RADIUS_RING_INSET_F);
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(62);
  // Past the camp and the one-tile-tighter silo circle (silo at 16), but
  // inside a full-size silo ring copied from the camp.
  const siloX = 16;
  const pastSilo = siloX + siloWorkRadiusWorld(CAMP_WORK_RADIUS_F) + 1;
  const vill = spawn(w, { x: fx.fromFloat(pastSilo), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, fx.fromFloat(pastSilo - 1), 0, 30);
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 16, z: 0 }),
  ];

  for (let t = 0; t < 80; t++) step(w, field, []);
  assert.notEqual(w.order[vill], ORDER.GATHER, 'silo circle is one tile shorter than the camp');
  assert.equal(getResource(w, 0, 'wood'), 0);
}

function unattachedSiloDoesNotExtendRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(58);
  const vill = spawn(w, { x: fx.fromFloat(34), y: 0, type: UNIT.VILLAGER, owner: 0 });
  plantTreeAt(field, fx.fromFloat(32), 0, 30);
  w.buildings = [
    createBuilding({ owner: 0, type: 'camp', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 40, z: 0 }),
  ];

  for (let t = 0; t < 80; t++) step(w, field, []);
  assert.notEqual(w.order[vill], ORDER.GATHER, 'a silo past attach range does not recruit');
  assert.equal(getResource(w, 0, 'wood'), 0, 'no wood from an unattached silo circle');
}

function attachedSiloExtendsFarmRadius() {
  const field = createField(1);
  field.pass.fill(1);
  const w = createWorld(59);
  const farmTile = worldToTile(0) * field.width + worldToTile(0);
  field.foodNode[farmTile] = 1;
  // Farm plot + silo at 12 (one tile tighter). Villager at 20 is outside
  // the plot ring and inside the silo's extra circle.
  w.buildings = [
    createBuilding({ owner: 0, type: 'farm', x: 0, z: 0 }),
    createBuilding({ owner: 0, type: 'silo', x: 12, z: 0 }),
  ];
  const vill = spawn(w, { x: fx.fromFloat(20), y: 0, type: UNIT.VILLAGER, owner: 0 });

  for (let t = 0; t < 220; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'farm silo circle pulls a farmer in');
  assert.ok(getResource(w, 0, 'food') > 0, 'farmer still banks food on the plot');
  assert.equal(w.gatherTile[vill], farmTile, 'silo does not steal a different food tile');
}
