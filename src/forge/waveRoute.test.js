import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAVE_DEFAULT_COUNT,
  WAVE_ROUTE_MAX,
  appendWaveHop,
  collectWaveParams,
  listWaveHops,
  popWaveHop,
  removeWaveHopAt,
  replaceWaveHop,
  setZoneAllies,
  setZoneEra,
  setZoneKind,
  setZoneParam,
  setZoneTerminal,
  setZoneWaves,
  tileToWaveFrac,
  zoneTriggerSpec,
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

  it('edits a hop and the zone count in place', () => {
    const obj = { id: 'gate', params: { waves: 2, era: 1, route: [[0.2, 0.2], [0.4, 0.4]] } };
    assert.equal(replaceWaveHop(obj, 1, [0.6, 0.7]), true);
    assert.deepEqual(obj.params.route[1], [0.6, 0.7]);
    assert.equal(removeWaveHopAt(obj, 0), true);
    assert.equal(obj.params.route.length, 1);
    setZoneWaves(obj, 0);
    assert.equal(obj.params.waves, undefined);
    setZoneEra(obj, 5);
    assert.equal(obj.params.era, 5);
    setZoneEra(obj, 0);
    assert.equal(obj.params.era, undefined);
  });

  it('arms a zone when the first hop lands on it', () => {
    const obj = { id: 'ridge' };
    assert.equal(appendWaveHop(obj, [0.5, 0.7], { waves: 4, era: 1 }), true);
    assert.equal(obj.params.waves, 4);
    assert.equal(obj.params.era, 1);
  });

  it('flags a zone as the chapter ending, and locks escape and advance on', () => {
    const hold = { kind: 'hold' };
    setZoneTerminal(hold, true);
    assert.equal(hold.terminal, true);
    setZoneTerminal(hold, false);
    assert.equal(hold.terminal, undefined);
    const exit = { kind: 'reach', params: { escort: 'Wagon', waves: 2 } };
    setZoneKind(exit, 'escape');
    assert.equal(exit.kind, 'escape');
    assert.equal(exit.terminal, true);
    assert.equal(exit.params.escort, undefined);
    assert.equal(exit.params.waves, 2);
    setZoneTerminal(exit, false);
    assert.equal(exit.terminal, true);
    setZoneKind(exit, 'reach');
    assert.equal(exit.terminal, undefined);
  });

  it('stores escort, choice, and clock params, and drops blanks so the match default applies', () => {
    const zone = { kind: 'escort', params: { waves: 2 } };
    setZoneParam(zone, 'escort', 'Wagon');
    assert.equal(zone.params.escort, 'Wagon');
    assert.equal(zone.params.waves, 2);
    setZoneParam(zone, 'escort', '');
    assert.equal(zone.params.escort, undefined);
    assert.equal(zone.params.waves, 2);
    setZoneParam(zone, 'seconds', 45);
    assert.equal(zone.params.seconds, 45);
    setZoneParam(zone, 'seconds', null);
    assert.equal(zone.params.seconds, undefined);
    assert.equal(zoneTriggerSpec('choice').fields.some((f) => f.param === 'branch'), true);
    assert.equal(zoneTriggerSpec('race').fields.some((f) => f.param === 'failMessage'), true);
  });

  it('writes one allied reinforcement and clears it when the group count is zero', () => {
    const zone = { kind: 'survive' };
    setZoneAllies(zone, {
      from: [0.2, 0.8],
      to: [0.5, 0.3],
      waves: 2,
      count: 4,
      delay: 5,
      interval: 14,
    });
    assert.deepEqual(zone.params.allies, [{
      from: [0.2, 0.8],
      to: [0.5, 0.3],
      waves: 2,
      count: 4,
      delay: 5,
      interval: 14,
    }]);
    setZoneAllies(zone, { from: [0.2, 0.8], to: [0.5, 0.3], waves: 0 });
    assert.equal(zone.params, undefined);
  });
});
