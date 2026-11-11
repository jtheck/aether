import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN } from '../sim/field.js';
import {
  heatAt,
  liquidCover,
  packGroundSpecTexel,
  sampleHeat,
  sampleSpecLook,
  sampleWetness,
  specLookAt,
  wetnessAt,
} from './terrain.js';

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

  it('keeps lava heat off the water glint and off dry grass', () => {
    const types = new Uint8Array([TERRAIN.LAVA, TERRAIN.WATER, TERRAIN.GRASS, TERRAIN.CHARRED]);
    assert.equal(heatAt(types, 2, 2, 0, 0), 255);
    assert.equal(wetnessAt(types, 2, 2, 0, 0), 0);
    assert.equal(heatAt(types, 2, 2, 1, 0), 0);
    assert.equal(wetnessAt(types, 2, 2, 1, 0), 255);
    assert.equal(heatAt(types, 2, 2, 0, 1), 0);
    const lava = packGroundSpecTexel([0, 0, 0], 0, 255);
    const water = packGroundSpecTexel([0, 0, 0], 255, 0);
    const grass = packGroundSpecTexel(specLookAt(types, 2, 2, 0, 1), 0, 0);
    const hot = liquidCover(lava[0] / 255, lava[3] / 255);
    const wet = liquidCover(water[0] / 255, water[3] / 255);
    const dry = liquidCover(grass[0] / 255, grass[3] / 255);
    const shore = liquidCover((grass[0] / 255) * 0.75, 0.25);
    assert.ok(hot.heat > 0.95 && hot.wet < 0.05, `lava ${hot.heat} ${hot.wet}`);
    assert.ok(wet.wet > 0.95 && wet.heat < 0.05, `water ${wet.wet} ${wet.heat}`);
    assert.ok(dry.heat < 0.01 && dry.wet < 0.01);
    assert.ok(shore.heat < 0.02, `grass shore read as lava (${shore.heat})`);
    const fade = sampleHeat(types, 2, 2, 0.5, 0);
    assert.ok(fade > 100 && fade < 160, `heat did not fade (${fade})`);
  });
});
