import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adventureDealSeed,
  applyPartyToGarden,
  dealHeroOwners,
  heroCountsForPlayers,
  mergePartyUnits,
  prepareAdventureGarden,
  snapshotParty,
} from './party.js';

describe('adventure party', () => {
  it('snapshots living named humans and drops the dead', () => {
    const world = {
      count: 3,
      alive: [1, 0, 1],
      type: [5, 3, 4],
      owner: [0, 0, 1],
      hp: [40, 0, 12],
    };
    const party = snapshotParty(world, [
      { name: 'Stumpey', index: 0 },
      { name: 'Goblin', index: 1 },
    ], [0]);
    assert.deepEqual(party, [{ name: 'Stumpey', type: 5, owner: 0, hp: 40 }]);
  });

  it('seats survivors on the next map tiles and keeps extras', () => {
    const slots = [
      { name: 'Stumpey', type: 5, owner: 0, tx: 40, tz: 42 },
      { name: 'Goblin', type: 3, owner: 0, tx: 37, tz: 42 },
      { name: 'Lady', type: 4, owner: 0, tx: 40, tz: 40 },
    ];
    const merged = mergePartyUnits(slots, [
      { name: 'Stumpey', type: 5, owner: 0, hp: 22 },
      { name: 'Lady', type: 4, owner: 0, hp: 18 },
      { name: '', type: 1, owner: 0, hp: 50 },
    ]);
    assert.deepEqual(merged.map((u) => u.name), ['Stumpey', 'Lady', '']);
    assert.equal(merged[0].tx, 40);
    assert.equal(merged[0].hp, 22);
    assert.equal(merged[1].name, 'Lady');
    assert.equal(merged[2].type, 1);
    assert.equal(merged[2].tx, 41);
    assert.equal(merged[2].hp, 50);
  });

  it('patches an encoded garden so the worker spawns the carried party', () => {
    const garden = {
      v: 4,
      w: 32,
      h: 32,
      s: 1,
      cs: 16,
      cm: '1'.repeat(4),
      rr: '0:4',
      t: '1:1024',
      u: [
        [0, 5, 8, 8, 'Stumpey'],
        [0, 3, 9, 8, 'Goblin'],
      ],
    };
    const next = applyPartyToGarden(garden, [
      { name: 'Stumpey', type: 5, owner: 0, hp: 17 },
      { name: '', type: 1, owner: 0, hp: 44 },
    ], { wood: 12, stone: 3, mineral: 1, food: 8 });
    assert.deepEqual(next.u, [
      [0, 5, 8, 8, 'Stumpey', 17],
      [0, 1, 9, 8, '', 44],
    ]);
    assert.deepEqual(next.sr, [12, 3, 1, 8]);
    assert.equal(next.t, garden.t);
  });

  it('deals four heroes: all solo, two each in a pair, 2+1+1, then one apiece', () => {
    assert.deepEqual(heroCountsForPlayers(1), [4]);
    assert.deepEqual(heroCountsForPlayers(2), [2, 2]);
    assert.deepEqual(heroCountsForPlayers(3), [2, 1, 1]);
    assert.deepEqual(heroCountsForPlayers(4), [1, 1, 1, 1]);
    assert.deepEqual(dealHeroOwners(4, [3], 99), [3, 3, 3, 3]);

    const two = dealHeroOwners(4, [0, 1], 7);
    assert.equal(two.filter((o) => o === 0).length, 2);
    assert.equal(two.filter((o) => o === 1).length, 2);
    assert.deepEqual(dealHeroOwners(4, [0, 1], 7), two);

    const three = dealHeroOwners(4, [0, 1, 2], 3);
    const counts = [0, 1, 2].map((id) => three.filter((o) => o === id).length).sort();
    assert.deepEqual(counts, [1, 1, 2]);

    const four = dealHeroOwners(4, [0, 1, 2, 3], 1);
    assert.deepEqual([...four].sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('stamps a solo garden onto the local player', () => {
    const garden = {
      v: 4,
      w: 32,
      h: 32,
      s: 1,
      u: [
        [0, 5, 8, 8, 'Stumpey'],
        [0, 3, 9, 8, 'Goblin'],
        [0, 4, 8, 7, 'Lady'],
        [0, 6, 10, 7, 'Doc'],
      ],
      g: [[0, 1, 2]],
    };
    const solo = prepareAdventureGarden(garden, { humanPlayers: [2], seed: 1 });
    assert.ok(solo.u.every((u) => u[0] === 2));
    assert.equal(solo.g, undefined);
  });

  it('reshuffles heroes per map seed and leaves trained extras with their owner', () => {
    assert.notEqual(adventureDealSeed(1, 22049), adventureDealSeed(1, 44117));
    const garden = {
      v: 4,
      w: 32,
      h: 32,
      s: 1,
      u: [
        [0, 5, 8, 8, 'Stumpey'],
        [0, 3, 9, 8, 'Goblin'],
        [0, 4, 8, 7, 'Lady'],
        [0, 6, 10, 7, 'Doc'],
      ],
    };
    const party = [
      { name: 'Stumpey', type: 5, owner: 0, hp: 20 },
      { name: 'Goblin', type: 3, owner: 0, hp: 20 },
      { name: 'Lady', type: 4, owner: 1, hp: 20 },
      { name: 'Doc', type: 6, owner: 1, hp: 20 },
      { name: '', type: 1, owner: 1, hp: 44 },
    ];
    const a = prepareAdventureGarden(garden, { humanPlayers: [0, 1], seed: 7, party });
    const b = prepareAdventureGarden(garden, { humanPlayers: [0, 1], seed: 7, party });
    const c = prepareAdventureGarden(garden, { humanPlayers: [0, 1], seed: 99, party });
    const named = (u) => u.filter((row) => row[4]).map((row) => row[0]);
    assert.deepEqual(named(a.u), named(b.u));
    assert.deepEqual(named(a.u), dealHeroOwners(4, [0, 1], 7));
    assert.deepEqual(named(c.u), dealHeroOwners(4, [0, 1], 99));
    assert.notDeepEqual(named(a.u), named(c.u));
    const extra = a.u.find((row) => row[4] === '');
    assert.equal(extra[0], 1);
    assert.equal(extra[5], 44);
  });
});
