import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_FIRE_HP_GATE,
  BUILDING_FIRE_SPARK_CHANCE_MAX,
  BUILDING_FIRE_SPARK_CHANCE_MIN,
  createBuildingFire,
  fireWound,
  flameScale,
  heatForWound,
  maxPatchesForType,
  perimeterOffset,
  sparkChanceForWound,
  sparksForWound,
} from './buildingFire.js';

function building(partial = {}) {
  return {
    type: 'camp',
    owner: 1,
    x: 0,
    z: 0,
    yaw: 0,
    built: 1,
    maxHp: 300,
    hp: 300,
    ...partial,
  };
}

function alwaysSpark() {
  return createBuildingFire({ random: () => 0 });
}

function neverSpark() {
  return createBuildingFire({ random: () => 0.999 });
}

function livePatches(fx) {
  const out = [];
  fx.forEachLivePatch((p) => out.push(p));
  return out;
}

describe('building fire wound', () => {
  it('stays dark at or above two-thirds HP', () => {
    assert.equal(fireWound(1), 0);
    assert.equal(fireWound(BUILDING_FIRE_HP_GATE), 0);
    assert.equal(sparkChanceForWound(0), BUILDING_FIRE_SPARK_CHANCE_MIN);
    assert.equal(sparksForWound(0), 1);
  });

  it('ramps chance and patch count as HP falls', () => {
    assert.ok(fireWound(0.3) > fireWound(0.6));
    assert.ok(sparkChanceForWound(1) > sparkChanceForWound(0.2));
    assert.ok(Math.abs(sparkChanceForWound(1) - BUILDING_FIRE_SPARK_CHANCE_MAX) < 1e-9);
    assert.equal(sparksForWound(1), 3);
    assert.ok(heatForWound(1) > heatForWound(0));
    assert.ok(flameScale(1) < 0.8, 'little fires, not socket-torch scale');
  });
});

describe('perimeter sparks', () => {
  it('lands on the footprint edge', () => {
    const hx = 4;
    const hz = 4;
    for (const t of [0, 0.12, 0.25, 0.5, 0.73, 0.99]) {
      const p = perimeterOffset(hx, hz, t);
      const onX = Math.abs(Math.abs(p.x) - hx) < 1e-9;
      const onZ = Math.abs(Math.abs(p.z) - hz) < 1e-9;
      assert.ok(onX || onZ, `t=${t} left the edge`);
    }
  });

  it('gives larger buildings more patch slots', () => {
    assert.ok(maxPatchesForType('camp') < maxPatchesForType('barracks'));
  });
});

describe('createBuildingFire', () => {
  it('does not spark the first time a damaged building is seen', () => {
    const fx = alwaysSpark();
    const sparked = fx.sync([building({ hp: 100 })]);
    assert.equal(sparked.length, 0);
    assert.equal(livePatches(fx).length, 0);
  });

  it('ignores hits while HP is still at or above the gate', () => {
    const fx = alwaysSpark();
    fx.sync([building({ hp: 300 })]);
    const sparked = fx.sync([building({ hp: 220 })]);
    assert.ok(220 / 300 > BUILDING_FIRE_HP_GATE);
    assert.equal(sparked.length, 0);
  });

  it('sometimes sparks after a hit under two-thirds', () => {
    const fx = alwaysSpark();
    fx.sync([building({ hp: 300 })]);
    const sparked = fx.sync([building({ hp: 160 })]);
    assert.ok(sparked.length >= 1);
    assert.ok(livePatches(fx).length >= 1);
    assert.ok(fx.snapshot().buildings[0].heat > 0);
  });

  it('can roll a miss even when the building is eligible', () => {
    const fx = neverSpark();
    fx.sync([building({ hp: 300 })]);
    const sparked = fx.sync([building({ hp: 160 })]);
    assert.equal(sparked.length, 0);
    assert.ok(fx.snapshot().buildings[0].heat > 0, 'the hit still enflames');
  });

  it('skips unfinished paper sites', () => {
    const fx = alwaysSpark();
    fx.sync([building({ built: 0, hp: 1, maxHp: 300 })]);
    const sparked = fx.sync([building({ built: 0, hp: 0, maxHp: 300 })]);
    assert.equal(sparked.length, 0);
  });

  it('does not spark a heal or a hidden hit', () => {
    const fx = alwaysSpark();
    fx.sync([building({ hp: 80 })]);
    assert.equal(fx.sync([building({ hp: 200 })]).length, 0);
    fx.sync([building({ hp: 200 })]);
    const hidden = fx.sync([building({ hp: 80 })], { hidden: () => true });
    assert.equal(hidden.length, 0);
    assert.equal(livePatches(fx).length, 0);
  });

  it('enflames existing patches when hit again at low HP', () => {
    const fx = alwaysSpark();
    fx.sync([building({ hp: 300 })]);
    fx.sync([building({ hp: 160 })]);
    const before = fx.snapshot().buildings[0].heat;
    fx.sync([building({ hp: 40 })]);
    const after = fx.snapshot().buildings[0];
    assert.ok(after.heat >= before);
    assert.ok(after.patches >= 1);
  });

  it('dies back when it is not under attack', () => {
    const fx = alwaysSpark();
    fx.sync([building({ hp: 300 })]);
    fx.sync([building({ hp: 80 })]);
    assert.ok(livePatches(fx).length >= 1);
    for (let i = 0; i < 24; i++) fx.tick(0.5);
    assert.equal(livePatches(fx).length, 0);
    assert.equal(fx.snapshot().buildings[0].heat, 0);
  });
});
