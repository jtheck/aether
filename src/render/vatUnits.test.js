import assert from 'node:assert/strict';
import { UNIT } from '../sim/unitTypes.js';
import {
  clipForVatState,
  maxVatInstancesPerBatch,
  primeVatInstanceCapacity,
  vatInstanceTexelWidth,
  vatWant,
  vatWalkFps,
  vatWalkGait,
  VAT_WALK_RATE_MIN,
  VAT_WALK_RATE_MAX,
  VAT_CLIP,
  VAT_FROZEN,
  VAT_UNIT_DEFS,
} from './vatUnits.js';

function texelWidthMatchesLitePacking() {
  // Lite dual-packs each instance into 2 rgba32float texels on a 1-row texture.
  assert.equal(vatInstanceTexelWidth(32), 64);
  assert.equal(vatInstanceTexelWidth(1), 2);
  assert.equal(vatInstanceTexelWidth(0), 2);
}

function defaultBatchCapIsTheDestroyedSize() {
  // UNIT_BATCH_INITIAL is 32 → first Lite instance tex is unlabeled 64x1 RGBA32Float.
  assert.equal(vatInstanceTexelWidth(32), 64);
}

function primeUploadsReservedSlots() {
  const uploads = [];
  const handle = {
    setInstances(params) {
      uploads.push(params.length);
    },
  };
  primeVatInstanceCapacity(handle, 32);
  handle.setInstances(new Float32Array(8));
  handle.setInstances(new Float32Array(256));
  assert.deepEqual(uploads, [128, 8, 128]);
}

function maxInstancesUsesTextureLimit() {
  assert.equal(maxVatInstancesPerBatch({ _device: { limits: { maxTextureDimension2D: 8192 } } }), 4096);
  assert.equal(maxVatInstancesPerBatch({}), 4096);
}

function vatWalkFpsScalesWithRate() {
  assert.equal(vatWalkGait(0), 0);
  assert.equal(vatWalkGait(0.1), VAT_WALK_RATE_MIN);
  assert.ok(vatWalkGait(0.28) >= VAT_WALK_RATE_MIN);
  assert.ok(vatWalkGait(0.28) <= VAT_WALK_RATE_MIN + 1e-6, 'stroll stays a walk');
  assert.ok(vatWalkGait(1) >= VAT_WALK_RATE_MAX - 1e-6, 'full speed is a run');
  assert.equal(vatWalkFps(24, 1), 24 * VAT_WALK_RATE_MAX);
  assert.equal(vatWalkFps(24, 0), 0);
}

function vatWantPrefersChopOverIdle() {
  assert.equal(vatWant(false, false, true, true), VAT_CLIP.CHOP);
  assert.equal(vatWant(true, false, true, true), VAT_CLIP.CHOP);
  assert.equal(vatWant(false, true, true, true), VAT_CLIP.CARRY);
  assert.equal(vatWant(true, true, true, false), VAT_CLIP.CARRY_WALK);
  assert.equal(vatWant(false, false, false, true), VAT_CLIP.CHOP | VAT_FROZEN);
}

function vatWantPrefersAttackOverWalk() {
  assert.equal(vatWant(false, false, true, false, true), VAT_CLIP.ATTACK);
  assert.equal(vatWant(true, false, true, false, true), VAT_CLIP.ATTACK);
  assert.equal(vatWant(true, false, true, true, true), VAT_CLIP.CHOP);
  assert.equal(vatWant(false, false, false, false, true), VAT_CLIP.ATTACK | VAT_FROZEN);
}

function clipForVatStateUsesChop() {
  const clips = {
    idleClip: { name: 'idle' },
    walkClip: { name: 'walk' },
    carryClip: { name: 'carry' },
    carryWalkClip: { name: 'carry_walk' },
    chopClip: { name: 'chop' },
    attackClip: { name: 'Attack_Swing' },
  };
  assert.equal(clipForVatState(clips, VAT_CLIP.CHOP), clips.chopClip);
  assert.equal(clipForVatState(clips, VAT_CLIP.CARRY), clips.carryClip);
  assert.equal(clipForVatState(clips, VAT_CLIP.ATTACK), clips.attackClip);
}

function warriorHooksAuthoredClipNames() {
  const def = VAT_UNIT_DEFS[UNIT.WARRIOR];
  assert.equal(def.url, '/assets/models/warrior.glb');
  assert.equal(def.idleClip, 'Idle');
  assert.equal(def.walkClip, 'Run');
  assert.equal(def.attackClip, 'Attack_Swing');
}

texelWidthMatchesLitePacking();
warriorHooksAuthoredClipNames();
vatWalkFpsScalesWithRate();
vatWantPrefersChopOverIdle();
vatWantPrefersAttackOverWalk();
clipForVatStateUsesChop();
defaultBatchCapIsTheDestroyedSize();
primeUploadsReservedSlots();
maxInstancesUsesTextureLimit();
console.log('vatUnits.test.js ok');
