// Procedural curtain wall. A run is a centerline; this extrudes a footing,
// shaft, crenellations, and corner piers. Lite front faces are clockwise.

import { clampWallStyle, openingHeight } from '../sim/walls.js';
import { TILE_SIZE_F } from '../sim/field.js';

const SAMPLE_STEP = 2;

/** Parameters along a segment, including every terrain-grid crossing. */
function segmentParams(a, b) {
  const ts = [0];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const addGrid = (da, db) => {
    if (Math.abs(db - da) < 1e-6) return;
    const start = Math.min(da, db);
    const end = Math.max(da, db);
    let g = Math.ceil((start + 1e-4) / TILE_SIZE_F);
    for (; g * TILE_SIZE_F < end - 1e-4; g++) {
      const t = (g * TILE_SIZE_F - da) / (db - da);
      if (t > 1e-4 && t < 1 - 1e-4) ts.push(t);
    }
  };
  addGrid(a.x, b.x);
  addGrid(a.z, b.z);
  const parts = Math.max(1, Math.ceil(len / SAMPLE_STEP));
  for (let s = 1; s < parts; s++) ts.push(s / parts);
  ts.sort((p, q) => p - q);
  const out = [];
  for (const t of ts) {
    if (!out.length || t - out[out.length - 1] > 1e-3) out.push(t);
  }
  return out;
}
const BURY = 0.22;
const FOOTING_H = 0.55;
const PIER_CROWN = 0.4;
/** Extra proud of the shaft so pier faces do not sit on the wall. */
const PIER_MARGIN = 0.16;
/** One ashlar block is ~1.6 wide; the texture holds four across and four tall. */
const CASTLE_U = 1 / 6.4;
const CASTLE_V = 1 / 3.2;
const DUNGEON_U = 1 / 3.2;
const DUNGEON_V = 1 / 1.6;
let uvU = CASTLE_U;
let uvV = CASTLE_V;

function yAt(sample, x, z) {
  const y = Number(sample(x, z));
  return Number.isFinite(y) ? y : 0;
}

function edgeDir(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return null;
  return {
    dx: dx / len,
    dz: dz / len,
    nx: -dz / len,
    nz: dx / len,
    len,
  };
}

function dedupePoints(points, closed) {
  const src = [];
  for (const p of points || []) {
    const x = Number(p?.x);
    const z = Number(p?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const prev = src[src.length - 1];
    if (prev && Math.hypot(prev.x - x, prev.z - z) < 1e-3) continue;
    src.push({ x, z });
  }
  if (closed && src.length >= 2) {
    const a = src[0];
    const b = src[src.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-3) src.pop();
  }
  return src;
}

function buildStations(points, closed, sample) {
  const src = dedupePoints(points, closed);
  if (src.length === 1) {
    const p = src[0];
    return {
      stations: [{ x: p.x, z: p.z, y: yAt(sample, p.x, p.z), corner: true, arc: 0 }],
      edges: [],
      closed: false,
      perim: 0,
      single: true,
    };
  }
  let loop = closed && src.length >= 3;
  if (src.length < 2) return null;

  const stations = [];
  let arc = 0;
  const segCount = loop ? src.length : src.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = src[i];
    const b = src[(i + 1) % src.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-4) continue;
    const params = segmentParams(a, b);
    for (let s = 0; s < params.length; s++) {
      const t = params[s];
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      stations.push({
        x,
        z,
        y: yAt(sample, x, z),
        corner: s === 0,
        arc: arc + len * t,
      });
    }
    arc += len;
  }
  if (!stations.length) return null;
  if (!loop) {
    const last = src[src.length - 1];
    stations.push({
      x: last.x,
      z: last.z,
      y: yAt(sample, last.x, last.z),
      corner: true,
      arc,
    });
  } else if (stations.length < 3) {
    loop = false;
  }

  const edges = [];
  const n = stations.length;
  const eCount = loop ? n : n - 1;
  for (let i = 0; i < eCount; i++) {
    const edge = edgeDir(stations[i], stations[(i + 1) % n]);
    if (!edge) return null;
    edges.push(edge);
  }
  if (!edges.length) return null;
  let perim = 0;
  for (const edge of edges) perim += edge.len;
  return { stations, edges, closed: loop, perim, single: false };
}

