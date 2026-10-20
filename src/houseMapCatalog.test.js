import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customMapSelectOptions } from './app/lobbyUi.js';
import { gardenUrlForChapter } from './lobby/modes.js';
import { houseMapGardenUrl, lobbyOptionsFromHouseIndex } from './houseMapCatalog.js';

describe('house map catalog', () => {
  it('builds lobby options from index.json', () => {
    const opts = lobbyOptionsFromHouseIndex('1v1', {
      maps: [
        { file: 'a.garden', name: 'Alpha', mapType: 'onevsone' },
        { file: 'b.garden', name: 'Teams only', mapType: 'teams' },
      ],
    }, 'onevsone');
    assert.deepEqual(opts, [{
      id: '/maps/1v1/a.garden',
      name: 'Alpha',
      group: 'Official',
      mapType: 'onevsone',
    }]);
  });

  it('passes house map URLs through gardenUrlForChapter', () => {
    assert.equal(gardenUrlForChapter('/maps/teams/arena.garden'), '/maps/teams/arena.garden');
  });

  it('lists official maps before workshop in the picker', () => {
    const official = [{ id: '/maps/1v1/island.garden', name: 'Paradise Island', mapType: 'onevsone' }];
    const opts = customMapSelectOptions([
      { id: '10', title: 'Duel', gardens: [{ file: 'map.garden', name: 'Duel', mapType: 'onevsone' }] },
    ], '', [], 'onevsone', official);
    assert.equal(opts[0].id, '/maps/1v1/island.garden');
    assert.equal(opts[1].name, 'Duel');
  });

  it('rejects unsafe garden paths', () => {
    assert.equal(houseMapGardenUrl('1v1', '../secret.garden'), '');
  });
});
