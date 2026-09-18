// Gather-reach rings — terrain-draped annulus.
// Resource-tinted outer rim fading through owner color into transparency.
// Vertices sample ground height so the ribbon sits on the terrain instead of
// burying. Same-kind overlapping disks draw as a union outline: visible arcs
// chain at the true circle crossings so the terrain-draped ribbon stays one
// loop. Different resource kinds keep their own rims and do not merge.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  invalidateRenderBundles,
  setShaderUniform,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { ownerTint } from './ownerTints.js';

/** How far inward the film fades, in world units. */
const FADE_WU = 7.2;
/** Sit this far above the sampled ground at each rim vertex. */
const LIFT = 0.75;
export const RING_SEGMENTS = 64;
const MAX_RINGS = 64;
/** Hold a grown ring after the engineer bonus drops (~6s). */
const RADIUS_LINGER_MS = 6000;
/** Keep the exact crossing (on another rim) visible; hide strictly inside. */
export const RING_CLIP_EPS = 0.12;
/** Pair of rims that miss by this much are treated as separate / contained. */
const INTERSECT_GAP = 1e-4;
/** Join two visible-arc ends if they land on the same world point. */
const JOIN_EPS_SQ = 0.35 * 0.35;
const VERTS_PER_SEG = 4;
const IDX_PER_SEG = 6;
const MAX_SEGS = MAX_RINGS * RING_SEGMENTS;
const MAX_LINK_SEGS = 160;
const LINK_HALF = 0.32;
const LINK_STEP = 2.2;

/** Bright rim colors — replace the old hard-white edge. */
export const RIM_WHITE = Object.freeze([1, 1, 1]);
export const RESOURCE_RIM_RGB = Object.freeze({
  wood: Object.freeze([0.94, 0.66, 0.32]),
  stone: Object.freeze([0.76, 0.80, 0.88]),
  mineral: Object.freeze([0.86, 0.64, 1.0]),
  food: Object.freeze([0.58, 0.93, 0.38]),
});
const RIM_LAYER_KEYS = /** @type {const} */ (['wood', 'stone', 'mineral', 'food', 'white']);

/**
 * Camp → wood, farm → food, mine → stone. Anything else stays white.
 * @param {string | null | undefined} type
 */
export function rimKeyForBuildingType(type) {
  if (type === 'camp') return 'wood';
  if (type === 'mine') return 'stone';
  if (type === 'farm') return 'food';
  return 'white';
}

/**
 * @param {string | null | undefined} key
 */
export function rimRgbForKey(key) {
  return RESOURCE_RIM_RGB[key] || RIM_WHITE;
}

/**
 * @param {{ rimKey?: string, kind?: string } | null | undefined} spec
 */
export function rimKeyForSpec(spec) {
  const key = spec?.rimKey || spec?.kind;
  if (key === 'mineral' || key === 'wood' || key === 'stone' || key === 'food') return key;
  return 'white';
}

/**
 * Ghost / mixed-attach: one kind stays that kind; disagreement falls back to white.
 * @param {string[]} keys
 */
export function sharedRimKey(keys) {
  if (!keys?.length) return 'white';
  const first = keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] !== first) return 'white';
  }
  return first === 'mineral' || first === 'wood' || first === 'stone' || first === 'food'
    ? first
    : 'white';
}

/**
 * @param {{ rimKey?: string, kind?: string }[]} disks
 * @returns {Map<string, typeof disks>}
 */
export function groupDisksByRimKey(disks) {
  const groups = new Map();
  for (let i = 0; i < disks.length; i++) {
    const key = rimKeyForSpec(disks[i]);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(disks[i]);
  }
  return groups;
}

/**
 * @param {number} x
 * @param {number} z
 * @param {{ x: number, z: number, radius: number }} disk
 * @param {number} [epsilon]
 */
export function diskContains(x, z, disk, epsilon = RING_CLIP_EPS) {
  if (!(disk?.radius > 0)) return false;
  const lim = disk.radius - epsilon;
  if (lim <= 0) return false;
  const dx = x - disk.x;
  const dz = z - disk.z;
  return dx * dx + dz * dz < lim * lim;
}

