import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XR_LOOK_DOWN } from '../app/xrRig.js';
import { XR_HUD_CHROME_TAN } from './xrEye.js';
import {
  XR_SPEECH_COLUMN_H,
  XR_SPEECH_HUD_DEPTH,
  XR_SPEECH_STACK_STEP,
  XR_SPEECH_TAN_H,
  XR_SPEECH_TAN_W,
  assignSpeechColumns,
  eyeFlatForward,
  narratorPlanePose,
  speechColumnPose,
  speechInFront,
  speechSide,
  speechUnitPose,
  speakerViewTangent,
  worldUprightFaceEye,
} from './storySpeechPose.js';

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

describe('speech columns', () => {
  it('sits on the HUD plane, inside the chrome oval, without stacked overlap', () => {
    const wm = new Float32Array(16);
    wm[0] = wm[5] = wm[10] = wm[15] = 1;
    const pose = speechColumnPose(wm, 1, 0);
    assert.equal(pose.z, XR_SPEECH_HUD_DEPTH);
    assert.ok(Math.abs(pose.yAxis[0]) < 1e-8 && Math.abs(pose.yAxis[1] - 1) < 1e-8);
    assert.ok(Math.abs(pose.zAxis[0]) < 1e-8 && Math.abs(pose.zAxis[2] + 1) < 1e-8);
    const outer = XR_SPEECH_COLUMN_H + XR_SPEECH_TAN_W * 0.5;
    const inner = XR_SPEECH_COLUMN_H - XR_SPEECH_TAN_W * 0.5;
    assert.ok(outer <= XR_HUD_CHROME_TAN);
    assert.ok(inner > 0.12);
    assert.ok(XR_SPEECH_STACK_STEP >= XR_SPEECH_TAN_H);
    assert.ok(speakerViewTangent(wm, { x: 0, y: 0, z: 10 }).ahead > 0);
    assert.equal(speechSide(wm, { x: -4, y: 0, z: 6 }), -1);
  });

  it('keeps a line on its slot when the speaker crosses the view', () => {
    const wishes = [
      { key: 'doc', side: -1 },
      { key: 'lady', side: -1 },
      { key: 'gob', side: 1 },
    ];
    const first = assignSpeechColumns(wishes, new Map());
    assert.equal(first.get('doc').side, -1);
    assert.equal(first.get('lady').side, -1);
    assert.notEqual(first.get('doc').index, first.get('lady').index);
    const flipped = assignSpeechColumns(
      [
        { key: 'doc', side: 1 },
        { key: 'lady', side: 1 },
        { key: 'gob', side: -1 },
      ],
      first,
    );
    assert.equal(flipped.get('doc').side, first.get('doc').side);
    assert.equal(flipped.get('doc').index, first.get('doc').index);
    assert.equal(flipped.get('lady').index, first.get('lady').index);
    assert.equal(flipped.get('gob').side, 1);
  });
});

describe('speech on the unit', () => {
  const wm = new Float32Array(16);
  wm[0] = wm[5] = wm[10] = wm[15] = 1;
  wm[13] = 1.6;

  it('keeps a speaker in front on the unit, and sticks one outside to the visor', () => {
    assert.equal(speechInFront(wm, { x: 0.4, y: 1.2, z: 6 }), true);
    assert.equal(speechInFront(wm, { x: 8, y: 1.2, z: 2 }), false);
    assert.equal(speechInFront(wm, { x: 0, y: 1.2, z: -4 }), false);
    const pose = speechUnitPose(wm, { x: 0.4, y: 2.4, z: 6 });
    assert.ok(pose.z > 0.4 && pose.z < 6);
    assert.ok(pose.y > 2.4);
    assert.ok(Math.abs(pose.yAxis[1]) > 0.9);
    assert.ok(pose.width > pose.height);
  });
});

describe('worldUprightFaceEye', () => {
  it('keeps the plaque vertical in world space while facing the eye', () => {
    const face = worldUprightFaceEye(0, 10, 0, 2, 10, 4);
    assert.ok(Math.abs(face.yAxis[1]) > 0.96);
    assert.ok(face.zAxis[0] < 0);
  });
});

