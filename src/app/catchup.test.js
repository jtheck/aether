import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATCHUP_MAX_REPLAY_TICKS,
  shouldExportFreshCatchupCheckpoint,
} from './catchup.js';

test('solo live always mints a tip checkpoint', () => {
  assert.equal(
    shouldExportFreshCatchupCheckpoint({ activeCount: 1, cachedTick: 6000, tipTick: 6100 }),
    true,
  );
  assert.equal(
    shouldExportFreshCatchupCheckpoint({ activeCount: 0, cachedTick: 0, tipTick: 1951 }),
    true,
  );
});

test('multi-army exports when no checkpoint exists yet', () => {
  assert.equal(
    shouldExportFreshCatchupCheckpoint({ activeCount: 2, cachedTick: 0, tipTick: 1951 }),
    true,
  );
});

test('multi-army reuses a recent cached checkpoint', () => {
  assert.equal(
    shouldExportFreshCatchupCheckpoint({ activeCount: 3, cachedTick: 6000, tipTick: 6120 }),
    false,
  );
});

test('multi-army exports when the cached checkpoint is too far behind', () => {
  assert.equal(
    shouldExportFreshCatchupCheckpoint({
      activeCount: 2,
      cachedTick: 6000,
      tipTick: 6000 + CATCHUP_MAX_REPLAY_TICKS + 1,
    }),
    true,
  );
});
