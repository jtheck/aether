import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ladderPlayerId } from './ladderId.js';

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
}

test('a player id is created once and reused', () => {
  const storage = memory();
  let n = 0;
  const randomUUID = () => {
    n += 1;
    return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  };
  assert.equal(ladderPlayerId(storage, randomUUID), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(ladderPlayerId(storage, () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(n, 1);
});
