import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameRadialCenterOnAnchor,
  poseRadialFramingBuilding,
  radialNearRingLift,
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
