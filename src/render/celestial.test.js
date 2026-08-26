import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY,
  azElFromDirection,
  defaultCelestialState,
  directionFromAzEl,
} from './celestial.js';

describe('celestial angles', () => {
  it('round-trips azimuth and elevation', () => {
    const dir = directionFromAzEl(56, 30);
    const back = azElFromDirection(dir);
    assert.ok(Math.abs(back.azimuth - 56) < 0.2);
    assert.ok(Math.abs(back.elevation - 30) < 0.2);
  });

  it('puts fill opposite the sun so wrap does not collapse on yaw', () => {
    const state = defaultCelestialState();
    assert.equal(state.bodies[0].kind, BODY.SUN);
    assert.equal(state.bodies[1].kind, BODY.HEMI);
    const delta = Math.abs(state.bodies[1].azimuth - state.bodies[0].azimuth);
    assert.ok(Math.abs(delta - 180) < 1);
    assert.ok(state.bodies[1].intensity > 0.3);
    assert.ok(state.bodies[1].intensity < 0.55);
  });
});