function offsetRails(stations, edges, closed, dist) {
  const n = stations.length;
  const left = new Array(n);
  const right = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = stations[i];
    let nx;
    let nz;
    let scale;
    if (!closed && (i === 0 || i === n - 1)) {
      const edge = i === 0 ? edges[0] : edges[edges.length - 1];
      nx = edge.nx;
      nz = edge.nz;
      scale = dist;
    } else {
      const e0 = edges[(i - 1 + edges.length) % edges.length];
      const e1 = edges[i % edges.length];
      nx = e0.nx + e1.nx;
      nz = e0.nz + e1.nz;
      const ml = Math.hypot(nx, nz);
      if (ml < 1e-5) {
        nx = e1.nx;
        nz = e1.nz;
        scale = dist;
      } else {
        nx /= ml;
        nz /= ml;
        const align = nx * e1.nx + nz * e1.nz;
        const clamped = align > 0.35 ? align : 0.35;
        scale = dist / clamped;
        const cap = dist * 3.2;
        if (scale > cap) scale = cap;
      }
    }
    const u = p.arc * uvU;
    left[i] = { x: p.x + nx * scale, z: p.z + nz * scale, u };
    right[i] = { x: p.x - nx * scale, z: p.z - nz * scale, u };
  }
  return { left, right };
}

function pushOutwardQuad(dst, a, b, c, d, outward) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  let nx = acy * abz - acz * aby;
  let ny = acz * abx - acx * abz;
  let nz = acx * aby - acy * abx;
  const facing = nx * outward.x + ny * outward.y + nz * outward.z;
  const verts = facing < 0 ? [a, d, c, b] : [a, b, c, d];
  if (facing < 0) {
    const b2 = verts[1];
    const c2 = verts[2];
    const abx2 = b2.x - a.x;
    const aby2 = b2.y - a.y;
    const abz2 = b2.z - a.z;
    const acx2 = c2.x - a.x;
    const acy2 = c2.y - a.y;
    const acz2 = c2.z - a.z;
    nx = acy2 * abz2 - acz2 * aby2;
    ny = acz2 * abx2 - acx2 * abz2;
    nz = acx2 * aby2 - acy2 * abx2;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-8) return;
  nx /= len;
  ny /= len;
  nz /= len;
  const base = dst.pos.length / 3;
  for (const v of verts) {
    dst.pos.push(v.x, v.y, v.z);
    dst.norm.push(nx, ny, nz);
    dst.uv.push(v.u, v.v);
  }
  dst.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function vert(p, y, u, v) {
  return { x: p.x, y, z: p.z, u, v };
}

function pushWallFace(dst, a, b, y0a, y1a, y0b, y1b, outward) {
  pushOutwardQuad(
    dst,
    vert(a, y0a, a.u, y0a * uvV),
    vert(b, y0b, b.u, y0b * uvV),
    vert(b, y1b, b.u, y1b * uvV),
    vert(a, y1a, a.u, y1a * uvV),
    outward,
  );
}

function levels(station, style, showFoot) {
  const bottom = station.y - BURY;
  return {
    bottom,
    footY: showFoot ? bottom + FOOTING_H : bottom,
    top: station.y + style.height,
  };
}

function boxCorners(x, z, axes, hx, hz) {
  const { tx, tz, nx, nz } = axes;
  return [
    { x: x - tx * hx - nx * hz, z: z - tz * hx - nz * hz },
    { x: x + tx * hx - nx * hz, z: z + tz * hx - nz * hz },
    { x: x + tx * hx + nx * hz, z: z + tz * hx + nz * hz },
    { x: x - tx * hx + nx * hz, z: z - tz * hx + nz * hz },
  ];
}

