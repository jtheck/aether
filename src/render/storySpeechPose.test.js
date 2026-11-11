import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XR_LOOK_DOWN } from '../app/xrRig.js';
import { eyeFlatForward, narratorPlanePose } from './storySpeechPose.js';

describe('narratorPlanePose', () => {
  it('lays the card on the ground in front of the eye, short of the gaze hit', () => {
    const pose = narratorPlanePose([4, 20, -6], [0, 1], 1, XR_LOOK_DOWN);
    const gaze = (20 - 1) / Math.tan(XR_LOOK_DOWN);
    assert.ok(pose.dist < gaze);
    assert.ok(pose.dist >= 8);
    assert.equal(pose.x, 4);
    assert.ok(Math.abs(pose.z - (-6 + pose.dist)) < 1e-6);
    assert.equal(pose.y, 1.35);
  });
});

describe('eyeFlatForward', () => {
  it('reads stick-forward from the headset matrix', () => {
    const wm = new Float32Array(16);
    wm[8] = 0;
    wm[10] = 2;
    assert.deepEqual(eyeFlatForward(wm), [0, 1]);
  });
});
