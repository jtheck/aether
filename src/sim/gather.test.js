import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField, worldToTile, tileCenterX, tileCenterY } from './field.js';
import { growTreeAt } from './trees.js';
import { SCENERY, rockFootprintRadius, rockYield } from './scenery.js';
import { getResource } from './resources.js';
import {
  GATHER_ACT,
  GATHER_CARRY_CAP,
  campWorkRadius,
  refreshEngineerAssists,
  CAMP_WORK_RADIUS_F,
  ENGINEER_RADIUS_BONUS_F,
  ENGINEER_BONUS_LINGER_TICKS,
} from './gather.js';
import { createBuilding } from './buildings.js';

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
  // Villager sits just outside the base camp reach (28) — inside 36 with an engineer.
  const vill = spawn(w, { x: fx.fromFloat(34), y: 0, type: UNIT.VILLAGER, owner: 0 });
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

function farmCapsAtTwoWorkers() {
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
  assert.equal(working, 2, 'a farm keeps at most a 2-person crew');
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
farmCapsAtTwoWorkers();
attackMoveStartsDefensiveGather();
defensiveFarmerRetaliatesThenResumes();
onlyVillagersGather();
depletesThenIdles();
needsADropOff();
idleCarrierReturnsToNearestDropOff();
campDoesNotRecruitIdleCarriers();
campAutoAssignsIdleVillagers();
engineerExtendsCampRadius();
engineerRadiusBonusLingers();
console.log('gather.test.js: ok (wood + stone + mineral + food + wander + specialize + defend)');