function pushPrism(dst, corners, y0, y1) {
  if (!(y1 > y0 + 1e-4)) return;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = Math.hypot(dx, dz) || 1;
    const u0 = a.x * uvU;
    pushOutwardQuad(
      dst,
      { x: a.x, y: y0, z: a.z, u: u0, v: y0 * uvV },
      { x: b.x, y: y0, z: b.z, u: u0 + span * uvU, v: y0 * uvV },
      { x: b.x, y: y1, z: b.z, u: u0 + span * uvU, v: y1 * uvV },
      { x: a.x, y: y1, z: a.z, u: u0, v: y1 * uvV },
      { x: dz, y: 0, z: -dx },
    );
  }
  pushOutwardQuad(
    dst,
    { x: corners[0].x, y: y1, z: corners[0].z, u: corners[0].x * uvU, v: corners[0].z * uvU },
    { x: corners[1].x, y: y1, z: corners[1].z, u: corners[1].x * uvU, v: corners[1].z * uvU },
    { x: corners[2].x, y: y1, z: corners[2].z, u: corners[2].x * uvU, v: corners[2].z * uvU },
    { x: corners[3].x, y: y1, z: corners[3].z, u: corners[3].x * uvU, v: corners[3].z * uvU },
    { x: 0, y: 1, z: 0 },
  );
}

function axisish(edge) {
  return Math.abs(edge.dx) < 0.2 || Math.abs(edge.dz) < 0.2;
}

function pierAxes(edges, index, closed, count) {
  if (!closed && index === 0) {
    return { tx: edges[0].dx, tz: edges[0].dz, nx: edges[0].nx, nz: edges[0].nz };
  }
  if (!closed && index === count - 1) {
    const edge = edges[edges.length - 1];
    return { tx: edge.dx, tz: edge.dz, nx: edge.nx, nz: edge.nz };
  }
  const e0 = edges[(index - 1 + edges.length) % edges.length];
  const e1 = edges[index % edges.length];
  if (axisish(e0) && axisish(e1)) return { tx: 1, tz: 0, nx: 0, nz: 1 };
  let tx = e0.dx + e1.dx;
  let tz = e0.dz + e1.dz;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) {
    tx = e1.dx;
    tz = e1.dz;
  } else {
    tx /= tl;
    tz /= tl;
  }
  return { tx, tz, nx: -tz, nz: tx };
}

function pushPier(dst, station, axes, style, half, footExtra, stats) {
  const proud = half + footExtra + style.pier + PIER_MARGIN;
  const corners = boxCorners(station.x, station.z, axes, proud, proud);
  const bottom = station.y - BURY;
  const top = station.y + style.height + style.merlonHeight + PIER_CROWN;
  pushPrism(dst, corners, bottom, top);
  stats.piers += 1;
}

function loopDist(a, b, perim, closed) {
  const d = Math.abs(a - b);
  if (!closed || perim <= 0) return d;
  return Math.min(d, perim - d);
}

function stationAt(stations, edges, arc, closed, perim) {
  let d = arc;
  if (closed && perim > 0) {
    d %= perim;
    if (d < 0) d += perim;
  }
  for (let i = 0; i < edges.length; i++) {
    const a = stations[i];
    const len = edges[i].len;
    const end = a.arc + len;
    if (d + 1e-4 >= a.arc && d <= end + 1e-4) {
      const t = len > 1e-6 ? (d - a.arc) / len : 0;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      const b = stations[(i + 1) % stations.length];
      return {
        x: a.x + (b.x - a.x) * tc,
        z: a.z + (b.z - a.z) * tc,
        y: a.y + (b.y - a.y) * tc,
        tx: edges[i].dx,
        tz: edges[i].dz,
        nx: edges[i].nx,
        nz: edges[i].nz,
      };
    }
  }
  const last = stations[stations.length - 1];
  const edge = edges[edges.length - 1];
  return {
    x: last.x,
    z: last.z,
    y: last.y,
    tx: edge.dx,
    tz: edge.dz,
    nx: edge.nx,
    nz: edge.nz,
  };
}

function arcInOpening(arc, openings, closed, perim) {
  for (const opening of openings || []) {
    let gap = Math.abs(arc - opening.d);
    if (closed && perim > 0 && gap > perim * 0.5) gap = perim - gap;
    if (gap <= opening.span * 0.5 + 1e-4) return opening;
  }
  return null;
}

