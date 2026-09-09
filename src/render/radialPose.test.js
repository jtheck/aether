import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameRadialCenterOnAnchor,
  poseRadialFramingBuilding,
  radialNearRingLift,
  fitRadialInViewport,
  apparentScreenRadius,
  stepRadialEdgeOpacity,
  radialHudFadeAlpha,
  radialHudPremulRgba,
  RADIAL_HUD_BLEND_ALPHA,
} from './radialPose.js';

function colinear(a, b, c, eps = 1e-5) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return Math.hypot(cx, cy, cz) < eps;
}

describe('radialPose framing', () => {
  it('places the hub on the camera→building ray above the building', () => {
    const eye = { x: -80, y: 50, z: -80 };
    const c = frameRadialCenterOnAnchor(eye, 0, 2.4, 0, 10);
    assert.ok(c.y > 2.4);
    assert.ok(colinear(eye, c, { x: 0, y: 2.4, z: 0 }));
    assert.ok(c.x < 0 && c.x > -80);
    assert.ok(c.z < 0 && c.z > -80);
  });

  it('falls back to the building XZ when the camera is level with it', () => {
    const eye = { x: -40, y: 2.4, z: 0 };
    const c = frameRadialCenterOnAnchor(eye, 0, 2.4, 0, 8);
    assert.equal(c.x, 0);
    assert.equal(c.z, 0);
    assert.equal(c.y, 10.4);
  });

  it('keeps HUD scale tied to the posed center, not the building', () => {
    const eye = { x: -80, y: 50, z: -80 };
    const scaleForDist = (d) => Math.max(0.35, d / 110);
    const posed = poseRadialFramingBuilding(
      eye,
      0,
      2.4,
      0,
      scaleForDist,
      16.1,
      0.56,
      1.2,
    );
    const distC = Math.hypot(eye.x - posed.x, eye.y - posed.y, eye.z - posed.z);
    assert.ok(Math.abs(posed.hudScale - scaleForDist(distC)) < 1e-6);
    assert.ok(
      posed.hudScale <
        scaleForDist(Math.hypot(eye.x, eye.y - 2.4, eye.z)),
    );
    assert.ok(radialNearRingLift(0.56, 16.1, 1, 1.2) > 8);
  });
});

describe('fitRadialInViewport', () => {
  const vw = 400;
  const vh = 400;
  const worldToScreen = (x, y) => ({ x: vw * 0.5 + x, y: vh * 0.5 - y });
  const getViewport = () => ({ width: vw, height: vh });
  const eyeAt = (x) => ({ x, y: 0, z: -100 });

  it('leaves a centered disc alone', () => {
    const out = fitRadialInViewport({
      eye: eyeAt(0),
      x: 0,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
      marginPx: 10,
    });
    assert.equal(out.hudScale, 1);
    assert.equal(out.opacity, 1);
    assert.equal(out.hidden, false);
    assert.equal(out.x, 0);
    assert.equal(out.y, 0);
  });

  it('slides inward before shrinking', () => {
    const out = fitRadialInViewport({
      eye: eyeAt(-122),
      x: -122,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
      marginPx: 10,
    });
    // Screen x = 78. Need = 12. Slide-only budget ≈ 20.
    assert.equal(out.hudScale, 1);
    assert.equal(out.opacity, 1);
    assert.ok(Math.abs(out.x - (-110)) < 0.6);
  });

  it('mixes in shrink after the slide-only band', () => {
    const out = fitRadialInViewport({
      eye: eyeAt(-144),
      x: -144,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
      marginPx: 10,
    });
    // Screen x = 56. Need = 34. Past slide-only, into the mix.
    assert.ok(out.hudScale < 0.98);
    assert.ok(out.hudScale > 0.78);
    assert.ok(out.x > -144);
    assert.equal(out.opacity, 1);
    assert.equal(out.hidden, false);
  });

  it('stops sliding and fades after max slide and shrink', () => {
    const out = fitRadialInViewport({
      eye: eyeAt(-190),
      x: -190,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
      marginPx: 10,
    });
    assert.equal(out.hudScale, 0.78);
    assert.ok(out.x > -190);
    assert.ok(out.x < -190 + 40);
    assert.equal(out.opacity, 0);
    assert.equal(out.hidden, true);
  });

  it('lets the disc hang past the viewport before sliding', () => {
    const tight = fitRadialInViewport({
      eye: eyeAt(-118),
      x: -118,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
      marginPx: 10,
    });
    const hang = fitRadialInViewport({
      eye: eyeAt(-118),
      x: -118,
      y: 0,
      z: 0,
      hudScale: 1,
      worldRadius: 80,
      worldToScreen,
      getViewport,
    });
    assert.equal(hang.hudScale, 1);
    assert.equal(hang.x, -118);
    assert.equal(tight.hudScale, 1);
    assert.ok(tight.x > -118);
  });

  it('keeps HUD mesh alpha below 1 so Lite enables blending', () => {
    assert.equal(radialHudFadeAlpha(1, 1), RADIAL_HUD_BLEND_ALPHA);
    assert.equal(radialHudFadeAlpha(1, 0.5), 0.5);
    assert.equal(radialHudFadeAlpha(0.62, 1), 0.62);
    assert.equal(radialHudFadeAlpha(1, 0), 0);
    assert.deepEqual(radialHudPremulRgba([0.8, 1, 1, 1], 0.5), [0.4, 0.5, 0.5, 0.5]);
    assert.deepEqual(radialHudPremulRgba([1, 1, 1, 0.5], 0.5), [0.25, 0.25, 0.25, 0.25]);
  });

  it('eases displayed opacity toward the target', () => {
    const mid = stepRadialEdgeOpacity(1, 0, 0.05);
    assert.ok(mid < 1);
    assert.ok(mid > 0.6);
    assert.equal(stepRadialEdgeOpacity(0.4, 0.4, 0.016), 0.4);
    assert.equal(stepRadialEdgeOpacity(1, 0, 1), 0);
  });

  it('reports a positive apparent radius along camera right', () => {
    const r = apparentScreenRadius(eyeAt(0), 0, 0, 0, 40, worldToScreen);
    assert.ok(Math.abs(r - 40) < 1e-6);
  });
});
