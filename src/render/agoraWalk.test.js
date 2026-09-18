import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGORA_DECK_Y,
  agoraLocalXZ,
  agoraWalkPadsFromList,
  agoraWalkYAt,
  agoraWalkYaw,
  pointOnAgoraDeck,
} from './agoraWalk.js';

describe('agora walk Y', () => {
  it('faces map center when yaw is omitted', () => {
    assert.ok(Math.abs(agoraWalkYaw(10, 0) + Math.PI / 2) < 1e-9);
    assert.equal(agoraWalkYaw(0, 0, 0.4), 0.4);
  });

  it('maps world XZ into the same local frame as the agora instance yaw', () => {
    const yaw = Math.PI / 2;
    const local = agoraLocalXZ(3, 0, yaw);
    assert.ok(Math.abs(local.x) < 1e-9);
    assert.ok(Math.abs(local.z - 3) < 1e-9);
  });

  it('lifts the plaza and leaves ground outside the deck', () => {
    const pads = agoraWalkPadsFromList([{ x: 40, z: -20, yaw: 0 }], () => 2);
    assert.equal(agoraWalkYAt(pads, 40, -20, 2), 2 + AGORA_DECK_Y);
    assert.equal(agoraWalkYAt(pads, 40 + 9.5, -20, 2), 2);
    assert.equal(agoraWalkYAt(pads, 0, 0, 1.5), 1.5);
  });

  it('keeps a taller hill when the ground is above the plaza', () => {
    const pads = agoraWalkPadsFromList([{ x: 0, z: 0, yaw: 0, baseY: 1 }]);
    assert.equal(agoraWalkYAt(pads, 0, 0, 4), 4);
    assert.ok(pointOnAgoraDeck(pads[0], 0, 0));
  });

  it('rotates the deck with agora yaw', () => {
    const pads = agoraWalkPadsFromList([{ x: 0, z: 0, yaw: Math.PI / 2 }], () => 0);
    // Local +Z is world +X after a +90° yaw — still on the plaza.
    assert.equal(agoraWalkYAt(pads, 7.2, 0, 0), AGORA_DECK_Y);
    // Local +X is world −Z — past the short side, off the deck.
    assert.equal(agoraWalkYAt(pads, 0, -7.7, 0), 0);
  });
});
