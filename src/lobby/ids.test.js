import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameUserId, senderUserId, shortUserId } from './ids.js';

describe('lobby ids', () => {
  it('matches only exact user ids', () => {
    assert.equal(sameUserId('p2p-aaa', 'p2p-aaa'), true);
    assert.equal(sameUserId('p2p-aaa', 'p2p-bbb'), false);
    assert.equal(sameUserId('xx-aaa', 'aaa'), false);
    assert.equal(sameUserId(null, 'aaa'), false);
  });

  it('reads stamped userId and ignores signaling from', () => {
    assert.equal(senderUserId({ userId: 'guest', from: 'host' }), 'guest');
    assert.equal(senderUserId({ from: 'guest' }), null);
    assert.equal(senderUserId({ userId: '' }), null);
  });

  it('shortens an id from the tail', () => {
    assert.equal(shortUserId('p2p-abcdef'), 'abcdef');
    assert.equal(shortUserId('abc'), 'abc');
  });
});
