// Building construction — placed buildings start as inert sites that villagers
// and engineers raise. Verifies: placement makes a site, nearby workers auto-build
// it (up to two, faster with two), engineers take a slot at half speed, it pulls
// a gatherer when no idle hand is free, finishing turns on the building's
// effects, and the whole loop is deterministic.

import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD, applyCommands } from './commands.js';
import { buildField, createField, worldToTile } from './field.js';
import { growTreeAt } from './trees.js';
import { getResource, grantStartingResources } from './resources.js';
import { getBuildTime, getBuildingCost } from './buildings.js';
import { checksum } from './checksum.js';
import { constructionVisualStage, CONSTRUCT_NEAR_NUM, CONSTRUCT_NEAR_DEN, IDLE_VILLAGE_DEN } from './construction.js';

function siteBuilding(type, xF, zF, owner = 0) {
  return {
    owner,
    type,
    x: fx.fromFloat(xF),
    z: fx.fromFloat(zF),
    yaw: 0,
    hasRally: 0,
    rallyX: 0,
    rallyZ: 0,
    rallyOrder: ORDER.MOVE,
    prodPaused: 0,
    built: 0,
    buildProgress: 0,
    buildTime: getBuildTime(type),
    tracks: [],
  };
}

function openField(seed) {
  const field = createField(seed);
  field.pass.fill(1);
  return field;
}

function ticksToBuild(field, w, maxTicks = 400) {
  for (let t = 0; t < maxTicks; t++) {
    step(w, field, []);
    if (w.buildings[0].built) return t;
  }
  return -1;
}

function placementMakesASite() {
  const field = openField(1);
  field.activeMask?.fill(1);
  const w = createWorld(1);
  w.buildings = [];
  grantStartingResources(w, 0, { wood: 500, stone: 500, mineral: 500, food: 500 });
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'camp', tx: fx.fromFloat(0), ty: fx.fromFloat(0) },
  ]);
  assert.equal(w.buildings.length, 1, 'camp placed');
  assert.equal(w.buildings[0].built, 0, 'placed as an unbuilt site');
  assert.equal(w.buildings[0].buildProgress, 0, 'no progress yet');
  assert.ok(w.buildings[0].buildTime > 0, 'has a build time');
}

function siteIsInertUntilRaised() {
  // A camp site must not act as a drop-off: a villager can gather but has nowhere
  // to bank until the camp is built.
  const field = openField(2);
  const w = createWorld(2);
  const treeTile = worldToTile(0) * field.width + worldToTile(fx.fromFloat(6));
  growTreeAt(field, treeTile, 200);
  w.buildings = [siteBuilding('camp', 0, 0)];
  const vill = spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });

  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: treeTile }]);
  // Chop a load but finish before construction assign (tick 20) steals the hand.
  for (let t = 0; t < 18; t++) step(w, field, []);
  assert.equal(w.buildings[0].built, 0, 'site still unbuilt');
  assert.ok((w.carriedAmt[vill] | 0) > 0, 'villager picked up wood');
  assert.equal(getResource(w, 0, 'wood'), 0, 'nothing banked at an unbuilt camp');
}

function villagersRaiseTheSite() {
  const field = openField(3);
  const w = createWorld(3);
  w.buildings = [siteBuilding('camp', 0, 0)];
  spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(w, { x: fx.fromFloat(-6), y: 0, type: UNIT.VILLAGER, owner: 0 });

  const t = ticksToBuild(field, w);
  assert.ok(t >= 0, 'camp gets raised by nearby villagers');
  assert.equal(w.buildings[0].built, 1, 'built flag set');
  assert.equal(w.buildings[0].buildProgress, w.buildings[0].buildTime, 'progress capped at build time');
}

