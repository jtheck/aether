import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLY_SLASH_SEGMENTS,
  holyInfusionGeometry,
  holySlashGeometry,
  rollSlashPose,
  slashChordAngle,
} from './priestFx.js';

function stationWidth(g, i) {
  const inner = i * 2;
  const outer = inner + 1;
  const dx = g.positions[outer * 3] - g.positions[inner * 3];
  const dy = g.positions[outer * 3 + 1] - g.positions[inner * 3 + 1];
  return Math.hypot(dx, dy);
}

describe('priest smite slash', () => {
  it('is a pointed crescent, not a squashed disc', () => {
    const g = holySlashGeometry();
    const n = HOLY_SLASH_SEGMENTS;
    assert.equal(g.indices.length, n * 6);
    assert.equal(g.positions.length / 3, (n + 1) * 2);
    for (let v = 0; v < g.positions.length / 3; v++) {
      assert.equal(g.positions[v * 3 + 2], 0);
    }
    assert.ok(stationWidth(g, 0) < 1e-4, 'one tip comes to a point');
    assert.ok(stationWidth(g, n) < 1e-4, 'the other tip comes to a point');
    const mid = stationWidth(g, n >> 1);
    assert.ok(mid > stationWidth(g, 1) * 4, 'the blade is thickest through the middle');
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < g.positions.length / 3; v++) {
      const x = g.positions[v * 3];
      const y = g.positions[v * 3 + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const spanY = maxY - minY;
    const spanX = maxX - minX;
    assert.ok(spanY > spanX * 2, 'the cut is long, not round');
    assert.ok(spanY / mid > 6, 'the cut is a blade, not an oval');
    const midVert = (n >> 1) * 2;
    const mx = (g.positions[midVert * 3] + g.positions[(midVert + 1) * 3]) * 0.5;
    const my = (g.positions[midVert * 3 + 1] + g.positions[(midVert + 1) * 3 + 1]) * 0.5;
    assert.ok(Math.hypot(mx, my) < 0.05, 'the thick of the blade sits on the target');
  });

  it('cuts across a side-on shot instead of lying flat', () => {
    const angle = slashChordAngle(1, 0, 0, 0, 1, 0);
    const right = -Math.sin(angle);
    const up = Math.cos(angle);
    assert.ok(Math.abs(up) > Math.abs(right) * 1.3);
    const fallback = slashChordAngle(1, 0, 0, 0, 0, 0);
    const fr = -Math.sin(fallback);
    const fu = Math.cos(fallback);
    assert.ok(Math.abs(fr) > 0.2 && Math.abs(fu) > 0.2);
  });

  it('rolls a different arch and strike angle for each hit', () => {
    const seq = [0.1, 0.2, 0.9, 0.85, 0.4, 0.15];
    let i = 0;
    const rand = () => seq[i++];
    const a = rollSlashPose(rand);
    const b = rollSlashPose(rand);
    assert.ok(a.flat >= 0.34 && a.flat <= 0.62);
    assert.ok(b.flat >= 0.34 && b.flat <= 0.62);
    assert.notEqual(a.flat, b.flat);
    assert.ok(Math.abs(a.spin - b.spin) > 0.5);
    assert.notEqual(a.sweepDir, b.sweepDir);
  });
});

describe('priest heal infusion', () => {
  it('is an upright sheet from the feet to the crown', () => {
    const g = holyInfusionGeometry();
    assert.equal(g.positions.length / 3, 4);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < 4; v++) {
      assert.equal(g.positions[v * 3 + 2], 0);
      minX = Math.min(minX, g.positions[v * 3]);
      maxX = Math.max(maxX, g.positions[v * 3]);
      minY = Math.min(minY, g.positions[v * 3 + 1]);
      maxY = Math.max(maxY, g.positions[v * 3 + 1]);
    }
    assert.equal(minX, -1);
    assert.equal(maxX, 1);
    assert.equal(minY, 0);
    assert.equal(maxY, 1);
  });
});
