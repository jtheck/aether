import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { PROJECTILE } from './projectileTypes.js';
import { FROG_COUNT } from './frogs.js';
import {
  LIGHTNING_FOLLOWUP_GAP,
  LIGHTNING_HIT,
  takeLightningUpdates,
} from './lightning.js';
import { holyArmorShieldAmount } from './holyArmor.js';
import { takeSporeBloomUpdates } from './sporeBloom.js';
import {
  CAST_COMPOUND_CAP,
  FIREBALL_STAGGER,
  SHAMAN_COMPOUND_RANGE,
} from './abilities.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function mycoPairOverlappingRings() {
  const field = openField();
  const w = createWorld(200);
  const aimX = fx.fromInt(24);
  const aimY = 0;
  const a = spawn(w, { x: fx.fromInt(-8), y: 0, type: UNIT.MYCO, owner: 0 });
  const b = spawn(w, { x: fx.fromInt(-4), y: 0, type: UNIT.MYCO, owner: 0 });
  step(w, field, [{
    type: CMD.CAST,
    entities: [a, b],
    tx: aimX,
    ty: aimY,
  }]);
  assert.ok(w.abilityCd[a] > 0 && w.abilityCd[b] > 0, 'pair locks');
  const patch = takeSporeBloomUpdates(w);
  assert.ok(patch);
  assert.equal(patch.arcCount, 2, 'pair is a vesica of two rings');
  const keys = new Set();
  for (let i = 0; i < patch.arcCount; i++) {
    keys.add(`${patch.arcX[i].toFixed(1)},${patch.arcY[i].toFixed(1)}`);
  }
  assert.equal(keys.size, 2, 'rings sit on different centers');
  assert.ok(
    Math.abs(patch.arcRadius[0] - patch.arcRadius[1]) < 0.05,
    'overlapping rings share a size',
  );
}

function mycoOverlappingRings() {
  const field = openField();
  const w = createWorld(201);
  const aimX = fx.fromInt(24);
  const aimY = 0;
  const mycos = [];
  for (let n = 0; n < 3; n++) {
    mycos.push(spawn(w, {
      x: fx.fromInt(-8 + n * 4),
      y: 0,
      type: UNIT.MYCO,
      owner: 0,
    }));
  }
  step(w, field, [{
    type: CMD.CAST,
    entities: mycos,
    tx: aimX,
    ty: aimY,
  }]);
  for (let n = 0; n < mycos.length; n++) {
    assert.ok(w.abilityCd[mycos[n]] > 0, 'every myco locks');
  }
  const patch = takeSporeBloomUpdates(w);
  assert.ok(patch);
  assert.equal(patch.arcCount, 3, 'triad of overlapping rings');
  const keys = new Set();
  for (let i = 0; i < patch.arcCount; i++) {
    keys.add(`${patch.arcX[i].toFixed(1)},${patch.arcY[i].toFixed(1)}`);
  }
  assert.equal(keys.size, 3, 'rings sit on different centers');
  assert.ok(
    Math.abs(patch.arcRadius[0] - patch.arcRadius[1]) < 0.05,
    'overlapping rings share a size',
  );
}

