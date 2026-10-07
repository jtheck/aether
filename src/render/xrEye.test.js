import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eyeReach, xrFitFov, xrShadowCover } from './xrEye.js';

/** GL-style projection for tangents l, r, b, t at the unit plane. */
function proj(l, r, b, t) {
  const p = new Float32Array(16);
  p[0] = 2 / (r - l);
  p[5] = 2 / (t - b);
  p[8] = (r + l) / (r - l);
  p[9] = (t + b) / (t - b);
  p[10] = -1;
  p[11] = -1;
  return p;
}

describe('eyeReach', () => {
  it('takes the widest edge across asymmetric eyes', () => {
    const left = { projectionMatrix: proj(-1.3, 0.9, -1.1, 1.0) };
    const right = { projectionMatrix: proj(-0.9, 1.3, -1.1, 1.0) };
    const { h, v } = eyeReach([left, right]);
    assert.ok(Math.abs(h - 1.3) < 1e-5);
    assert.ok(Math.abs(v - 1.1) < 1e-5);
  });

  it('falls back to 90 degrees without views', () => {
    assert.deepEqual(eyeReach([]), { h: 1, v: 1 });
  });
});

describe('xrFitFov', () => {
  it('covers both axes at the canvas aspect', () => {
    const eyes = { h: 1.3, v: 1.1 };
    for (const aspect of [0.5, 1, 16 / 9, 3]) {
      const t = Math.tan(xrFitFov(aspect, eyes) / 2);
      assert.ok(t >= eyes.v, `vertical at ${aspect}`);
      assert.ok(t * aspect >= eyes.h, `horizontal at ${aspect}`);
    }
  });
});

describe('xrShadowCover', () => {
  it('holds still under head jitter', () => {
    let cover = xrShadowCover(40, 1000);
    const first = cover;
    for (let i = 0; i < 200; i++) {
      cover = xrShadowCover(40 + Math.sin(i) * 0.05, 1000, cover);
      assert.equal(cover, first);
    }
  });

  it('holds still when jitter straddles a rung', () => {
    let cover = xrShadowCover(36, 1000);
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      cover = xrShadowCover(36 + (i % 2 ? 0.01 : -0.01), 1000, cover);
      seen.add(cover);
    }
    assert.ok(seen.size <= 2);
    assert.equal(cover, xrShadowCover(36.01, 1000, cover));
  });

  it('always reaches past the head and shrinks when close', () => {
    let cover = 0;
    for (const h of [200, 120, 60, 30, 12]) {
      cover = xrShadowCover(h, 5000, cover);
      assert.ok(cover >= Math.min(5000, h * 5), `height ${h}`);
    }
    assert.equal(cover, 80);
  });

  it('caps at the board range', () => {
    assert.equal(xrShadowCover(1000, 300), 300);
  });
});
