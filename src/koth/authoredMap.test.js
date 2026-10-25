import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KOTH_AUTHORED_GARDEN_URL,
  attachKothAuthoredGarden,
} from './authoredMap.js';

describe('koth authored map', () => {
  it('loads KOTH1 for every match seed and keeps that seed', async () => {
    let loads = 0;
    const garden = { n: 'KOTH1', w: 144, h: 144, s: 99 };
    const loadGarden = async () => {
      loads += 1;
      return garden;
    };
    const even = await attachKothAuthoredGarden(
      { mode: 'koth', seed: 4, matchId: 'a' },
      loadGarden,
    );
    const odd = await attachKothAuthoredGarden(
      { mode: 'koth', seed: 5, matchId: 'c' },
      loadGarden,
    );
    assert.equal(loads, 1);
    assert.equal(even.seed, 4);
    assert.equal(even.gardenUrl, KOTH_AUTHORED_GARDEN_URL);
    assert.equal(even.mapW, 144);
    assert.equal(even.mapH, 144);
    assert.equal(odd.seed, 5);
    assert.equal(odd.garden, garden);
    assert.equal(odd.gardenUrl, KOTH_AUTHORED_GARDEN_URL);
  });

  it('leaves solo play and maps that are already chosen alone', async () => {
    const loadGarden = async () => {
      throw new Error('should not load');
    };
    const solo = { mode: 'koth', seed: 2, localSolo: true };
    assert.equal(await attachKothAuthoredGarden(solo, loadGarden), solo);
    const duel = { mode: 'onevsone', seed: 2 };
    assert.equal(await attachKothAuthoredGarden(duel, loadGarden), duel);
    const picked = { mode: 'koth', seed: 2, garden: { n: 'other' } };
    assert.equal(await attachKothAuthoredGarden(picked, loadGarden), picked);
  });
});
