import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { castIndexFromUnits, findNamedUnit, mergeStoryParty, normalizeSpeaker, storyPartyPlacements, unitsFromCast } from './cast.js';

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

  it('lays the four heroes in a diamond and moves them instead of duplicating', () => {
    const placed = storyPartyPlacements(40, 40, 80, 80, 0);
    assert.deepEqual(placed.map((u) => u.name), ['Stumpey', 'Goblin', 'Idra', 'Doc']);
    assert.deepEqual(placed.map((u) => [u.tx, u.tz]), [[40, 41], [37, 41], [40, 39], [43, 39]]);
    const row = storyPartyPlacements(40, 40, 80, 80, 0, 'row');
    assert.deepEqual(row.map((u) => u.name), ['Stumpey', 'Goblin', 'Idra', 'Doc']);
    assert.deepEqual(row.map((u) => u.tz), [40, 40, 40, 40]);
    assert.deepEqual(row.map((u) => u.tx), [34, 38, 42, 46]);
    const again = mergeStoryParty(
      [{ owner: 1, type: 1, name: 'Stumpey', tx: 2, tz: 2, x: 9, z: 9 }, { owner: 0, type: 1, name: 'Scout', tx: 1, tz: 1 }],
      placed,
    );
    assert.equal(again.length, 5);
    assert.equal(again[0].tx, 40);
    assert.equal(again[0].tz, 41);
    assert.equal(again[0].x, undefined);
    assert.equal(again[1].name, 'Scout');
  });
});
