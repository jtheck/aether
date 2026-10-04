import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRAST, EXPOSURE } from './celestial.js';
import {
  isTeamColorMaterial,
  isTeamColorName,
  sceneTeamRgb,
  TEAM_COLOR_UNLIT,
} from './teamColor.js';

/** Same grade the unlit PBR shader applies after TEAM_COLOR_UNLIT cancels exposure. */
function shaderDisplay(linear, contrast = CONTRAST) {
  let c = Math.min(1, Math.max(0, linear ** (1 / 2.2)));
  const high = c * c * (3 - 2 * c);
  if (contrast < 1) c = 0.5 + (c - 0.5) * contrast;
  else c = c + (high - c) * (contrast - 1);
  return c;
}

describe('teamColor names', () => {
  it('matches authored and cloned TeamColor materials', () => {
    assert.equal(isTeamColorName('TeamColor'), true);
    assert.equal(isTeamColorName('teamcolor'), true);
    assert.equal(isTeamColorName('TeamColor_clone'), true);
    assert.equal(isTeamColorMaterial({ name: 'TeamColor.001' }), true);
  });

  it('ignores other materials', () => {
    assert.equal(isTeamColorName('Material.001'), false);
    assert.equal(isTeamColorName('spawn_anchor'), false);
    assert.equal(isTeamColorMaterial({ name: 'Wood' }), false);
    assert.equal(isTeamColorMaterial(null), false);
  });

  it('undoes the outdoor exposure lift so the picker hex is the on-screen swatch', () => {
    assert.ok(Math.abs(TEAM_COLOR_UNLIT * EXPOSURE - 1) < 1e-9);
  });

  it('pre-encodes a swatch so gamma and contrast land on the picker hex', () => {
    const swatches = [
      [0, 0, 0],
      [1, 1, 1],
      [0x95 / 255, 0x10 / 255, 0x18 / 255],
      [0x0a / 255, 0x38 / 255, 0xb8 / 255],
      [0x14 / 255, 0x70 / 255, 0x00 / 255],
      [0xc4 / 255, 0xa8 / 255, 0x10 / 255],
    ];
    for (const rgb of swatches) {
      const encoded = sceneTeamRgb(rgb);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(shaderDisplay(encoded[i]) - rgb[i]) < 1 / 255, `${rgb} ch ${i}`);
      }
    }
    const blue = sceneTeamRgb([0x0a / 255, 0x38 / 255, 0xb8 / 255]);
    assert.ok(blue[2] < 0xb8 / 255);
  });
});
