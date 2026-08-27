// Economic AI — a passive, rule-bound player that gathers, expands drop-offs,
// farms, and trains villagers, all while paying real costs. Verified headless +
// deterministic (two runs must land on the same checksum).

import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { createField } from './field.js';
import { growTreeAt } from './trees.js';
import { SCENERY, rockYield } from './scenery.js';
import { getResource, grantStartingResources } from './resources.js';
import { checksum } from './checksum.js';
import { generateEconomyCommands } from './aiEconomy.js';

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
  assert.ok(countVillagers(w) > 3, `AI trained villagers (have ${countVillagers(w)})`);
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

macrosAnEconomy();
staysPassive();
deterministic();
console.log('aiEconomy.test.js: ok (macro + passive + deterministic)');
