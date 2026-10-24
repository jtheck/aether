// Headset select: a tapered beam from the controller to the field, and the
// lasso loop draped on the terrain. World-space so both eyes agree - the
// desktop marquee (selectionBox.js) draws in clip space and cannot be reused.

import {
  addToScene,
  createCylinder,
  createMeshFromData,
  createShaderMaterial,
  createStandardMaterial,
  invalidateRenderBundles,
  setShaderUniform,
  setSubtreeVisible,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { inwardNormals } from './selectionBox.js';

const INK = [70 / 255, 230 / 255, 110 / 255];
const MAX_QUADS = 640;
const TIP_SEGMENTS = 20;
const BEAM_SEGMENTS = 8;
/** Hand end of the beam as a fraction of the far end's width. */
const BEAM_HAND_FRAC = 0.015;
/** Subtle downward bow, capped in beam widths so long pointers stay readable. */
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

/** Quaternion turning +Y onto the unit vector (dx, dy, dz). */
function quatFromUp(dx, dy, dz) {
  if (dy < -0.999999) return [1, 0, 0, 0];
  const x = dz;
  const z = -dx;
  const w = 1 + dy;
  const len = Math.hypot(x, z, w) || 1;
  return [x / len, 0, z / len, w / len];
}

/**
 * Point on a controller beam that keeps the exact ray endpoints while bowing
 * toward world-down, perpendicular to the ray.
 */
export function bentBeamPoint(ray, length, bend, t) {
  const downDot = -ray.dy;
  let bx = -downDot * ray.dx;
  let by = -1 - downDot * ray.dy;
  let bz = -downDot * ray.dz;
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

  const beamMat = createStandardMaterial();
  beamMat.diffuseColor = [...INK];
  beamMat.emissiveColor = [...INK];
  beamMat.specularColor = [0, 0, 0];
  beamMat.disableLighting = true;
  // Below 1 keeps Lite off the opaque render-bundle path for a mesh that moves every frame.
  beamMat.alpha = 0.7;
  const beams = [];
  for (let i = 0; i < BEAM_SEGMENTS; i++) {
    const a = i / BEAM_SEGMENTS;
    const b = (i + 1) / BEAM_SEGMENTS;
    const beam = createCylinder(engine, {
      diameterBottom: BEAM_HAND_FRAC + (1 - BEAM_HAND_FRAC) * a,
      diameterTop: BEAM_HAND_FRAC + (1 - BEAM_HAND_FRAC) * b,
      height: 1,
      tessellation: 10,
    });
    beam.pickable = false;
    beam.receiveShadows = false;
    beam.material = beamMat;
    addToScene(scene, beam);
    setSubtreeVisible(beam, false);
    beams.push(beam);
  }

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
    for (const beam of beams) {
      if (beam.visible) setSubtreeVisible(beam, false);
    }
  }

  function poseBeam(ray, length, width) {
    if (!ray || !(length > 0)) {
      hideBeam();
      return;
    }
    const bend = Math.min(length * BEAM_BEND_FRAC, width * BEAM_BEND_WIDTHS);
    let a = bentBeamPoint(ray, length, bend, 0);
    for (let i = 0; i < BEAM_SEGMENTS; i++) {
      const beam = beams[i];
      const b = bentBeamPoint(ray, length, bend, (i + 1) / BEAM_SEGMENTS);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const segmentLength = Math.hypot(dx, dy, dz);
      beam.position.x = (a.x + b.x) * 0.5;
      beam.position.y = (a.y + b.y) * 0.5;
      beam.position.z = (a.z + b.z) * 0.5;
      beam.scaling.x = width;
      beam.scaling.y = segmentLength;
      beam.scaling.z = width;
      const q = quatFromUp(dx / segmentLength, dy / segmentLength, dz / segmentLength);
      const rq = beam.rotationQuaternion;
      if (rq) {
        if (typeof rq.set === 'function') rq.set(q[0], q[1], q[2], q[3]);
        else {
          rq.x = q[0];
          rq.y = q[1];
          rq.z = q[2];
          rq.w = q[3];
        }
      }
      beam.markLocalDirty?.();
      if (!beam.visible) setSubtreeVisible(beam, true);
      a = b;
    }
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
