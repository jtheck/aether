import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeDesires, desireCastBonus, desireTrainOrder, mergeDesireIds } from './aiDesire.js';
import { resolveAiStrategy } from './aiStrategy.js';

describe('aiDesire', () => {
  it('stacks caster desires into cast budget', () => {
    const ids = ['priest_ward', 'warlock_burst'];
    const fx = desireCastBonus(ids);
    assert.ok(fx.castChance >= 30);
    assert.ok(fx.castCap >= 2);
  });

  it('respects minHeat on train order', () => {
    const low = desireTrainOrder(['warlock_burst', 'monk_ward'], 1);
    assert.ok(low.includes('monk'));
    assert.equal(low.includes('warlock'), false);
  });

  it('resolveAiStrategy adds desire cast bonus', () => {
    const s = resolveAiStrategy({
      owner: 1,
      temperament: 'passive',
      desires: ['warlock_burst'],
    });
    assert.ok(s.castChance > 0);
  });

  it('mergeDesireIds dedupes', () => {
    assert.deepEqual(
      mergeDesireIds(['a'], ['b', 'a']),
      ['a', 'b'],
    );
  });
});