function placeMerlons(dst, built, style, half, footExtra, stats) {
  if (style.merlonHeight < 0.05) return;
  const { stations, edges, closed, perim } = built;
  const period = style.merlonWidth + style.merlonGap;
  if (perim < style.merlonWidth || period <= 0) return;
  let count = Math.max(1, Math.round(perim / period));
  let step = perim / count;
  while (count > 1 && step < style.merlonWidth + 0.15) {
    count -= 1;
    step = perim / count;
  }
  if (step < style.merlonWidth) return;
  const reach = half + footExtra + style.pier + PIER_MARGIN + style.merlonWidth * 0.5 + 0.08;
  const cornerArcs = [];
  for (const station of stations) {
    if (station.corner) cornerArcs.push(station.arc);
  }
  const hx = style.merlonWidth * 0.5;
  const hz = half * 0.94;
  for (let i = 0; i < count; i++) {
    const d = (i + 0.5) * step;
    let blocked = false;
    for (const corner of cornerArcs) {
      if (loopDist(d, corner, perim, closed) < reach) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const at = stationAt(stations, edges, d, closed, perim);
    const corners = boxCorners(
      at.x,
      at.z,
      { tx: at.tx, tz: at.tz, nx: at.nx, nz: at.nz },
      hx,
      hz,
    );
    const base = at.y + style.height;
    pushPrism(dst, corners, base, base + style.merlonHeight);
    stats.merlons += 1;
  }
}

function pushCap(dst, left, right, y0, y1, outward) {
  const u0 = left.u;
  pushOutwardQuad(
    dst,
    vert(right, y0, u0, y0 * uvV),
    vert(left, y0, u0 + 0.2, y0 * uvV),
    vert(left, y1, u0 + 0.2, y1 * uvV),
    vert(right, y1, u0, y1 * uvV),
    outward,
  );
}

function pushOpenCaps(dst, stations, edges, wall, foot, style, showFoot) {
  const n = stations.length;
  const start = levels(stations[0], style, showFoot);
  const end = levels(stations[n - 1], style, showFoot);
  const e0 = edges[0];
  const eN = edges[edges.length - 1];
  const caps = [
    [0, wall.left[0], wall.right[0], foot && foot.left[0], foot && foot.right[0], start, { x: -e0.dx, y: 0, z: -e0.dz }],
    [n - 1, wall.left[n - 1], wall.right[n - 1], foot && foot.left[n - 1], foot && foot.right[n - 1], end, { x: eN.dx, y: 0, z: eN.dz }],
  ];
  for (const [, left, right, footL, footR, y, outward] of caps) {
    if (showFoot && footL && footR) {
      pushCap(dst, footL, footR, y.bottom, y.footY, outward);
    }
    pushCap(dst, left, right, y.footY, y.top, outward);
  }
}

function endBundle(stations, wall, foot, i, t, style, showFoot) {
  const j = (i + 1) % stations.length;
  const y0 = levels(stations[i], style, showFoot);
  const y1 = levels(stations[j], style, showFoot);
  const mix = (a, b) => a + (b - a) * t;
  const lerp = (p, q) => ({
    x: p.x + (q.x - p.x) * t,
    z: p.z + (q.z - p.z) * t,
    u: p.u + (q.u - p.u) * t,
  });
  return {
    y: {
      bottom: mix(y0.bottom, y1.bottom),
      footY: mix(y0.footY, y1.footY),
      top: mix(y0.top, y1.top),
      ground: mix(stations[i].y, stations[j].y),
    },
    left: lerp(wall.left[i], wall.left[j]),
    right: lerp(wall.right[i], wall.right[j]),
    footL: foot ? lerp(foot.left[i], foot.left[j]) : null,
    footR: foot ? lerp(foot.right[i], foot.right[j]) : null,
  };
}

function pushSolidEnds(dst, a, b, edge, style, showFoot) {
  const leftOut = { x: edge.nx, y: 0, z: edge.nz };
  const rightOut = { x: -edge.nx, y: 0, z: -edge.nz };
  const up = { x: 0, y: 1, z: 0 };
  if (showFoot && a.footL && b.footL) {
    pushWallFace(dst, a.footL, b.footL, a.y.bottom, a.y.footY, b.y.bottom, b.y.footY, leftOut);
    pushWallFace(dst, a.footR, b.footR, a.y.bottom, a.y.footY, b.y.bottom, b.y.footY, rightOut);
    pushOutwardQuad(
      dst,
      vert(a.footL, a.y.footY, a.footL.u, 0),
      vert(a.left, a.y.footY, a.left.u, style.footing * uvU),
      vert(b.left, b.y.footY, b.left.u, style.footing * uvU),
      vert(b.footL, b.y.footY, b.footL.u, 0),
      up,
    );
    pushOutwardQuad(
      dst,
      vert(a.right, a.y.footY, a.right.u, 0),
      vert(a.footR, a.y.footY, a.footR.u, style.footing * uvU),
      vert(b.footR, b.y.footY, b.footR.u, style.footing * uvU),
      vert(b.right, b.y.footY, b.right.u, 0),
      up,
    );
  }
  pushWallFace(dst, a.left, b.left, a.y.footY, a.y.top, b.y.footY, b.y.top, leftOut);
  pushWallFace(dst, a.right, b.right, a.y.footY, a.y.top, b.y.footY, b.y.top, rightOut);
  pushOutwardQuad(
    dst,
    vert(a.left, a.y.top, a.left.u, 0),
    vert(a.right, a.y.top, a.right.u, style.thickness * uvU),
    vert(b.right, b.y.top, b.right.u, style.thickness * uvU),
    vert(b.left, b.y.top, b.left.u, 0),
    up,
  );
}

function pushLintel(dst, a, b, edge, holeA, holeB) {
  const leftOut = { x: edge.nx, y: 0, z: edge.nz };
  const rightOut = { x: -edge.nx, y: 0, z: -edge.nz };
  pushWallFace(dst, a.left, b.left, holeA, a.y.top, holeB, b.y.top, leftOut);
  pushWallFace(dst, a.right, b.right, holeA, a.y.top, holeB, b.y.top, rightOut);
  pushOutwardQuad(
    dst,
    vert(a.left, a.y.top, a.left.u, 0),
    vert(a.right, a.y.top, a.right.u, 0.2),
    vert(b.right, b.y.top, b.right.u, 0.2),
    vert(b.left, b.y.top, b.left.u, 0),
    { x: 0, y: 1, z: 0 },
  );
  pushOutwardQuad(
    dst,
    vert(a.right, holeA, a.right.u, 0),
    vert(a.left, holeA, a.left.u, 0.2),
    vert(b.left, holeB, b.left.u, 0.2),
    vert(b.right, holeB, b.right.u, 0),
    { x: 0, y: -1, z: 0 },
  );
}

function pushJamb(dst, end, edge, style, showFoot, sign) {
  const outward = { x: edge.dx * sign, y: 0, z: edge.dz * sign };
  if (showFoot && end.footL && end.footR) {
    pushCap(dst, end.footL, end.footR, end.y.bottom, end.y.footY, outward);
  }
  pushCap(dst, end.left, end.right, end.y.footY, end.y.top, outward);
}

function spanPieces(arc0, arc1, openings, closed, perim) {
  const cuts = [arc0, arc1];
  const holes = [];
  for (const opening of openings || []) {
    const half = opening.span * 0.5;
    const bands = closed && perim > 0
      ? [[opening.d - half, opening.d + half], [opening.d - half + perim, opening.d + half + perim], [opening.d - half - perim, opening.d + half - perim]]
      : [[opening.d - half, opening.d + half]];
    for (const [s0, s1] of bands) {
      const c0 = Math.max(s0, arc0);
      const c1 = Math.min(s1, arc1);
      if (c1 - c0 < 1e-3) continue;
      holes.push([c0, c1]);
      cuts.push(c0, c1);
    }
  }
  cuts.sort((p, q) => p - q);
  const parts = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1e-3) continue;
    const mid = (a + b) * 0.5;
    const open = holes.some(([s0, s1]) => mid >= s0 - 1e-4 && mid <= s1 + 1e-4);
    parts.push({ a, b, open });
  }
  return parts.length ? parts : [{ a: arc0, b: arc1, open: false }];
}

