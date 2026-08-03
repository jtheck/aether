import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { checksum } from './checksum.js';
import {
  FROG_COUNT,
  FROG_DISTRACT_TICKS,
  FROG_HOPS_MIN,
  FROG_LAUNCH_STAGGER,
  FROG_LINGER_MIN,
  FROG_PHASE,
  FROG_PLAGUE_COOLDOWN,
  findNearestWater,
  frogSystem,
  maybeConfuseAlly,
  spawnFrogPlague,
  takeFrogUpdates,
} from './frogs.js';
import {
  TERRAIN,
  TILE,
  tileCenterX,
  tileCenterY,
  worldToTile,
} from './field.js';

function castSpawnsStaggeredCluster() {
  const field = createField(1);
  const w = createWorld(40);
  const shaman = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.SHAMAN,
    owner: 0,
  });
  step(w, field, [{
    type: CMD.CAST,
    entities: [shaman],
    tx: fx.fromInt(30),
    ty: 0,
  }]);
  assert.equal(w.frogs.activeCount, FROG_COUNT, 'cast spawns frog cluster');
  assert.ok(w.abilityCd[shaman] > 0);
  assert.equal(w.abilityCd[shaman], FROG_PLAGUE_COOLDOWN - 1);

  let waiting = 0;
  let hopping = 0;
  for (let s = 0; s < w.frogs.highWater; s++) {
    if (!w.frogs.alive[s]) continue;
    if (w.frogs.phase[s] === FROG_PHASE.WAIT) waiting++;
    if (w.frogs.phase[s] === FROG_PHASE.OUT) hopping++;
    assert.ok(w.frogs.hopsLeft[s] >= FROG_HOPS_MIN, 'long hop life');
  }
  assert.equal(waiting + hopping, FROG_COUNT);
  assert.ok(waiting >= FROG_COUNT - 2, 'most frogs stagger before launch');
}

function clustersAreNotALine() {
  const w = createWorld(41);
  spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  spawnFrogPlague(w, {
    owner: 0,
    source: 0,
    x: 0,
    y: 0,
    aimX: fx.fromInt(40),
    aimY: 0,
    damage: 5,
    count: 9,
  });

  const destY = [];
  for (let s = 0; s < w.frogs.highWater; s++) {
    if (!w.frogs.alive[s]) continue;
    destY.push(w.frogs.destY[s]);
  }
  destY.sort((a, b) => a - b);
  // A fan line toward +X would keep Y near 0; clusters should spread.
  const spread = destY[destY.length - 1] - destY[0];
  assert.ok(spread > fx.fromFloat(6), 'first landings form a cluster blob, not a line');
}

function frogsWanderManyHops() {
  const w = createWorld(42);
  spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  spawnFrogPlague(w, {
    owner: 0,
    source: 0,
    x: 0,
    y: 0,
    aimX: fx.fromInt(40),
    aimY: 0,
    damage: 5,
    count: 4,
  });

  frogSystem(w);
  let waitA = 0;
  let outA = 0;
  for (let s = 0; s < w.frogs.highWater; s++) {
    if (!w.frogs.alive[s]) continue;
    if (w.frogs.phase[s] === FROG_PHASE.WAIT) waitA++;
    if (w.frogs.phase[s] === FROG_PHASE.OUT) outA++;
  }
  assert.ok(outA >= 1 && waitA >= 1, 'staggered independent launches');

  let maxHopsDone = 0;
  let sawLinger = false;
  for (let t = 0; t < 900; t++) {
    frogSystem(w);
    for (let s = 0; s < w.frogs.highWater; s++) {
      if (!w.frogs.alive[s]) continue;
      maxHopsDone = Math.max(maxHopsDone, w.frogs.hopsDone[s]);
      if (w.frogs.phase[s] === FROG_PHASE.LINGER) sawLinger = true;
    }
    if (maxHopsDone >= 4) break;
  }
  assert.ok(sawLinger, 'frogs linger between hops');
  assert.ok(maxHopsDone >= 4, 'frogs keep hopping well past two landings');

  for (let t = 0; t < 2000; t++) frogSystem(w);
  assert.equal(w.frogs.activeCount, 0, 'frogs eventually despawn');
}

function landingDistractsHostiles() {
  const w = createWorld(43);
  const shaman = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.SHAMAN,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromFloat(10),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  w.order[foe] = ORDER.ATTACK;
  w.targetEntity[foe] = shaman;

  spawnFrogPlague(w, {
    owner: 0,
    source: shaman,
    x: 0,
    y: 0,
    aimX: fx.fromInt(40),
    aimY: 0,
    damage: 6,
    count: 8,
  });
  for (let t = 0; t < 320; t++) frogSystem(w);
  assert.ok(w.distractCd[foe] > 0, 'hostile near landing is distracted');
  assert.ok(w.distractCd[foe] <= FROG_DISTRACT_TICKS);
  assert.notEqual(w.order[foe], ORDER.ATTACK, 'distract breaks attack focus');
}

