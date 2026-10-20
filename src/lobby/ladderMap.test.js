import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFieldSize, ladderMatchDeal, ladderPadsPlayable } from './ladderMap.js';

describe('ladder map', () => {
  it('rotates tiny and the next two boards from the queue seed', () => {
    assert.equal(ladderFieldSize(0), 'tiny');
    assert.equal(ladderFieldSize(1), 'small');
    assert.equal(ladderFieldSize(2), 'medium');
    assert.equal(ladderFieldSize(3), 'tiny');
  });

  it('rotates teams from the default board through the next two sizes', () => {
    assert.equal(ladderFieldSize(0, 'teams'), 'small');
    assert.equal(ladderFieldSize(1, 'teams'), 'medium');
    assert.equal(ladderFieldSize(2, 'teams'), 'large');
    assert.equal(ladderFieldSize(3, 'teams'), 'small');
  });

  it('rejects a start stranded on the agora and keeps that board size', () => {
    assert.equal(ladderPadsPlayable(45, 'tiny'), false);
    const deal = ladderMatchDeal(45);
    assert.equal(deal.fieldSize, 'tiny');
    assert.notEqual(deal.seed, 45);
    assert.equal(ladderPadsPlayable(deal.seed, deal.fieldSize), true);
  });
});
