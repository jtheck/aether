import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPOSURE } from './celestial.js';
import {
  isTeamColorMaterial,
  isTeamColorName,
  TEAM_COLOR_UNLIT,
} from './teamColor.js';

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
});
