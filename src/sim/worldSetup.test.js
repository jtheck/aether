import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { TINY_MAP_W, SKIRMISH_MAP_W, worldHalfFFromMap } from './field.js';
import { UNIT } from './unitTypes.js';
import {
  SPAWN_BASE_INSET,
  STRESS_ARMY_COUNT,
  STRESS_MENU_PER_SIDE,
  STRESS_RING_INNER_FRAC,
  buildWorldFromConfig,
  cornerBases,
  defaultMatchAgoras,
  kothBases,
  laneBases,
  spawnBases,
  stressSliceMidAngle,
  usesCornerSpawnBases,
} from './worldSetup.js';

describe('spawn bases', () => {
  it('uses the side-midline intersection for tiny-map corners', () => {
    const half = worldHalfFFromMap(TINY_MAP_W);
    const m = half * SPAWN_BASE_INSET;
    const corners = cornerBases(half);
    assert.deepEqual(corners[0], [-m, -m]);
    assert.deepEqual(corners[1], [m, m]);
    assert.equal(Math.abs(corners[0][0]), Math.abs(kothBases(half)[0][0]));
    assert.ok(Math.abs(corners[0][0]) < half);
    assert.ok(usesCornerSpawnBases(TINY_MAP_W));
    assert.equal(usesCornerSpawnBases(SKIRMISH_MAP_W), false);
  });

  it('picks corners on tiny and sides on larger 1v1 boards', () => {
    const tinyHalf = worldHalfFFromMap(TINY_MAP_W);
    const smallHalf = worldHalfFFromMap(SKIRMISH_MAP_W);
    assert.deepEqual(spawnBases(tinyHalf, { mapW: TINY_MAP_W }), cornerBases(tinyHalf));
    assert.deepEqual(spawnBases(smallHalf, { mapW: SKIRMISH_MAP_W }), kothBases(smallHalf));
    assert.deepEqual(
      spawnBases(tinyHalf, { laneBases: true, mapW: TINY_MAP_W }),
      laneBases(tinyHalf),
    );
  });

  it('places tiny skirmish agoras in opposite corners facing center', () => {
    const w = buildWorldFromConfig({
      seed: 1,
      mode: 'skirmish',
      mapW: TINY_MAP_W,
      mapH: TINY_MAP_W,
      activeSlots: [0, 1],
    });
    const half = worldHalfFFromMap(TINY_MAP_W);
    const expected = defaultMatchAgoras(half, TINY_MAP_W);
    assert.equal(w.agoras.length, 2);
    assert.equal(fx.toFloat(w.agoras[0].x), expected[0].x);
    assert.equal(fx.toFloat(w.agoras[0].z), expected[0].z);
    assert.equal(fx.toFloat(w.agoras[1].x), expected[1].x);
    assert.equal(fx.toFloat(w.agoras[1].z), expected[1].z);
    assert.ok(expected[0].x < 0 && expected[0].z < 0);
    assert.ok(expected[1].x > 0 && expected[1].z > 0);
  });
});

const STRESS_SUPPORT = new Set([
  UNIT.VILLAGER,
  UNIT.ENGINEER,
  UNIT.WAGON,
  UNIT.DIRIGIBLE,
  UNIT.APC,
]);

function livingOf(w, owner) {
  const ids = [];
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.owner[i] === owner) ids.push(i);
  }
  return ids;
}

function radiusOf(w, i) {
  return Math.hypot(fx.toFloat(w.px[i]), fx.toFloat(w.py[i]));
}

function angleOf(w, i) {
  return Math.atan2(fx.toFloat(w.py[i]), fx.toFloat(w.px[i]));
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

describe('stress pie ring', () => {
  it('keeps the menu default at 1000 per player', () => {
    assert.equal(STRESS_MENU_PER_SIDE, 1000);
    assert.equal(STRESS_ARMY_COUNT, 5);
  });

  it('lays five slices: inner monks, combat mass, support behind', () => {
    const perSide = 80;
    const w = buildWorldFromConfig({ seed: 0x57e55, stressPerSide: perSide });
    assert.equal(w.count, perSide * STRESS_ARMY_COUNT);
    const half = w.worldHalfF;
    const innerMin = half * STRESS_RING_INNER_FRAC * 0.85;

    for (let owner = 0; owner < STRESS_ARMY_COUNT; owner++) {
      const ids = livingOf(w, owner);
      assert.equal(ids.length, perSide);
      const rows = ids.map((i) => ({ i, r: radiusOf(w, i), t: w.type[i] }));
      rows.sort((a, b) => a.r - b.r);
      assert.ok(rows[0].r > innerMin, `owner ${owner} starts too close to origin`);

      const innerR = rows[0].r;
      const innerRank = rows.filter((u) => u.r < innerR + 2);
      assert.ok(innerRank.length >= 1);
      assert.ok(innerRank.every((u) => u.t === UNIT.MONK), `owner ${owner} inner rank is not monks`);

      const support = rows.filter((u) => STRESS_SUPPORT.has(u.t));
      assert.equal(support.length, STRESS_SUPPORT.size);
      const types = new Set(support.map((u) => u.t));
      assert.equal(types.size, STRESS_SUPPORT.size);
      const maxFront = Math.max(...rows.filter((u) => !STRESS_SUPPORT.has(u.t)).map((u) => u.r));
      assert.ok(support.every((u) => u.r > maxFront + 8), `owner ${owner} support is not behind the ring`);

      const mid = stressSliceMidAngle(owner);
      const halfSlice = Math.PI / STRESS_ARMY_COUNT;
      for (const u of rows) {
        assert.ok(
          angDiff(angleOf(w, u.i), mid) < halfSlice,
          `owner ${owner} unit left its pie slice`,
        );
      }

      const combat = rows.filter((u) => u.t !== UNIT.MONK && !STRESS_SUPPORT.has(u.t));
      assert.ok(combat.length > 0);
      assert.ok(combat.every((u) => u.t !== UNIT.MONK));
    }
  });

  it('spawns 1000 units per player for the menu default', () => {
    const w = buildWorldFromConfig({ seed: 1, stressPerSide: STRESS_MENU_PER_SIDE });
    assert.equal(w.count, STRESS_MENU_PER_SIDE * STRESS_ARMY_COUNT);
    for (let owner = 0; owner < STRESS_ARMY_COUNT; owner++) {
      assert.equal(livingOf(w, owner).length, STRESS_MENU_PER_SIDE);
    }
  });
});
