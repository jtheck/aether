import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn, ORDER } from './world.js';
import { applyCommands, CMD } from './commands.js';
import { grantStartingResources } from './resources.js';
import { buildField, isPassable } from './field.js';
import * as fx from './fixed.js';
import {
  applyStructureOccupancyAt,
  buildingFootprintBounds,
  createBuilding,
  snapBuildingWorld,
} from './buildings.js';
import { combatSystem } from './combat.js';
import { step } from './step.js';
import { UNIT } from './unitTypes.js';
import { PROJECTILE } from './projectileTypes.js';
import { TOWER_ATTACK_COOLDOWN, TOWER_ATTACK_RANGE_F } from './towerCombat.js';

function richWorld(seed) {
  const w = createWorld(seed);
  grantStartingResources(w, 0, { wood: 5000, stone: 5000, mineral: 5000, food: 5000 });
  grantStartingResources(w, 1, { wood: 5000, stone: 5000, mineral: 5000, food: 5000 });
  return w;
}

function placeFinished(w, field, opts) {
  const snapped = snapBuildingWorld(opts.type, fx.fromFloat(opts.x), fx.fromFloat(opts.z));
  const b = createBuilding({
    owner: opts.owner,
    type: opts.type,
    x: fx.toFloat(snapped.x),
    z: fx.toFloat(snapped.z),
    hp: opts.hp,
  });
  b.built = 1;
  w.buildings.push(b);
  applyStructureOccupancyAt(field, b.type, b.x, b.z, true);
  return w.buildings.length - 1;
}

