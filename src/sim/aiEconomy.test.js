// Economic AI — a passive, rule-bound player that gathers, expands drop-offs,
// and farms (villagers trickle from the village). Verified headless +
// deterministic (two runs must land on the same checksum).

import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { createField } from './field.js';
import { growTreeAt } from './trees.js';
import { SCENERY, rockYield } from './scenery.js';
import { addResource, getResource, grantStartingResources } from './resources.js';
import { checksum } from './checksum.js';
import { generateEconomyCommands, bankPressure } from './aiEconomy.js';
import { createBuilding } from './buildings.js';
import { CMD } from './commands.js';
import { ownerResourceCap } from './storage.js';
import { AI_DIFFICULTY } from './aiStrategy.js';
import { ensureTech, TECH } from './tech.js';

const AI = 1;

/** Open field with a tree grove + a rock, an AI agora, and 3 AI villagers. */
function makeScenario(seed) {
  const field = createField(seed, { width: 64, height: 64 });
  field.pass.fill(1);
  field.activeMask.fill(1);
  // A grove of trees ~10 tiles east of center.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = 0; dx <= 4; dx++) {
      const tx = 42 + dx;
      const tz = 32 + dz;
      growTreeAt(field, tz * field.width + tx, 30);
    }
  }
  // A couple of rocks ~10 tiles west (stone + mineral).
  const rockA = 32 * field.width + 22;
  field.sceneryType[rockA] = SCENERY.ROCK_MOSS;
  field.rockStock[rockA] = rockYield(SCENERY.ROCK_MOSS);
  const rockB = 34 * field.width + 22;
  field.sceneryType[rockB] = SCENERY.ROCK_PLAIN;
  field.rockStock[rockB] = rockYield(SCENERY.ROCK_PLAIN);

  const w = createWorld(seed);
  w.buildings = [];
  // Agora at map center (world origin → tile 32,32 on this 64² board).
  w.agoras = [{ owner: AI, x: fx.fromFloat(0), z: fx.fromFloat(0) }];
  for (let k = 0; k < 3; k++) {
    spawn(w, { x: fx.fromFloat(4 + k * 3), y: fx.fromFloat(0), type: UNIT.VILLAGER, owner: AI });
  }
  grantStartingResources(w, AI);
  return { w, field };
}

function run(seed, ticks) {
  const { w, field } = makeScenario(seed);
  const entry = { owner: AI, temperament: 'passive' };
  for (let t = 0; t < ticks; t++) {
    const cmds = generateEconomyCommands(w, field, entry);
    step(w, field, cmds);
  }
  return { w, field };
}

function countType(w, type) {
  let n = 0;
  for (const b of w.buildings) if (b.owner === AI && b.type === type) n++;
  return n;
}

function countVillagers(w) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.owner[i] === AI && w.type[i] === UNIT.VILLAGER) n++;
  }
  return n;
}

function macrosAnEconomy() {
  const { w } = run(101, 1200);
  assert.ok(countType(w, 'village') >= 1, 'AI built a village');
  assert.ok(countType(w, 'farm') >= 1, 'AI built at least one farm');
  assert.ok(countVillagers(w) > 3, `village trickled villagers (have ${countVillagers(w)})`);
  const gathered =
    getResource(w, AI, 'wood') +
    getResource(w, AI, 'stone') +
    getResource(w, AI, 'mineral') +
    getResource(w, AI, 'food');
  assert.ok(gathered > 0, 'AI is banking resources');
}

function buildsGatherFacilitiesFromStartingBank() {
  for (const temperament of ['passive', 'steady']) {
    const { w, field } = makeScenario(404);
    const entry = { owner: AI, temperament };
    for (let t = 0; t < 2400; t++) step(w, field, generateEconomyCommands(w, field, entry));
    assert.ok(countType(w, 'camp') >= 1, `${temperament} AI built a camp`);
    assert.ok(countType(w, 'mine') >= 1, `${temperament} AI built a mine`);
    assert.ok(countType(w, 'village') >= 1, `${temperament} AI still built a village`);
  }
}

function staysPassive() {
  const { w } = run(102, 800);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== AI) continue;
    assert.equal(w.type[i], UNIT.VILLAGER, 'passive AI only ever fields villagers');
  }
}

function deterministic() {
  const a = run(303, 900);
  const b = run(303, 900);
  assert.equal(checksum(a.w, a.field), checksum(b.w, b.field), 'two runs match exactly');
}