function priestBiggerRadiusNoChain() {
  const field = openField();
  const w = createWorld(202);
  const p0 = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
  const p1 = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.PRIEST, owner: 0 });
  const mid = spawn(w, {
    x: fx.fromInt(18),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const reach = spawn(w, {
    x: fx.fromInt(30),
    y: 0,
    type: UNIT.ARCHER,
    owner: 0,
  });
  const far = spawn(w, {
    x: fx.fromInt(52),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  step(w, field, [{
    type: CMD.CAST,
    entities: [p0, p1],
    tx: 0,
    ty: 0,
  }]);
  const amount = holyArmorShieldAmount(UNIT.PRIEST);
  assert.equal(w.shieldHp[mid], amount, 'pulse still hits the huddle');
  assert.equal(w.shieldHp[reach], amount, 'bigger radius covers the next row');
  assert.equal(w.shieldHp[far], 0, 'no chain hop past the pulse');
}

function shamanShortRangeUnlessSolo() {
  const field = openField();
  const far = createWorld(203);
  const s0 = spawn(far, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  const s1 = spawn(far, { x: fx.fromInt(3), y: 0, type: UNIT.SHAMAN, owner: 0 });
  step(far, field, [{
    type: CMD.CAST,
    entities: [s0, s1],
    tx: fx.fromInt(40),
    ty: 0,
  }]);
  assert.equal(far.frogs.activeCount, 0, 'pair will not toss across the map');
  assert.equal(far.abilityCd[s0], 0, 'out-of-range pair does not lock');

  const near = createWorld(213);
  const n0 = spawn(near, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  const n1 = spawn(near, { x: fx.fromInt(3), y: 0, type: UNIT.SHAMAN, owner: 0 });
  step(near, field, [{
    type: CMD.CAST,
    entities: [n0, n1],
    tx: fx.fromInt(18),
    ty: 0,
  }]);
  assert.ok(near.frogs.activeCount > FROG_COUNT, 'short pair still compounds');

  const solo = createWorld(223);
  const one = spawn(solo, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  step(solo, field, [{
    type: CMD.CAST,
    entities: [one],
    tx: fx.fromInt(40),
    ty: 0,
  }]);
  assert.equal(solo.frogs.activeCount, FROG_COUNT, 'lone shaman may still aim far');
  assert.ok(fx.toFloat(SHAMAN_COMPOUND_RANGE) < 40);
}

function wizardFollowUpBranchesOut() {
  const field = openField();
  const w = createWorld(204);
  const z0 = spawn(w, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
  const z1 = spawn(w, { x: fx.fromInt(3), y: 0, type: UNIT.WIZARD, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(10),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const hp0 = w.hp[foe];
  const aimX = fx.fromInt(10);
  const aimY = 0;
  step(w, field, [{
    type: CMD.CAST,
    entities: [z0, z1],
    tx: aimX,
    ty: aimY,
  }]);
  const first = takeLightningUpdates(w);
  assert.equal(first?.count, 1, 'first bolt is immediate');
  assert.equal(first.kind[0], LIGHTNING_HIT.UNIT);
  const hpAfterFirst = w.hp[foe];
  assert.ok(hpAfterFirst < hp0, 'first strike lands');
  assert.equal(w.pendingLightning.count, 1, 'follow-up is queued');
  const pendingAim = {
    x: w.pendingLightning.aimX[0],
    y: w.pendingLightning.aimY[0],
  };
  assert.ok(
    pendingAim.x !== aimX || pendingAim.y !== aimY,
    'follow-up branches off the epicenter',
  );

  for (let t = 0; t < LIGHTNING_FOLLOWUP_GAP - 1; t++) step(w, field, []);
  assert.equal(takeLightningUpdates(w), null, 'follow-up waits');
  step(w, field, []);
  const second = takeLightningUpdates(w);
  assert.equal(second?.count, 1, 'bonus bolt after the delay');
}

function warlockStaggeredVolley() {
  const field = openField();
  const w = createWorld(205);
  const a = spawn(w, {
    x: 0,
    y: fx.fromInt(-8),
    type: UNIT.WARLOCK,
    owner: 0,
  });
  const b = spawn(w, {
    x: 0,
    y: fx.fromInt(8),
    type: UNIT.WARLOCK,
    owner: 0,
  });
  step(w, field, [{
    type: CMD.CAST,
    entities: [a, b],
    tx: fx.fromInt(40),
    ty: 0,
  }]);
  assert.ok(w.projectiles.activeCount >= 3, 'two parallel balls plus an extra');
  let waiting = 0;
  const aims = [];
  const speeds = [];
  for (let s = 0; s < w.projectiles.highWater; s++) {
    if (!w.projectiles.alive[s]) continue;
    assert.equal(w.projectiles.type[s], PROJECTILE.FIREBALL);
    aims.push({ x: w.projectiles.aimX[s], y: w.projectiles.aimY[s] });
    speeds.push(w.projectiles.speed[s]);
    if (w.projectiles.launchWait[s] > 0) waiting++;
  }
  assert.ok(waiting >= 1, 'later balls still wait a beat');
  assert.ok(FIREBALL_STAGGER >= 1);
  const uniqueY = new Set(aims.map((p) => p.y));
  assert.ok(uniqueY.size >= 2, 'aims fan with warlock spacing, not one point');
  const defSpeed = speeds[0];
  assert.ok(speeds.every((s) => s === defSpeed), 'volley shares a slower speed');
}

function capIsFour() {
  assert.equal(CAST_COMPOUND_CAP, 4);
}

mycoPairOverlappingRings();
mycoOverlappingRings();
priestBiggerRadiusNoChain();
shamanShortRangeUnlessSolo();
wizardFollowUpBranchesOut();
warlockStaggeredVolley();
capIsFour();
console.log('castCompound.test.js: ok');