describe('building combat', () => {
  it('ATTACK command locks onto a hostile building and flashes via targetBuilding', () => {
    const w = richWorld(3);
    const field = buildField(3, { width: 64, height: 64 });
    const bi = placeFinished(w, field, { owner: 1, type: 'camp', x: 20, z: 20 });
    const warrior = spawn(w, {
      x: fx.fromInt(8),
      y: fx.fromInt(20),
      type: UNIT.WARRIOR,
      owner: 0,
    });
    applyCommands(w, field, [
      { type: CMD.ATTACK, entities: [warrior], target: -1, buildingIndex: bi },
    ]);
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.targetEntity[warrior], -1);
    assert.equal(w.targetBuilding[warrior], bi);
  });

  it('melee swings damage a building and ruin clears occupancy without splicing', () => {
    const w = richWorld(4);
    const field = buildField(4, { width: 64, height: 64 });
    const bi = placeFinished(w, field, { owner: 1, type: 'barracks', x: 24, z: 24, hp: 10 });
    const b = w.buildings[bi];
    const bounds = buildingFootprintBounds(b.type, b.x, b.z);
    const tile = { tx: bounds.x0, tz: bounds.z0 };
    assert.equal(isPassable(field, tile.tx, tile.tz), false);

    const warrior = spawn(w, {
      x: b.x + fx.fromInt(6),
      y: b.z,
      type: UNIT.WARRIOR,
      owner: 0,
    });
    applyCommands(w, field, [
      { type: CMD.ATTACK, entities: [warrior], target: -1, buildingIndex: bi },
    ]);
    for (let t = 0; t < 40; t++) step(w, field);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.buildings[bi].hp, 0);
    assert.equal(isPassable(field, tile.tx, tile.tz), true);
    assert.equal(w.targetBuilding[warrior], -1);
  });

  it('ranged attack damages a building after travel', () => {
    const w = richWorld(5);
    const field = buildField(5, { width: 64, height: 64 });
    field.pass.fill(1);
    const bi = placeFinished(w, field, { owner: 1, type: 'tower', x: 16, z: 0, hp: 40 });
    const startHp = w.buildings[bi].hp;
    const archer = spawn(w, {
      x: fx.fromInt(0),
      y: fx.fromInt(0),
      type: UNIT.ARCHER,
      owner: 0,
    });
    step(w, field, [{ type: CMD.ATTACK, entities: [archer], target: -1, buildingIndex: bi }]);
    assert.equal(w.buildings[bi].hp, startHp, 'ranged damage must not be instant');
    assert.ok(w.projectiles.activeCount >= 1);
    for (let t = 0; t < 24; t++) step(w, field);
    assert.ok(w.buildings[bi].hp < startHp);
  });

  it('idle military auto-acquires a nearby hostile building', () => {
    const w = richWorld(6);
    const field = buildField(6, { width: 64, height: 64 });
    const bi = placeFinished(w, field, { owner: 1, type: 'camp', x: 12, z: 0 });
    const warrior = spawn(w, {
      x: fx.fromInt(0),
      y: fx.fromInt(0),
      type: UNIT.WARRIOR,
      owner: 0,
    });
    assert.equal(w.order[warrior], ORDER.IDLE);
    for (let t = 0; t < 8; t++) {
      combatSystem(w, field);
      w.tick++;
    }
    assert.equal(w.order[warrior], ORDER.ATTACK);
    assert.equal(w.targetBuilding[warrior], bi);
    assert.equal(w.targetEntity[warrior], -1);
  });

  it('finished towers fire arrows at hostiles in range', () => {
    const w = richWorld(7);
    const field = buildField(7, { width: 64, height: 64 });
    field.pass.fill(1);
    placeFinished(w, field, { owner: 0, type: 'tower', x: 0, z: 0 });
    const foe = spawn(w, {
      x: fx.fromFloat(20),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    const hp = w.hp[foe];
    step(w, field);
    assert.ok(w.projectiles.activeCount >= 1, 'tower loosed an arrow');
    let arrow = -1;
    for (let s = 0; s < w.projectiles.highWater; s++) {
      if (w.projectiles.alive[s] && w.projectiles.type[s] === PROJECTILE.ARROW) {
        arrow = s;
        break;
      }
    }
    assert.ok(arrow >= 0);
    assert.equal(w.projectiles.source[arrow], -1);
    assert.equal(w.projectiles.target[arrow], foe);
    assert.equal(w.projectiles.owner[arrow], 0);
    assert.equal(w.hp[foe], hp, 'arrow damage waits for travel');
    for (let t = 0; t < 24; t++) step(w, field);
    assert.ok(w.hp[foe] < hp, 'arrow eventually hits');
  });

  it('construction-site towers do not fire', () => {
    const w = richWorld(8);
    const field = buildField(8, { width: 64, height: 64 });
    field.pass.fill(1);
    const bi = placeFinished(w, field, { owner: 0, type: 'tower', x: 0, z: 0 });
    w.buildings[bi].built = 0;
    spawn(w, { x: fx.fromFloat(12), y: 0, type: UNIT.WARRIOR, owner: 1 });
    step(w, field);
    assert.equal(w.projectiles.activeCount, 0);
  });

  it('towers ignore hostiles past their reach', () => {
    const w = richWorld(9);
    const field = buildField(9, { width: 64, height: 64 });
    field.pass.fill(1);
    placeFinished(w, field, { owner: 0, type: 'tower', x: 0, z: 0 });
    spawn(w, {
      x: fx.fromFloat(TOWER_ATTACK_RANGE_F + 8),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    step(w, field);
    assert.equal(w.projectiles.activeCount, 0);
    assert.equal(w.buildings[0].attackCd | 0, 0);
  });

  it('towers wait out their attack cooldown before firing again', () => {
    const w = richWorld(10);
    const field = buildField(10, { width: 64, height: 64 });
    field.pass.fill(1);
    placeFinished(w, field, { owner: 0, type: 'tower', x: 0, z: 0 });
    spawn(w, { x: fx.fromFloat(16), y: 0, type: UNIT.WARRIOR, owner: 1 });
    step(w, field);
    const afterFirst = w.projectiles.activeCount;
    assert.ok(afterFirst >= 1);
    step(w, field);
    assert.equal(w.projectiles.activeCount, afterFirst, 'still on cooldown');
    assert.ok((w.buildings[0].attackCd | 0) > 0);
    assert.ok((w.buildings[0].attackCd | 0) < TOWER_ATTACK_COOLDOWN);
  });
});
