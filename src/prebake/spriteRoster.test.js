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

  it('includes units, buildings, upgrades, and field resources', () => {
    const urls = spriteBakeEntries().map((entry) => entry.url);
    assert.ok(urls.some((url) => url.endsWith('/villager.glb')));
    assert.ok(urls.some((url) => url.endsWith('/champion.glb')));
    assert.ok(urls.some((url) => url.endsWith('/camp.glb')));
    assert.ok(urls.some((url) => url.endsWith('/agora.glb')));
    assert.ok(urls.some((url) => url.endsWith('/patronage.glb')));
    assert.ok(urls.some((url) => url.endsWith('/trees.glb')));
    assert.ok(urls.some((url) => url.endsWith('/rocks_plain.glb')));
    assert.ok(urls.some((url) => url.endsWith('/rocks_moss.glb')));
    assert.ok(urls.some((url) => url.endsWith('/rocks_snow.glb')));
    assert.equal(urls.some((url) => url.endsWith('/frog.glb')), false);
    assert.equal(new Set(urls).size, urls.length);
  });

  it('aims upgrades straighter than the three-quarter roster', () => {
    const entries = spriteBakeEntries();
    const villager = entries.find((entry) => entry.url.endsWith('/villager.glb'));
    const armor = entries.find((entry) => entry.url.endsWith('/armor.glb'));
    const face = Math.PI / 2;
    const offFace = (alpha) => Math.abs(Math.abs(alpha) - face);
    assert.ok(offFace(armor.alpha) < offFace(villager.alpha));
    assert.ok(armor.beta > villager.beta);
  });
});