/**
 * @param {number} x
 * @param {number} z
 * @param {{ x: number, z: number, radius: number }[]} disks
 * @param {number} selfIndex
 * @param {number} [epsilon]
 */
export function pointInsideOtherDisk(x, z, disks, selfIndex, epsilon = RING_CLIP_EPS) {
  for (let i = 0; i < disks.length; i++) {
    if (i === selfIndex) continue;
    if (diskContains(x, z, disks[i], epsilon)) return true;
  }
  return false;
}

/**
 * Outer-arc midpoint of segment `i` — the point we test for the union clip.
 * @param {{ x: number, z: number, radius: number }} disk
 * @param {number} i
 * @param {number} [segments]
 */
export function ringSegmentOuterMid(disk, i, segments = RING_SEGMENTS) {
  const a0 = (i / segments) * Math.PI * 2;
  const a1 = ((i + 1) / segments) * Math.PI * 2;
  const am = (a0 + a1) * 0.5;
  return {
    x: disk.x + Math.cos(am) * disk.radius,
    z: disk.z + Math.sin(am) * disk.radius,
  };
}

/**
 * @param {{ x: number, z: number, radius: number }} disk
 * @param {number} i
 * @param {{ x: number, z: number, radius: number }[]} disks
 * @param {number} selfIndex
 * @param {number} [segments]
 * @param {number} [epsilon]
 */
export function ringSegmentVisible(disk, i, disks, selfIndex, segments = RING_SEGMENTS, epsilon = RING_CLIP_EPS) {
  const p = ringSegmentOuterMid(disk, i, segments);
  return !pointInsideOtherDisk(p.x, p.z, disks, selfIndex, epsilon);
}

export function fadeWidthForRadius(radius) {
  return Math.min(FADE_WU, radius * 0.45);
}

/**
 * @param {{ x: number, z: number, radius: number }} a
 * @param {{ x: number, z: number, radius: number }} b
 * @returns {{ x: number, z: number }[]}
 */
export function circleIntersections(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const ra = a.radius;
  const rb = b.radius;
  if (!(ra > 0) || !(rb > 0) || d < 1e-6) return [];
  if (d >= ra + rb - INTERSECT_GAP) return [];
  if (d <= Math.abs(ra - rb) + INTERSECT_GAP) return [];
  const aa = (ra * ra - rb * rb + d * d) / (2 * d);
  const h2 = ra * ra - aa * aa;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const mx = a.x + (dx * aa) / d;
  const mz = a.z + (dz * aa) / d;
  if (h < 1e-5) return [{ x: mx, z: mz }];
  const px = (-dz * h) / d;
  const pz = (dx * h) / d;
  return [
    { x: mx + px, z: mz + pz },
    { x: mx - px, z: mz - pz },
  ];
}

function rimPoint(disk, angle) {
  return {
    x: disk.x + Math.cos(angle) * disk.radius,
    z: disk.z + Math.sin(angle) * disk.radius,
  };
}

function sameRimPoint(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= JOIN_EPS_SQ;
}

/**
 * Visible CCW rim spans of one disk — the pieces that sit on the union outline.
 * @param {{ x: number, z: number, radius: number }[]} disks
 * @param {number} selfIndex
 * @returns {{ diskIndex: number, a0: number, a1: number, sx: number, sz: number, ex: number, ez: number, closed: boolean }[]}
 */
