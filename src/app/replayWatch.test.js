import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReplaySpeed,
  nextReplaySpeed,
  replayPlayShouldRewind,
} from './replayWatch.js';

describe('replay watch helpers', () => {
  it('cycles speed through ½× then back to 1×', () => {
    assert.equal(nextReplaySpeed(1), 2);
    assert.equal(nextReplaySpeed(8), 0.5);
    assert.equal(nextReplaySpeed(0.5), 1);
    assert.equal(formatReplaySpeed(0.5), '½×');
    assert.equal(formatReplaySpeed(2), '2×');
  });

  it('rewinds play when the tape is already at the end', () => {
    assert.equal(replayPlayShouldRewind(400, 400), true);
    assert.equal(replayPlayShouldRewind(399, 400), true);
    assert.equal(replayPlayShouldRewind(10, 400), false);
  });
});