function addDoorLeaf(dst, at, span, hole, ground, style) {
  const margin = 0.07;
  const seam = 0.045;
  const width = Math.max(0.4, span - margin * 2);
  const leaf = (width - seam) * 0.5;
  const hz = Math.max(0.16, style.thickness * 0.34);
  const y0 = ground + 0.03;
  const y1 = ground + hole - 0.05;
  const centers = [-seam * 0.5 - leaf * 0.5, seam * 0.5 + leaf * 0.5];
  for (const along of centers) {
    const x = at.x + at.tx * along;
    const z = at.z + at.tz * along;
    pushBoard(
      dst,
      boxCorners(x, z, at, leaf * 0.5, hz),
      y0,
      y1,
      1 / 0.42,
      1 / 0.85,
    );
  }
}

function addGateBars(dst, at, span, hole, ground, style) {
  const margin = 0.06;
  const inner = Math.max(0.6, span - margin * 2);
  const hz = Math.max(0.12, style.thickness * 0.32);
  const y0 = ground + 0.03;
  const y1 = ground + hole - 0.04;
  const rail = 0.2;
  const rails = [
    { along: 0, hx: inner * 0.5, y0: y1 - rail, y1 },
    { along: 0, hx: inner * 0.5, y0, y1: y0 + rail },
  ];
  for (const bar of rails) {
    pushPrism(
      dst,
      boxCorners(at.x + at.tx * bar.along, at.z + at.tz * bar.along, at, bar.hx, hz),
      bar.y0,
      bar.y1,
    );
  }
  const count = Math.max(5, Math.round(inner / 0.7));
  const pitch = inner / count;
  const hx = Math.min(0.13, pitch * 0.28);
  const barY0 = y0 + rail * 0.35;
  const barY1 = y1 - rail * 0.35;
  for (let i = 0; i < count; i++) {
    const along = -inner * 0.5 + pitch * (i + 0.5);
    pushPrism(
      dst,
      boxCorners(at.x + at.tx * along, at.z + at.tz * along, at, hx, hz * 0.85),
      barY0,
      barY1,
    );
  }
}

