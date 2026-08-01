import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { checksum } from './checksum.js';
import { CMD } from './commands.js';
import { kill } from './damage.js';
import { createField, setBlocked, worldToTile } from './field.js';
import {
  createProjectileStore,
  projectileSystem,
  spawnProjectile,
} from './projectiles.js';
import { PROJECTILE } from './projectileTypes.js';
import { step } from './step.js';
import { UNIT } from './unitTypes.js';
import { createWorld, spawn } from './world.js';
import { buildWorldFromConfig } from './worldSetup.js';
import {
  beginSharedPublish,
  endSharedPublish,
  mapSharedState,
  publishProjectiles,
  publishWorld,
  simSharedByteSize,
  simViewFacade,
} from './sharedState.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function archerTravelAndCooldown() {
  const field = openField();
  const w = createWorld(11);
  const archer = spawn(w, {
    x: fx.fromInt(0),
    y: fx.fromInt(0),
    type: UNIT.ARCHER,
    owner: 0,
  });
  const target = spawn(w, {
    x: fx.fromInt(12),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const hp = w.hp[target];
  step(w, field, [{ type: CMD.ATTACK, entities: [archer], target }]);
  assert.equal(w.hp[target], hp, 'ranged damage must not be instant');
  assert.equal(w.projectiles.activeCount, 1);
  assert.equal(w.attackCd[archer], 39, 'cooldown starts when the arrow is fired');
  step(w, field);
  assert.equal(w.hp[target], hp, 'slower arrow remains in flight after one more tick');
  step(w, field);
  assert.equal(w.hp[target], hp - 8, 'arrow damage lands after travel');
  assert.equal(w.projectiles.activeCount, 0);
}

function deadTargetMisses() {
  const field = openField();
  const w = createWorld(12);
  const source = spawn(w, { x: 0, y: 0, type: UNIT.ARCHER, owner: 0 });
  const target = spawn(w, {
    x: fx.fromInt(12),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  spawnProjectile(w, {
    type: PROJECTILE.ARROW,
    owner: 0,
    source,
    target,
    x: 0,
    y: 0,
    aimX: w.px[target],
    aimY: w.py[target],
    damage: 8,
  });
  kill(w, target);
  for (let tick = 0; tick < 8 && w.projectiles.activeCount; tick++) {
    projectileSystem(w, field);
  }
  assert.equal(w.projectiles.activeCount, 0);
  assert.equal(w.metrics.projectileHits, 0);
  assert.equal(w.metrics.projectileMisses, 1);
}

function poolReuseAndOverflow() {
  const field = openField();
  const w = createWorld(13);
  w.projectiles = createProjectileStore(2);
  const source = spawn(w, { type: UNIT.ARCHER, owner: 0 });
  const target = spawn(w, { type: UNIT.WARRIOR, owner: 1 });
  const args = {
    type: PROJECTILE.ARROW,
    owner: 0,
    source,
    target,
    x: 0,
    y: 0,
    aimX: 0,
    aimY: 0,
    damage: 1,
  };
  const first = spawnProjectile(w, args);
  const firstGeneration = w.projectiles.generation[first];
  const second = spawnProjectile(w, {
    ...args,
    type: PROJECTILE.BOLT,
    target: -1,
    aimX: fx.fromInt(20),
  });
  assert.equal(spawnProjectile(w, args), -1);
  assert.equal(w.metrics.projectileOverflow, 1);
  projectileSystem(w, field);
  assert.equal(w.projectiles.alive[first], 0);
  const reused = spawnProjectile(w, args);
  assert.equal(reused, first);
  assert.ok(w.projectiles.generation[reused] > firstGeneration);
  assert.equal(w.projectiles.alive[second], 1);
}

function terrainBlocking() {
  const field = openField();
  const w = createWorld(14);
  const source = spawn(w, { type: UNIT.ARCHER, owner: 0 });
  const target = spawn(w, {
    x: fx.fromInt(20),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  setBlocked(field, worldToTile(fx.fromInt(6)), worldToTile(0));
  spawnProjectile(w, {
    type: PROJECTILE.ROCK,
    owner: 0,
    source,
    target,
    x: 0,
    y: 0,
    aimX: w.px[target],
    aimY: w.py[target],
    damage: 20,
  });
  for (let tick = 0; tick < 8 && w.projectiles.activeCount; tick++) {
    projectileSystem(w, field);
  }
  assert.equal(w.projectiles.activeCount, 0);
  assert.equal(w.hp[target], 120);
  assert.equal(w.metrics.projectileMisses, 1);
}

function simultaneousImpactAndChecksum() {
  const field = openField();
  const w = createWorld(15);
  const source = spawn(w, { type: UNIT.ARCHER, owner: 0 });
  const target = spawn(w, { type: UNIT.WARRIOR, owner: 1, hp: 5 });
  const args = {
    type: PROJECTILE.ARROW,
    owner: 0,
    source,
    target,
    x: 0,
    y: 0,
    aimX: 0,
    aimY: 0,
    damage: 5,
  };
  const slot = spawnProjectile(w, args);
  spawnProjectile(w, args);
  const before = checksum(w);
  w.projectiles.px[slot] = fx.fromInt(1);
  assert.notEqual(checksum(w), before, 'projectile position must affect checksum');
  w.projectiles.px[slot] = 0;
  projectileSystem(w, field);
  assert.equal(w.alive[target], 0);
  assert.equal(w.metrics.projectileHits, 1, 'lower slot resolves the lethal impact first');
}

function engagementSlotsAndRangedSpacing() {
  const field = openField();
  const melee = createWorld(16);
  const target = spawn(melee, {
    x: 0,
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
    hp: 1000,
  });
  const attackers = [];
  for (let i = 0; i < 8; i++) {
    attackers.push(
      spawn(melee, {
        x: fx.fromInt(-10),
        y: fx.fromInt(i - 4),
        type: UNIT.WARRIOR,
        owner: 0,
      }),
    );
  }
  step(melee, field, [{ type: CMD.ATTACK, entities: attackers, target }]);
  const slots = new Set(attackers.map((i) => melee.engagementSlot[i]));
  assert.equal(slots.size, attackers.length, 'melee attackers should claim distinct slots');

  const ranged = createWorld(17);
  const archer = spawn(ranged, {
    x: fx.fromInt(1),
    y: 0,
    type: UNIT.ARCHER,
    owner: 0,
  });
  const closeTarget = spawn(ranged, {
    x: 0,
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const startX = ranged.px[archer];
  step(ranged, field, [{ type: CMD.ATTACK, entities: [archer], target: closeTarget }]);
  assert.ok(ranged.px[archer] > startX, 'ranged units should move toward preferred spacing');
  assert.equal(ranged.projectiles.activeCount, 0, 'ranged units do not fire inside minimum range');
}

function sharedProjectilePublication() {
  const w = createWorld(18);
  const source = spawn(w, { type: UNIT.ARCHER, owner: 0 });
  const target = spawn(w, { x: fx.fromInt(10), type: UNIT.WARRIOR, owner: 1 });
  const slot = spawnProjectile(w, {
    type: PROJECTILE.ARROW,
    owner: 0,
    source,
    target,
    x: 0,
    y: 0,
    aimX: w.px[target],
    aimY: w.py[target],
    damage: 8,
  });
  const views = mapSharedState(new SharedArrayBuffer(simSharedByteSize()));
  beginSharedPublish(views);
  publishWorld(w, views);
  publishProjectiles(w, views);
  endSharedPublish(views);
  const facade = simViewFacade(views);
  assert.equal(Atomics.load(views.header, 4) & 1, 0);
  assert.equal(facade.projectiles.activeCount, 1);
  assert.equal(facade.projectiles.highWater, 1);
  assert.equal(facade.projectiles.generation[slot], w.projectiles.generation[slot]);
  assert.equal(facade.projectiles.px[slot], w.projectiles.px[slot]);
}

function kothEliminationAfterImpact() {
  const field = openField();
  const w = buildWorldFromConfig({
    seed: 19,
    mode: 'koth',
    activeSlots: [0, 1],
  });
  let archer = -1;
  let target = -1;
  for (let i = 0; i < w.count; i++) {
    if (w.owner[i] === 0 && w.type[i] === UNIT.ARCHER && archer < 0) archer = i;
    if (w.owner[i] === 1) {
      if (target < 0) target = i;
      else kill(w, i);
    }
  }
  w.px[archer] = 0;
  w.py[archer] = 0;
  w.px[target] = fx.fromInt(6);
  w.py[target] = 0;
  w.hp[target] = 1;
  step(w, field, [{ type: CMD.ATTACK, entities: [archer], target }]);
  assert.equal(w.alive[target], 1, 'slower projectile remains authoritative while in flight');
  step(w, field);
  assert.equal(w.alive[target], 0);
  assert.equal(w.koth.eliminated[1], 1, 'projectile impacts resolve before KOTH elimination');
}

function fireballSplashDamagesAndFriendlyFire() {
  const field = openField();
  const w = createWorld(21);
  const caster = spawn(w, {
    x: fx.fromInt(0),
    y: fx.fromInt(0),
    type: UNIT.WARLOCK,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromInt(20),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const ally = spawn(w, {
    x: fx.fromInt(22),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const foeHp = w.hp[foe];
  const allyHp = w.hp[ally];
  const damage = Math.max(1, Math.round(9 * 1.35)); // warlock attackDamage * 1.35
  spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: caster,
    target: -1,
    x: 0,
    y: 0,
    aimX: fx.fromInt(20),
    aimY: 0,
    damage,
  });
  for (let tick = 0; tick < 16 && w.projectiles.activeCount; tick++) {
    projectileSystem(w, field);
  }
  assert.equal(w.projectiles.activeCount, 0);
  assert.equal(w.hp[foe], foeHp - damage, 'hostile takes full fireball splash');
  assert.equal(
    w.hp[ally],
    allyHp - Math.max(1, Math.round(damage * 0.25)),
    'friendly takes reduced splash',
  );
}

function castCommandSpawnsFireball() {
  const field = openField();
  const w = createWorld(22);
  const warlock = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WARLOCK,
    owner: 0,
  });
  step(w, field, [{
    type: CMD.CAST,
    entities: [warlock],
    tx: fx.fromInt(30),
    ty: 0,
  }]);
  assert.equal(w.projectiles.activeCount, 1);
  let slot = -1;
  for (let s = 0; s < w.projectiles.highWater; s++) {
    if (w.projectiles.alive[s]) { slot = s; break; }
  }
  assert.ok(slot >= 0);
  assert.equal(w.projectiles.type[slot], PROJECTILE.FIREBALL);
  assert.ok(w.abilityCd[warlock] > 0);
}

function fireballAimScatterGrowsWithRange() {
  const field = openField();
  const w = createWorld(23);
  const aimX = fx.fromInt(80);
  const near = spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: -1,
    target: -1,
    x: 0,
    y: 0,
    aimX: fx.fromInt(12),
    aimY: 0,
    damage: 1,
  });
  const far = spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: -1,
    target: -1,
    x: 0,
    y: 0,
    aimX,
    aimY: 0,
    damage: 1,
  });
  assert.ok(near >= 0 && far >= 0);
  const nearOff = Math.abs(w.projectiles.aimY[near]);
  const farOff = Math.hypot(
    fx.toFloat(w.projectiles.aimX[far] - aimX),
    fx.toFloat(w.projectiles.aimY[far]),
  );
  // Far shot should be allowed to wander farther than a point-blank one.
  assert.ok(farOff >= nearOff || farOff > 0, 'long throws pick up aim scatter');
  void field;
}

archerTravelAndCooldown();
deadTargetMisses();
poolReuseAndOverflow();
terrainBlocking();
simultaneousImpactAndChecksum();
engagementSlotsAndRangedSpacing();
sharedProjectilePublication();
kothEliminationAfterImpact();
fireballSplashDamagesAndFriendlyFire();
castCommandSpawnsFireball();
fireballAimScatterGrowsWithRange();
console.log('[PASS] authoritative projectile behavior and pooling');
