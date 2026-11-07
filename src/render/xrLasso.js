// Headset select: a tapered beam from the controller to the field, and the
// lasso loop draped on the terrain. World-space so both eyes agree - the
// desktop marquee (selectionBox.js) draws in clip space and cannot be reused.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  invalidateRenderBundles,
  setSubtreeVisible,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { inwardNormals } from './selectionBox.js';

const INK = [70 / 255, 230 / 255, 110 / 255];
const MAX_QUADS = 640;
const TIP_SEGMENTS = 20;
/** Rings along the pointer. One tube, so the bend is not a stack of joints. */
const BEAM_RINGS = 24;
const BEAM_SIDES = 8;
/** Hand end of the beam as a fraction of the far end's width. */
const BEAM_HAND_FRAC = 0.015;
/** Lift above the chord, capped in beam widths so long pointers stay readable. */
const BEAM_BEND_FRAC = 0.055;
const BEAM_BEND_WIDTHS = 10;
const LIFT = 0.75;

/**
 * Resample a closed loop so no edge is longer than `step`, keeping corners.
 * @param {{ x: number, z: number }[]} loop
 * @param {number} step
 * @param {number} maxPts
 * @returns {{ x: number, y: number }[]} y carries world z
 */
export function densifyLoop(loop, step, maxPts) {
  const n = loop?.length ?? 0;
  if (n < 2) return [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const s = Math.max(step, perimeter / Math.max(n, maxPts - n), 1e-3);
  const out = [];
  for (let i = 0; i < n && out.length < maxPts; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / s));
    for (let k = 0; k < steps && out.length < maxPts; k++) {
      const t = k / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function makeRibbonMaterial() {
  return createShaderMaterial({
    name: 'xr-lasso',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'ink', type: 'vec3<f32>', defaultValue: INK },
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
  // uv.y = 1 on the loop itself, 0 at the inner end of the fade band.
  let t = 1.0 - input.uv.y;
  let edge = 1.0 - smoothstep(0.0, 0.3, t);
  let film = (1.0 - t) * 0.3;
  let alpha = max(edge * 0.95, film);
  if (alpha < 0.02) { discard; }
  return vec4<f32>(shaderUniforms.ink, alpha);
}`,
  });
}

function makeRibbonMesh(engine) {
  const verts = MAX_QUADS * 4;
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint32Array(MAX_QUADS * 6);
  for (let i = 0; i < verts; i++) normals[i * 3 + 1] = 1;
  for (let q = 0; q < MAX_QUADS; q++) {
    const v = q * 4;
    const o = v * 2;
    uvs[o + 1] = 1;
    uvs[o + 3] = 1;
    const t = q * 6;
    indices[t] = v;
    indices[t + 1] = v + 1;
    indices[t + 2] = v + 2;
    indices[t + 3] = v;
    indices[t + 4] = v + 2;
    indices[t + 5] = v + 3;
  }
  const mesh = createMeshFromData(engine, 'xr-lasso', positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.renderOrder = 176;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  if (mesh._gpu) mesh._gpu.indexCount = 0;
  return { mesh, positions };
}

/** Unlit ink. Outward faces only — the shell is wound CCW. */
function makeBeamMaterial() {
  return createShaderMaterial({
    name: 'xr-beam',
    attributes: ['position'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'ink', type: 'vec3<f32>', defaultValue: INK },
    ],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    backFaceCulling: true,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(shaderUniforms.ink, 0.7);
}`,
  });
}

/**
 * One tapered tube. Lite cylinders keep Babylon's winding, so CCW culling
 * draws the inside and the end caps read as knuckles wherever the arc bends.
 * `N = B × T` with angle increasing toward B, so these quads face outward.
 */