/** Door boards: U runs across the planks, V runs up the grain. */
function pushBoard(dst, corners, y0, y1, uScale, vScale) {
  if (!(y1 > y0 + 1e-4)) return;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const u1 = span * uScale;
    const v0 = 0;
    const v1 = (y1 - y0) * vScale;
    pushOutwardQuad(
      dst,
      { x: a.x, y: y0, z: a.z, u: 0, v: v0 },
      { x: b.x, y: y0, z: b.z, u: u1, v: v0 },
      { x: b.x, y: y1, z: b.z, u: u1, v: v1 },
      { x: a.x, y: y1, z: a.z, u: 0, v: v1 },
      { x: b.z - a.z, y: 0, z: -(b.x - a.x) },
    );
  }
  pushOutwardQuad(
    dst,
    { x: corners[0].x, y: y1, z: corners[0].z, u: 0, v: 0 },
    { x: corners[1].x, y: y1, z: corners[1].z, u: 0.4, v: 0 },
    { x: corners[2].x, y: y1, z: corners[2].z, u: 0.4, v: 0.4 },
    { x: corners[3].x, y: y1, z: corners[3].z, u: 0, v: 0.4 },
    { x: 0, y: 1, z: 0 },
  );
}

function buildRun(stone, wood, iron, run, style, sample, stats) {
  uvU = run?.kind === 'dungeon' ? DUNGEON_U : CASTLE_U;
  uvV = run?.kind === 'dungeon' ? DUNGEON_V : CASTLE_V;
  const built = buildStations(run?.points, !!run?.closed, sample);
  if (!built) return;
  const half = style.thickness * 0.5;
  const showFoot = style.footing > 0.02;
  const footExtra = showFoot ? style.footing : 0;
  if (built.single) {
    pushPier(stone, built.stations[0], { tx: 1, tz: 0, nx: 0, nz: 1 }, style, half, footExtra, stats);
    return;
  }
  const { stations, edges, closed, perim } = built;
  const openings = run.openings || [];
  const wall = offsetRails(stations, edges, closed, half);
  const foot = showFoot ? offsetRails(stations, edges, closed, half + footExtra) : null;
  for (let i = 0; i < edges.length; i++) {
    const arc0 = stations[i].arc;
    const arc1 = arc0 + edges[i].len;
    const parts = spanPieces(arc0, arc1, openings, closed, perim);
    for (const part of parts) {
      const len = edges[i].len || 1;
      const a = endBundle(stations, wall, foot, i, (part.a - arc0) / len, style, showFoot);
      const b = endBundle(stations, wall, foot, i, (part.b - arc0) / len, style, showFoot);
      if (!part.open) {
        pushSolidEnds(stone, a, b, edges[i], style, showFoot);
        if (part.a > arc0 + 1e-3) pushJamb(stone, a, edges[i], style, showFoot, -1);
        if (part.b < arc1 - 1e-3) pushJamb(stone, b, edges[i], style, showFoot, 1);
      } else {
        const mid = (part.a + part.b) * 0.5;
        const opening = arcInOpening(mid, openings, closed, perim);
        const hole = openingHeight(opening?.gate, style.height);
        const holeA = a.y.ground + hole;
        const holeB = b.y.ground + hole;
        if (holeA < a.y.top - 0.08 && holeB < b.y.top - 0.08) {
          pushLintel(stone, a, b, edges[i], holeA, holeB);
        }
      }
    }
    stats.spans += 1;
  }
  if (!closed) pushOpenCaps(stone, stations, edges, wall, foot, style, showFoot);
  for (let i = 0; i < stations.length; i++) {
    if (!stations[i].corner) continue;
    if (arcInOpening(stations[i].arc, openings, closed, perim)) continue;
    pushPier(
      stone,
      stations[i],
      pierAxes(edges, i, closed, stations.length),
      style,
      half,
      footExtra,
      stats,
    );
  }
  placeMerlons(stone, built, style, half, footExtra, stats);
  for (const opening of openings) {
    const at = stationAt(stations, edges, opening.d, closed, perim);
    const hole = openingHeight(opening.gate, style.height);
    const empty = opening.open ? 1 : 0;
    if (opening.gate) stats.gates = (stats.gates || 0) + 1;
    else stats.doors = (stats.doors || 0) + 1;
    if (empty) continue;
    if (opening.gate) addGateBars(iron, at, opening.span, hole, at.y, style);
    else addDoorLeaf(wood, at, opening.span, hole, at.y, style);
  }
}

