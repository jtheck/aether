import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATCHUP_MAX_REPLAY_TICKS,
  replayCatchUpInto,
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

test('stayPaused leaves lockstep paused after replayCatchUpInto', async () => {
  const session = {
    pauseLockstep: true,
    replayingCatchUp: false,
    setHumanPlayers() {},
    setRole() {},
    catchupProgress: null,
    _lastChecksum: 1,
    confirmedTick: 5,
    client: { commitTickAsync: async () => ({ checksum: 1, extra: {} }) },
    _captureSnapshot() {},
  };
  await replayCatchUpInto(session, { humanPlayers: [0] }, [], 5, null, {
    stayPaused: true,
    fromTick: 5,
    ticksPerFrame: 0,
  });
  assert.equal(session.pauseLockstep, true);
});

test('live catch-up unpauses lockstep after replayCatchUpInto', async () => {
  const session = {
    pauseLockstep: true,
    replayingCatchUp: false,
    setHumanPlayers() {},
    setRole() {},
    catchupProgress: null,
    _lastChecksum: 1,
    confirmedTick: 5,
    client: { commitTickAsync: async () => ({ checksum: 1, extra: {} }) },
    _captureSnapshot() {},
  };
  await replayCatchUpInto(session, { humanPlayers: [0] }, [], 5, null, {
    fromTick: 5,
    ticksPerFrame: 0,
  });
  assert.equal(session.pauseLockstep, false);
});

