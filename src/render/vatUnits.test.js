import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNIT } from '../sim/unitTypes.js';
import {
  BRIGAND_TORCH_SOCKET,
  clipForVatState,
  maxVatInstancesPerBatch,
  parseGlbJson,
  primeVatInstanceCapacity,
  vatDefFromGlbJson,
  vatInstanceTexelWidth,
  vatRolesFromClipNames,
  vatWant,
  vatWalkFps,
  vatWalkGait,
  VAT_WALK_RATE_MIN,
  VAT_WALK_RATE_MAX,
  VAT_CLIP,
  VAT_FROZEN,
  VAT_UNIT_DEFS,
} from './vatUnits.js';

function glbJson(rel) {
  return parseGlbJson(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
}

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

function sniffedRolesMatchAuthoredDefs() {
  for (const def of [VAT_UNIT_DEFS[UNIT.VILLAGER], VAT_UNIT_DEFS[UNIT.WARRIOR]]) {
    const file = def.url.split('/').pop();
    const sniffed = vatDefFromGlbJson(def.url, glbJson(`../../assets/models/${file}`));
    assert.ok(sniffed, file);
    assert.equal(sniffed.idleClip, def.idleClip, file);
    assert.equal(sniffed.walkClip, def.walkClip, file);
    assert.equal(sniffed.carryClip, def.carryClip, file);
    assert.equal(sniffed.chopClip, def.chopClip, file);
    assert.equal(sniffed.attackClip, def.attackClip, file);
  }
}

function monkClipsLeaveTheBindPose() {
  const sniffed = vatDefFromGlbJson('/assets/models/monk.glb', glbJson('../../assets/models/monk.glb'));
  assert.equal(sniffed.idleClip, 'Idle');
  assert.equal(sniffed.walkClip, 'Walk');
  assert.equal(sniffed.attackClip, 'Attack');
  assert.equal(sniffed.carryClip, undefined);
}

function rigidGlbStaysOffVat() {
  assert.equal(vatDefFromGlbJson('/assets/models/archer.glb', glbJson('../../assets/models/archer.glb')), null);
  assert.equal(vatDefFromGlbJson('/x.glb', {
    animations: [{ name: 'spin' }],
    nodes: [{ name: 'Cube' }],
  }), null);
}

function clipNamesMapOntoRoles() {
  const vill = vatRolesFromClipNames(['carry', 'chop', 'idle', 'idle.001', 'walk_cycle']);
  assert.equal(vill.idleClip, 'idle');
  assert.equal(vill.walkClip, 'walk_cycle');
  assert.equal(vill.carryClip, 'carry');
  assert.equal(vill.chopClip, 'chop');
  const posed = vatRolesFromClipNames(['ArmatureAction']);
  assert.equal(posed.idleClip, 'ArmatureAction');
  assert.equal(posed.walkClip, 'ArmatureAction');
  assert.equal(vatRolesFromClipNames([]), null);
  assert.equal(vatRolesFromClipNames(['', null]), null);
}

function brigandKeepsVillagerBakeAndATorch() {
  const def = VAT_UNIT_DEFS[UNIT.BRIGAND];
  const vill = VAT_UNIT_DEFS[UNIT.VILLAGER];
  assert.equal(def.url, vill.url);
  assert.equal(def.idleClip, vill.idleClip);
  assert.equal(def.walkClip, vill.walkClip);
  assert.deepEqual(def.extraSockets, [BRIGAND_TORCH_SOCKET]);
  // Idle Arm.R tip — not bind T-pose, not a guessed hip offset.
  assert.ok(BRIGAND_TORCH_SOCKET.x > 0.4);
  assert.ok(BRIGAND_TORCH_SOCKET.y > 1.1);
  assert.ok(BRIGAND_TORCH_SOCKET.y < 1.3);
}

texelWidthMatchesLitePacking();
warriorHooksAuthoredClipNames();
sniffedRolesMatchAuthoredDefs();
monkClipsLeaveTheBindPose();
rigidGlbStaysOffVat();
clipNamesMapOntoRoles();
brigandKeepsVillagerBakeAndATorch();
vatWalkFpsScalesWithRate();
vatWantPrefersChopOverIdle();
vatWantPrefersAttackOverWalk();
clipForVatStateUsesChop();
defaultBatchCapIsTheDestroyedSize();
primeUploadsReservedSlots();
maxInstancesUsesTextureLimit();
console.log('vatUnits.test.js ok');
