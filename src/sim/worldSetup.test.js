import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { TINY_MAP_W, SKIRMISH_MAP_W, worldHalfFFromMap } from './field.js';
import {
  SPAWN_BASE_INSET,
  buildWorldFromConfig,
  cornerBases,
  defaultMatchAgoras,
  kothBases,
  laneBases,
  spawnBases,
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
