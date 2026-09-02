import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { castIndexFromUnits, findNamedUnit, normalizeSpeaker, unitsFromCast } from './cast.js';

describe('story cast', () => {
  it('matches speakers to named garden units', () => {
    const units = unitsFromCast([
      { name: 'Stumpey', type: 5, tx: 30, tz: 44 },
      { name: 'Doc', type: 6, tx: 33, tz: 42 },
    ]);
    assert.equal(findNamedUnit(units, 'stumpey').type, 5);
    assert.equal(findNamedUnit(units, 'DOC').tx, 33);
    assert.equal(findNamedUnit(units, ''), null);
    assert.deepEqual(castIndexFromUnits(units).map((c) => c.name), ['Stumpey', 'Doc']);
    assert.equal(normalizeSpeaker(' Lady '), 'lady');
  });
});
