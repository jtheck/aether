import assert from 'node:assert/strict';
import {
  clipForVatState,
  maxVatInstancesPerBatch,
  primeVatInstanceCapacity,
  vatInstanceTexelWidth,
  vatWant,
  VAT_CLIP,
  VAT_FROZEN,
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

function vatWantPrefersChopOverIdle() {
  assert.equal(vatWant(false, false, true, true), VAT_CLIP.CHOP);
  assert.equal(vatWant(true, false, true, true), VAT_CLIP.CHOP);
  assert.equal(vatWant(false, true, true, true), VAT_CLIP.CARRY);
  assert.equal(vatWant(true, true, true, false), VAT_CLIP.CARRY_WALK);
  assert.equal(vatWant(false, false, false, true), VAT_CLIP.CHOP | VAT_FROZEN);
}

function clipForVatStateUsesChop() {
  const clips = {
    idleClip: { name: 'idle' },
    walkClip: { name: 'walk' },
    carryClip: { name: 'carry' },
    carryWalkClip: { name: 'carry_walk' },
    chopClip: { name: 'chop' },
  };
  assert.equal(clipForVatState(clips, VAT_CLIP.CHOP), clips.chopClip);
  assert.equal(clipForVatState(clips, VAT_CLIP.CARRY), clips.carryClip);
}

texelWidthMatchesLitePacking();
vatWantPrefersChopOverIdle();
clipForVatStateUsesChop();
defaultBatchCapIsTheDestroyedSize();
primeUploadsReservedSlots();
maxInstancesUsesTextureLimit();
console.log('vatUnits.test.js ok');
