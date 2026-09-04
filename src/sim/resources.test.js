import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatResourceCost, lackingCostKinds, resourceCostParts } from './resources.js';

describe('formatResourceCost', () => {
  it('lists resource amounts and skips pop', () => {
    assert.deepEqual(
      resourceCostParts({ wood: 25, food: 10, pop: 1, stone: 0 }),
      [{ kind: 'wood', amount: 25 }, { kind: 'food', amount: 10 }],
    );
    assert.equal(formatResourceCost({ wood: 25, food: 10, pop: 1 }), '19 · a');
    assert.equal(formatResourceCost({ pop: 1 }), '');
  });

  it('names only the cost kinds the bank is short on', () => {
    assert.deepEqual(
      lackingCostKinds({ wood: 30, stone: 5, mineral: 0, food: 100 }, { wood: 25, stone: 15, food: 10 }),
      ['stone'],
    );
    assert.deepEqual(lackingCostKinds({ wood: 10 }, { wood: 25, pop: 1 }), ['wood']);
  });
});
