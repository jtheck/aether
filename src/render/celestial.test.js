import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY,
  CELESTIAL_PRESETS,
  azElFromDirection,
  celestialPresetState,
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

describe('celestial presets', () => {
  const DIRECTIONAL = new Set([BODY.SUN, BODY.MOON]);

  it('exposes a default preset that clones the default state', () => {
    const def = CELESTIAL_PRESETS.find((p) => p.id === 'default');
    assert.ok(def, 'default preset exists');
    assert.deepEqual(celestialPresetState('default'), defaultCelestialState());
  });

  it('returns null for unknown ids', () => {
    assert.equal(celestialPresetState('nope'), null);
  });

  for (const preset of CELESTIAL_PRESETS) {
    it(`"${preset.name}" stays within the forge slider + shadow-key ranges`, () => {
      const s = celestialPresetState(preset.id);
      assert.ok(s, 'preset resolves');
      // Body 0 must be directional so it drives the CSM shadow generator.
      assert.ok(DIRECTIONAL.has(s.bodies[0].kind), 'body 0 is a directional key');
      for (const b of s.bodies) {
        assert.ok(b.elevation >= 5 && b.elevation <= 85, `elevation ${b.elevation} in [5,85]`);
        assert.ok(b.intensity >= 0 && b.intensity <= 2.5, `intensity ${b.intensity} in [0,2.5]`);
        const az = ((b.azimuth % 360) + 360) % 360;
        assert.ok(az >= 0 && az <= 360, `azimuth ${az} in [0,360]`);
      }
    });
  }
});
