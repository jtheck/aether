import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { playbackBlocked, thunderPlaysForStrikes } from './audio.js';

describe('thunder catch-up', () => {
  it('plays one clap for any number of bolts in a drained frame', () => {
    assert.equal(thunderPlaysForStrikes(0), 0);
    assert.equal(thunderPlaysForStrikes(1), 1);
    assert.equal(thunderPlaysForStrikes(100), 1);
  });
});

describe('playbackBlocked', () => {
  it('blocks while the tab is hidden or the context is interrupted', () => {
    assert.equal(playbackBlocked({ hidden: false, ctxState: 'running' }), false);
    assert.equal(playbackBlocked({ hidden: true, ctxState: 'running' }), true);
    assert.equal(playbackBlocked({ hidden: false, ctxState: 'interrupted' }), true);
    assert.equal(playbackBlocked({ hidden: false, ctxState: 'suspended' }), false);
  });
});