function emptyDst() {
  return { pos: [], norm: [], uv: [], idx: [] };
}

function packDst(dst) {
  return {
    positions: new Float32Array(dst.pos),
    normals: new Float32Array(dst.norm),
    uvs: new Float32Array(dst.uv),
    indices: new Uint32Array(dst.idx),
  };
}

/**
 * @param {Array<{ closed?: boolean, kind?: string, openings?: object[], points: Array<{x: number, z: number}> }>} runs
 * @param {object} style
 * @param {(x: number, z: number) => number} [sampleHeight]
 */
export function buildWallGeometry(runs, style, sampleHeight) {
  const castle = emptyDst();
  const dungeon = emptyDst();
  const wood = emptyDst();
  const iron = emptyDst();
  const stats = { spans: 0, merlons: 0, piers: 0, doors: 0, gates: 0 };
  const clamped = clampWallStyle(style);
  const sample = typeof sampleHeight === 'function' ? sampleHeight : () => 0;
  for (const run of runs || []) {
    const stone = run?.kind === 'dungeon' ? dungeon : castle;
    buildRun(stone, wood, iron, run, clamped, sample, stats);
  }
  return {
    castle: packDst(castle),
    dungeon: packDst(dungeon),
    wood: packDst(wood),
    iron: packDst(iron),
    stats,
  };
}
