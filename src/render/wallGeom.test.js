import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DOOR_SPAN, GATE_SPAN } from '../sim/walls.js';
import { DEFAULT_WALL_STYLE } from '../sim/walls.js';
import { buildWallGeometry } from './wallGeom.js';

const style = { ...DEFAULT_WALL_STYLE, height: 6, thickness: 1.35, merlonHeight: 0.9, merlonWidth: 1, merlonGap: 0.7, footing: 0.32, pier: 0.45 };

function stone(geom) {
  return geom.castle;
}

function assertSane(part) {
  const verts = part.positions.length / 3;
  assert.equal(part.positions.length % 3, 0);
  assert.equal(part.normals.length, part.positions.length);
  assert.equal(part.uvs.length, verts * 2);
  assert.equal(part.indices.length % 3, 0);
  for (let i = 0; i < part.positions.length; i++) assert.ok(Number.isFinite(part.positions[i]));
  for (let i = 0; i < part.uvs.length; i++) assert.ok(Number.isFinite(part.uvs[i]));
  for (let i = 0; i < part.indices.length; i++) {
    assert.ok(part.indices[i] >= 0 && part.indices[i] < verts);
  }
}

function triNormal(positions, ia, ib, ic) {
  const ax = positions[ia];
  const ay = positions[ia + 1];
  const az = positions[ia + 2];
  const bx = positions[ib] - ax;
  const by = positions[ib + 1] - ay;
  const bz = positions[ib + 2] - az;
  const cx = positions[ic] - ax;
  const cy = positions[ic + 1] - ay;
  const cz = positions[ic + 2] - az;
  return [
    cy * bz - cz * by,
    cz * bx - cx * bz,
    cx * by - cy * bx,
  ];
}

function distToPolyline(x, z, run) {
  const pts = run.points;
  const spans = run.closed ? pts.length : pts.length - 1;
  let best = Infinity;
  for (let i = 0; i < spans; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

describe('curtain wall mesh', () => {
  it('extrudes a straight run with merlons, piers, and outward sides', () => {
    const run = { closed: false, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }] };
    const geom = buildWallGeometry([run], style, () => 0);
    const mesh = stone(geom);
    assertSane(mesh);
    assert.equal(geom.stats.piers, 2);
    assert.ok(geom.stats.merlons >= 3);
    assert.ok(geom.stats.spans >= 4);

    let minY = Infinity;
    let maxY = -Infinity;
    let side = false;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      if (x > 6 && x < 10) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z > 0.5 && z < 1.15) side = true;
      }
    }
    assert.ok(side, 'shaft sits about half a thickness off the centerline');
    assert.ok(maxY > 6.5 && maxY < 7.4, `merlon top ${maxY}`);
    assert.ok(minY < 0 && minY > -0.5, `buried base ${minY}`);

    let outward = 0;
    let inward = 0;
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const ia = mesh.indices[t] * 3;
      const ib = mesh.indices[t + 1] * 3;
      const ic = mesh.indices[t + 2] * 3;
      const cz = (p[ia + 2] + p[ib + 2] + p[ic + 2]) / 3;
      const n = triNormal(p, ia, ib, ic);
      const ax = Math.abs(n[0]);
      const ay = Math.abs(n[1]);
      const az = Math.abs(n[2]);
      if (Math.abs(cz) < 0.45 || az < ax || az < ay) continue;
      if (n[2] * Math.sign(cz) > 0) outward += 1;
      else inward += 1;
    }
    assert.ok(outward > 8);
    assert.equal(inward, 0);
  });

  it('follows a slope and keeps a corner from exploding', () => {
    const sloped = buildWallGeometry(
      [{ closed: false, points: [{ x: 0, z: 0 }, { x: 20, z: 0 }] }],
      style,
      (x) => x * 0.2,
    );
    assertSane(stone(sloped));
    let maxY = -Infinity;
    const slopedPos = stone(sloped).positions;
    for (let i = 1; i < slopedPos.length; i += 3) {
      if (slopedPos[i] > maxY) maxY = slopedPos[i];
    }
    assert.ok(maxY > 9, `far pier should ride the slope, maxY ${maxY}`);

    const elbow = { closed: false, points: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }] };
    const bent = buildWallGeometry([elbow], style, () => 0);
    assertSane(stone(bent));
    assert.equal(bent.stats.piers, 3);
    let far = 0;
    const bentPos = stone(bent).positions;
    for (let i = 0; i < bentPos.length; i += 3) {
      const d = distToPolyline(bentPos[i], bentPos[i + 2], elbow);
      if (d > far) far = d;
    }
    assert.ok(far < 2.8, `miter/pier offset ${far}`);
  });

  it('rides a hill between the corners', () => {
    const geom = buildWallGeometry(
      [{ closed: false, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }] }],
      style,
      (x) => (x > 6 && x < 10 ? 4 : 0),
    );
    let peak = -Infinity;
    const pos = stone(geom).positions;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] > 7 && pos[i] < 9) peak = Math.max(peak, pos[i + 1]);
    }
    assert.ok(peak > 8, `wall should climb the hill, peak ${peak}`);
  });

  it('plants four piers on a closed square and a marker on one corner', () => {
    const square = buildWallGeometry(
      [{ closed: true, points: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }, { x: 0, z: 12 }] }],
      style,
      () => 1,
    );
    assertSane(stone(square));
    assert.equal(square.stats.piers, 4);
    assert.ok(square.stats.spans >= 8);

    const post = buildWallGeometry([{ closed: false, points: [{ x: 3, z: 4 }] }], style, () => 0);
    assert.equal(post.stats.piers, 1);
    assert.equal(post.stats.spans, 0);
    assert.ok(stone(post).positions.length > 0);
  });

  it('cuts a door under a lintel and keeps dungeon brick on its own mesh', () => {
    const run = {
      closed: false,
      kind: 'castle',
      points: [{ x: 0, z: 0 }, { x: 16, z: 0 }],
      openings: [{ d: 6, span: DOOR_SPAN, gate: 0 }, { d: 12, span: GATE_SPAN, gate: 1 }],
    };
    const geom = buildWallGeometry([run], style, () => 0);
    assertSane(stone(geom));
    assertSane(geom.wood);
    assertSane(geom.iron);
    assert.equal(geom.stats.doors, 1);
    assert.equal(geom.stats.gates, 1);
    const open = buildWallGeometry([{
      closed: false,
      points: [{ x: 0, z: 0 }, { x: 16, z: 0 }],
      openings: [{ d: 6, span: DOOR_SPAN, gate: 0, open: 1 }, { d: 12, span: GATE_SPAN, gate: 1, open: 1 }],
    }], style, () => 0);
    assert.equal(open.wood.positions.length, 0);
    assert.equal(open.iron.positions.length, 0);
    assert.ok(stone(open).positions.length > 0);
    assert.ok(geom.wood.positions.length > 0);
    assert.ok(geom.iron.positions.length > 0);
    let low = Infinity;
    const pos = stone(geom).positions;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - 6) < 0.4 && Math.abs(pos[i + 2]) < 1.2) low = Math.min(low, pos[i + 1]);
    }
    assert.ok(low > 2.5, `doorway should stop at the lintel, lowest y ${low}`);

    const brick = buildWallGeometry(
      [{ kind: 'dungeon', closed: false, points: [{ x: 0, z: 0 }, { x: 8, z: 0 }] }],
      style,
      () => 0,
    );
    assert.ok(brick.dungeon.positions.length > 0);
    assert.equal(brick.castle.positions.length, 0);
  });
});
