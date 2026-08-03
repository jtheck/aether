import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { buildField } from './field.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import {
  createAgoras,
  agoraCaptureSystem,
  AGORA_CAPTURE_TICKS,
  AGORA_OCCUPATION_RADIUS,
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
    const field = buildField(1, { width: 64, height: 64 });

    // Pack attackers on the point (owner 1).
    for (let i = 0; i < 4; i++) {
      spawnNear(w, 1, 0, 0);
    }

    for (let t = 0; t < 10; t++) {
      agoraCaptureSystem(w);
    }
    assert.equal(w.agoras[0].progress, 10);
    assert.equal(w.agoras[0].capturer, 1);
    assert.equal(w.kothMatchOver, 0);
  });

  it('stalls when defenders have enough presence', () => {
    const w = createWorld(2);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.kothMatchOver = 0;

    spawnNear(w, 0, 0, 0);
    spawnNear(w, 0, 0, 0);
    spawnNear(w, 1, 0, 0); // only 1 attacker vs 2 defenders — blocked
    spawnNear(w, 1, 0, 0);

    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].progress, 0);
    assert.equal(w.agoras[0].contested, 1);
  });

  it('ends the match on full capture', () => {
    const w = createWorld(3);
    w.agoras = createAgoras([{ owner: 0, x: 40, z: 0 }]);
    w.kothMatchOver = 0;
    const ax = w.agoras[0].x;
    const az = w.agoras[0].z;

    for (let i = 0; i < 3; i++) spawnNear(w, 1, ax, az);

    w.agoras[0].progress = AGORA_CAPTURE_TICKS - 1;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].captured, 1);
    assert.equal(w.agoras[0].owner, 1);
    assert.equal(w.matchWinner, 1);
    assert.equal(w.kothMatchOver, 1);
  });

  it('decays when attackers leave', () => {
    const w = createWorld(4);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    w.agoras[0].progress = 20;
    agoraCaptureSystem(w);
    assert.equal(w.agoras[0].progress, 19);
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
