import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatStoryTime } from './transport.js';

describe('story transport', () => {
  it('formats a playhead like a video timeline', () => {
    assert.equal(formatStoryTime(0), '0:00');
    assert.equal(formatStoryTime(9.9), '0:09');
    assert.equal(formatStoryTime(75), '1:15');
  });
});
