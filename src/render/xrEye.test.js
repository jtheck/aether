import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  XR_HUD_CHROME_TAN,
  XR_HUD_EDGE_TAN,
  eyeReach,
  xrFitFov,
  xrHudChromeScale,
  xrHudEdgeScale,
  xrHudLayoutPoint,
  xrHudProjection,
  xrShadowCover,
} from './xrEye.js';

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

describe('xrHudProjection', () => {
  it('maps canvas NDC onto the eye tangents', () => {
    const p = xrHudProjection({ h: 1.2, v: 0.8 });
    assert.ok(Math.abs(p.aspect - 1.5) < 1e-6);
    assert.ok(Math.abs(Math.tan(p.fov / 2) - 0.8) < 1e-6);
    assert.ok(Math.abs(Math.tan(p.fov / 2) * p.aspect - 1.2) < 1e-6);
  });
});

describe('xrHudEdgeScale', () => {
  it('leaves a narrow eye alone', () => {
    assert.equal(xrHudEdgeScale({ h: 0.3, v: 0.3 }), 1);
  });

  it('pulls canvas edges inside the comfortable tangent', () => {
    const eyes = { h: 1.4, v: 1.1 };
    const s = xrHudEdgeScale(eyes);
    assert.ok(s < 1);
    assert.ok(s * eyes.h <= XR_HUD_EDGE_TAN + 1e-9);
    assert.ok(s * eyes.v <= XR_HUD_EDGE_TAN + 1e-9);
  });

  it('is limited by the wider axis', () => {
    const s = xrHudEdgeScale({ h: 2, v: 0.4 });
    assert.ok(Math.abs(s - XR_HUD_EDGE_TAN / 2) < 1e-9);
  });

  it('pulls the other chrome closer than the control pads', () => {
    const eyes = { h: 1.4, v: 1.1 };
    const pads = xrHudEdgeScale(eyes);
    const chrome = xrHudChromeScale(eyes);
    assert.ok(chrome < pads);
    assert.ok(chrome * eyes.h <= XR_HUD_CHROME_TAN + 1e-9);
    assert.ok(chrome * eyes.v <= XR_HUD_CHROME_TAN + 1e-9);
  });
});

describe('xrHudLayoutPoint', () => {
  it('is identity at scale 1', () => {
    assert.deepEqual(xrHudLayoutPoint(12, 40, 200, 100, 1), { x: 12, y: 40 });
  });

  it('pulls a corner halfway to center', () => {
    const p = xrHudLayoutPoint(0, 0, 200, 100, 0.5);
    assert.equal(p.x, 50);
    assert.equal(p.y, 25);
    const q = xrHudLayoutPoint(200, 100, 200, 100, 0.5);
    assert.equal(q.x, 150);
    assert.equal(q.y, 75);
    const mid = xrHudLayoutPoint(100, 50, 200, 100, 0.5);
    assert.equal(mid.x, 100);
    assert.equal(mid.y, 50);
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
