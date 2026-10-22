import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customMapSelectOptions } from './app/lobbyUi.js';
import { gardenUrlForChapter } from './lobby/modes.js';
import { houseMapGardenUrl, lobbyOptionsFromHouseIndex } from './houseMapCatalog.js';
import { decodeGarden } from './sim/garden.js';

const mapsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'maps');

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
    assert.equal(gardenUrlForChapter('/maps/teams/divide.garden'), '/maps/teams/divide.garden');
  });

  it('decodes every official 1v1 and teams garden', () => {
    for (const dir of ['1v1', 'teams']) {
      const index = JSON.parse(readFileSync(join(mapsRoot, dir, 'index.json'), 'utf8'));
      assert.ok(index.maps.length >= 1);
      for (const row of index.maps) {
        const data = JSON.parse(readFileSync(join(mapsRoot, dir, row.file), 'utf8'));
        const garden = decodeGarden(data);
        assert.equal(garden.name, row.name);
        assert.equal(garden.mapType, row.mapType);
        assert.equal(garden.terrainTypes.length, garden.width * garden.height);
      }
    }
  });

  it('lists official maps before workshop in the picker', () => {
    const official = [{ id: '/maps/1v1/ford.garden', name: 'The Ford', mapType: 'onevsone' }];
    const opts = customMapSelectOptions([
      { id: '10', title: 'Duel', gardens: [{ file: 'map.garden', name: 'Duel', mapType: 'onevsone' }] },
    ], '', [], 'onevsone', official);
    assert.equal(opts[0].id, '/maps/1v1/ford.garden');
    assert.equal(opts[1].name, 'Duel');
  });

  it('rejects unsafe garden paths', () => {
    assert.equal(houseMapGardenUrl('1v1', '../secret.garden'), '');
  });
});
