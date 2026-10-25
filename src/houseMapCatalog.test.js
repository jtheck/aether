import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customMapSelectOptions } from './app/lobbyUi.js';
import { gardenUrlForChapter } from './lobby/modes.js';
import { gardenLobbyFields, houseMapGardenUrl, lobbyOptionsFromHouseIndex, spawnsFitLobby } from './houseMapCatalog.js';
import { readSkirmishCatalog } from './mapsResolve.js';
import { decodeGarden } from './sim/garden.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapsRoot = join(repoRoot, 'maps');

describe('house map catalog', () => {
  const index = {
    maps: [
      { file: 'a.garden', name: 'Alpha', spawns: 2 },
      { file: 'b.garden', name: 'Lanes', spawns: 4 },
      { file: 'c.garden', name: 'Hill', spawns: 5, mapType: 'koth' },
      { file: 'd.garden', name: 'Bare', spawns: 0 },
    ],
  };

  it('lists every map with two or more starts in 1v1', () => {
    assert.equal(spawnsFitLobby(0, 'onevsone'), false);
    assert.equal(spawnsFitLobby(1, 'onevsone'), false);
    assert.equal(spawnsFitLobby(2, 'onevsone'), true);
    assert.equal(spawnsFitLobby(4, 'onevsone'), true);
    assert.equal(spawnsFitLobby(2, 'teams'), false);
    assert.equal(spawnsFitLobby(4, 'teams'), true);
    assert.deepEqual(lobbyOptionsFromHouseIndex(index, 'onevsone'), [
      { id: '/maps/skirmish/a.garden', name: 'Alpha', group: 'Official', mapType: 'skirmish', spawns: 2 },
      { id: '/maps/skirmish/b.garden', name: 'Lanes', group: 'Official', mapType: 'skirmish', spawns: 4 },
    ]);
    assert.deepEqual(lobbyOptionsFromHouseIndex(index, 'teams'), [
      { id: '/maps/skirmish/b.garden', name: 'Lanes', group: 'Official', mapType: 'skirmish', spawns: 4 },
    ]);
  });

  it('passes house map URLs through gardenUrlForChapter', () => {
    assert.equal(gardenUrlForChapter('/maps/skirmish/divide.garden'), '/maps/skirmish/divide.garden');
  });

  it('reads names and spawn counts from the skirmish gardens', () => {
    const shipped = readSkirmishCatalog(repoRoot);
    assert.ok(shipped.maps.length >= 1);
    const listed = (mode) => new Set(lobbyOptionsFromHouseIndex(shipped, mode).map((row) => row.id));
    for (const row of shipped.maps) {
      const data = JSON.parse(readFileSync(join(mapsRoot, 'skirmish', row.file), 'utf8'));
      const fields = gardenLobbyFields(data, row.file);
      assert.equal(row.name, data.n);
      assert.equal(row.spawns, fields.spawns);
      const garden = decodeGarden(data);
      assert.equal(garden.agoras.length, fields.spawns);
      assert.equal(garden.terrainTypes.length, garden.width * garden.height);
      const id = `/maps/skirmish/${row.file}`;
      assert.equal(listed('onevsone').has(id), spawnsFitLobby(fields.spawns, 'onevsone'));
      assert.equal(listed('teams').has(id), spawnsFitLobby(fields.spawns, 'teams'));
    }
    assert.ok(shipped.maps.some((row) => row.spawns > 2));
  });

  it('lists official maps before workshop in the picker', () => {
    const official = [{ id: '/maps/skirmish/ford.garden', name: 'Ford', mapType: 'skirmish' }];
    const opts = customMapSelectOptions([
      { id: '10', title: 'Duel', gardens: [{ file: 'map.garden', name: 'Duel', mapType: 'onevsone' }] },
    ], '', [], 'onevsone', official);
    assert.equal(opts[0].id, '/maps/skirmish/ford.garden');
    assert.equal(opts[0].name, 'Ford');
    assert.equal(opts[1].name, 'Duel');
  });

  it('rejects unsafe garden paths', () => {
    assert.equal(houseMapGardenUrl('../secret.garden'), '');
  });
});
