import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFieldSize, ladderMatchDeal, ladderOfficialMaps, ladderPadsPlayable } from './ladderMap.js';

describe('ladder map', () => {
  it('rotates tiny and the next two boards from the queue seed', () => {
    assert.equal(ladderFieldSize(0), 'tiny');
    assert.equal(ladderFieldSize(1), 'small');
    assert.equal(ladderFieldSize(2), 'medium');
    assert.equal(ladderFieldSize(3), 'tiny');
  });

  it('rotates teams from the default board through the next two sizes', () => {
    assert.equal(ladderFieldSize(0, 'teams'), 'small');
    assert.equal(ladderFieldSize(1, 'teams'), 'medium');
    assert.equal(ladderFieldSize(2, 'teams'), 'large');
    assert.equal(ladderFieldSize(3, 'teams'), 'small');
  });

  it('gives each official map and each auto size one slot', () => {
    const maps = [
      { id: '/maps/skirmish/ford.garden', name: 'Ford', spawns: 2, mapType: 'skirmish' },
      { id: '/maps/skirmish/bowl.garden', name: 'Knife Bowl', spawns: 4, mapType: 'skirmish' },
      { id: '/maps/skirmish/hill.garden', name: 'Hill', spawns: 5, mapType: 'koth' },
    ];
    const seen = new Map();
    for (let seed = 0; seed < 5; seed++) {
      const deal = ladderMatchDeal(seed, 'onevsone', maps);
      const key = deal.chapter || `auto:${deal.fieldSize}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    assert.deepEqual([...seen.keys()], [
      '/maps/skirmish/ford.garden',
      '/maps/skirmish/bowl.garden',
      'auto:tiny',
      'auto:small',
      'auto:medium',
    ]);
    assert.equal(ladderMatchDeal(0, 'onevsone', maps).mapName, 'Ford');
    assert.equal(ladderOfficialMaps(maps, 'teams').map((row) => row.name).join(), 'Knife Bowl');
    const teams = ladderMatchDeal(0, 'teams', maps);
    assert.equal(teams.mapName, 'Knife Bowl');
    assert.equal(ladderMatchDeal(1, 'teams', maps).fieldSize, 'small');
  });

  it('rejects a start stranded on the agora and keeps that board size', () => {
    assert.equal(ladderPadsPlayable(45, 'tiny'), false);
    const deal = ladderMatchDeal(45);
    assert.equal(deal.fieldSize, 'tiny');
    assert.notEqual(deal.seed, 45);
    assert.equal(ladderPadsPlayable(deal.seed, deal.fieldSize), true);
  });
});
