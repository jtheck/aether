import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { noteHelpControlsDevice, resolveHelpControlsDevice } from './helpControlsDevice.js';

describe('resolveHelpControlsDevice', () => {
  it('prefers an active XR session', () => {
    noteHelpControlsDevice('touch');
    assert.equal(resolveHelpControlsDevice({ xrActive: true }), 'xr');
  });

  it('uses the last noted device when not in XR', () => {
    noteHelpControlsDevice('gamepad');
    assert.equal(resolveHelpControlsDevice({ xrActive: false }), 'gamepad');
    noteHelpControlsDevice('mouse');
  });
});
