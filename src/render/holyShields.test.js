import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIREBALL_ORB_INNER,
  FIREBALL_ORB_OUTER,
  FIREBALL_ORB_SEGMENTS,
  HOLY_SHIELD_RING_INNER,
  HOLY_SHIELD_RING_OUTER,
  HOLY_SHIELD_SIDE_SEGMENTS,
  fireballDiscGeometry,
  holyShieldRingGeometry,
} from './holyShields.js';

describe('holy shield ring', () => {
  it('is a flat side sheen, not a filled circle', () => {
    const g = holyShieldRingGeometry();
    const vertsPerArc = (HOLY_SHIELD_SIDE_SEGMENTS + 1) * 2;
    assert.equal(g.indices.length, HOLY_SHIELD_SIDE_SEGMENTS * 2 * 6);
    assert.equal(g.positions.length / 3, vertsPerArc * 2);
    assert.ok(HOLY_SHIELD_SIDE_SEGMENTS >= 16);
    let minR = Infinity;
    let maxR = 0;
    let left = false;
    let right = false;
    for (let v = 0; v < g.positions.length / 3; v++) {
      const x = g.positions[v * 3];
      const y = g.positions[v * 3 + 1];
      assert.ok(Math.abs(x) + 1e-4 >= Math.abs(y), 'top and bottom arcs are not drawn');
      assert.equal(g.positions[v * 3 + 2], 0);
      const r = Math.hypot(x, y);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      if (x < 0) left = true;
      if (x > 0) right = true;
    }
    assert.equal(left, true);
    assert.equal(right, true);
    assert.ok(Math.abs(minR - HOLY_SHIELD_RING_INNER) < 1e-5);
    assert.ok(Math.abs(maxR - HOLY_SHIELD_RING_OUTER) < 1e-5);
  });

  it('gives the fireball a filled disc, not side arcs', () => {
    const g = fireballDiscGeometry();
    assert.equal(g.indices.length, FIREBALL_ORB_SEGMENTS * 3);
    assert.equal(g.positions.length / 3, FIREBALL_ORB_SEGMENTS + 1);
    assert.ok(FIREBALL_ORB_INNER / FIREBALL_ORB_OUTER < HOLY_SHIELD_RING_INNER / HOLY_SHIELD_RING_OUTER);
    assert.equal(g.positions[0], 0);
    assert.equal(g.positions[1], 0);
    let maxGap = 0;
    let prev = null;
    for (let v = 1; v < g.positions.length / 3; v++) {
      const x = g.positions[v * 3];
      const y = g.positions[v * 3 + 1];
      assert.equal(g.positions[v * 3 + 2], 0);
      assert.ok(Math.abs(Math.hypot(x, y) - FIREBALL_ORB_OUTER) < 1e-5);
      const a = Math.atan2(y, x);
      if (prev != null) {
        let gap = a - prev;
        if (gap < 0) gap += Math.PI * 2;
        maxGap = Math.max(maxGap, gap);
      }
      prev = a;
    }
    assert.ok(maxGap < (Math.PI * 2) / FIREBALL_ORB_SEGMENTS + 1e-4);
  });
});
