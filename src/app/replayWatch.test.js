import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReplaySpeed,
  nextReplaySpeed,
  replaySpeedIndex,
  replaySpeedStopRatio,
  replaySpeedZeroRatio,
  stepReplaySpeed,
  replayBatchSize,
  replayDisplayBlendMs,
  nearestReplayCheckpointTick,
  replayCheckpointDue,
  replayPlayShouldRewind,
  formatReplayClock,
  replayScrubRatio,
  replaySkipTarget,
} from './replayWatch.js';

describe('replay watch helpers', () => {
  it('steps speed from reverse through 32× and wraps', () => {
    assert.equal(nextReplaySpeed(1), 2);
    assert.equal(nextReplaySpeed(8), 16);
    assert.equal(nextReplaySpeed(32), -32);
    assert.equal(nextReplaySpeed(-32), -16);
    assert.equal(nextReplaySpeed(0.125), 0.25);
    assert.equal(nextReplaySpeed(0.25), 0.5);
    assert.equal(nextReplaySpeed(0.5), 1);
    assert.equal(replaySpeedIndex(0), 9);
    assert.equal(replaySpeedIndex(1), 13);
    assert.equal(replaySpeedIndex(0.125), 10);
    assert.equal(replaySpeedIndex(32), 18);
    assert.equal(replaySpeedIndex(-32), 0);
    assert.equal(replaySpeedStopRatio(0), 0.5);
    assert.equal(replaySpeedStopRatio(1), 13 / 18);
    assert.equal(replaySpeedZeroRatio(), 0.5);
    assert.equal(replaySpeedZeroRatio([-4, -2, -1, 1, 2]), 0.625);
    assert.equal(replaySpeedZeroRatio([-1, 0, 1]), 0.5);
    assert.equal(stepReplaySpeed(1, 1), 2);
    assert.equal(stepReplaySpeed(1, -1), 0.5);
    assert.equal(stepReplaySpeed(0, -1), -0.125);
    assert.equal(stepReplaySpeed(0, 1), 0.125);
    assert.equal(stepReplaySpeed(0.125, -1), 0);
    assert.equal(stepReplaySpeed(-0.125, -1), -0.25);
    assert.equal(stepReplaySpeed(-32, -1), -32);
    assert.equal(stepReplaySpeed(32, 1), 32);
    assert.equal(replayBatchSize(0.125), 1);
    assert.equal(replayBatchSize(0.25), 1);
    assert.equal(replayBatchSize(1), 1);
    assert.equal(replayBatchSize(2), 1);
    assert.equal(replayBatchSize(8), 8);
    assert.equal(replayBatchSize(32), 32);
    assert.equal(replayDisplayBlendMs(1), 50);
    assert.equal(replayDisplayBlendMs(0.25), 200);
    assert.equal(replayDisplayBlendMs(0.125), 400);
    assert.equal(formatReplaySpeed(0), '0×');
    assert.equal(formatReplaySpeed(0.125), '⅛×');
    assert.equal(formatReplaySpeed(0.25), '¼×');
    assert.equal(formatReplaySpeed(0.5), '½×');
    assert.equal(formatReplaySpeed(2), '2×');
    assert.equal(formatReplaySpeed(-2), '−2×');
    assert.equal(formatReplaySpeed(-0.5), '−½×');
    assert.equal(replayBatchSize(-8), 8);
    assert.equal(replayDisplayBlendMs(-0.25), 200);
  });

  it('rewinds play when the tape is already at the end', () => {
    assert.equal(replayPlayShouldRewind(400, 400), true);
    assert.equal(replayPlayShouldRewind(399, 400), true);
    assert.equal(replayPlayShouldRewind(10, 400), false);
  });

  it('rewinds from the nearest checkpoint instead of tick 0', () => {
    assert.equal(replayCheckpointDue([], 199), false);
    assert.equal(replayCheckpointDue([], 200), true);
    assert.equal(replayCheckpointDue([200], 399), false);
    assert.equal(replayCheckpointDue([200], 400), true);
    assert.equal(nearestReplayCheckpointTick([200, 400, 600], 450), 400);
    assert.equal(nearestReplayCheckpointTick([200], 100), -1);
  });

  it('places the catch-up ghost along the tape', () => {
    assert.equal(replayScrubRatio(0, 400), 0);
    assert.equal(replayScrubRatio(200, 400), 0.5);
    assert.equal(replayScrubRatio(900, 400), 1);
    assert.equal(replayScrubRatio(10, 0), 0);
  });

  it('keeps minutes on the replay clock', () => {
    assert.equal(formatReplayClock(0), '0:00');
    assert.equal(formatReplayClock(20), '0:01');
    assert.equal(formatReplayClock(20 * 59), '0:59');
    assert.equal(formatReplayClock(20 * 65), '1:05');
    assert.equal(formatReplayClock(20 * 3605), '60:05');
  });

  it('skips ten seconds and clamps to the tape', () => {
    assert.equal(replaySkipTarget(400, 2000, -1, 20), 200);
    assert.equal(replaySkipTarget(400, 2000, 1, 20), 600);
    assert.equal(replaySkipTarget(50, 2000, -1, 20), 0);
    assert.equal(replaySkipTarget(1950, 2000, 1, 20), 2000);
  });
});