export function visibleArcsOnDisk(disks, selfIndex) {
  const self = disks[selfIndex];
  if (!(self?.radius > 0)) return [];
  const hits = [];
  for (let j = 0; j < disks.length; j++) {
    if (j === selfIndex) continue;
    const pts = circleIntersections(self, disks[j]);
    for (let p = 0; p < pts.length; p++) {
      const hit = pts[p];
      if (pointInsideOtherDisk(hit.x, hit.z, disks, selfIndex)) continue;
      hits.push({
        x: hit.x,
        z: hit.z,
        angle: Math.atan2(hit.z - self.z, hit.x - self.x),
      });
    }
  }
  hits.sort((a, b) => a.angle - b.angle);
  const uniq = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const prev = uniq[uniq.length - 1];
    if (prev && Math.abs(h.angle - prev.angle) < 1e-4) continue;
    uniq.push(h);
  }
  if (uniq.length > 1) {
    const first = uniq[0];
    const last = uniq[uniq.length - 1];
    if (Math.abs(last.angle - first.angle - Math.PI * 2) < 1e-4
      || sameRimPoint(first.x, first.z, last.x, last.z)) {
      uniq.pop();
    }
  }

  if (uniq.length === 0) {
    const probe = rimPoint(self, 0);
    if (pointInsideOtherDisk(probe.x, probe.z, disks, selfIndex)) return [];
    return [{
      diskIndex: selfIndex,
      a0: 0,
      a1: Math.PI * 2,
      sx: probe.x,
      sz: probe.z,
      ex: probe.x,
      ez: probe.z,
      closed: true,
    }];
  }

  const arcs = [];
  for (let i = 0; i < uniq.length; i++) {
    const a0 = uniq[i].angle;
    let a1 = uniq[(i + 1) % uniq.length].angle;
    if (i === uniq.length - 1) a1 += Math.PI * 2;
    const mid = rimPoint(self, a0 + (a1 - a0) * 0.5);
    if (pointInsideOtherDisk(mid.x, mid.z, disks, selfIndex)) continue;
    const end = uniq[(i + 1) % uniq.length];
    arcs.push({
      diskIndex: selfIndex,
      a0,
      a1,
      sx: uniq[i].x,
      sz: uniq[i].z,
      ex: end.x,
      ez: end.z,
      closed: false,
    });
  }
  return arcs;
}

/**
 * @param {{ x: number, z: number, radius: number }[]} disks
 */
export function collectVisibleArcs(disks) {
  const out = [];
  for (let i = 0; i < disks.length; i++) out.push(...visibleArcsOnDisk(disks, i));
  return out;
}

/**
 * Chain visible arcs into closed (or leftover open) outline loops.
 * @param {{ diskIndex: number, sx: number, sz: number, ex: number, ez: number, closed: boolean }[]} arcs
 */
export function chainUnionLoops(arcs) {
  const used = new Uint8Array(arcs.length);
  const loops = [];

  function take(start) {
    const loop = [arcs[start]];
    used[start] = 1;
    if (arcs[start].closed) return loop;
    for (let guard = 0; guard < arcs.length + 2; guard++) {
      const last = loop[loop.length - 1];
      if (loop.length > 1 && sameRimPoint(last.ex, last.ez, loop[0].sx, loop[0].sz)) {
        return loop;
      }
      let found = -1;
      for (let i = 0; i < arcs.length; i++) {
        if (used[i] || arcs[i].closed) continue;
        if (sameRimPoint(arcs[i].sx, arcs[i].sz, last.ex, last.ez)) {
          found = i;
          break;
        }
      }
      if (found < 0) return loop;
      loop.push(arcs[found]);
      used[found] = 1;
    }
    return loop;
  }

  for (let i = 0; i < arcs.length; i++) {
    if (!used[i]) loops.push(take(i));
  }
  return loops;
}

/**
 * @param {{ x: number, z: number, radius: number }[]} disks
 */
export function buildUnionLoops(disks) {
  return chainUnionLoops(collectVisibleArcs(disks));
}

function offsetInward(x, z, disk) {
  const dx = disk.x - x;
  const dz = disk.z - z;
  const len = Math.hypot(dx, dz);
  const fade = fadeWidthForRadius(disk.radius);
  if (len < 1e-6) return { x, z };
  return { x: x + (dx / len) * fade, z: z + (dz / len) * fade };
}

/**
 * Terrain-draped ribbon samples for one outline loop.
 * Open-arc joins keep a duplicated outer point so the fade can wedge.
 * @param {{ diskIndex: number, a0: number, a1: number, sx: number, sz: number, ex: number, ez: number, closed: boolean }[]} loop
 * @param {{ x: number, z: number, radius: number }[]} disks
 * @param {number} [segments]
 * @returns {{ ox: number, oz: number, ix: number, iz: number }[]}
 */
