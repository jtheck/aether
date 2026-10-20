import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchStatOwners, matchStatRows } from './matchStats.js';

describe('match stat rows', () => {
  it('lists the seats of a match and falls back to anyone with a tally', () => {
    const stats = [
      { kills: 3, losses: 1, trained: 4, razes: 1, buildingsLost: 0, gathered: 80, spent: 40 },
      { kills: 0, losses: 2, trained: 0, razes: 0, buildingsLost: 1, gathered: 10, spent: 0 },
    ];
    const rows = matchStatRows(stats, [1, 0, 0]);
    assert.deepEqual(rows.map((row) => row.owner), [1, 0]);
    assert.equal(rows[1].kills, 3);
    assert.equal(rows[0].buildingsLost, 1);

    const only = matchStatRows([null, { kills: 2, losses: 0, trained: 0, razes: 0, buildingsLost: 0, gathered: 0, spent: 0 }], null);
    assert.deepEqual(only.map((row) => row.owner), [1]);
  });

  it('reads humans, AI, and a living hill', () => {
    assert.deepEqual(matchStatOwners({
      humanPlayers: [0],
      aiPlayers: [{ owner: 2 }],
      koth: { active: [1, 1, 0, 0, 0] },
    }), [0, 2, 1]);
  });
});
