import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonInfo } from './ladderSeason.js';

test('a known season shows its name and start date', () => {
  assert.deepEqual(seasonInfo('2026-1'), {
    name: 'Two Words: Move In',
    started: 'Started October 19, 2026',
    number: 0,
  });
});

test('an unknown season id is shown with no invented date', () => {
  assert.deepEqual(seasonInfo('1999-1'), { name: '1999-1', started: '', number: null });
});
