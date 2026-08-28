import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { PROJECTILE } from './projectileTypes.js';
import { spawnProjectile, projectileSystem } from './projectiles.js';
import { step } from './step.js';
import { createBuilding } from './buildings.js';
import { FARM_FIRE_DAMAGE_MUL, pulseFireZoneBuildings } from './buildingCombat.js';
import { createField } from './field.js';
import {
  FIRE_ZONE_DAMAGE,
  FIRE_ZONE_DAMAGE_INTERVAL,
  FIRE_ZONE_TTL,
  fireZoneSystem,
  spawnFireZone,
  takeFireZoneUpdates,
} from './fireZones.js';

function makeArena() {
  const w = createWorld(1);
  const field = createField(1);
  return { w, field };
}

function spawnDamagesUnitsInRadius() {
  const { w } = makeArena();
  const caster = spawn(w, { type: UNIT.WARLOCK, owner: 0, x: 0, y: 0 });
  const foe = spawn(w, {
    type: UNIT.WARRIOR,
    owner: 1,
    x: fx.fromFloat(2),
    y: 0,
  });
  const hpBefore = w.hp[foe];
  spawnFireZone(w, {
    x: fx.fromFloat(0),
    y: fx.fromFloat(0),
    radius: fx.fromFloat(4),
    owner: 0,
    source: caster,
    damage: FIRE_ZONE_DAMAGE,
    friendlyMul: 0,
  });
  // Advance to first damage pulse (ttl % INTERVAL === 0).
  for (let t = 0; t < FIRE_ZONE_DAMAGE_INTERVAL; t++) fireZoneSystem(w);
  assert.ok(w.hp[foe] < hpBefore, 'hostile in zone takes damage');
  assert.equal(w.hp[foe], hpBefore - FIRE_ZONE_DAMAGE);
}

function friendlyFireUsesMultiplier() {
  const { w } = makeArena();
  const caster = spawn(w, { type: UNIT.WARLOCK, owner: 0, x: 0, y: 0 });
  const ally = spawn(w, {
    type: UNIT.WARRIOR,
    owner: 0,
    x: fx.fromFloat(1),
    y: 0,
  });
  const hpBefore = w.hp[ally];
  spawnFireZone(w, {
    x: fx.fromFloat(0),
    y: fx.fromFloat(0),
    radius: fx.fromFloat(4),
    owner: 0,
    source: caster,
    damage: 8,
    friendlyMul: 0.25,
  });
  for (let t = 0; t < FIRE_ZONE_DAMAGE_INTERVAL; t++) fireZoneSystem(w);
  assert.equal(w.hp[ally], hpBefore - 2);
}

function expiresAndPublishes() {
  const { w } = makeArena();
  spawnFireZone(w, {
    x: fx.fromFloat(10),
    y: fx.fromFloat(10),
    radius: fx.fromFloat(3),
    owner: 0,
  });
  const spawnPatch = takeFireZoneUpdates(w);
  assert.ok(spawnPatch);
  assert.equal(spawnPatch.alive[0], 1);
  assert.ok(spawnPatch.ttl[0] > 0);

  for (let t = 0; t < FIRE_ZONE_TTL; t++) fireZoneSystem(w);
  assert.equal(w.fireZones.activeCount, 0);
  const endPatch = takeFireZoneUpdates(w);
  assert.ok(endPatch);
  assert.equal(endPatch.alive[0], 0);
}

function fireballSplashLeavesZone() {
  const { w, field } = makeArena();
  const caster = spawn(w, { type: UNIT.WARLOCK, owner: 0, x: 0, y: 0 });
  spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: 0,
    source: caster,
    target: -1,
    x: fx.fromFloat(0),
    y: fx.fromFloat(0),
    aimX: fx.fromFloat(8),
    aimY: fx.fromFloat(0),
    damage: 12,
  });
  for (let t = 0; t < 120; t++) {
    projectileSystem(w, field);
    if (w.fireZones.activeCount > 0) break;
  }
  assert.ok(w.fireZones.activeCount > 0, 'fireball impact spawns ground fire');
}

function stepWalkThroughDamages() {
  const { w, field } = makeArena();
  const foe = spawn(w, { type: UNIT.WARRIOR, owner: 1, x: 0, y: 0 });
  const hpBefore = w.hp[foe];
  spawnFireZone(w, {
    x: fx.fromFloat(0),
    y: fx.fromFloat(0),
    radius: fx.fromFloat(3),
    owner: 0,
    source: -1,
    friendlyMul: 0,
  });
  for (let t = 0; t < FIRE_ZONE_DAMAGE_INTERVAL; t++) step(w, field, []);
  assert.ok(w.hp[foe] < hpBefore);
}

function burnsFarmsHarderThanOtherBuildings() {
  const { w, field } = makeArena();
  const farm = createBuilding({ owner: 1, type: 'farm', x: 0, z: 0, hp: 200 });
  const camp = createBuilding({ owner: 1, type: 'camp', x: 0, z: 0, hp: 200 });
  const allyFarm = createBuilding({ owner: 0, type: 'farm', x: 0, z: 0, hp: 200 });
  w.buildings.push(farm, camp, allyFarm);
  spawnFireZone(w, {
    x: fx.fromFloat(0),
    y: fx.fromFloat(0),
    radius: fx.fromFloat(4),
    owner: 0,
    source: -1,
    damage: FIRE_ZONE_DAMAGE,
    friendlyMul: 0,
  });
  for (let t = 0; t < FIRE_ZONE_DAMAGE_INTERVAL; t++) {
    fireZoneSystem(w);
    pulseFireZoneBuildings(w, field);
  }
  assert.equal(farm.hp, 200 - FIRE_ZONE_DAMAGE * FARM_FIRE_DAMAGE_MUL, 'farm burns faster');
  assert.equal(camp.hp, 200 - FIRE_ZONE_DAMAGE, 'other buildings take base fire pulse');
  assert.equal(allyFarm.hp, 200 - FIRE_ZONE_DAMAGE * FARM_FIRE_DAMAGE_MUL, 'friendly farm burns too');
}

spawnDamagesUnitsInRadius();
friendlyFireUsesMultiplier();
expiresAndPublishes();
fireballSplashLeavesZone();
stepWalkThroughDamages();
burnsFarmsHarderThanOtherBuildings();
console.log('fireZones.test.js: ok');
