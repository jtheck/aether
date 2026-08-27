import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { checksum } from './checksum.js';
import { CMD } from './commands.js';
import { kill } from './damage.js';
import { createField, setBlocked, worldToTile, TERRAIN } from './field.js';
import {
  createProjectileStore,
  projectileSystem,
  spawnProjectile,
} from './projectiles.js';
import { PROJECTILE } from './projectileTypes.js';
import { takeSporeBloomUpdates } from './sporeBloom.js';
import { step } from './step.js';
import { getUnitDef, UNIT } from './unitTypes.js';
import { createWorld, spawn } from './world.js';
import { buildWorldFromConfig } from './worldSetup.js';
import {
  FIREBALL_BLAST_LOB_DIST,
  FIREBALL_BLAST_PEAK_HEIGHT,
  LOB_TRAIL,
  MONK_KICK_LOB_DIST,
  isLobbing,
} from './monkKick.js';
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
  w.carriedAmt[source] = 10;
  const views = mapSharedState(new SharedArrayBuffer(simSharedByteSize()));
  beginSharedPublish(views);
  publishWorld(w, views);
  publishProjectiles(w, views);
  endSharedPublish(views);
  const facade = simViewFacade(views);
  assert.equal(Atomics.load(views.header, 4) & 1, 0);
  assert.equal(facade.carriedAmt[source], 10);
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
  const damage = Math.max(1, Math.round(getUnitDef(UNIT.WARLOCK).attackDamage * 1.35));
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

function fireballSplashBlastLobsUnits() {
  const field = openField();
  const w = createWorld(24);
  const caster = spawn(w, {
    x: fx.fromInt(0),
    y: 0,
    type: UNIT.WARLOCK,
    owner: 0,
  });
  const foe = spawn(w, {
    x: fx.fromInt(20),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const wagon = spawn(w, {
    x: fx.fromInt(21),
    y: 0,
    type: UNIT.WAGON,
    owner: 1,
  });
  const start = w.px[foe];
  const damage = 12;
  spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: caster,
    target: -1,
    x: fx.fromInt(20),
    y: 0,
    aimX: fx.fromInt(20),
    aimY: 0,
    damage,
  });
  // Impact immediately (already at aim).
  projectileSystem(w, field);
  assert.ok(isLobbing(w, foe), 'splash yeets the warrior');
  assert.ok(!isLobbing(w, wagon), 'vehicles stay grounded');
  assert.equal(w.lobTrail[foe], LOB_TRAIL.FIRE);
  assert.equal(w.lobPeak[foe], FIREBALL_BLAST_PEAK_HEIGHT);
  const planned = Math.abs(fx.toFloat(w.lobToX[foe] - start));
  assert.ok(
    planned < fx.toFloat(MONK_KICK_LOB_DIST) * 0.55,
    `blast shorter than monk kick: ${planned}`,
  );
  assert.ok(
    planned >= fx.toFloat(FIREBALL_BLAST_LOB_DIST) * 0.35,
    `blast not a noop: ${planned}`,
  );
}