function armyPathPlacesBarracks() {
  const { w, field } = makeScenario(201);
  w.buildings.push(createBuilding({ owner: AI, type: 'village', x: -12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'farm', x: 12, z: 0 }));
  w.buildings[0].built = 1;
  w.buildings[1].built = 1;
  addResource(w, AI, 'wood', 200);
  addResource(w, AI, 'stone', 80);
  const entry = { owner: AI, temperament: 'steady' };
  for (let t = 0; t < 90; t++) {
    w.tick = t;
    const cmds = generateEconomyCommands(w, field, entry);
    step(w, field, cmds);
    if (w.buildings.some((b) => b.type === 'barracks')) return;
  }
  assert.fail('army-path AI should place a barracks after village + farm');
}

function captureRampsTraining() {
  const { w, field } = makeScenario(77);
  w.agoraOccupyEndsMatch = 1;
  w.agoras[0].progress = 80;
  w.agoras[0].founder = AI;
  w.buildings.push(createBuilding({ owner: AI, type: 'barracks', x: 16, z: 0 }));
  addResource(w, AI, 'food', 80);
  addResource(w, AI, 'wood', 80);
  spawn(w, { x: fx.fromFloat(0), y: fx.fromFloat(0), type: UNIT.WARRIOR, owner: 0 });
  const entry = { owner: AI, temperament: 'steady' };
  for (let t = 0; t < 90; t++) {
    w.tick = t;
    const cmds = generateEconomyCommands(w, field, entry);
    if (cmds.some((c) => c.type === CMD.QUEUE_TRAIN && c.unitKey === 'warrior')) return;
  }
  assert.fail('steady should train when the home pad is ringing');
}

function firstEcoCmds(w, field, entry) {
  for (let t = 0; t < 40; t++) {
    w.tick = t;
    const cmds = generateEconomyCommands(w, field, entry);
    if (cmds.length) return cmds;
  }
  return [];
}

function fillToCap(w, kind) {
  const cap = ownerResourceCap(w.buildings, AI, kind);
  const have = getResource(w, AI, kind);
  if (have < cap) addResource(w, AI, kind, cap - have);
}

function startingBankIsNotADump() {
  const { w } = makeScenario(1);
  const bank = {
    wood: getResource(w, AI, 'wood'),
    food: getResource(w, AI, 'food'),
    stone: getResource(w, AI, 'stone'),
    mineral: getResource(w, AI, 'mineral'),
  };
  assert.equal(
    bankPressure(w, AI, bank, AI_DIFFICULTY.EXPERT).dump,
    false,
    'opening stock is not the 25% hit',
  );
}

function overflowSpendsInsteadOfLeaking() {
  const { w, field } = makeScenario(55);
  w.buildings.push(createBuilding({ owner: AI, type: 'village', x: -12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'farm', x: 12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'silo', x: 20, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'farm', x: 40, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'silo', x: 48, z: 0 }));
  for (let i = 0; i < 3; i++) {
    const x = -40 - i * 20;
    w.buildings.push(createBuilding({ owner: AI, type: 'camp', x, z: 20 }));
    if (i < 2) {
      w.buildings.push(createBuilding({ owner: AI, type: 'silo', x: x + 8, z: 20 }));
    }
  }
  w.buildings.push(createBuilding({ owner: AI, type: 'mine', x: -8, z: 24 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'mine', x: 8, z: 24 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'barracks', x: 16, z: 16 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'tavern', x: -16, z: 16 }));
  ensureTech(w);
  w.tech[AI] |= TECH.DRAYAGE;
  for (let i = 0; i < 6; i++) {
    spawn(w, { x: fx.fromFloat(-20 - i), y: 0, type: UNIT.WARRIOR, owner: AI });
  }
  fillToCap(w, 'wood');
  fillToCap(w, 'food');
  const bank = {
    wood: getResource(w, AI, 'wood'),
    food: getResource(w, AI, 'food'),
    stone: getResource(w, AI, 'stone'),
    mineral: getResource(w, AI, 'mineral'),
  };
  assert.equal(bankPressure(w, AI, bank, AI_DIFFICULTY.EASY).dump, false);
  assert.equal(bankPressure(w, AI, bank, AI_DIFFICULTY.EXPERT).dump, true);

  const easy = firstEcoCmds(w, field, {
    owner: AI,
    temperament: 'steady',
    difficulty: AI_DIFFICULTY.EASY,
  });
  assert.equal(
    easy.some((c) => c.type === CMD.QUEUE_TRAIN),
    false,
    'easy sits on a full bank and takes the 25% hit',
  );

  const expert = firstEcoCmds(w, field, {
    owner: AI,
    temperament: 'steady',
    difficulty: AI_DIFFICULTY.EXPERT,
  });
  assert.ok(
    expert.some((c) => c.type === CMD.QUEUE_TRAIN || c.type === CMD.RESEARCH),
    'expert burns a full bank instead of overflowing',
  );
}

