import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bakedSpriteUrl } from '../render/bakedAssets.js';
import { spriteBakeEntries } from './spriteRoster.js';

describe('sprite roster', () => {
  it('points a model at its baked portrait', () => {
    assert.equal(
      bakedSpriteUrl('/assets/models/priest.glb'),
      '/assets/baked/sprites/priest.png',
    );
  });

  it('includes units, buildings, and upgrades, and skips scenery', () => {
    const urls = spriteBakeEntries().map((entry) => entry.url);
    assert.ok(urls.some((url) => url.endsWith('/villager.glb')));
    assert.ok(urls.some((url) => url.endsWith('/champion.glb')));
    assert.ok(urls.some((url) => url.endsWith('/camp.glb')));
    assert.ok(urls.some((url) => url.endsWith('/agora.glb')));
    assert.ok(urls.some((url) => url.endsWith('/patronage.glb')));
    assert.equal(urls.some((url) => url.endsWith('/trees.glb')), false);
    assert.equal(new Set(urls).size, urls.length);
  });
});
