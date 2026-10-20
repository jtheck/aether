import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ladderSlices } from './ladderBoard.js';

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    playerId: `p${i}`,
    rating: 2000 - i,
    games: 1,
    wins: 1,
  }));
}

test('top 10 and the ranks around a later player', () => {
  const view = ladderSlices(rows(40), 'p14', 0);
  assert.deepEqual(view.top.map((row) => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(view.around.map((row) => row.rank), [12, 13, 14, 15, 16, 17, 18]);
  assert.equal(view.me.playerId, 'p14');
  assert.equal(view.pages, 4);
  assert.equal(view.pageRows.length, 10);
});

test('a player already in the top 10 is not repeated underneath', () => {
  const view = ladderSlices(rows(20), 'p2', 0);
  assert.equal(view.around.length, 0);
  assert.equal(view.me.rank, 3);
});

test('an unranked id has no row and still pages the board', () => {
  const view = ladderSlices(rows(3), 'missing', 4);
  assert.equal(view.me, null);
  assert.equal(view.page, 0);
  assert.equal(view.pageRows.length, 3);
});
