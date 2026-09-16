import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chapterVotesReady, gardenFromChapterVotes, pickCanonicalChapter } from './chapterSync.js';

describe('chapter sync', () => {
  it('waits until every seated player has voted', () => {
    const votes = new Map();
    votes.set(0, { url: '/maps/chapter2.garden', party: [], playerId: 0 });
    assert.equal(chapterVotesReady(votes, [0, 1]), false);
    votes.set(1, { url: '/maps/chapter2.garden', party: [{ name: 'A' }], playerId: 1 });
    assert.equal(chapterVotesReady(votes, [0, 1]), true);
  });

  it('picks the lowest seat as the shared handoff', () => {
    const votes = new Map([
      [1, { playerId: 1, party: [{ name: 'guest' }], epoch: 3 }],
      [0, { playerId: 0, party: [{ name: 'host' }], epoch: 1, url: '/maps/chapter2.garden' }],
    ]);
    const picked = pickCanonicalChapter(votes);
    assert.deepEqual(picked.party, [{ name: 'host' }]);
    assert.equal(picked.epoch, 1);
    assert.equal(picked.url, '/maps/chapter2.garden');
  });

  it('uses an embedded garden from any vote when the lowest seat has none', () => {
    const garden = { v: 4, n: 'Road', w: 8, h: 8 };
    const votes = new Map([
      [0, { playerId: 0, url: 'workshop:99/maps/02.garden', party: [] }],
      [1, { playerId: 1, url: 'workshop:99/maps/02.garden', garden, party: [] }],
    ]);
    assert.equal(pickCanonicalChapter(votes).garden, undefined);
    assert.equal(gardenFromChapterVotes(votes), garden);
  });
});