function makeBeamMesh(engine) {
  const verts = BEAM_RINGS * BEAM_SIDES;
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint32Array((BEAM_RINGS - 1) * BEAM_SIDES * 6);
  let t = 0;
  for (let i = 0; i < BEAM_RINGS - 1; i++) {
    for (let j = 0; j < BEAM_SIDES; j++) {
      const j2 = (j + 1) % BEAM_SIDES;
      const a = i * BEAM_SIDES + j;
      const b = i * BEAM_SIDES + j2;
      const c = (i + 1) * BEAM_SIDES + j2;
      const d = (i + 1) * BEAM_SIDES + j;
      indices[t++] = a;
      indices[t++] = b;
      indices[t++] = d;
      indices[t++] = b;
      indices[t++] = c;
      indices[t++] = d;
    }
  }
  const mesh = createMeshFromData(engine, 'xr-beam', positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.renderOrder = 176;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  return { mesh, positions };
}

/** Right-handed frame for a unit tangent. `ref` is shared by every ring. */
function beamBasis(tx, ty, tz, ref) {
  let bx = ty * ref.z - tz * ref.y;
  let by = tz * ref.x - tx * ref.z;
  let bz = tx * ref.y - ty * ref.x;
  const bl = Math.hypot(bx, by, bz);
  if (bl < 1e-5) {
    const alt = Math.abs(ref.y) > 0.5 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    return beamBasis(tx, ty, tz, alt);
  }
  bx /= bl;
  by /= bl;
  bz /= bl;
  return {
    nx: by * tz - bz * ty,
    ny: bz * tx - bx * tz,
    nz: bx * ty - by * tx,
    bx,
    by,
    bz,
  };
}

/**
 * Point on a controller beam that keeps the exact ray endpoints while arcing
 * toward world-up, perpendicular to the ray. A downward sag leaves the hand
 * going down and climbs back to the target; this rises, then comes down onto it.
 */
export function bentBeamPoint(ray, length, bend, t) {
  const upDot = ray.dy;
  let bx = -upDot * ray.dx;
  let by = 1 - upDot * ray.dy;
  let bz = -upDot * ray.dz;
  const bl = Math.hypot(bx, by, bz);
  if (bl > 1e-5) {
    bx /= bl;
    by /= bl;
    bz /= bl;
  } else {
    bx = by = bz = 0;
  }
  const bow = bend * 4 * t * (1 - t);
  return {
    x: ray.ox + ray.dx * length * t + bx * bow,
    y: ray.oy + ray.dy * length * t + by * bow,
    z: ray.oz + ray.dz * length * t + bz * bow,
  };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createXrLassoOverlay(engine, scene, groundYAt) {
  const ribbon = makeRibbonMesh(engine);
  ribbon.mesh.material = makeRibbonMaterial();
  addToScene(scene, ribbon.mesh);
  setSubtreeVisible(ribbon.mesh, false);
  let quads = 0;

  const beam = makeBeamMesh(engine);
  beam.mesh.material = makeBeamMaterial();
  addToScene(scene, beam.mesh);
  setSubtreeVisible(beam.mesh, false);

  function setQuads(n) {
    const idx = n * 6;
    if (ribbon.mesh._gpu && ribbon.mesh._gpu.indexCount !== idx) {
      ribbon.mesh._gpu.indexCount = idx;
      invalidateRenderBundles(engine);
    }
    if ((n > 0) !== ribbon.mesh.visible) setSubtreeVisible(ribbon.mesh, n > 0);
    quads = n;
  }

  function writeVertex(o, x, z) {
    const p = ribbon.positions;
    p[o] = x;
    p[o + 1] = (groundYAt(x, z) || 0) + LIFT;
    p[o + 2] = z;
  }

  /** Closed band: outer edge on the loop, fading `band` world units inward. */
  function writeBand(pts, band, slot) {
    const n = pts.length;
    if (n < 3) return slot;
    const { nx, ny } = inwardNormals(pts);
    for (let i = 0; i < n && slot < MAX_QUADS; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      const v = slot * 4 * 3;
      writeVertex(v, a.x, a.y);
      writeVertex(v + 3, b.x, b.y);
      writeVertex(v + 6, b.x + nx[j] * band, b.y + ny[j] * band);
      writeVertex(v + 9, a.x + nx[i] * band, a.y + ny[i] * band);
      slot++;
    }
    return slot;
  }

  const tipPts = [];
  for (let i = 0; i < TIP_SEGMENTS; i++) tipPts.push({ x: 0, y: 0 });

  function writeTip(x, z, r, slot) {
    for (let i = 0; i < TIP_SEGMENTS; i++) {
      const a = (i / TIP_SEGMENTS) * Math.PI * 2;
      tipPts[i].x = x + Math.cos(a) * r;
      tipPts[i].y = z + Math.sin(a) * r;
    }
    return writeBand(tipPts, r, slot);
  }

  function hideBeam() {
    if (beam.mesh.visible) setSubtreeVisible(beam.mesh, false);
  }

  function poseBeam(ray, length, width) {
    if (!ray || !(length > 0)) {
      hideBeam();
      return;
    }
    const bend = Math.min(length * BEAM_BEND_FRAC, width * BEAM_BEND_WIDTHS);
    const ref = Math.abs(ray.dy) > 0.85 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const pos = beam.positions;
    for (let i = 0; i < BEAM_RINGS; i++) {
      const t = i / (BEAM_RINGS - 1);
      const p = bentBeamPoint(ray, length, bend, t);
      const ta = Math.max(0, t - 1e-3);
      const tb = Math.min(1, t + 1e-3);
      const a = bentBeamPoint(ray, length, bend, ta);
      const b = bentBeamPoint(ray, length, bend, tb);
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dz = b.z - a.z;
      const span = Math.hypot(dx, dy, dz) || 1;
      dx /= span;
      dy /= span;
      dz /= span;
      const basis = beamBasis(dx, dy, dz, ref);
      const radius = width * (BEAM_HAND_FRAC + (1 - BEAM_HAND_FRAC) * t) * 0.5;
      for (let j = 0; j < BEAM_SIDES; j++) {
        const ang = (j / BEAM_SIDES) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const ox = basis.nx * c + basis.bx * s;
        const oy = basis.ny * c + basis.by * s;
        const oz = basis.nz * c + basis.bz * s;
        const v = (i * BEAM_SIDES + j) * 3;
        pos[v] = p.x + ox * radius;
        pos[v + 1] = p.y + oy * radius;
        pos[v + 2] = p.z + oz * radius;
      }
    }
    updateMeshPositions(engine, beam.mesh, pos, 0, BEAM_RINGS * BEAM_SIDES);
    if (!beam.mesh.visible) setSubtreeVisible(beam.mesh, true);
  }

  function hide() {
    hideBeam();
    if (quads > 0 || ribbon.mesh.visible) setQuads(0);
  }

  return {
    /**
     * @param {{
     *   ray?: { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null,
     *   length?: number,
     *   loop?: { x: number, z: number }[] | null,
     *   tip?: { x: number, z: number } | null,
     *   width?: number,
     * }} s `width` is the lasso line width in world units; the beam and tip scale off it.
     */
    show(s) {
      const width = s.width > 0 ? s.width : 0.5;
      poseBeam(s.ray, s.length, width * 1.5);
      let slot = 0;
      if (s.loop && s.loop.length >= 3) {
        const pts = densifyLoop(s.loop, width * 4, MAX_QUADS - TIP_SEGMENTS);
        slot = writeBand(pts, width * 6, slot);
      }
      if (s.tip) slot = writeTip(s.tip.x, s.tip.z, width * 2.5, slot);
      if (slot > 0) updateMeshPositions(engine, ribbon.mesh, ribbon.positions, 0, slot * 4);
      setQuads(slot);
    },
    hide,
  };
}
