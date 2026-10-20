import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SPORE_SHOT_HOLD_MS, retireUnseenSporeShots } from './mushrooms.js';

describe('spore attack lines', () => {
  it('keeps a long chase until the hit can finish the line', () => {
    const live = new Map([
      ['4:1', { seen: 8, born: 0 }],
    ]);
    const recent = [];
    const now = SPORE_SHOT_HOLD_MS + 500;
    retireUnseenSporeShots(live, recent, 9, now);
    assert.equal(live.size, 0);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].ended, now);

    retireUnseenSporeShots(live, recent, 10, now + SPORE_SHOT_HOLD_MS);
    assert.equal(recent.length, 1);
    retireUnseenSporeShots(live, recent, 11, now + SPORE_SHOT_HOLD_MS + 1);
    assert.equal(recent.length, 0);
  });

  it('leaves a shot that is still in the air', () => {
    const shot = { seen: 3, born: 0 };
    const live = new Map([['1:1', shot]]);
    const recent = [];
    retireUnseenSporeShots(live, recent, 3, 2000);
    assert.equal(live.get('1:1'), shot);
    assert.equal(recent.length, 0);
  });
});
