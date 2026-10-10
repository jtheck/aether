// Curtain walls as polylines snapped to tile corners.
// The mesh is extruded in render/wallGeom.js — castle ashlar or dungeon brick.
// A run blocks every tile its centerline crosses. Doors (one tile) and gates
// (two) leave that span open. The forge stamps this into field.pass; a match
// does not draw or block on walls yet.

import { TERRAIN, TILE_SIZE_F, worldHalfFFromField, worldHalfZFFromField } from './field.js';
import { SCENERY, rockFootprintRadiusForStock } from './scenery.js';

export const WALL_KINDS = ['castle', 'dungeon'];
/** One tile edge. Matches the grid the centerline is snapped to. */
export const DOOR_SPAN = TILE_SIZE_F;
/** Two tile edges. */
export const GATE_SPAN = TILE_SIZE_F * 2;
export const DOOR_HEIGHT = 3.4;
export const GATE_HEIGHT = 5;

export const DEFAULT_WALL_STYLE = {
  height: 6,
  thickness: 1.35,
  merlonHeight: 0.9,
  merlonWidth: 1.05,
  merlonGap: 0.7,
  footing: 0.32,
  pier: 0.45,
};

const LIMITS = {
  height: [2, 16],
  thickness: [0.4, 3],
  merlonHeight: [0, 3],
  merlonWidth: [0.3, 3],
  merlonGap: [0.15, 3],
  footing: [0, 1.2],
  pier: [0, 2],
};

export function emptyWalls() {
  return { style: { ...DEFAULT_WALL_STYLE }, runs: [] };
}

export function clampWallStyle(style) {
  const src = style || {};
  const out = { ...DEFAULT_WALL_STYLE };
  for (const key of Object.keys(LIMITS)) {
    const n = Number(src[key]);
    if (!Number.isFinite(n)) continue;
    const [lo, hi] = LIMITS[key];
    out[key] = n < lo ? lo : n > hi ? hi : n;
  }
  return out;
}

