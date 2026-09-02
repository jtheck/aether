import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { createField, worldToTile } from './field.js';
import { growTreeAt } from './trees.js';
import { getBuildTime } from './buildings.js';
import { PATH_STYLE } from './path.js';
import {
  VILLAGER_WANDER_PERIOD,
  VILLAGER_WANDER_MAX_F,
  MYCO_WANDER_MIN_F,
  ENGINEER_WANDER_PERIOD,
  IDLE_WANDER_SPEED,
} from './idleWander.js';

function openField(seed) {
  const field = createField(seed);
  field.pass.fill(1);
  return field;
}

function site(type, xF, zF, owner = 0) {
  return {
    owner,
    type,
    x: fx.fromFloat(xF),
    z: fx.fromFloat(zF),
    yaw: 0,
    built: 1,
    buildProgress: 1,
    buildTime: getBuildTime(type),
    hp: 200,
    maxHp: 200,
  };
}

function waitForMove(field, w, id, maxTicks) {
  for (let t = 0; t < maxTicks; t++) {
    step(w, field, []);
    if (w.order[id] === ORDER.WANDER && w.hasTarget[id]) return t;
  }
  return -1;
}

function idleVillagerAmbles() {
  const field = openField(1);
  const w = createWorld(1);
  const vill = spawn(w, { x: 0, y: 0, type: UNIT.VILLAGER, owner: 0 });
  const t = waitForMove(field, w, vill, VILLAGER_WANDER_PERIOD + 8);
  assert.ok(t >= 0, 'idle villager eventually picks a heading');
  const d2 = fx.dist2(w.px[vill], w.py[vill], w.tx[vill], w.ty[vill]);
  assert.ok(d2 > 0, 'wander dest is away from the start');
  for (let k = 0; k < 8; k++) step(w, field, []);
  const spd = fx.toFloat(fx.len(w.vx[vill], w.vy[vill]));
  assert.ok(spd <= fx.toFloat(IDLE_WANDER_SPEED) + 0.05, `amble is a stroll (${spd.toFixed(2)}), not a sprint`);
}

function idleMycoAmblesFarther() {
  const field = openField(2);
  const w = createWorld(2);
  const myco = spawn(w, { x: 0, y: 0, type: UNIT.MYCO, owner: 0 });
  const t = waitForMove(field, w, myco, VILLAGER_WANDER_PERIOD + 8);
  assert.ok(t >= 0, 'idle myco eventually wanders');
  const dist = fx.toFloat(fx.len(w.tx[myco] - w.px[myco], w.ty[myco] - w.py[myco]));
  assert.ok(
    dist >= MYCO_WANDER_MIN_F - 2,
    `myco walk is a long hop (${dist.toFixed(1)} wu), not a villager amble`,
  );
  assert.ok(dist > VILLAGER_WANDER_MAX_F, 'myco spread beats villager max');
}

function idleEngineerWalksToAnotherBuilding() {
  const field = openField(3);
  const w = createWorld(3);
  w.buildings = [site('camp', 0, 0), site('village', 40, 0)];
  const eng = spawn(w, { x: fx.fromFloat(2), y: 0, type: UNIT.ENGINEER, owner: 0 });
  const t = waitForMove(field, w, eng, ENGINEER_WANDER_PERIOD + 8);
  assert.ok(t >= 0, 'idle engineer eventually leaves the post');
  const dCamp = fx.dist2(w.tx[eng], w.ty[eng], w.buildings[0].x, w.buildings[0].z);
  const dVill = fx.dist2(w.tx[eng], w.ty[eng], w.buildings[1].x, w.buildings[1].z);
  assert.ok(dVill < dCamp, 'hop aims at the other building, not the one they stood on');
}

function idleMycoAimsAtTrees() {
  const field = openField(5);
  const ox = worldToTile(0);
  const oz = worldToTile(0);
  for (let dx = 2; dx <= 22; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      growTreeAt(field, (oz + dz) * field.width + (ox + dx), 40);
    }
  }
  const w = createWorld(5);
  const myco = spawn(w, { x: 0, y: 0, type: UNIT.MYCO, owner: 0 });
  const t = waitForMove(field, w, myco, VILLAGER_WANDER_PERIOD + 8);
  assert.ok(t >= 0, 'idle myco eventually wanders');
  assert.equal(w.pathSlowAware[myco], PATH_STYLE.TREE_SEEK, 'wander uses tree-seeking A*');
  assert.ok(w.tx[myco] > w.px[myco], 'heading prefers the eastern grove');
}

function wanderDoesNotBlockAssign() {
  const field = openField(4);
  const w = createWorld(4);
  growTreeAt(field, worldToTile(0) * field.width + worldToTile(fx.fromFloat(8)), 80);
  w.buildings = [site('camp', 0, 0)];
  const vill = spawn(w, { x: fx.fromFloat(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
  for (let t = 0; t < 40; t++) step(w, field, []);
  assert.equal(w.order[vill], ORDER.GATHER, 'nearby idle villager still gets camp work');
}

idleVillagerAmbles();
idleMycoAmblesFarther();
idleMycoAimsAtTrees();
idleEngineerWalksToAnotherBuilding();
wanderDoesNotBlockAssign();
console.log('idleWander.test.js: ok (villager + myco + engineer + assign)');
