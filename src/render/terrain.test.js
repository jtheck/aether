import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN } from '../sim/field.js';
import { sampleSpecLook, sampleWetness, specLookAt, wetnessAt } from './terrain.js';

describe('terrain spec look', () => {
  it('keeps water cover full and dirt dry', () => {
    const types = new Uint8Array([TERRAIN.WATER, TERRAIN.DIRT, TERRAIN.DIRT, TERRAIN.GRASS]);
    assert.equal(wetnessAt(types, 2, 2, 0, 0), 255);
    assert.equal(wetnessAt(types, 2, 2, 1, 0), 0);
    assert.equal(wetnessAt(types, 2, 2, 1, 1), 0);
  });

  it('gives grass more spec than dirt, and none on water tiles', () => {
    const types = new Uint8Array([TERRAIN.WATER, TERRAIN.DIRT, TERRAIN.DIRT, TERRAIN.GRASS]);
    const water = specLookAt(types, 2, 2, 0, 0);
    const dirt = specLookAt(types, 2, 2, 1, 0);
    const grass = specLookAt(types, 2, 2, 1, 1);
    assert.equal(Math.max(...water), 0);
    assert.ok(grass[1] > dirt[1]);
    assert.ok(Math.max(...dirt) < 20);
  });

  it('bilinear-blends the shore so water glint is not a hard tile', () => {
    const types = new Uint8Array([
      TERRAIN.WATER, TERRAIN.DIRT,
      TERRAIN.WATER, TERRAIN.DIRT,
    ]);
    const mid = sampleWetness(types, 2, 2, 0.5, 0);
    assert.ok(mid > 100 && mid < 160);
    const dirt = sampleWetness(types, 2, 2, 1, 0);
    assert.equal(dirt, 0);
    const rgb = sampleSpecLook(types, 2, 2, 0.5, 0);
    assert.ok(rgb[1] < specLookAt(types, 2, 2, 1, 0)[1] + 1);
  });
});
