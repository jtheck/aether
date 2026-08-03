import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { checksum } from './checksum.js';
import {
  MONK_KICK_ALLY_LOB_DIST,
  MONK_KICK_COOLDOWN,
  MONK_KICK_FLIGHT_TICKS,
  MONK_KICK_LOB_DIST,
  MONK_KICK_PEAK_HEIGHT,
  MONK_KICK_RADIUS,
  isLobbing,
  lobHeightAt,
  takeMonkKickUpdates,
} from './monkKick.js';

function moveMonkToward(_w, monk, x, y) {
  return {
    type: CMD.MOVE,
    entities: [monk],
    tx: x,
    ty: y,
  };
}

function passiveBonkLobsOneUnit() {
  const field = createField(1);
  const w = createWorld(40);
  const monk = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MONK,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const ally = spawn(w, {
    x: fx.fromFloat(2.2),
    y: fx.fromFloat(0.4),
    type: UNIT.ARCHER,
    owner: 0,
  });
  const startFoe = w.px[foe];
  const startAlly = w.px[ally];
  const hpFoe = w.hp[foe];
  const hpAlly = w.hp[ally];

  // Walk into stick range — passive bonk, not a cast.
  step(w, field, [moveMonkToward(w, monk, fx.fromInt(20), 0)]);

  let launched = isLobbing(w, foe) || isLobbing(w, ally);
  for (let t = 0; t < 30 && !launched; t++) {
    step(w, field, []);
    launched = isLobbing(w, foe) || isLobbing(w, ally);
  }
  assert.ok(launched, 'someone got stick-bonked');

  const foeFlying = isLobbing(w, foe);
  const allyFlying = isLobbing(w, ally);
  assert.ok(foeFlying !== allyFlying, 'exactly one victim at a time');
  assert.ok(w.abilityCd[monk] > 0, 'monk on bonk cooldown');
  assert.ok(w.abilityCd[monk] <= MONK_KICK_COOLDOWN);
  if (foeFlying) assert.ok(w.hp[foe] < hpFoe, 'stick draws blood');
  else assert.ok(w.hp[ally] < hpAlly, 'friendly fire stick still hurts');

  const victim = foeFlying ? foe : ally;
  const other = foeFlying ? ally : foe;
  const startV = foeFlying ? startFoe : startAlly;
  assert.ok(isLobbing(w, victim));
  assert.ok(!isLobbing(w, other));

  // Finish the flight.
  for (let t = 0; t < MONK_KICK_FLIGHT_TICKS + 2; t++) step(w, field, []);
  assert.ok(!isLobbing(w, victim), 'lands after flight');
  const traveled = Math.abs(fx.toFloat(w.px[victim] - startV));
  const expect = foeFlying ? MONK_KICK_LOB_DIST : MONK_KICK_ALLY_LOB_DIST;
  // Distance is rng-jittered (~0.55–1.08× base).
  assert.ok(traveled >= fx.toFloat(expect) * 0.4, `lob too short: ${traveled}`);
  assert.ok(traveled <= fx.toFloat(expect) * 1.25, `lob too long: ${traveled}`);
}

function monksAreImmune() {
  const field = createField(1);
  const w = createWorld(41);
  const monk = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MONK,
    owner: 0,
  });
  spawn(w, {
    x: fx.fromFloat(1.5),
    y: 0,
    type: UNIT.MONK,
    owner: 1,
  });
  // Even idle — monks don't bonk other monks.
  for (let t = 0; t < 10; t++) step(w, field, []);
  assert.equal(w.abilityCd[monk], 0);
  assert.ok(!isLobbing(w, 0) && !isLobbing(w, 1));
}

function vehiclesAreImmune() {
  const field = createField(1);
  const w = createWorld(41);
  const monk = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MONK,
    owner: 0,
  });
  const wagon = spawn(w, {
    x: fx.fromFloat(1.5),
    y: 0,
    type: UNIT.WAGON,
    owner: 1,
  });
  const apc = spawn(w, {
    x: fx.fromFloat(-1.5),
    y: 0,
    type: UNIT.APC,
    owner: 1,
  });
  for (let t = 0; t < 15; t++) step(w, field, []);
  assert.equal(w.abilityCd[monk], 0);
  assert.ok(!isLobbing(w, wagon), 'wagon immune');
  assert.ok(!isLobbing(w, apc), 'apc immune');
}

function castDoesNothing() {
  const field = createField(1);
  const w = createWorld(42);
  const monk = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MONK,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromInt(40),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  step(w, field, [{
    type: CMD.CAST,
    entities: [monk],
    tx: 0,
    ty: 0,
  }]);
  assert.equal(w.abilityCd[monk], 0, 'cast is not a monk ability');
  assert.ok(!isLobbing(w, foe));
}