function engineerTakesABuildSlot() {
  const field = openField(11);
  const w = createWorld(11);
  w.buildings = [siteBuilding('camp', 0, 0)];
  const eng = spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.ENGINEER, owner: 0 });
  spawn(w, { x: fx.fromFloat(80), y: 0, type: UNIT.VILLAGER, owner: 0 });

  let claimed = false;
  for (let t = 0; t < 40; t++) {
    step(w, field, []);
    if (w.order[eng] === ORDER.BUILD && w.buildTarget[eng] === 0) claimed = true;
  }
  assert.ok(claimed, 'idle engineer is recruited on the call-for-workers');
}

function engineerBuildsAtHalfSpeed() {
  const villField = openField(12);
  const wVill = createWorld(12);
  wVill.buildings = [siteBuilding('camp', 0, 0)];
  spawn(wVill, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tVill = ticksToBuild(villField, wVill, 400);

  const engField = openField(12);
  const wEng = createWorld(12);
  wEng.buildings = [siteBuilding('camp', 0, 0)];
  spawn(wEng, { x: fx.fromFloat(6), y: 0, type: UNIT.ENGINEER, owner: 0 });
  const tEng = ticksToBuild(engField, wEng, 800);

  assert.ok(tVill > 0 && tEng > 0, 'both finish');
  assert.ok(tEng > tVill, `engineer is slower than a villager (eng ${tEng} > vill ${tVill})`);
  assert.ok(tEng < tVill * 2.4, `engineer is about half speed, not stalled (eng ${tEng}, vill ${tVill})`);
}

function villagerPlusEngineerBeatsSoloVillager() {
  const solo = openField(13);
  const wSolo = createWorld(13);
  wSolo.buildings = [siteBuilding('village', 0, 0)];
  spawn(wSolo, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tSolo = ticksToBuild(solo, wSolo, 600);

  const mixed = openField(13);
  const wMixed = createWorld(13);
  wMixed.buildings = [siteBuilding('village', 0, 0)];
  spawn(wMixed, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(wMixed, { x: fx.fromFloat(-6), y: 0, type: UNIT.ENGINEER, owner: 0 });
  const tMixed = ticksToBuild(mixed, wMixed, 600);

  assert.ok(tSolo > 0 && tMixed > 0, 'both finish');
  assert.ok(tMixed < tSolo, `villager + half-speed engineer beats solo (mixed ${tMixed} < solo ${tSolo})`);
}

function twoBuildersBeatOne() {
  const solo = openField(4);
  const wSolo = createWorld(4);
  wSolo.buildings = [siteBuilding('village', 0, 0)];
  spawn(wSolo, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tSolo = ticksToBuild(solo, wSolo, 600);

  const duo = openField(4);
  const wDuo = createWorld(4);
  wDuo.buildings = [siteBuilding('village', 0, 0)];
  spawn(wDuo, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(wDuo, { x: fx.fromFloat(-6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  const tDuo = ticksToBuild(duo, wDuo, 600);

  assert.ok(tSolo > 0 && tDuo > 0, 'both finish');
  assert.ok(tDuo < tSolo, `two builders finish sooner (duo ${tDuo} < solo ${tSolo})`);
}

function pullsAGathererWhenNoIdle() {
  const field = openField(5);
  const w = createWorld(5);
  const treeTile = worldToTile(fx.fromFloat(-6)) * field.width + worldToTile(fx.fromFloat(-6));
  growTreeAt(field, treeTile, 200);
  // A working camp so the lone villager can actually gather (no site yet).
  w.buildings = [
    { owner: 0, type: 'camp', x: fx.fromFloat(-6), z: fx.fromFloat(-6), built: 1, buildProgress: 1, buildTime: 1, hasRally: 0, rallyX: 0, rallyZ: 0, rallyOrder: ORDER.MOVE, prodPaused: 0, tracks: [] },
  ];
  const vill = spawn(w, { x: fx.fromFloat(-6), y: fx.fromFloat(-4), type: UNIT.VILLAGER, owner: 0 });
  step(w, field, [{ type: CMD.GATHER, entities: [vill], tile: treeTile }]);
  for (let t = 0; t < 30; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'the lone villager is busy gathering');

  // Now a site appears with no idle hand free — construction must pull the gatherer.
  w.buildings.push(siteBuilding('village', 8, 8));
  let pulled = false;
  for (let t = 0; t < 220; t++) {
    step(w, field, []);
    if (w.order[vill] === ORDER.BUILD) pulled = true;
    if (w.buildings[1].built) break;
  }
  assert.ok(pulled, 'a gatherer was pulled to build when no idle hand was free');
  assert.equal(w.buildings[1].built, 1, 'and the site got raised');
}

function finishingTurnsOnTheFarm() {
  const field = openField(6);
  const w = createWorld(6);
  const center = worldToTile(0) * field.width + worldToTile(0);
  w.buildings = [siteBuilding('farm', 0, 0)];
  spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(w, { x: fx.fromFloat(-6), y: 0, type: UNIT.VILLAGER, owner: 0 });

  assert.equal(field.foodNode?.[center] ?? 0, 0, 'no food node while under construction');
  const t = ticksToBuild(field, w);
  assert.ok(t >= 0, 'farm raised');
  assert.equal(field.foodNode[center], 1, 'food node switches on once the farm is built');
}

function deterministic() {
  const run = (seed) => {
    const field = openField(seed);
    const w = createWorld(seed);
    w.buildings = [siteBuilding('mine', 0, 0)];
    spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
    spawn(w, { x: fx.fromFloat(-6), y: 0, type: UNIT.VILLAGER, owner: 0 });
    for (let t = 0; t < 200; t++) step(w, field, []);
    return checksum(w, field);
  };
  assert.equal(run(9), run(9), 'construction is deterministic across identical runs');
}

function visualStagesAtStartAndTwoThirds() {
  assert.equal(constructionVisualStage(0, 90), 0, 'no work yet');
  assert.equal(constructionVisualStage(1, 90), 1, 'first work pops');
  const near = Math.ceil((90 * CONSTRUCT_NEAR_NUM) / CONSTRUCT_NEAR_DEN);
  assert.equal(constructionVisualStage(near - 1, 90), 1, 'still the mid stage');
  assert.equal(constructionVisualStage(near, 90), 2, '2/3 is the late bump');
  assert.equal(constructionVisualStage(90, 90), 2, 'finished-but-unflagged stays late');
}

function cancelConstructionRefundsAndClears() {
  const field = openField(8);
  field.activeMask?.fill(1);
  const w = createWorld(8);
  w.buildings = [];
  grantStartingResources(w, 0, { wood: 500, stone: 500, mineral: 500, food: 500 });
  const woodBefore = getResource(w, 0, 'wood');
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'camp', tx: fx.fromFloat(0), ty: fx.fromFloat(0) },
  ]);
  assert.equal(w.buildings.length, 1, 'camp placed');
  assert.equal(w.buildings[0].built, 0, 'still a site');
  const cost = getBuildingCost('camp');
  assert.equal(getResource(w, 0, 'wood'), woodBefore - (cost.wood | 0), 'placement charged');
  const vill = spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  for (let t = 0; t < 30; t++) step(w, field, []);
  assert.ok((w.buildings[0].buildProgress | 0) > 0, 'builders made some progress');

  let occupied = -1;
  for (let i = 0; i < (field.structureSlowMask?.length ?? 0); i++) {
    if (field.structureSlowMask[i]) {
      occupied = i;
      break;
    }
  }
  assert.ok(occupied >= 0, 'site occupies tiles');

  applyCommands(w, field, [
    { type: CMD.CANCEL_CONSTRUCTION, playerId: 0, buildingIndex: 0 },
  ]);
  assert.equal(w.buildings[0].hp, 0, 'site is ruined');
  assert.equal(getResource(w, 0, 'wood'), woodBefore, 'placement cost refunded');
  assert.equal(field.structureSlowMask[occupied], 0, 'footprint tiles reopen');

  step(w, field, []);
  assert.notEqual(w.order[vill], ORDER.BUILD, 'builder is released');
}

function cancelConstructionIgnoresFinished() {
  const field = openField(10);
  field.activeMask?.fill(1);
  const w = createWorld(10);
  w.buildings = [];
  grantStartingResources(w, 0, { wood: 500, stone: 0, mineral: 0, food: 0 });
  applyCommands(w, field, [
    { type: CMD.PLACE_BUILDING, playerId: 0, buildingType: 'camp', tx: fx.fromFloat(0), ty: fx.fromFloat(0) },
  ]);
  w.buildings[0].built = 1;
  w.buildings[0].buildProgress = w.buildings[0].buildTime | 0;
  const wood = getResource(w, 0, 'wood');
  applyCommands(w, field, [
    { type: CMD.CANCEL_CONSTRUCTION, playerId: 0, buildingIndex: 0 },
  ]);
  assert.ok((w.buildings[0].hp | 0) > 0, 'finished camp is not torn down');
  assert.equal(getResource(w, 0, 'wood'), wood, 'no refund on a finished building');
}

function villageTricklesWithoutWorkers() {
  const field = openField(14);
  const w = createWorld(14);
  w.buildings = [siteBuilding('village', 0, 0)];

  for (let t = 0; t < IDLE_VILLAGE_DEN - 1; t++) step(w, field, []);
  assert.equal(w.buildings[0].buildProgress | 0, 0, 'no full builder-tick yet');
  step(w, field, []);
  assert.equal(w.buildings[0].buildProgress | 0, 1, '0.1× one villager with no hands');

  const time = w.buildings[0].buildTime | 0;
  const t = ticksToBuild(field, w, time * IDLE_VILLAGE_DEN + 40);
  assert.ok(t >= 0, 'unattended village still finishes');
  assert.equal(w.buildings[0].built, 1, 'built flag set');
}

function campStaysIdleWithoutWorkers() {
  const field = openField(15);
  const w = createWorld(15);
  w.buildings = [siteBuilding('camp', 0, 0)];
  for (let t = 0; t < IDLE_VILLAGE_DEN * 8; t++) step(w, field, []);
  assert.equal(w.buildings[0].built, 0, 'camp stays a site');
  assert.equal(w.buildings[0].buildProgress | 0, 0, 'camps still need workers');
}

function twoOwnersRaiseIndependently() {
  const field = openField(7);
  const w = createWorld(7);
  w.buildings = [
    siteBuilding('camp', -10, 0, 0),
    siteBuilding('camp', 10, 0, 1),
  ];
  spawn(w, { x: fx.fromFloat(-14), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(w, { x: fx.fromFloat(-6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 1 });
  spawn(w, { x: fx.fromFloat(14), y: 0, type: UNIT.VILLAGER, owner: 1 });

  let t0 = -1;
  let t1 = -1;
  for (let t = 0; t < 400; t++) {
    step(w, field, []);
    if (t0 < 0 && w.buildings[0].built) t0 = t;
    if (t1 < 0 && w.buildings[1].built) t1 = t;
    if (t0 >= 0 && t1 >= 0) break;
  }
  assert.ok(t0 >= 0 && t1 >= 0, 'both owners raise their own sites');
  assert.equal(w.buildings[0].owner, 0);
  assert.equal(w.buildings[1].owner, 1);
  assert.equal(w.buildings.length, 2, 'neither site ate the other');
}

placementMakesASite();
siteIsInertUntilRaised();
villagersRaiseTheSite();
engineerTakesABuildSlot();
engineerBuildsAtHalfSpeed();
villagerPlusEngineerBeatsSoloVillager();
twoBuildersBeatOne();
pullsAGathererWhenNoIdle();
finishingTurnsOnTheFarm();
deterministic();
visualStagesAtStartAndTwoThirds();
cancelConstructionRefundsAndClears();
cancelConstructionIgnoresFinished();
twoOwnersRaiseIndependently();
villageTricklesWithoutWorkers();
campStaysIdleWithoutWorkers();
console.log('construction.test.js: ok (site + auto-build + engineer + speed + pull + complete + cancel + stages + two-owner + idle-village + deterministic)');