function publishOnlyOnStateChanges() {
  const w = createWorld(44);
  spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  spawnFrogPlague(w, {
    owner: 0,
    source: 0,
    x: 0,
    y: 0,
    aimX: fx.fromInt(20),
    aimY: fx.fromInt(10),
    damage: 4,
    count: 2,
  });
  const spawnPatch = takeFrogUpdates(w);
  assert.ok(spawnPatch);
  assert.equal(spawnPatch.slots.length, 2);

  frogSystem(w);
  takeFrogUpdates(w);

  let quietTicks = 0;
  for (let t = 0; t < 5; t++) {
    frogSystem(w);
    const patch = takeFrogUpdates(w);
    if (!patch) quietTicks++;
  }
  assert.ok(quietTicks >= 3, 'hopping does not spam dirty patches');
}

function plagueAffectsChecksum() {
  const w = createWorld(45);
  spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  const before = checksum(w);
  spawnFrogPlague(w, {
    owner: 0,
    source: 0,
    x: 0,
    y: 0,
    aimX: fx.fromInt(16),
    aimY: 0,
    damage: 4,
  });
  assert.notEqual(checksum(w), before, 'frog state mixes into checksum');
}

function endOfLifeHopsToNearestWater() {
  const field = createField(1);
  const w = createWorld(46);
  spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });

  // Paint a water puddle near the origin.
  const waterTx = worldToTile(fx.fromFloat(20));
  const waterTz = worldToTile(fx.fromFloat(8));
  field.terrainTypes[waterTz * field.width + waterTx] = TERRAIN.WATER;
  const waterX = tileCenterX(waterTx);
  const waterY = tileCenterY(waterTz);

  const found = findNearestWater(field, 0, 0);
  assert.ok(found, 'finds painted water');
  assert.equal(found.x, waterX);
  assert.equal(found.y, waterY);

  spawnFrogPlague(w, {
    owner: 0,
    source: 0,
    x: 0,
    y: 0,
    aimX: fx.fromInt(12),
    aimY: 0,
    damage: 4,
    count: 1,
  });
  let slot = -1;
  for (let s = 0; s < w.frogs.highWater; s++) {
    if (w.frogs.alive[s]) { slot = s; break; }
  }
  assert.ok(slot >= 0);

  // Force end-of-life after one land + linger.
  w.frogs.hopsLeft[slot] = 1;
  let sawEscape = false;
  let maxEscapeHops = 0;
  for (let t = 0; t < 900; t++) {
    frogSystem(w, field);
    if (w.frogs.alive[slot] && w.frogs.phase[slot] === FROG_PHASE.ESCAPE) {
      if (!sawEscape) {
        sawEscape = true;
        assert.equal(w.frogs.escaping[slot], 1);
        const firstStepDist = fx.len(
          w.frogs.destX[slot] - w.frogs.originX[slot],
          w.frogs.destY[slot] - w.frogs.originY[slot],
        );
        // Short hop — not a single leap all the way to water (~22 units away).
        assert.ok(firstStepDist < fx.fromFloat(18), 'escape hops are short');
        assert.ok(firstStepDist > fx.fromFloat(5), 'escape hops still move');
        // First landing should still be short of the water tile.
        const stillShort = fx.dist2(
          w.frogs.destX[slot],
          w.frogs.destY[slot],
          waterX,
          waterY,
        ) > fx.mul(TILE, TILE);
        assert.ok(stillShort, 'first escape hop is not the full trip');
      }
      maxEscapeHops = Math.max(maxEscapeHops, w.frogs.escapeHops[slot]);
    }
    if (!w.frogs.alive[slot] && sawEscape) break;
  }
  assert.ok(sawEscape, 'spent frog enters ESCAPE toward water');
  assert.ok(maxEscapeHops >= 2, 'uses multiple small hops to reach water');
  assert.equal(w.frogs.activeCount, 0, 'frog despawns after reaching water');
}

function confuseCanTurnOnAlly() {
  const w = createWorld(47);
  const a = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const b = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  // Force the RNG path by retrying — deterministic seeds eventually hit chance.
  let confused = false;
  for (let attempt = 0; attempt < 64 && !confused; attempt++) {
    w.order[a] = ORDER.IDLE;
    w.targetEntity[a] = -1;
    // Burn rng until maybeConfuseAlly succeeds.
    if (maybeConfuseAlly(w, a)) confused = true;
  }
  assert.ok(confused, 'confuse eventually forces an ally attack');
  assert.equal(w.order[a], ORDER.ATTACK);
  assert.equal(w.targetEntity[a], b);
}

castSpawnsStaggeredCluster();
clustersAreNotALine();
frogsWanderManyHops();
landingDistractsHostiles();
publishOnlyOnStateChanges();
plagueAffectsChecksum();
endOfLifeHopsToNearestWater();
confuseCanTurnOnAlly();
assert.ok(FROG_LINGER_MIN > 0);
assert.ok(FROG_LAUNCH_STAGGER > 0);
console.log('frogs.test.js: ok');
