import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  XR_FADE_COVER,
  XR_FADE_DEPTH,
  XR_FADE_SPEECH_CUT,
  paintFadeNarrator,
  xrFadeMix,
  xrFadePlane,
} from './xrFade.js';

function identityLookingZ() {
  const wm = new Float32Array(16);
  wm[0] = wm[5] = wm[10] = wm[15] = 1;
  return wm;
}

describe('xrFadePlane', () => {
  it('sits on the look axis and covers the frustum with margin', () => {
    const wm = identityLookingZ();
    wm[12] = 4;
    wm[13] = 20;
    wm[14] = -6;
    const pose = xrFadePlane(wm, { h: 1.2, v: 0.8 }, XR_FADE_DEPTH);
    assert.ok(Math.abs(pose.x - 4) < 1e-6);
    assert.ok(Math.abs(pose.y - 20) < 1e-6);
    assert.ok(Math.abs(pose.z - (-6 + XR_FADE_DEPTH)) < 1e-6);
    assert.ok(Math.abs(pose.width - 2 * XR_FADE_DEPTH * 1.2 * XR_FADE_COVER) < 1e-6);
    assert.ok(Math.abs(pose.height - 2 * XR_FADE_DEPTH * 0.8 * XR_FADE_COVER) < 1e-6);
    assert.ok(Math.abs(pose.zAxis[0]) < 1e-8);
    assert.ok(Math.abs(pose.zAxis[1]) < 1e-8);
    assert.ok(Math.abs(pose.zAxis[2] + 1) < 1e-8);
  });
});

describe('xrFadeMix', () => {
  it('snaps without a duration and eases out toward the target', () => {
    assert.equal(xrFadeMix(0, 1, 10, 0), 1);
    const mid = xrFadeMix(0, 1, 80, 160);
    assert.ok(mid > 0.5 && mid < 1);
    assert.equal(xrFadeMix(0, 1, 160, 160), 1);
  });
});

describe('paintFadeNarrator', () => {
  it('draws narrator copy on a clear plate', () => {
    const w = 64;
    const h = 32;
    const canvas = { width: w, height: h };
    const ops = [];
    const ctx = {
      canvas,
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
      clearRect(...args) { ops.push(['clear', ...args]); },
      fillText(text, x, y) { ops.push(['text', text, x, y]); },
      measureText(text) { return { width: String(text).length * 6 }; },
    };
    paintFadeNarrator(ctx, w, h, [{ text: 'Wait.' }]);
    assert.equal(ops[0][0], 'clear');
    assert.ok(ops.some((op