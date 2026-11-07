import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceSharedRallyMarkers, forEachRallyDash, wrapPeriod } from './rallyDash.js';

function spans(pathLen, offset, dashLen = 1.55, period = 2.6) {
  const out = [];
  forEachRallyDash(pathLen, offset, dashLen, period, (a, b) => out.push([a, b]));
  return out;
}

describe('rallyDash', () => {
  it('wraps negative phase into [0, period)', () => {
    assert.ok(Math.abs(wrapPeriod(-0.2, 2.6) - 2.4) < 1e-9);
    assert.equal(wrapPeriod(2.6, 2.6), 0);
  });

  it('increasing offset moves dashes toward the path end', () => {
    const on = (list, s) => list.some(([a, b]) => s >= a && s < b);
    const a = spans(20, 0);
    const b = spans(20, 0.4);
    assert.equal(on(a, 0.1), true);
    assert.equal(on(b, 0.1), false);
    assert.equal(on(b, 0.5), true);
    const startA = a.find((s) => Math.abs(s[0] - 2.6) < 1e-9);
    const startB = b.find((s) => Math.abs(s[0] - 3.0) < 1e-9);
    assert.ok(startA && startB);
  });

  it('keeps one continuous pattern (no per-segment restart)', () => {
    const s = spans(10, 0, 1.55, 2.6);
    for (let i = 1; i < s.length; i++) {
      assert.ok(s[i][0] >= s[i - 1][1]);
      assert.ok(Math.abs(s[i][0] - s[i - 1][0] - 2.6) < 1e-9);
    }
  });

  it('draws one shared flag and keeps each building path', () => {
    const shared = { x: 20, z: 4, owner: 0, attackMove: false };
    const hop = {
      x: 40,
      z: 4,
      owner: 0,
      attackMove: false,
      points: [{ x: 20, z: 4 }, { x: 40, z: 4 }],
    };
    const out = coalesceSharedRallyMarkers([
      { ...shared, fromX: 0, fromZ: 0, points: [{ x: 0, z: 0 }, { x: 20, z: 4 }] },
      { ...shared, fromX: 8, fromZ: 0, points: [{ x: 8, z: 0 }, { x: 20, z: 4 }] },
      { ...hop },
      { ...hop },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].noFlag, undefined);
    assert.equal(out[1].noFlag, true);
    assert.equal(out[1].noLine, undefined);
    assert.equal(out[2].noFlag, undefined);
    assert.equal(out[2].noLine, undefined);
  });
});
