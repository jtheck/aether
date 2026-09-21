import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAVE_DEFAULT_COUNT,
  WAVE_ROUTE_MAX,
  appendWaveHop,
  collectWaveParams,
  listWaveHops,
  popWaveHop,
  tileToWaveFrac,
  waveFracToTile,
  waveTargetObjective,
} from './waveRoute.js';

describe('forge wave route', () => {
  it('roundtrips tiles through the same frac the sim spawners use', () => {
    const w = 80;
    const h = 80;
    for (const [tx, tz] of [[0, 0], [40, 16], [79, 79], [31, 32]]) {
      const [fx, fz] = tileToWaveFrac(tx, tz, w, h);
      assert.deepEqual(waveFracToTile(fx, fz, w, h), { tx, tz });
    }
  });

  it('omits params until waves or hops exist, and fills a default count from hops', () => {
    assert.equal(collectWaveParams({}), null);
    assert.deepEqual(collectWaveParams({ waves: 3, era: 1 }), { waves: 3, era: 1 });
    assert.deepEqual(
      collectWaveParams({ route: [[0.5, 0.7]] }),
      { waves: WAVE_DEFAULT_COUNT, route: [[0.5, 0.7]] },
    );
  });

  it('caps hops and prefers the latest wave-armed zone', () => {
    const hop = [0.2, 0.3];
    const a = { id: 'a', params: { waves: 2 } };
    const b = { id: 'b' };
    assert.equal(waveTargetObjective([a, b]), a);
    assert.equal(appendWaveHop(a, hop), true);
    assert.equal(appendWaveHop(a, [0.4, 0.4]), true);
    assert.equal(appendWaveHop(a, [0.6, 0.6]), true);
    assert.equal(appendWaveHop(a, [0.8, 0.8]), false);
    assert.equal(a.params.route.length, WAVE_ROUTE_MAX);
    assert.equal(popWaveHop(a), true);
    assert.equal(a.params.route.length, 2);
    assert.deepEqual(listWaveHops([a], [[0.1, 0.1]]), [...a.params.route, [0.1, 0.1]]);
  });

  it('arms a zone when the first hop lands on it', () => {
    const obj = { id: 'ridge' };
    assert.equal(appendWaveHop(obj, [0.5, 0.7], { waves: 4, era: 1 }), true);
    assert.equal(obj.params.waves, 4);
    assert.equal(obj.params.era, 1);
  });
});