function flightPublishesProgress() {
  const field = createField(1);
  const w = createWorld(43);
  const monk = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MONK,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  step(w, field, [moveMonkToward(w, monk, fx.fromInt(10), 0)]);
  let flying = isLobbing(w, foe);
  for (let t = 0; t < 30 && !flying; t++) {
    step(w, field, []);
    flying = isLobbing(w, foe);
  }
  assert.ok(flying);
  // Still airborne — no land puff yet.
  const mid = takeMonkKickUpdates(w);
  assert.ok(mid.count >= 1);
  assert.equal(mid.landCount, 0);

  for (let t = 0; t < MONK_KICK_FLIGHT_TICKS + 2; t++) step(w, field, []);
  const landed = takeMonkKickUpdates(w);
  assert.ok(landed.landCount >= 1, 'landing publishes dirt puff');
  assert.equal(landed.count, 0);
}

function lobIsDeterministic() {
  function run(seed) {
    const field = createField(1);
    const w = createWorld(seed);
    const monk = spawn(w, { x: 0, y: 0, type: UNIT.MONK, owner: 0 });
    spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.WARRIOR, owner: 1 });
    spawn(w, { x: fx.fromFloat(2.1), y: fx.fromFloat(0.3), type: UNIT.ARCHER, owner: 1 });
    step(w, field, [moveMonkToward(w, monk, fx.fromInt(12), 0)]);
    for (let t = 0; t < 40; t++) step(w, field, []);
    const poses = [];
    for (let i = 0; i < w.count; i++) poses.push([w.px[i], w.py[i], w.lobTicks[i]]);
    return { checksum: checksum(w, field), poses };
  }
  const a = run(99);
  const b = run(99);
  assert.deepEqual(a.poses, b.poses);
  assert.equal(a.checksum, b.checksum);
}

function loftCurvePeaksMidflight() {
  assert.ok(lobHeightAt(0, 10) < 0.01);
  assert.ok(lobHeightAt(1, 10) < 0.01);
  assert.ok(Math.abs(lobHeightAt(0.5, 10) - 10) < 0.01);
  assert.ok(fx.toFloat(MONK_KICK_RADIUS) < fx.toFloat(MONK_KICK_ALLY_LOB_DIST));
  assert.ok(fx.toFloat(MONK_KICK_ALLY_LOB_DIST) < fx.toFloat(MONK_KICK_LOB_DIST));
  assert.ok(MONK_KICK_COOLDOWN > 0);
  assert.ok(MONK_KICK_FLIGHT_TICKS > 5);
}

function alliesGetShorterLob() {
  const field = createField(1);
  const w = createWorld(55);
  const monk = spawn(w, { x: 0, y: 0, type: UNIT.MONK, owner: 0 });
  const ally = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const start = w.px[ally];
  step(w, field, [moveMonkToward(w, monk, fx.fromInt(8), 0)]);
  let launched = isLobbing(w, ally);
  for (let t = 0; t < 20 && !launched; t++) {
    step(w, field, []);
    launched = isLobbing(w, ally);
  }
  assert.ok(launched);
  for (let t = 0; t < MONK_KICK_FLIGHT_TICKS + 2; t++) step(w, field, []);
  const traveled = Math.abs(fx.toFloat(w.px[ally] - start));
  assert.ok(traveled < fx.toFloat(MONK_KICK_LOB_DIST) * 0.7, 'ally lob shorter than hostile');
  assert.ok(traveled >= fx.toFloat(MONK_KICK_ALLY_LOB_DIST) * 0.4);
}

function squadMatesAreNotBonked() {
  const field = createField(1);
  const w = createWorld(56);
  const monk = spawn(w, { x: 0, y: 0, type: UNIT.MONK, owner: 0 });
  const ally = spawn(w, {
    x: fx.fromFloat(2),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromFloat(-2),
    y: 0,
    type: UNIT.ARCHER,
    owner: 1,
  });
  // Same selection / control group.
  step(w, field, [{
    type: CMD.SELECT,
    playerId: 0,
    entities: [monk, ally],
  }]);
  assert.equal(w.squadId[monk], w.squadId[ally]);
  assert.ok(w.squadId[monk] !== 0);

  for (let t = 0; t < 15; t++) step(w, field, []);
  assert.ok(!isLobbing(w, ally), 'co-selected ally is safe');
  // Enemy still fair game.
  let foeHit = isLobbing(w, foe);
  for (let t = 0; t < 20 && !foeHit; t++) {
    step(w, field, []);
    foeHit = isLobbing(w, foe);
  }
  assert.ok(foeHit, 'enemy outside the squad still gets bonked');
  assert.ok(!isLobbing(w, ally));
}

passiveBonkLobsOneUnit();
monksAreImmune();
vehiclesAreImmune();
castDoesNothing();
flightPublishesProgress();
lobIsDeterministic();
loftCurvePeaksMidflight();
alliesGetShorterLob();
squadMatesAreNotBonked();
console.log('monkKick tests ok');
