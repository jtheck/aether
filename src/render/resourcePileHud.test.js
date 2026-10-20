import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resourcePileTextureSize } from './resourcePileHud.js';

describe('resourcePileTextureSize', () => {
  it('keeps the bank aspect and a 256-byte row stride', () => {
    const { w, h } = resourcePileTextureSize(420, 84);
    assert.equal(w % 64, 0);
    assert.equal((w * 4) % 256, 0);
    assert.ok(Math.abs(h / w - 84 / 420) < 0.02);
    assert.ok(w <= 1024);
    assert.ok(h >= 1);
  });

  it('stays at least one aligned block', () => {
    const { w, h } = resourcePileTextureSize(1, 1);
    assert.ok(w >= 64);
    assert.ok(h >= 1);
  });
});
