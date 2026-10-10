import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearestMeshInstanceHit } from './meshPick.js';

function writeYawMatrix(x, y, z, yaw, sx, sy = sx, sz = sx) {
  const m = new Float32Array(16);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  m[0] = c * sx;
  m[1] = 0;
  m[2] = -s * sx;
  m[3] = 0;
  m[4] = 0;
  m[5] = sy;
  m[6] = 0;
  m[7] = 0;
  m[8] = s * sz;
  m[9] = 0;
  m[10] = c * sz;
  m[11] = 0;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  return m;
}

const tri = {
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 0, 2]),
  indices: new Uint32Array([0, 1, 2]),
  min: [0, 0, 0],
  max: [2, 0, 2],
};

function downRay(x, z, y = 10) {
  return { ox: x, oy: y, oz: z, dx: 0, dy: -1, dz: 0 };
}

describe('mesh instance pick', () => {
  it('hits a triangle and misses beside it', () => {
    const matrices = writeYawMatrix(0, 0, 0, 0, 1);
    const hit = nearestMeshInstanceHit(downRay(0.4, 0.4), [tri], matrices, 1);
    assert.ok(hit);
    assert.equal(hit.slot, 0);
    assert.ok(Math.abs(hit.t - 10) < 1e-4);
    assert.equal(nearestMeshInstanceHit(downRay(3, 0.4), [tri], matrices, 1), null);
  });

  it('follows yaw, scale, and translation', () => {
    const yawed = writeYawMatrix(0, 0, 0, Math.PI / 2, 1);
    const hit = nearestMeshInstanceHit(downRay(0.4, -0.4), [tri], yawed, 1);
    assert.ok(hit);
    assert.equal(nearestMeshInstanceHit(downRay(0.4, 0.4), [tri], yawed, 1), null);

    const scaled = writeYawMatrix(0, 0, 0, 0, 2);
    assert.ok(nearestMeshInstanceHit(downRay(3, 0.2), [tri], scaled, 1));
    assert.equal(nearestMeshInstanceHit(downRay(3, 0.2), [tri], writeYawMatrix(0, 0, 0, 0, 1), 1), null);

    const moved = writeYawMatrix(10, 4, -3, 0, 1);
    const movedHit = nearestMeshInstanceHit(downRay(10.4, -2.6, 8), [tri], moved, 1);
    assert.ok(movedHit);
    assert.ok(Math.abs(movedHit.t - 4) < 1e-4);
  });

  it('drops a triangle past the ground clip and keeps one in front of it', () => {
    const above = {
      positions: new Float32Array([0, 2, 0, 2, 2, 0, 0, 2, 2]),
      indices: new Uint32Array([0, 1, 2]),
      min: [0, 2, 0],
      max: [2, 2, 2],
    };
    const buried = {
      positions: new Float32Array([0, -2, 0, 2, -2, 0, 0, -2, 2]),
      indices: new Uint32Array([0, 1, 2]),
      min: [0, -2, 0],
      max: [2, -2, 2],
    };
    const matrices = writeYawMatrix(0, 0, 0, 0, 1);
    const ray = downRay(0.4, 0.4, 10);
    const groundT = 10;
    assert.equal(nearestMeshInstanceHit(ray, [buried], matrices, 1, undefined, groundT + 0.05), null);
    const hit = nearestMeshInstanceHit(ray, [above, buried], matrices, 1, undefined, groundT + 0.05);
    assert.ok(hit);
    assert.ok(Math.abs(hit.t - 8) < 1e-4);
  });

  it('keeps the nearer instance and skips a rejected slot', () => {
    const matrices = new Float32Array(32);
    matrices.set(writeYawMatrix(0, 0, 0, 0, 1), 0);
    matrices.set(writeYawMatrix(0, 5, 0, 0, 1), 16);
    const near = nearestMeshInstanceHit(downRay(0.4, 0.4, 10), [tri], matrices, 2);
    assert.equal(near.slot, 1);
    assert.ok(Math.abs(near.t - 5) < 1e-4);
    const far = nearestMeshInstanceHit(
      downRay(0.4, 0.4, 10),
      [tri],
      matrices,
      2,
      (slot) => slot !== 1,
    );
    assert.equal(far.slot, 0);
    assert.ok(Math.abs(far.t - 10) < 1e-4);
  });
});