function openRallyMovesIdleToNewCamp() {
  const { w, field } = makeScenario(88);
  // Beside the east grove, out of reach of the villagers at the agora.
  w.buildings = [
    createBuilding({ owner: AI, type: 'camp', x: 40, z: 20, built: 1 }),
  ];
  w.buildings[0].gatherRallyAt = 10;
  // Owner 1 → economy phase 11; first planner tick ≥ 10 is tick 11.
  w.tick = 11;
  const cmds = generateEconomyCommands(w, field, { owner: AI, temperament: 'passive' });
  const moves = cmds.filter((c) => c.type === CMD.MOVE);
  assert.equal(moves.length, 3, 'every idle villager is sent to the new camp');
  for (const m of moves) {
    assert.equal(m.entities.length, 1, 'one order per villager');
    assert.equal(m.tx[0] === w.buildings[0].x && m.ty[0] === w.buildings[0].z, true, 'move targets the camp center');
  }
  assert.equal(cmds.some((c) => c.type === CMD.GATHER), false, 'no hand-picked trees');

  // No further orders: the camp's own auto-assign puts them to work.
  step(w, field, moves);
  for (let t = 0; t < 600; t++) step(w, field, []);
  for (const m of moves) {
    assert.equal(w.order[m.entities[0]], ORDER.GATHER, 'rallied villager was recruited by the camp');
  }
}

function fullWoodStillGetsFirstCamp() {
  const { w, field } = makeScenario(91);
  w.buildings = [
    createBuilding({ owner: AI, type: 'village', x: -12, z: 0, built: 1 }),
    createBuilding({ owner: AI, type: 'farm', x: 0, z: -16, built: 1 }),
    createBuilding({ owner: AI, type: 'mine', x: -36, z: 4, built: 1 }),
  ];
  // Hand-gathered wood dropped at the mine has filled the bank.
  fillToCap(w, 'wood');
  const wood = getResource(w, AI, 'wood');
  assert.ok(bankPressure(w, AI, { wood, food: 0, stone: 0, mineral: 0 }, 0).overflowing.includes('wood'), 'wood reads as full');
  for (const temperament of ['passive', 'steady']) {
    const cmds = firstEcoCmds(w, field, { owner: AI, temperament });
    const place = cmds.find((c) => c.type === CMD.PLACE_BUILDING);
    assert.equal(place?.buildingType, 'camp', `${temperament}: full wood with no camp still places one`);
  }
}

function campCrewIsNotPulled() {
  const { w, field } = makeScenario(90);
  w.buildings = [
    createBuilding({ owner: AI, type: 'camp', x: 40, z: 20, built: 1 }),
    createBuilding({ owner: AI, type: 'farm', x: -20, z: 0, built: 1 }),
  ];
  // Food is the top need and the farm is open, but every villager is camp crew.
  addResource(w, AI, 'wood', 60);
  const tree = 32 * field.width + 42;
  step(w, field, [{ type: CMD.GATHER, entities: [0, 1, 2], tile: tree }]);
  for (let t = 1; t < 200; t++) {
    w.tick = t;
    const cmds = generateEconomyCommands(w, field, { owner: AI, temperament: 'passive' });
    for (const c of cmds) {
      if (c.type !== CMD.MOVE && c.type !== CMD.GATHER) continue;
      for (const i of c.entities) {
        assert.notEqual(w.order[i], ORDER.GATHER, 'a camp worker is never re-ordered');
      }
    }
    step(w, field, cmds);
  }
}

function campGoesToDensestGrove() {
  const field = createField(9, { width: 96, height: 96 });
  field.pass.fill(1);
  field.activeMask.fill(1);
  const c = 48;
  // Three lone trees just east; a 6x6 wood ~20 tiles south-west.
  for (const [dx, dz] of [[7, 0], [8, 3], [7, -3]]) growTreeAt(field, (c + dz) * 96 + c + dx, 30);
  for (let tz = c + 16; tz < c + 22; tz++) {
    for (let tx = c - 22; tx < c - 16; tx++) growTreeAt(field, tz * 96 + tx, 30);
  }
  const w = createWorld(9);
  w.buildings = [];
  w.agoras = [{ owner: AI, x: fx.fromFloat(0), z: fx.fromFloat(0) }];
  for (let k = 0; k < 3; k++) {
    spawn(w, { x: fx.fromFloat(-4 - k * 3), y: fx.fromFloat(0), type: UNIT.VILLAGER, owner: AI });
  }
  grantStartingResources(w, AI);
  const entry = { owner: AI, temperament: 'passive' };
  for (let t = 0; t < 400; t++) {
    const cmds = generateEconomyCommands(w, field, entry);
    for (const cm of cmds) {
      if (cm.type !== CMD.PLACE_BUILDING || cm.buildingType !== 'camp') continue;
      assert.ok(fx.toFloat(cm.tx) < -40 && fx.toFloat(cm.ty) > 40, 'first camp sits at the dense wood');
      return;
    }
    step(w, field, cmds);
  }
  assert.fail('AI should place a camp');
}