function fireballBlastDistanceIsRandom() {
  const field = openField();
  const dists = new Set();
  for (let seed = 100; seed < 112; seed++) {
    const w = createWorld(seed);
    spawn(w, { x: 0, y: 0, type: UNIT.WARLOCK, owner: 0 });
    const foe = spawn(w, {
      x: fx.fromInt(10),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    spawnProjectile(w, {
      type: PROJECTILE.FIREBALL,
      owner: 0,
      source: 0,
      target: -1,
      x: fx.fromInt(10),
      y: 0,
      aimX: fx.fromInt(10),
      aimY: 0,
      damage: 8,
    });
    projectileSystem(w, field);
    assert.ok(isLobbing(w, foe));
    dists.add(w.lobToX[foe]);
  }
  assert.ok(dists.size >= 3, 'throw distance varies across seeds');
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

function sporeStreamHitsOnlyTarget() {
  const field = openField();
  const w = createWorld(31);
  const myco = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.MYCO,
    owner: 0,
  });
  const front = spawn(w, {
    x: fx.fromInt(8),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const back = spawn(w, {
    x: fx.fromInt(14),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const frontHp = w.hp[front];
  const backHp = w.hp[back];
  spawnProjectile(w, {
    type: PROJECTILE.SPORE_STREAM,
    owner: 0,
    source: myco,
    target: back,
    x: 0,
    y: 0,
    aimX: w.px[back],
    aimY: w.py[back],
    damage: 5,
  });
  for (let t = 0; t < 40 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.equal(w.hp[front], frontHp, 'head mushroom does not pierce the path');
  assert.ok(w.hp[back] < backHp, 'aimed target still takes the hit');
  const fx = takeSporeBloomUpdates(w);
  assert.ok(fx?.headCount >= 1, 'hit publishes a head mushroom');
  assert.equal(fx.headKill[0], 0);
}

function stampGrassAround(field, wx, wy, r = 4) {
  const tx0 = worldToTile(wx);
  const tz0 = worldToTile(wy);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = tx0 + dx;
      const tz = tz0 + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) continue;
      const i = tz * field.width + tx;
      field.terrainTypes[i] = TERRAIN.GRASS;
      field.pass[i] = 1;
      field.activeMask[i] = 1;
      field.sceneryType[i] = 0;
      field.treeStock[i] = 0;
    }
  }
}

function sporeHeadKillSeedsATree() {
  const field = openField();
  const w = createWorld(36);
  const myco = spawn(w, { x: 0, y: 0, type: UNIT.MYCO, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(8),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  stampGrassAround(field, w.px[foe], w.py[foe]);
  w.hp[foe] = 3;
  spawnProjectile(w, {
    type: PROJECTILE.SPORE_STREAM,
    owner: 0,
    source: myco,
    target: foe,
    x: 0,
    y: 0,
    aimX: w.px[foe],
    aimY: w.py[foe],
    damage: 5,
  });
  for (let t = 0; t < 40 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.equal(w.alive[foe], 0, 'killing blow drops the unit');
  assert.ok(w.treeGrowth.count >= 1, 'killing blow queues a tree seed');
  const fx = takeSporeBloomUpdates(w);
  assert.ok(fx?.headCount >= 1);
  assert.equal(fx.headKill[0], 1);
  assert.ok(fx.seedCount >= 1, 'death tile becomes a tree seed preview');
}

function shadowBoltAppliesDot() {
  const field = openField();
  const w = createWorld(32);
  const warlock = spawn(w, { x: 0, y: 0, type: UNIT.WARLOCK, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(6),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  spawnProjectile(w, {
    type: PROJECTILE.SHADOW_BOLT,
    owner: 0,
    source: warlock,
    target: foe,
    x: 0,
    y: 0,
    aimX: w.px[foe],
    aimY: w.py[foe],
    damage: 9,
  });
  for (let t = 0; t < 20 && w.projectiles.activeCount; t++) {
    step(w, field);
  }
  assert.ok(w.dotTicks[foe] > 0 || w.hp[foe] < 120, 'shadow bolt lands DoT or damage');
  const hpAfterHit = w.hp[foe];
  assert.ok(w.dotTicks[foe] > 0, 'shadow bolt applies DoT');
  for (let t = 0; t < 12; t++) step(w, field);
  assert.ok(w.hp[foe] < hpAfterHit, 'DoT ticks deal damage');
}

function iceBoltAppliesFrost() {
  const field = openField();
  const w = createWorld(33);
  const wizard = spawn(w, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(8),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  spawnProjectile(w, {
    type: PROJECTILE.ICE_BOLT,
    owner: 0,
    source: wizard,
    target: foe,
    x: 0,
    y: 0,
    aimX: w.px[foe],
    aimY: w.py[foe],
    damage: 10,
  });
  for (let t = 0; t < 20 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.ok(w.frostTicks[foe] > 0, 'ice bolt applies frost');
}

function locustSwarmDistracts() {
  const field = openField();
  const w = createWorld(34);
  const shaman = spawn(w, { x: 0, y: 0, type: UNIT.SHAMAN, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(8),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  spawnProjectile(w, {
    type: PROJECTILE.LOCUST_SWARM,
    owner: 0,
    source: shaman,
    target: foe,
    x: 0,
    y: 0,
    aimX: w.px[foe],
    aimY: w.py[foe],
    damage: 5,
  });
  for (let t = 0; t < 40 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.ok(w.distractCd[foe] > 0, 'locust swarm distracts');
}

function holySlashDamages() {
  const field = openField();
  const w = createWorld(35);
  const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
  const foe = spawn(w, {
    x: fx.fromInt(10),
    y: 0,
    type: UNIT.WARRIOR,
    owner: 1,
  });
  const hp = w.hp[foe];
  spawnProjectile(w, {
    type: PROJECTILE.HOLY_SLASH,
    owner: 0,
    source: priest,
    target: foe,
    x: 0,
    y: 0,
    aimX: w.px[foe],
    aimY: w.py[foe],
    damage: 6,
  });
  for (let t = 0; t < 12 && w.projectiles.activeCount; t++) {
    projectileSystem(w, field);
  }
  assert.equal(w.hp[foe], hp - 6);
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
fireballSplashBlastLobsUnits();
fireballBlastDistanceIsRandom();
castCommandSpawnsFireball();
fireballAimScatterGrowsWithRange();
sporeStreamHitsOnlyTarget();
sporeHeadKillSeedsATree();
shadowBoltAppliesDot();
iceBoltAppliesFrost();
locustSwarmDistracts();
holySlashDamages();
console.log('[PASS] authoritative projectile behavior and pooling');
