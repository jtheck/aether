// Economic AI — a passive, rule-bound player that gathers, expands drop-offs,
// and farms (villagers trickle from the village). Verified headless +
// deterministic (two runs must land on the same checksum).

import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
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

function overflowReroutesGather() {
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
  assert.ok(gathers.length > 0, 'expert still sends idle villagers');
  for (const g of gathers) {
    const tile = g.tile | 0;
    assert.equal(
      (field.treeStock?.[tile] | 0) > 0,
      false,
      'expert does not gather into a full wood bank',
    );
  }
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
staysPassive();
deterministic();
armyPathPlacesBarracks();
captureRampsTraining();
startingBankIsNotADump();
overflowSpendsInsteadOfLeaking();
overflowReroutesGather();
stressCanMuteEconomy();
console.log('aiEconomy.test.js: ok (macro + passive + path + overflow + deterministic)');