function replacesDepletedCamp() {
  const { w, field } = makeScenario(58);
  w.buildings.push(createBuilding({ owner: AI, type: 'village', x: -12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'farm', x: 12, z: -20 }));
  // Camp with no trees anywhere in reach — its grove is gone.
  w.buildings.push(createBuilding({ owner: AI, type: 'camp', x: -100, z: -100 }));
  const cmds = firstEcoCmds(w, field, { owner: AI, temperament: 'passive' });
  const place = cmds.find((c) => c.type === CMD.PLACE_BUILDING);
  assert.ok(place && place.buildingType === 'camp', `a dry camp does not count — place a new one (got ${JSON.stringify(cmds)})`);
  assert.ok(fx.toFloat(place.tx) > 20, 'new camp goes to the live grove (east), not beside the dry one');
}

function oneCampSiteAtATime() {
  const { w, field } = makeScenario(59);
  w.buildings.push(createBuilding({ owner: AI, type: 'village', x: -12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'farm', x: 12, z: -20 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'camp', x: 30, z: 0, built: 0 }));
  addResource(w, AI, 'wood', 20);
  for (let t = 0; t < 120; t++) {
    w.tick = t;
    const cmds = generateEconomyCommands(w, field, { owner: AI, temperament: 'steady' });
    assert.equal(
      cmds.some((c) => c.type === CMD.PLACE_BUILDING && c.buildingType === 'camp'),
      false,
      'no second camp while the first is still a site',
    );
  }
}

function noPerTileGatherMicro() {
  const { w, field } = makeScenario(56);
  fillToCap(w, 'wood');
  addResource(w, AI, 'food', 80);
  addResource(w, AI, 'stone', 40);
  const cmds = firstEcoCmds(w, field, {
    owner: AI,
    temperament: 'steady',
    difficulty: AI_DIFFICULTY.EXPERT,
  });
  const gathers = cmds.filter((c) => c.type === CMD.GATHER);
  assert.equal(gathers.length, 3, 'no camp/mine yet: each idle villager gets its own order');
  for (const g of gathers) {
    assert.equal(g.entities.length, 1, 'one villager per order');
    assert.equal((field.treeStock?.[g.tile | 0] | 0) > 0, false, 'expert does not gather into a full wood bank');
  }
}

function prefersCampOverDirectGather() {
  const { w, field } = makeScenario(57);
  w.buildings.push(createBuilding({ owner: AI, type: 'village', x: -12, z: 0 }));
  w.buildings.push(createBuilding({ owner: AI, type: 'camp', x: 40, z: 0 }));
  const cmds = firstEcoCmds(w, field, { owner: AI, temperament: 'passive' });
  assert.equal(cmds.some((c) => c.type === CMD.GATHER), false, 'camp in place: no hand-picked trees');
  const move = cmds.find((c) => c.type === CMD.MOVE);
  assert.ok(move, 'idle villagers are walked to the camp');
  assert.equal(move.tx[0], w.buildings[1].x, 'rally targets the camp');
}

function stressCanMuteEconomy() {
  const { w, field } = makeScenario(9);
  const entry = { owner: AI, temperament: 'steady', economy: false };
  for (let t = 0; t < 60; t++) {
    w.tick = t;
    assert.deepEqual(generateEconomyCommands(w, field, entry), []);
  }
}

macrosAnEconomy();
buildsGatherFacilitiesFromStartingBank();
campGoesToDensestGrove();
staysPassive();
deterministic();
armyPathPlacesBarracks();
captureRampsTraining();
startingBankIsNotADump();
overflowSpendsInsteadOfLeaking();
openRallyMovesIdleToNewCamp();
campCrewIsNotPulled();
fullWoodStillGetsFirstCamp();
noPerTileGatherMicro();
prefersCampOverDirectGather();
replacesDepletedCamp();
oneCampSiteAtATime();
stressCanMuteEconomy();
console.log('aiEconomy.test.js: ok (macro + passive + path + overflow + deterministic)');