export function sampleUnionLoop(loop, disks, segments = RING_SEGMENTS) {
  const samples = [];
  for (let a = 0; a < loop.length; a++) {
    const arc = loop[a];
    const disk = disks[arc.diskIndex];
    const span = arc.a1 - arc.a0;
    const steps = arc.closed
      ? segments
      : Math.max(1, Math.round((span / (Math.PI * 2)) * segments));
    const last = arc.closed ? steps - 1 : steps;
    for (let i = 0; i <= last; i++) {
      let ox;
      let oz;
      if (!arc.closed && i === 0) {
        ox = arc.sx;
        oz = arc.sz;
      } else if (!arc.closed && i === last) {
        ox = arc.ex;
        oz = arc.ez;
      } else {
        const p = rimPoint(disk, arc.a0 + span * (i / steps));
        ox = p.x;
        oz = p.z;
      }
      const inn = offsetInward(ox, oz, disk);
      samples.push({ ox, oz, ix: inn.x, iz: inn.z });
    }
  }
  return samples;
}

function createRingMaterial() {
  return createShaderMaterial({
    name: 'work-radius-ring',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      'cameraPosition',
      { name: 'tint', type: 'vec3<f32>', defaultValue: [0.38, 0.64, 1.0] },
      { name: 'rim', type: 'vec3<f32>', defaultValue: [1.0, 1.0, 1.0] },
    ],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.uv = input.uv;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  // uv.y = 1 at the outer rim, 0 at the inner fade.
  let t = 1.0 - input.uv.y;
  let rim = shaderUniforms.rim;
  let tint = shaderUniforms.tint;
  // Outer third stays the resource rim. Then team color, then gone.
  let film = mix(rim, tint, smoothstep(0.28, 0.72, t));
  let fade = pow(1.0 - t, 1.15);
  let edge = pow(1.0 - t, 4.2);
  let alpha = clamp(fade * 0.72 + edge * 0.28, 0.0, 1.0);
  if (alpha < 0.02) { discard; }
  return vec4<f32>(film, alpha);
}`,
  });
}

function allocMesh(engine, name, maxSegs, rimOnly = false) {
  const maxVerts = maxSegs * VERTS_PER_SEG;
  const positions = new Float32Array(maxVerts * 3);
  const normals = new Float32Array(maxVerts * 3);
  const uvs = new Float32Array(maxVerts * 2);
  const indices = new Uint32Array(maxSegs * IDX_PER_SEG);

  for (let i = 0; i < maxVerts; i++) normals[i * 3 + 1] = 1;

  for (let s = 0; s < maxSegs; s++) {
    const vb = s * VERTS_PER_SEG;
    const o = vb * 2;
    // Independent quad — uv.y drives the film fade (1 = resource rim).
    const inner = rimOnly ? 1 : 0;
    uvs[o] = 0;
    uvs[o + 1] = 1;
    uvs[o + 2] = 1;
    uvs[o + 3] = 1;
    uvs[o + 4] = 1;
    uvs[o + 5] = inner;
    uvs[o + 6] = 0;
    uvs[o + 7] = inner;
    const ib = s * IDX_PER_SEG;
    indices[ib] = vb;
    indices[ib + 1] = vb + 1;
    indices[ib + 2] = vb + 2;
    indices[ib + 3] = vb;
    indices[ib + 4] = vb + 2;
    indices[ib + 5] = vb + 3;
  }

  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.renderOrder = 175;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  return { mesh, positions };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createWorkRadiusRings(engine, scene, groundYAt) {
  function makeLayer(name, maxSegs, rimOnly, material) {
    const { mesh, positions } = allocMesh(engine, name, maxSegs, rimOnly);
    const mat = material || createRingMaterial();
    mesh.material = mat;
    addToScene(scene, mesh);
    mesh.visible = false;
    if (mesh._gpu) mesh._gpu.indexCount = 0;
    return { mesh, positions, material: mat };
  }

  /** @type {Record<string, { ring: ReturnType<typeof makeLayer>, link: ReturnType<typeof makeLayer> }>} */
  const layers = {};
  for (let i = 0; i < RIM_LAYER_KEYS.length; i++) {
    const key = RIM_LAYER_KEYS[i];
    const ring = makeLayer(`work-radius-ring-${key}`, MAX_SEGS, false);
    const link = makeLayer(`work-radius-link-${key}`, MAX_LINK_SEGS, true, ring.material);
    layers[key] = { ring, link };
  }

  /** @type {Map<string, { radius: number, until: number }>} */
  const lingerByKey = new Map();

  function lingerKey(spec) {
    return `${spec.owner | 0}:${spec.x.toFixed(2)},${spec.z.toFixed(2)}`;
  }

  function lingeredRadius(spec, now) {
    const live = spec.radius;
    const key = lingerKey(spec);
    const prev = lingerByKey.get(key);
    if (!(live > 0)) {
      lingerByKey.delete(key);
      return live;
    }
    if (!prev || live >= prev.radius) {
      if (prev) {
        prev.radius = live;
        prev.until = now + RADIUS_LINGER_MS;
      } else {
        lingerByKey.set(key, { radius: live, until: now + RADIUS_LINGER_MS });
      }
      return live;
    }
    if (now < prev.until) return prev.radius;
    prev.radius = live;
    prev.until = now;
    return live;
  }

  function setSegCount(mesh, n) {
    const idx = n * IDX_PER_SEG;
    if (mesh._gpu && mesh._gpu.indexCount !== idx) {
      mesh._gpu.indexCount = idx;
      invalidateRenderBundles(engine);
    }
    mesh.visible = n > 0;
  }

  function writeLinkQuad(positions, slot, ax, az, bx, bz, px, pz) {
    const pts = [
      [ax + px, az + pz],
      [bx + px, bz + pz],
      [bx - px, bz - pz],
      [ax - px, az - pz],
    ];
    const vb = slot * VERTS_PER_SEG;
    for (let k = 0; k < 4; k++) {
      const x = pts[k][0];
      const z = pts[k][1];
      const y = (groundYAt(x, z) || 0) + LIFT;
      const o = (vb + k) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
  }

  function writeLinksForLayer(layer, links) {
    const list = links ?? [];
    let segs = 0;
    for (let i = 0; i < list.length && segs < MAX_LINK_SEGS; i++) {
      const l = list[i];
      const dx = l.x1 - l.x0;
      const dz = l.z1 - l.z0;
      const len = Math.hypot(dx, dz);
      if (!(len > 0.08)) continue;
      const inv = 1 / len;
      const px = -dz * inv * LINK_HALF;
      const pz = dx * inv * LINK_HALF;
      const steps = Math.max(1, Math.ceil(len / LINK_STEP));
      for (let s = 0; s < steps && segs < MAX_LINK_SEGS; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        writeLinkQuad(
          layer.positions,
          segs,
          l.x0 + dx * t0,
          l.z0 + dz * t0,
          l.x0 + dx * t1,
          l.z0 + dz * t1,
          px,
          pz,
        );
        segs++;
      }
    }
    if (segs === 0) {
      setSegCount(layer.mesh, 0);
      return;
    }
    updateMeshPositions(engine, layer.mesh, layer.positions, 0, segs * VERTS_PER_SEG);
    setSegCount(layer.mesh, segs);
  }

  function writeQuad(positions, slot, ox0, oz0, ox1, oz1, ix1, iz1, ix0, iz0) {
    const pts = [
      [ox0, oz0],
      [ox1, oz1],
      [ix1, iz1],
      [ix0, iz0],
    ];
    const vb = slot * VERTS_PER_SEG;
    for (let k = 0; k < 4; k++) {
      const x = pts[k][0];
      const z = pts[k][1];
      const y = (groundYAt(x, z) || 0) + LIFT;
      const o = (vb + k) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
  }

  function writeLoop(positions, loop, disks, startSlot) {
    const samples = sampleUnionLoop(loop, disks);
    const n = samples.length;
    if (n < 2) return 0;
    const first = samples[0];
    const last = samples[n - 1];
    const wrap = !!(loop[0]?.closed || sameRimPoint(first.ox, first.oz, last.ox, last.oz));
    const quads = wrap ? n : n - 1;
    let written = 0;
    for (let i = 0; i < quads; i++) {
      if (startSlot + written >= MAX_SEGS) break;
      const a = samples[i];
      const b = samples[(i + 1) % n];
      writeQuad(positions, startSlot + written, a.ox, a.oz, b.ox, b.oz, b.ix, b.iz, a.ix, a.iz);
      written++;
    }
    return written;
  }

  function applyLayerUniforms(material, rimKey, tintRgb, tintOwner) {
    const tint = tintRgb || ownerTint(tintOwner);
    const rim = rimRgbForKey(rimKey);
    setShaderUniform(material, 'tint', [tint[0], tint[1], tint[2]]);
    setShaderUniform(material, 'rim', [rim[0], rim[1], rim[2]]);
  }

  function writeLayerRings(layer, disks, rimKey, tintRgb, tintOwner) {
    if (!disks.length) {
      setSegCount(layer.mesh, 0);
      return;
    }
    let segs = 0;
    const loops = buildUnionLoops(disks);
    for (let i = 0; i < loops.length; i++) {
      segs += writeLoop(layer.positions, loops[i], disks, segs);
    }
    if (segs === 0) setSegCount(layer.mesh, 0);
    else {
      updateMeshPositions(engine, layer.mesh, layer.positions, 0, segs * VERTS_PER_SEG);
      setSegCount(layer.mesh, segs);
    }
    applyLayerUniforms(layer.material, rimKey, tintRgb, tintOwner);
  }

  function clear() {
    for (let i = 0; i < RIM_LAYER_KEYS.length; i++) {
      const layer = layers[RIM_LAYER_KEYS[i]];
      setSegCount(layer.ring.mesh, 0);
      setSegCount(layer.link.mesh, 0);
    }
  }

  return {
    /**
     * @param {{ x: number, z: number, radius: number, owner?: number, rimKey?: string, kind?: string }[] | null | undefined} rings
     * @param {{ x0: number, z0: number, x1: number, z1: number, rimKey?: string, kind?: string }[] | null | undefined} [links]
     */
    sync(rings, links) {
      const list = rings ?? [];
      const n = Math.min(list.length, MAX_RINGS);
      const now = performance.now();
      const seen = new Set();
      /** @type {{ x: number, z: number, radius: number, owner?: number, tint?: number[], rimKey?: string }[]} */
      const disks = [];
      let tintOwner = 0;
      let tintRgb = null;
      for (let i = 0; i < n; i++) {
        const spec = list[i];
        if (!(spec?.radius > 0)) continue;
        if (disks.length === 0 && spec.owner != null) tintOwner = spec.owner | 0;
        if (disks.length === 0 && spec.tint) tintRgb = spec.tint;
        const radius = lingeredRadius(spec, now);
        seen.add(lingerKey(spec));
        disks.push({
          x: spec.x,
          z: spec.z,
          radius,
          owner: spec.owner,
          tint: spec.tint,
          rimKey: rimKeyForSpec(spec),
        });
      }
      for (const key of lingerByKey.keys()) {
        if (!seen.has(key)) lingerByKey.delete(key);
      }

      const ringGroups = groupDisksByRimKey(disks);
      /** @type {Map<string, typeof links>} */
      const linkGroups = new Map();
      const linkList = links ?? [];
      for (let i = 0; i < linkList.length; i++) {
        const key = rimKeyForSpec(linkList[i]);
        let bucket = linkGroups.get(key);
        if (!bucket) {
          bucket = [];
          linkGroups.set(key, bucket);
        }
        bucket.push(linkList[i]);
      }

      for (let i = 0; i < RIM_LAYER_KEYS.length; i++) {
        const key = RIM_LAYER_KEYS[i];
        const layer = layers[key];
        const group = ringGroups.get(key) || [];
        writeLayerRings(layer.ring, group, key, tintRgb, tintOwner);
        const layerLinks = linkGroups.get(key);
        writeLinksForLayer(layer.link, layerLinks);
        if (layerLinks?.length && !group.length) {
          applyLayerUniforms(layer.ring.material, key, tintRgb, tintOwner);
        }
      }
    },

    commit() {},

    clear,
  };
}
