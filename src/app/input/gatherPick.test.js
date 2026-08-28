import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createField, TILE_SIZE_F, worldHalfFFromField } from '../../sim/field.js';
import { growTreeAt } from '../../sim/trees.js';
import { SCENERY, rockYield } from '../../sim/scenery.js';
import { pickGatherNodeOnRay, rayHitYawBox } from './gatherPick.js';

function plantTree(field, tx, tz, stock = 42) {
  const tile = tz * field.width + tx;
  assert.ok(growTreeAt(field, tile, stock), 'tree planted');
  return tile;
}

function plantRock(field, tx, tz, kind, stock) {
  const tile = tz * field.width + tx;
  field.sceneryType[tile] = kind;
  field.rockStock[tile] = stock;
  return tile;
}

describe('gather volume pick', () => {
  it('hits a tree canopy when the ground click is the next tile over', () => {
    const field = createField(1);
    field.pass.fill(1);
    const half = worldHalfFFromField(field);
    const tx = Math.floor(field.width / 2);
    const tz = Math.floor(field.height / 2);
    const tree = plantTree(field, tx, tz);
    const cx = (tx + 0.5) * TILE_SIZE_F - half;
    const cz = (tz + 0.5) * TILE_SIZE_F - half;
    // Camera in front, looking through the trunk toward dirt behind the tree.
    const ray = {
      ox: cx - 12,
      oy: 4,
      oz: cz,
      dx: 1,
      dy: -0.22,
      dz: 0,
    };
    const len = Math.hypot(ray.dx, ray.dy, ray.dz);
    ray.dx /= len;
    ray.dy /= len;
    ray.dz /= len;
    assert.equal(pickGatherNodeOnRay(field, ray, { maxT: 40 }), tree);
  });

  it('misses empty air', () => {
    const field = createField(1);
    field.pass.fill(1);
    const ray = { ox: 0, oy: 20, oz: 0, dx: 0, dy: -1, dz: 0 };
    assert.equal(pickGatherNodeOnRay(field, ray, { maxT: 40 }), -1);
  });

  it('hits a moss rock from the side of its footprint', () => {
    const field = createField(1);
    field.pass.fill(1);
    field.rockStock = new Uint16Array(field.width * field.height);
    field.sceneryType = new Uint8Array(field.width * field.height);
    const half = worldHalfFFromField(field);
    const tx = Math.floor(field.width / 2);
    const tz = Math.floor(field.height / 2);
    const rock = plantRock(field, tx, tz, SCENERY.ROCK_MOSS, rockYield(SCENERY.ROCK_MOSS));
    const cx = (tx + 0.5) * TILE_SIZE_F - half;
    const cz = (tz + 0.5) * TILE_SIZE_F - half;
    const ray = {
      ox: cx - 14,
      oy: 3,
      oz: cz,
      dx: 1,
      dy: -0.12,
      dz: 0,
    };
    const len = Math.hypot(ray.dx, ray.dy, ray.dz);
    ray.dx /= len;
    ray.dy /= len;
    ray.dz /= len;
    assert.equal(pickGatherNodeOnRay(field, ray, { maxT: 40 }), rock);
  });
});

describe('building footprint pick', () => {
  it('hits the pad and misses the old circumcircle corner', () => {
    // 2×2 tiles → 8×8 pad. Circumcircle radius is ~5.66, so a sphere would
    // eat a click 5 units out on the side. The box should miss that.
    const ray = { ox: 5, oy: 4, oz: 0, dx: 0, dy: -1, dz: 0 };
    assert.equal(rayHitYawBox(ray, 0, 0, 0, 4, -0.2, 4, 10), null);
    const onPad = { ox: 2, oy: 4, oz: 2, dx: 0, dy: -1, dz: 0 };
    assert.ok(rayHitYawBox(onPad, 0, 0, 0, 4, -0.2, 4, 10) != null);
  });

  it('respects yaw so a rotated pad is not a world-axis square', () => {
    const yaw = Math.PI / 4;
    // Point that is outside an axis-aligned 4×4 box but inside a 45° 4×4 box.
    const ray = { ox: 5.2, oy: 4, oz: 0, dx: 0, dy: -1, dz: 0 };
    assert.equal(rayHitYawBox(ray, 0, 0, 0, 4, -0.2, 4, 10), null);
    assert.ok(rayHitYawBox(ray, 0, 0, yaw, 4, -0.2, 4, 10) != null);
  });
});
