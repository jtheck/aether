import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { buildField } from './field.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import {
  createAgoras,
  agoraCaptureSystem,
  agoraOverlayActive,
  AGORA_CAPTURE_TICKS,
  AGORA_OCCUPATION_RADIUS,
  AGORA_PHASE_LOCK,
  AGORA_PHASE_TUG,
} from './agora.js';
import * as fx from './fixed.js';

function spawnNear(w, owner, ax, az, type = UNIT.WARRIOR) {
  return spawn(w, {
    x: ax,
    y: az,
    type,
    owner,
  });
}

describe('agora capture', () => {
  it('fills progress when attackers hold uncontested', () => {
    const w = createWorld(1);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.kothMatchOver = 0;

    for (let i = 0; i < 4; i++) {
      spawnNear(w, 1, 0, 0);
    }

    for (let t = 0; t < 10; t++) {
      agoraCaptureSystem(w);
    }
    assert.equal(w.agoras[0].progress, 10);
    assert.equal(w.agoras[0].capturer, 1);
    assert.equal(w.agoras[0].phase, AGORA_PHASE_LOCK);
    assert.equal(w.kothMatchOver, 0);
  });

  it('stalls when defenders have enough presence', () => {
    const w = createWorld(2);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.kothMatchOver = 0;

    spawnNear(w, 0, 0, 0);
    spawnNear(w, 0, 0, 0);
    spawnNear(w, 1, 0, 0);
    spawnNear(w, 1, 0, 0);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].progress, 0);
    assert.equal(w.agoras[0].contested, 1);
  });

  it('unlocks a tug after a full invade without ending the match', () => {
    const w = createWorld(3);
    w.agoras = createAgoras([{ owner: 0, x: 40, z: 0 }]);
    w.kothMatchOver = 0;
    const ax = w.agoras[0].x;
    const az = w.agoras[0].z;

    for (let i = 0; i < 3; i++) spawnNear(w, 1, ax, az);

    w.agoras[0].progress = AGORA_CAPTURE_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].phase, AGORA_PHASE_TUG);
    assert.equal(w.agoras[0].progress, 0);
    assert.equal(w.agoras[0].tug, 0);
    assert.equal(w.agoras[0].owner, 0);
    assert.equal(w.agoras[0].founder, 0);
    assert.equal(w.agoras[0].captured, 0);
    assert.equal(w.kothMatchOver, 0);
    assert.equal(agoraOverlayActive(w.agoras[0]), true);
  });

  it('occupying the tug ends the match when the mode says so', () => {
    const w = createWorld(3);
    w.agoraOccupyEndsMatch = 1;
    w.agoras = createAgoras([{ owner: 0, x: 40, z: 0 }]);
    w.kothMatchOver = 0;
    const ax = w.agoras[0].x;
    const az = w.agoras[0].z;
    for (let i = 0; i < 3; i++) spawnNear(w, 1, ax, az);

    w.agoras[0].phase = AGORA_PHASE_TUG;
    w.agoras[0].tug = AGORA_CAPTURE_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].captured, 1);
    assert.equal(w.agoras[0].owner, 1);
    assert.equal(w.agoras[0].founder, 1);
    assert.equal(w.matchWinner, 1);
    assert.equal(w.kothMatchOver, 1);
  });

  it('occupying transfers ownership without ending KOTH-style matches', () => {
    const w = createWorld(3);
    w.agoraOccupyEndsMatch = 0;
    w.agoras = createAgoras([{ owner: 0, x: 40, z: 0 }]);
    w.kothMatchOver = 0;
    const ax = w.agoras[0].x;
    const az = w.agoras[0].z;
    for (let i = 0; i < 3; i++) spawnNear(w, 1, ax, az);

    w.agoras[0].phase = AGORA_PHASE_TUG;
    w.agoras[0].tug = AGORA_CAPTURE_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].owner, 1);
    assert.equal(w.agoras[0].phase, AGORA_PHASE_LOCK);
    assert.equal(w.agoras[0].captured, 0);
    assert.equal(w.kothMatchOver, 0);
  });

  it('founder can retake the tug and lock the agora again', () => {
    const w = createWorld(8);
    w.kothMatchOver = 0;
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.agoras[0].phase = AGORA_PHASE_TUG;
    w.agoras[0].tug = AGORA_CAPTURE_TICKS - 1;
    spawnNear(w, 0, 0, 0);
    spawnNear(w, 0, 0, 0);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].phase, AGORA_PHASE_LOCK);
    assert.equal(w.agoras[0].owner, 0);
    assert.equal(w.agoras[0].tug, 0);
    assert.equal(w.kothMatchOver, 0);
  });

  it('tug drains to neutral then trades sides', () => {
    const w = createWorld(9);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.agoras[0].phase = AGORA_PHASE_TUG;
    w.agoras[0].tug = 3;
    w.agoras[0].capturer = 1;
    spawnNear(w, 0, 0, 0);
    spawnNear(w, 0, 0, 0);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].tug, 2);
    assert.equal(w.agoras[0].capturer, 1);

    agoraCaptureSystem(w);
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].tug, 0);
    assert.equal(w.agoras[0].capturer, -1);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].capturer, 0);
    assert.equal(w.agoras[0].tug, 1);
  });

  it('decays when attackers leave', () => {
    const w = createWorld(4);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.agoras[0].progress = 20;
    w.agoras[0].capturer = 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].progress, 19);
    assert.equal(w.agoras[0].capturer, 1);
  });

  it('clears capturer once decay finishes', () => {
    const w = createWorld(4);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.agoras[0].progress = 1;
    w.agoras[0].capturer = 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].progress, 0);
    assert.equal(w.agoras[0].capturer, -1);
  });

  it('occupation radius is finite', () => {
    assert.ok(AGORA_OCCUPATION_RADIUS > 0);
    const r = fx.toFloat(AGORA_OCCUPATION_RADIUS);
    assert.ok(r >= 19 && r <= 21);
  });

  it('step advances capture when wired', () => {
    const w = createWorld(5);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.kothMatchOver = 0;
    const field = buildField(5, { width: 64, height: 64 });
    for (let i = 0; i < 4; i++) spawnNear(w, 1, 0, 0);
    step(w, field, []);
    assert.ok(w.agoras[0].progress >= 1);
  });
});
