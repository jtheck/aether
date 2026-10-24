import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AGORA_CAPTURE_TICKS, AGORA_PHASE_LOCK, AGORA_PHASE_TUG, AGORA_TUG_TICKS } from '../sim/agora.js';
import {
  AGORA_CAPTURE_RING_R_MAX,
  AGORA_CAPTURE_RING_SHRINK,
  agoraCaptureRingAlpha,
  agoraCaptureRingRadiusAtProgress,
  agoraCaptureRingRgb,
  agoraCaptureRingTargetProgress,
} from './agoraCaptureRing.js';
import { AGORA_NEUTRAL_RGB } from './healthBars.js';
import { ownerTint } from './ownerTints.js';

describe('agora capture occupation ring', () => {
  it('shrinks with milestone progress and eases from full occupation radius', () => {
    assert.ok(Math.abs(agoraCaptureRingRadiusAtProgress(0) - AGORA_CAPTURE_RING_R_MAX) < 1e-6);
    const mid = agoraCaptureRingRadiusAtProgress(0.5);
    assert.ok(mid < AGORA_CAPTURE_RING_R_MAX * (1 - AGORA_CAPTURE_RING_SHRINK * 0.4));
    assert.ok(agoraCaptureRingRadiusAtProgress(1) < mid);
  });

  it('steps target progress with the five health-dot segments', () => {
    const lockHalf = {
      phase: AGORA_PHASE_LOCK,
      progress: AGORA_CAPTURE_TICKS / 2,
      tug: 0,
    };
    assert.ok(Math.abs(agoraCaptureRingTargetProgress(lockHalf) - 0.5) < 0.08);
    const tugHalf = {
      phase: AGORA_PHASE_TUG,
      progress: 0,
      tug: AGORA_TUG_TICKS / 2,
    };
    assert.ok(Math.abs(agoraCaptureRingTargetProgress(tugHalf) - 0.5) < 0.08);
  });

  it('lerps owner → gray on lock and gray → capturer on tug', () => {
    const owner = ownerTint(0);
    const lock = agoraCaptureRingRgb({
      phase: AGORA_PHASE_LOCK,
      owner: 0,
      progress: AGORA_CAPTURE_TICKS,
      capturer: 1,
    });
    assert.ok(Math.abs(lock[0] - AGORA_NEUTRAL_RGB[0]) < 0.08);
    const tug = agoraCaptureRingRgb({
      phase: AGORA_PHASE_TUG,
      owner: 0,
      tug: AGORA_TUG_TICKS,
      capturer: 1,
    });
    assert.ok(Math.abs(tug[0] - ownerTint(1)[0]) < 0.08);
  });

  it('pulses alpha when contested', () => {
    const quiet = agoraCaptureRingAlpha({ contested: 0, progress: 40, phase: 0 }, 0);
    const hot = agoraCaptureRingAlpha({ contested: 1, progress: 40, phase: 0 }, 0);
    const hot2 = agoraCaptureRingAlpha({ contested: 1, progress: 40, phase: 0 }, 400);
    assert.ok(hot > quiet || hot2 > quiet);
  });
});
