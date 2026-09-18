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
  AGORA_FINALE_HOLD_TICKS,
  AGORA_OCCUPATION_RADIUS,
  AGORA_PHASE_LOCK,
  AGORA_PHASE_TUG,
  AGORA_RITE_FINALE,
  AGORA_RITE_NONE,
  AGORA_RITE_UNLOCK,
  AGORA_TUG_TICKS,
  AGORA_UNLOCK_HOLD_TICKS,
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
    assert.equal(w.agoras[0].rite, AGORA_RITE_UNLOCK);
    assert.equal(w.agoras[0].hold, AGORA_UNLOCK_HOLD_TICKS);
    assert.equal(w.agoras[0].owner, 0);
    assert.equal(w.agoras[0].founder, 0);
    assert.equal(w.agoras[0].captured, 0);
    assert.equal(w.kothMatchOver, 0);
    assert.equal(agoraOverlayActive(w.agoras[0]), true);
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].tug, 0);
    assert.equal(w.agoras[0].hold, AGORA_UNLOCK_HOLD_TICKS - 1);
    for (let i = 1; i < AGORA_UNLOCK_HOLD_TICKS; i++) agoraCaptureSystem(w);
    assert.equal(w.agoras[0].rite, AGORA_RITE_NONE);
    assert.equal(w.agoras[0].hold, 0);
    agoraCaptureSystem(w);
    assert.ok(w.agoras[0].tug >= 1);
  });

  it('hides capture chips until the pad is contested or filling', () => {
    const idle = createAgoras([{ owner: 0, x: 0, z: 0 }])[0];
    assert.equal(agoraOverlayActive(idle), false);
    idle.contested = 1;
    assert.equal(agoraOverlayActive(idle), true);
    idle.contested = 0;
    idle.progress = 4;
    idle.capturer = 1;
    assert.equal(agoraOverlayActive(idle), true);
    idle.progress = 0;
    idle.capturer = -1;
    idle.phase = AGORA_PHASE_TUG;
    assert.equal(agoraOverlayActive(idle), false);
    idle.hold = 4;
    idle.rite = AGORA_RITE_UNLOCK;
    assert.equal(agoraOverlayActive(idle), true);
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
    w.agoras[0].tug = AGORA_TUG_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].captured, 0);
    assert.equal(w.agoras[0].rite, AGORA_RITE_FINALE);
    assert.equal(w.agoras[0].hold, AGORA_FINALE_HOLD_TICKS);
    assert.equal(w.kothMatchOver, 0);
    for (let i = 0; i < AGORA_FINALE_HOLD_TICKS; i++) agoraCaptureSystem(w);
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
    w.agoras[0].tug = AGORA_TUG_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].rite, AGORA_RITE_FINALE);
    for (let i = 0; i < AGORA_FINALE_HOLD_TICKS; i++) agoraCaptureSystem(w);
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
    w.agoras[0].tug = AGORA_TUG_TICKS - 1;
    spawnNear(w, 0, 0, 0);
    spawnNear(w, 0, 0, 0);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].rite, AGORA_RITE_FINALE);
    for (let i = 0; i < AGORA_FINALE_HOLD_TICKS; i++) agoraCaptureSystem(w);
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

  it('occupies faster than the invade', () => {
    assert.ok(AGORA_TUG_TICKS < AGORA_CAPTURE_TICKS);
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