function quantize(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Drop degenerate runs. Closed runs need three distinct corners. */
export function normalizeWallRuns(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const run of list) {
    const raw = Array.isArray(run?.points) ? run.points : null;
    if (!raw) continue;
    const points = [];
    for (const p of raw) {
      const x = Number(p?.x);
      const z = Number(p?.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const prev = points[points.length - 1];
      if (prev && Math.hypot(prev.x - x, prev.z - z) < 0.05) continue;
      points.push({ x, z });
    }
    if (points.length >= 2) {
      const a = points[0];
      const b = points[points.length - 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 0.05) points.pop();
    }
    const closed = !!run.closed && points.length >= 3;
    if (points.length < 2) continue;
    const spans = closed ? points.length : points.length - 1;
    let len = 0;
    for (let i = 0; i < spans; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    if (len < 0.5) continue;
    out.push({
      closed,
      points,
      kind: run.kind === 'dungeon' ? 'dungeon' : 'castle',
      openings: normalizeOpenings(run.openings, len, closed),
    });
  }
  return out;
}

function normalizeOpenings(list, perim, closed) {
  if (!Array.isArray(list) || perim <= 0) return [];
  const out = [];
  for (const raw of list) {
    const d = Number(raw?.d);
    const gate = raw?.gate ? 1 : 0;
    const open = raw?.open ? 1 : 0;
    const span = gate ? GATE_SPAN : DOOR_SPAN;
    if (!Number.isFinite(d)) continue;
    if (perim < span - 0.05) continue;
    let at = d;
    if (closed) {
      at %= perim;
      if (at < 0) at += perim;
    } else if (at < span * 0.5 || at > perim - span * 0.5) {
      continue;
    }
    let overlap = false;
    for (const prev of out) {
      let gap = Math.abs(prev.d - at);
      if (closed) gap = Math.min(gap, perim - gap);
      if (gap < (prev.span + span) * 0.5 - 0.05) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    out.push({ d: quantize(at), span, gate, open });
  }
  return out;
}

export function wallKindOf(run) {
  return run?.kind === 'dungeon' ? 'dungeon' : 'castle';
}

/** Lintel stays at least this tall so a short wall does not lose its head. */
export function openingHeight(gate, wallHeight) {
  const want = gate ? GATE_HEIGHT : DOOR_HEIGHT;
  const h = Number(wallHeight) || 0;
  const lintel = 0.45;
  if (h <= lintel + 1.2) return Math.max(0.8, h * 0.7);
  return Math.min(want, h - lintel);
}

/** Null when there is nothing to keep. Style is omitted until a run exists. */
export function encodeWalls(walls) {
  const runs = normalizeWallRuns(walls?.runs);
  if (!runs.length) return null;
  const style = clampWallStyle(walls?.style);
  const out = {
    s: [
      quantize(style.height),
      quantize(style.thickness),
      quantize(style.merlonHeight),
      quantize(style.merlonWidth),
      quantize(style.merlonGap),
      quantize(style.footing),
      quantize(style.pier),
    ],
    r: runs.map((run) => {
      const row = [run.closed ? 1 : 0];
      for (const p of run.points) row.push(quantize(p.x), quantize(p.z));
      return row;
    }),
  };
  const kinds = runs.map((run) => (run.kind === 'dungeon' ? 1 : 0));
  if (kinds.some((k) => k)) out.k = kinds;
  const openings = runs.map((run) => (run.openings || []).map((o) => [quantize(o.d), o.gate ? 1 : 0, o.open ? 1 : 0]));
  if (openings.some((list) => list.length)) out.o = openings;
  return out;
}

const STYLE_KEYS = [
  'height',
  'thickness',
  'merlonHeight',
  'merlonWidth',
  'merlonGap',
  'footing',
  'pier',
];

export function decodeWalls(raw) {
  const walls = emptyWalls();
  if (!raw || typeof raw !== 'object') return walls;
  if (Array.isArray(raw.s)) {
    const patch = { ...walls.style };
    for (let i = 0; i < STYLE_KEYS.length; i++) {
      const n = Number(raw.s[i]);
      if (Number.isFinite(n)) patch[STYLE_KEYS[i]] = n;
    }
    walls.style = clampWallStyle(patch);
  }
  if (!Array.isArray(raw.r)) return walls;
  const runs = [];
  for (const row of raw.r) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const points = [];
    for (let i = 1; i + 1 < row.length; i += 2) {
      const x = Number(row[i]);
      const z = Number(row[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(z)) points.push({ x, z });
    }
    const kind = Array.isArray(raw.k) && raw.k[runs.length] === 1 ? 'dungeon' : 'castle';
    const openings = [];
    const packed = Array.isArray(raw.o) ? raw.o[runs.length] : null;
    if (Array.isArray(packed)) {
      for (const item of packed) {
        if (!Array.isArray(item)) continue;
        openings.push({ d: Number(item[0]), gate: item[1] ? 1 : 0, open: item[2] ? 1 : 0 });
      }
    }
    runs.push({ closed: row[0] === 1, points, kind, openings });
  }
  walls.runs = normalizeWallRuns(runs);
  return walls;
}

export function sameWallCorner(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01;
}

/** Snap a ground hit to a tile corner, clamped to the board. */
export function snapWallCorner(field, x, z) {
  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const tilesX = field.width | 0;
  const tilesZ = field.height | 0;
  let gx = Math.round((Number(x) + halfX) / TILE_SIZE_F);
  let gz = Math.round((Number(z) + halfZ) / TILE_SIZE_F);
  if (gx < 0) gx = 0;
  if (gz < 0) gz = 0;
  if (gx > tilesX) gx = tilesX;
  if (gz > tilesZ) gz = tilesZ;
  return {
    x: gx * TILE_SIZE_F - halfX,
    z: gz * TILE_SIZE_F - halfZ,
  };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = 0;
  if (len2 > 1e-8) {
    t = ((px - ax) * dx + (pz - az) * dz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Index of the run whose centerline is closest, or -1 past maxDist. */
export function nearestWallRun(runs, x, z, maxDist) {
  if (!Array.isArray(runs)) return -1;
  let best = -1;
  let bestD = maxDist;
  for (let i = 0; i < runs.length; i++) {
    const pts = runs[i]?.points;
    if (!pts || pts.length < 2) continue;
    const spans = runs[i].closed ? pts.length : pts.length - 1;
    for (let s = 0; s < spans; s++) {
      const a = pts[s];
      const b = pts[(s + 1) % pts.length];
      const d = distToSegment(x, z, a.x, a.z, b.x, b.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

function runSections(run) {
  const pts = run?.points;
  if (!pts || pts.length < 2) return null;
  const count = run.closed ? pts.length : pts.length - 1;
  const sections = [];
  let arc = 0;
  for (let s = 0; s < count; s++) {
    const a = pts[s];
    const b = pts[(s + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    sections.push({ index: s, a, b, len, arc });
    arc += len;
  }
  return { sections, perim: arc };
}

/** The corner-to-corner piece closest to a point, or a miss past maxDist. */
export function previewWallSection(runs, x, z, maxDist = OPENING_REACH) {
  if (!Array.isArray(runs)) return { ok: false };
  let best = null;
  let bestD = maxDist;
  for (const run of runs) {
    const laid = runSections(run);
    if (!laid) continue;
    for (const sec of laid.sections) {
      const dist = distToSegment(x, z, sec.a.x, sec.a.z, sec.b.x, sec.b.z);
      if (dist < bestD) {
        bestD = dist;
        best = { run, sec, perim: laid.perim };
      }
    }
  }
  if (!best) return { ok: false };
  const len = best.sec.len || 1;
  return {
    ok: true,
    run: best.run,
    index: best.sec.index,
    a: best.sec.a,
    b: best.sec.b,
    arc: best.sec.arc,
    len: best.sec.len,
    perim: best.perim,
    tx: (best.sec.b.x - best.sec.a.x) / len,
    tz: (best.sec.b.z - best.sec.a.z) / len,
  };
}

function keptOpening(opening, d) {
  return {
    d: quantize(d),
    span: opening.span,
    gate: opening.gate ? 1 : 0,
    open: opening.open ? 1 : 0,
  };
}

function splitRunAtSection(run, segIndex, arc0, arc1, perim) {
  const pts = run.points.map((p) => ({ x: p.x, z: p.z }));
  const kind = run.kind === 'dungeon' ? 'dungeon' : 'castle';
  const openings = run.openings || [];
  if (run.closed) {
    const n = pts.length;
    const ordered = [];
    for (let k = 1; k <= n; k++) ordered.push(pts[(segIndex + k) % n]);
    const kept = [];
    for (const opening of openings) {
      if (opening.d >= arc0 - 1e-3 && opening.d <= arc1 + 1e-3) continue;
      const d = opening.d >= arc1 - 1e-3
        ? opening.d - arc1
        : (perim - arc1) + opening.d;
      kept.push(keptOpening(opening, d));
    }
    return [{ closed: false, points: ordered, kind, openings: kept }];
  }
  const leftPts = pts.slice(0, segIndex + 1);
  const rightPts = pts.slice(segIndex + 1);
  const leftOpen = [];
  const rightOpen = [];
  for (const opening of openings) {
    if (opening.d >= arc0 - 1e-3 && opening.d <= arc1 + 1e-3) continue;
    if (opening.d < arc0) leftOpen.push(keptOpening(opening, opening.d));
    else rightOpen.push(keptOpening(opening, opening.d - arc1));
  }
  const out = [];
  if (leftPts.length >= 2) out.push({ closed: false, points: leftPts, kind, openings: leftOpen });
  if (rightPts.length >= 2) out.push({ closed: false, points: rightPts, kind, openings: rightOpen });
  return out;
}

/** Remove the nearest corner-to-corner section. A loop opens; a middle piece splits the run. */
export function removeWallSection(runs, x, z, maxDist = OPENING_REACH) {
  const hit = previewWallSection(runs, x, z, maxDist);
  if (!hit.ok) return false;
  const pieces = splitRunAtSection(hit.run, hit.index, hit.arc, hit.arc + hit.len, hit.perim);
  const at = runs.indexOf(hit.run);
  if (at < 0) return false;
  runs.splice(at, 1, ...pieces);
  return true;
}

function runSpans(run) {
  const pts = run.points;
  const count = run.closed ? pts.length : pts.length - 1;
  const spans = [];
  let arc = 0;
  for (let s = 0; s < count; s++) {
    const a = pts[s];
    const b = pts[(s + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    spans.push({ a, b, len, arc });
    arc += len;
  }
  return { spans, perim: arc };
}

function pointAtArc(spans, perim, closed, arc) {
  let d = arc;
  if (closed && perim > 0) {
    d %= perim;
    if (d < 0) d += perim;
  }
  for (const span of spans) {
    if (d >= span.arc - 1e-4 && d <= span.arc + span.len + 1e-4) {
      const t = span.len > 1e-6 ? (d - span.arc) / span.len : 0;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      return {
        x: span.a.x + (span.b.x - span.a.x) * tc,
        z: span.a.z + (span.b.z - span.a.z) * tc,
      };
    }
  }
  const last = spans[spans.length - 1];
  return { x: last.b.x, z: last.b.z };
}

/** Collinear corners count as one straight wall, so a gate can span them. */
function straightStretches(run) {
  const { spans } = runSpans(run);
  const out = [];
  for (const seg of spans) {
    if (seg.len < 1e-4) continue;
    const ux = (seg.b.x - seg.a.x) / seg.len;
    const uz = (seg.b.z - seg.a.z) / seg.len;
    const prev = out[out.length - 1];
    if (prev && ux * prev.ux + uz * prev.uz > 0.985) {
      prev.len += seg.len;
    } else {
      out.push({ arc: seg.arc, len: seg.len, x: seg.a.x, z: seg.a.z, ux, uz });
    }
  }
  return out;
}

function openingOverlaps(run, d, span, perim) {
  for (const prev of run.openings || []) {
    let gap = Math.abs(prev.d - d);
    if (run.closed && perim > 0) gap = Math.min(gap, perim - gap);
    if (gap < (prev.span + span) * 0.5 - 0.05) return true;
  }
  return false;
}

/** How far from a wall a click still counts as aiming at it. */
export const OPENING_REACH = 8;

function projectOntoRun(run, x, z) {
  const { spans } = runSpans(run);
  let best = null;
  let bestD = Infinity;
  for (const seg of spans) {
    if (seg.len < 1e-4) continue;
    const dx = seg.b.x - seg.a.x;
    const dz = seg.b.z - seg.a.z;
    let t = ((x - seg.a.x) * dx + (z - seg.a.z) * dz) / (seg.len * seg.len);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = seg.a.x + dx * t;
    const pz = seg.a.z + dz * t;
    const dist = Math.hypot(px - x, pz - z);
    if (dist < bestD) {
      bestD = dist;
      best = { arc: seg.arc + seg.len * t, x: px, z: pz };
    }
  }
  return best;
}

/** Tile-aligned opening that contains the point on the wall closest to the click. */
function slotAtProjection(run, x, z, span) {
  const proj = projectOntoRun(run, x, z);
  if (!proj) return null;
  for (const stretch of straightStretches(run)) {
    const end = stretch.arc + stretch.len;
    if (proj.arc < stretch.arc - 1e-3 || proj.arc > end + 1e-3) continue;
    const n = Math.floor((stretch.len + 0.05) / span);
    if (n < 1) return null;
    let i = Math.floor((proj.arc - stretch.arc) / span);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    const along = span * (i + 0.5);
    return {
      d: stretch.arc + along,
      x: stretch.x + stretch.ux * along,
      z: stretch.z + stretch.uz * along,
      tx: stretch.ux,
      tz: stretch.uz,
    };
  }
  return null;
}

/**
 * Where a door or gate would cut. The opening is the tile under the click,
 * measured along the wall, not the nearest pre-set slot in the world.
 */
export function previewWallOpening(runs, x, z, gate, maxDist = OPENING_REACH) {
  const span = gate ? GATE_SPAN : DOOR_SPAN;
  if (!Array.isArray(runs) || !runs.some((run) => run?.points?.length >= 2)) {
    return { ok: false, reason: 'Finish a wall first, then click it.' };
  }
  const idx = nearestWallRun(runs, x, z, maxDist);
  if (idx < 0) return { ok: false, reason: 'Click a finished wall.' };
  const run = runs[idx];
  const slot = slotAtProjection(run, x, z, span);
  if (!slot) {
    return {
      ok: false,
      reason: gate
        ? 'A gate needs two tiles in a straight line.'
        : 'A door needs one straight tile of wall.',
    };
  }
  if (openingOverlaps(run, slot.d, span, runSpans(run).perim)) {
    return { ok: false, reason: gate ? 'A gate is already there.' : 'A door is already there.' };
  }
  return { ok: true, run, ...slot, span, gate: gate ? 1 : 0 };
}

/** Drop a door or gate on the nearest free tile-edge along a run. */
export function placeWallOpening(runs, x, z, gate, maxDist = OPENING_REACH, open = false) {
  const hit = previewWallOpening(runs, x, z, gate, maxDist);
  if (!hit.ok) return false;
  if (!hit.run.openings) hit.run.openings = [];
  hit.run.openings.push({
    d: quantize(hit.d),
    span: hit.span,
    gate: hit.gate,
    open: open ? 1 : 0,
  });
  return true;
}

/** Remove the opening whose center is closest to the click. */
export function removeNearestOpening(runs, x, z, maxDist = OPENING_REACH) {
  if (!Array.isArray(runs)) return false;
  let best = null;
  let bestD = maxDist;
  for (const run of runs) {
    const openings = run?.openings;
    if (!openings?.length) continue;
    const { spans, perim } = runSpans(run);
    for (let i = 0; i < openings.length; i++) {
      const at = pointAtArc(spans, perim, run.closed, openings[i].d);
      const dist = Math.hypot(at.x - x, at.z - z);
      if (dist < bestD) {
        bestD = dist;
        best = { run, index: i };
      }
    }
  }
  if (!best) return false;
  best.run.openings.splice(best.index, 1);
  return true;
}

function pointInOpening(arc, opening, closed, perim) {
  const half = opening.span * 0.5;
  if (!closed || perim <= 0) return Math.abs(arc - opening.d) <= half + 1e-4;
  let gap = Math.abs(arc - opening.d);
  if (gap > perim * 0.5) gap = perim - gap;
  return gap <= half + 1e-4;
}

function intervalOpen(a0, a1, openings, closed, perim) {
  if (!openings?.length) return false;
  if (a1 - a0 < 1e-3) {
    const mid = (a0 + a1) * 0.5;
    for (const opening of openings) {
      if (pointInOpening(mid, opening, closed, perim)) return true;
    }
    return false;
  }
  const lo = a0 + 1e-3;
  const hi = a1 - 1e-3;
  for (const opening of openings) {
    if (pointInOpening(lo, opening, closed, perim) && pointInOpening(hi, opening, closed, perim)) {
      return true;
    }
  }
  return false;
}

function segmentOverlapT(ax, az, bx, bz, minX, minZ, maxX, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

function tileOfWorld(field, x, z) {
  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    tx: Math.floor((x + halfX) / TILE_SIZE_F),
    tz: Math.floor((z + halfZ) / TILE_SIZE_F),
  };
}

function markRunBlocked(field, mask, run) {
  const { width, height } = field;
  const { spans, perim } = runSpans(run);
  const openings = run.openings || [];
  const halfX = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  for (const seg of spans) {
    if (seg.len < 1e-4) continue;
    const minX = Math.min(seg.a.x, seg.b.x);
    const maxX = Math.max(seg.a.x, seg.b.x);
    const minZ = Math.min(seg.a.z, seg.b.z);
    const maxZ = Math.max(seg.a.z, seg.b.z);
    const t0 = tileOfWorld(field, minX, minZ);
    const t1 = tileOfWorld(field, maxX, maxZ);
    const tx0 = Math.max(0, Math.min(t0.tx, t1.tx) - 1);
    const tx1 = Math.min(width - 1, Math.max(t0.tx, t1.tx) + 1);
    const tz0 = Math.max(0, Math.min(t0.tz, t1.tz) - 1);
    const tz1 = Math.min(height - 1, Math.max(t0.tz, t1.tz) + 1);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const x0 = tx * TILE_SIZE_F - halfX;
        const z0 = tz * TILE_SIZE_F - halfZ;
        const hit = segmentOverlapT(seg.a.x, seg.a.z, seg.b.x, seg.b.z, x0, z0, x0 + TILE_SIZE_F, z0 + TILE_SIZE_F);
        if (!hit) continue;
        const a0 = seg.arc + hit[0] * seg.len;
        const a1 = seg.arc + hit[1] * seg.len;
        if (intervalOpen(a0, a1, openings, run.closed, perim)) continue;
        mask[tz * width + tx] = 1;
      }
    }
  }
}

function solidWater(field, i) {
  return field.terrainTypes?.[i] === TERRAIN.WATER && field.tileType?.[i] === 12;
}

function rockCovers(field, tx, tz) {
  const { width, height, sceneryType } = field;
  if (!sceneryType) return false;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = tx + dx;
      const cz = tz + dz;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue;
      const kind = sceneryType[cz * width + cx];
      if (kind < SCENERY.ROCK_PLAIN) continue;
      const radius = rockFootprintRadiusForStock(kind, field.rockStock?.[cz * width + cx] | 0);
      if (radius < 0) continue;
      if (dx * dx + dz * dz <= (radius + 0.5) ** 2) return true;
    }
  }
  return false;
}

function canRelease(field, i) {
  if (field.activeMask?.[i] === 0) return false;
  if (solidWater(field, i)) return false;
  if (field.tableEdge?.[i]) return false;
  const tz = (i / field.width) | 0;
  const tx = i - tz * field.width;
  if (rockCovers(field, tx, tz)) return false;
  return true;
}

/**
 * Stamp wall runs into field.pass. Tiles a centerline crosses become blocked;
 * a door or gate clears the tiles of that span. Previous wall tiles are
 * released unless water, the table rim, or a rock still owns them.
 */
export function applyWallOccupancy(field, walls) {
  if (!field?.pass) return field;
  const n = field.width * field.height;
  const next = new Uint8Array(n);
  const runs = normalizeWallRuns(walls?.runs);
  for (const run of runs) markRunBlocked(field, next, run);
  const prev = field.wallBlock;
  if (prev && prev.length === n) {
    for (let i = 0; i < n; i++) {
      if (prev[i] && !next[i] && canRelease(field, i)) field.pass[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (next[i]) field.pass[i] = 0;
  }
  field.wallBlock = next;
  return field;
}
