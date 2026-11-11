// Headset select: a tapered beam from the controller to the field, and the
// lasso loop draped on the terrain. World-space so both eyes agree - the
// desktop marquee (selectionBox.js) draws in clip space and cannot be reused.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  invalidateRenderBundles,
  setShaderTexture,
  setSubtreeVisible,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { inwardNormals } from './selectionBox.js';

const INK = [70 / 255, 230 / 255, 110 / 255];
const MAX_QUADS = 640;
const TIP_SEGMENTS = 20;
/** Rings along the pointer. One tube, so the arc is not a stack of joints. */
const BEAM_RINGS = 24;
const BEAM_SIDES = 8;
/** Hand end of the beam as a fraction of the far end's width. */
const BEAM_HAND_FRAC = 0.015;
const LIFT = 0.75;
/** Wire box straight back from the ray origin, in metres. */
const HANDLE_W = 0.034;
const HANDLE_H = 0.016;
const HANDLE_D = 0.12;
const HANDLE_ROD = 0.0022;
/** Other-hand ray must meet a pad within this reach. */
const HANDLE_REACH = 0.4;
const LABEL_W = 256;
const LABEL_H = 128;
/**
 * Two pads on the top of the handle. Index 0 is the hand's order
 * (move / attack), index 1 selects, both at this laser's aim.
 */
const HANDLE_BUTTONS = [
  { id: 0, min: [-0.03, HANDLE_H, -0.112], max: [-0.003, HANDLE_H + 0.014, -0.008] },
  { id: 1, min: [0.003, HANDLE_H, -0.112], max: [0.03, HANDLE_H + 0.014, -0.008] },
];
const HANDLE_LABEL = {
  left: ['Move', 'Select'],
  right: ['Attack', 'Select'],
};
let handleSeq = 0;

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

/** World up, flattened off the aim. Straight up aims bow toward +X. */
function arcBow(ray) {
  const dx = ray.dx || 0;
  const dy = ray.dy || 0;
  const dz = ray.dz || 0;
  let x = -dx * dy;
  let y = 1 - dy * dy;
  let z = -dz * dy;
  const len = Math.hypot(x, y, z);
  if (!(len > 0.2)) return { x: 1, y: 0, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

function arcSag(length) {
  let s = length * 0.06;
  if (s > length * 0.12) s = length * 0.12;
  if (s > 0.4) s = 0.4;
  return s > 1e-4 ? s : 0;
}

/**
 * Circular arc from the ray origin to the aim point. The middle bows toward
 * world up. Both ends stay on the ray.
 */
export function arcBeamPoint(ray, length, t) {
  const px = ray.ox + ray.dx * length * t;
  const py = ray.oy + ray.dy * length * t;
  const pz = ray.oz + ray.dz * length * t;
  const sag = arcSag(length);
  if (!(sag > 0)) return { x: px, y: py, z: pz };
  const bow = arcBow(ray);
  const half = length * 0.5;
  const radius = (half * half + sag * sag) / (2 * sag);
  const alpha = Math.atan2(half, radius - sag);
  const ang = -alpha + 2 * alpha * t;
  const drop = radius - sag;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return {
    x: ray.ox + ray.dx * half - bow.x * drop + bow.x * radius * c + ray.dx * radius * s,
    y: ray.oy + ray.dy * half - bow.y * drop + bow.y * radius * c + ray.dy * radius * s,
    z: ray.oz + ray.dz * half - bow.z * drop + bow.z * radius * c + ray.dz * radius * s,
  };
}

/** Controller frame. Local +Z is the laser, local -Z runs back along the handle. */
function pointerFrame(ray) {
  const fx = ray.dx || 0;
  const fy = ray.dy || 0;
  const fz = ray.dz || 0;
  let ux = ray.ux || 0;
  let uy = ray.uy || 0;
  let uz = ray.uz || 0;
  if (Math.hypot(ux, uy, uz) < 1e-4) {
    ux = 0;
    uy = 1;
    uz = 0;
  }
  const along = ux * fx + uy * fy + uz * fz;
  ux -= fx * along;
  uy -= fy * along;
  uz -= fz * along;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 0.25) {
    const bow = arcBow(ray);
    ux = bow.x;
    uy = bow.y;
    uz = bow.z;
  } else {
    ux /= ul;
    uy /= ul;
    uz /= ul;
  }
  let rx = fy * uz - fz * uy;
  let ry = fz * ux - fx * uz;
  let rz = fx * uy - fy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  return { fx, fy, fz, ux, uy, uz, rx, ry, rz };
}

function rayToHandle(frame, origin, ray) {
  const px = ray.ox - origin.x;
  const py = ray.oy - origin.y;
  const pz = ray.oz - origin.z;
  return {
    ox: px * frame.rx + py * frame.ry + pz * frame.rz,
    oy: px * frame.ux + py * frame.uy + pz * frame.uz,
    oz: px * frame.fx + py * frame.fy + pz * frame.fz,
    dx: ray.dx * frame.rx + ray.dy * frame.ry + ray.dz * frame.rz,
    dy: ray.dx * frame.ux + ray.dy * frame.uy + ray.dz * frame.uz,
    dz: ray.dx * frame.fx + ray.dy * frame.fy + ray.dz * frame.fz,
  };
}

function rayHitLocalBox(ray, min, max) {
  let tEnter = 0;
  let tExit = HANDLE_REACH;
  const o = [ray.ox, ray.oy, ray.oz];
  const d = [ray.dx, ray.dy, ray.dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    let t1 = (min[a] - o[a]) / d[a];
    let t2 = (max[a] - o[a]) / d[a];
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (tExit < 0) return null;
  return tEnter >= 0 ? tEnter : 0;
}

/**
 * Which pad on `ray`'s handle `other` is pressing, or null.
 * 0 is the order pad, 1 is select. The other hand has to be close.
 */
export function pickHandleButton(ray, other) {
  if (!ray || !other) return null;
  const frame = pointerFrame(ray);
  const local = rayToHandle(frame, { x: ray.ox, y: ray.oy, z: ray.oz }, other);
  let best = null;
  let bestT = HANDLE_REACH;
  for (let i = 0; i < HANDLE_BUTTONS.length; i++) {
    const box = HANDLE_BUTTONS[i];
    const t = rayHitLocalBox(local, box.min, box.max);
    if (t != null && t < bestT) {
      bestT = t;
      best = box.id;
    }
  }
  return best;
}

/** A point just above pad `id`, for tests and hover. */
export function handleButtonPoint(ray, id) {
  const box = HANDLE_BUTTONS[id];
  const frame = pointerFrame(ray);
  const x = (box.min[0] + box.max[0]) * 0.5;
  const y = box.max[1] + 0.02;
  const z = (box.min[2] + box.max[2]) * 0.5;
  return {
    x: ray.ox + frame.rx * x + frame.ux * y + frame.fx * z,
    y: ray.oy + frame.ry * x + frame.uy * y + frame.fy * z,
    z: ray.oz + frame.rz * x + frame.uz * y + frame.fz * z,
  };
}

function quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz) {
  const trace = xx + yy + zz;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (yz - zy) / s;
    y = (zx - xz) / s;
    z = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    w = (yz - zy) / s;
    x = 0.25 * s;
    y = (xy + yx) / s;
    z = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    w = (zx - xz) / s;
    x = (xy + yx) / s;
    y = 0.25 * s;
    z = (yz + zy) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    w = (xy - yx) / s;
    x = (zx + xz) / s;
    y = (yz + zy) / s;
    z = 0.25 * s;
  }
  return { x, y, z, w };
}

function setQuat(mesh, q) {
  const rq = mesh.rotationQuaternion;
  if (!rq || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return;
  if (typeof rq.set === 'function') rq.set(q.x, q.y, q.z, q.w);
  else {
    rq.x = q.x;
    rq.y = q.y;
    rq.z = q.z;
    rq.w = q.w;
  }
}

function makeInkMaterial(name, alpha) {
  return createShaderMaterial({
    name,
    attributes: ['position'],
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
  return vec4<f32>(shaderUniforms.ink, ${alpha});
}`,
  });
}

function meshFromLists(engine, name, pos, idx, material) {
  const positions = Float32Array.from(pos);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array((positions.length / 3) * 2);
  const indices = Uint32Array.from(idx);
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  mesh.material = material;
  return mesh;
}

/** Thin box from a to b. */
function appendRod(pos, idx, a, b, r) {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const al = Math.hypot(ax, ay, az) || 1;
  const tx = ax / al;
  const ty = ay / al;
  const tz = az / al;
  const ref = Math.abs(ty) > 0.85 ? [1, 0, 0] : [0, 1, 0];
  let nx = ty * ref[2] - tz * ref[1];
  let ny = tz * ref[0] - tx * ref[2];
  let nz = tx * ref[1] - ty * ref[0];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const bx = ty * nz - tz * ny;
  const by = tz * nx - tx * nz;
  const bz = tx * ny - ty * nx;
  const base = pos.length / 3;
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const p of [a, b]) {
    for (let s = 0; s < signs.length; s++) {
      const sx = signs[s][0];
      const sy = signs[s][1];
      pos.push(
        p[0] + (nx * sx + bx * sy) * r,
        p[1] + (ny * sx + by * sy) * r,
        p[2] + (nz * sx + bz * sy) * r,
      );
    }
  }
  const faces = [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    idx.push(base + face[0], base + face[1], base + face[2]);
    idx.push(base + face[0], base + face[2], base + face[3]);
  }
}

function appendBoxEdges(pos, idx, x0, x1, y0, y1, z0, z1, r) {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let i = 0; i < edges.length; i++) {
    appendRod(pos, idx, c[edges[i][0]], c[edges[i][1]], r);
  }
}

/**
 * Wire box behind the laser, with two pads on top. Labels sit in the
 * handle frame: canvas top toward the beam, so they read when you look
 * down along the pointer.
 */
function createPointerHandle(engine, scene) {
  const id = handleSeq++;
  const pos = [];
  const idx = [];
  appendBoxEdges(pos, idx, -HANDLE_W, HANDLE_W, -HANDLE_H, HANDLE_H, -HANDLE_D, 0, HANDLE_ROD);
  for (let i = 0; i < HANDLE_BUTTONS.length; i++) {
    const b = HANDLE_BUTTONS[i];
    const y = HANDLE_H + 0.004;
    appendBoxEdges(pos, idx, b.min[0], b.max[0], y, y + 0.004, b.min[2], b.max[2], HANDLE_ROD * 0.75);
  }
  const wire = meshFromLists(engine, `xr-handle-${id}`, pos, idx, makeInkMaterial(`xr-handle-ink-${id}`, '0.9'));
  wire.renderOrder = 178;
  addToScene(scene, wire);
  setSubtreeVisible(wire, false);

  const pads = [];
  const hots = [];
  for (let i = 0; i < HANDLE_BUTTONS.length; i++) {
    const b = HANDLE_BUTTONS[i];
    const plate = [];
    const pi = [];
    const y = HANDLE_H + 0.006;
    const base = 0;
    plate.push(b.min[0], y, b.min[2], b.max[0], y, b.min[2], b.max[0], y, b.max[2], b.min[0], y, b.max[2]);
    pi.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const pad = meshFromLists(engine, `xr-pad-${id}-${i}`, plate, pi, makeInkMaterial(`xr-pad-ink-${id}-${i}`, '0.35'));
    pad.renderOrder = 180;
    addToScene(scene, pad);
    setSubtreeVisible(pad, false);
    const hotPos = plate.slice();
    for (let v = 1; v < hotPos.length; v += 3) hotPos[v] += 0.0015;
    const hot = meshFromLists(
      engine,
      `xr-pad-hot-${id}-${i}`,
      hotPos,
      pi,
      makeInkMaterial(`xr-pad-hot-ink-${id}-${i}`, '0.9'),
    );
    hot.renderOrder = 181;
    addToScene(scene, hot);
    setSubtreeVisible(hot, false);
    pads.push(pad);
    hots.push(hot);
  }

  const labels = [];
  const canPaint = typeof document !== 'undefined';
  if (canPaint) {
    for (let i = 0; i < HANDLE_BUTTONS.length; i++) {
      labels.push(makeHandleLabel(engine, scene, `xr-handle-label-${id}-${i}`));
    }
  }
  let visible = false;
  let paintedHand = '';
  const parts = [wire, ...pads, ...hots, ...labels.map((label) => label.mesh)];

  function hide() {
    if (!visible) return;
    for (let i = 0; i < parts.length; i++) setSubtreeVisible(parts[i], false);
    visible = false;
  }

  function poseRigid(mesh, ray, frame) {
    if (mesh.position) {
      mesh.position.x = ray.ox;
      mesh.position.y = ray.oy;
      mesh.position.z = ray.oz;
    }
    setQuat(mesh, quatFromBasis(
      frame.rx, frame.ry, frame.rz,
      frame.ux, frame.uy, frame.uz,
      frame.fx, frame.fy, frame.fz,
    ));
    mesh.markLocalDirty?.();
    setSubtreeVisible(mesh, true);
  }

  function pose(ray, hot) {
    if (!ray) {
      hide();
      return;
    }
    const frame = pointerFrame(ray);
    poseRigid(wire, ray, frame);
    for (let i = 0; i < pads.length; i++) poseRigid(pads[i], ray, frame);
    for (let i = 0; i < hots.length; i++) {
      if (hot === i) poseRigid(hots[i], ray, frame);
      else setSubtreeVisible(hots[i], false);
    }
    const words = HANDLE_LABEL[ray.hand];
    if (words && words.join() !== paintedHand) {
      for (let i = 0; i < labels.length; i++) labels[i].paint(words[i]);
      paintedHand = words.join();
    }
    for (let i = 0; i < labels.length; i++) {
      const b = HANDLE_BUTTONS[i];
      const x = (b.min[0] + b.max[0]) * 0.5;
      const y = HANDLE_H + 0.012;
      const z = (b.min[2] + b.max[2]) * 0.5;
      const mesh = labels[i].mesh;
      if (mesh.position) {
        mesh.position.x = ray.ox + frame.rx * x + frame.ux * y + frame.fx * z;
        mesh.position.y = ray.oy + frame.ry * x + frame.uy * y + frame.fy * z;
        mesh.position.z = ray.oz + frame.rz * x + frame.uz * y + frame.fz * z;
      }
      if (mesh.scaling) {
        mesh.scaling.x = (b.max[0] - b.min[0]) * 0.86;
        mesh.scaling.y = (b.max[2] - b.min[2]) * 0.55;
        mesh.scaling.z = 1;
      }
      // Local +Y is the laser (top of the glyphs). Local +X is the viewer's
      // left when looking down on the pad, matching the story-panel UVs.
      setQuat(mesh, quatFromBasis(
        frame.rx, frame.ry, frame.rz,
        frame.fx, frame.fy, frame.fz,
        frame.ux, frame.uy, frame.uz,
      ));
      mesh.markLocalDirty?.();
      setSubtreeVisible(mesh, true);
    }
    visible = true;
  }

  return { hide, pose };
}

function makeHandleLabel(engine, scene, name) {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([1, 1, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = 182;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  const mat = createShaderMaterial({
    name,
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['world', 'viewProjection'],
    samplers: ['glyph'],
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
  return textureSample(glyph, glyphSampler, input.uv);
}`,
  });
  mesh.material = mat;
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tex = createTexture2DFromPixels(engine, new Uint8Array(LABEL_W * LABEL_H * 4), LABEL_W, LABEL_H, {
    srgb: true,
    minFilter: 'linear',
    magFilter: 'linear',
  });
  setShaderTexture(mat, 'glyph', tex);
  let warned = false;

  function paint(text) {
    if (!ctx) return;
    try {
      ctx.clearRect(0, 0, LABEL_W, LABEL_H);
      ctx.fillStyle = '#eaffe8';
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, LABEL_W * 0.5, LABEL_H * 0.5);
      const bytes = new Uint8Array(ctx.getImageData(0, 0, LABEL_W, LABEL_H).data);
      engine._device.queue.writeTexture(
        { texture: tex.texture },
        bytes,
        { bytesPerRow: LABEL_W * 4, rowsPerImage: LABEL_H },
        { width: LABEL_W, height: LABEL_H },
      );
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn('[xr-handle] raster failed', err);
      }
    }
  }

  return { mesh, paint };
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
  const handle = createPointerHandle(engine, scene);

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
    handle.hide();
  }

  function poseBeam(ray, length, width, hot) {
    if (!ray || !(length > 0)) {
      hideBeam();
      return;
    }
    const ref = Math.abs(ray.dy) > 0.85 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const pos = beam.positions;
    for (let i = 0; i < BEAM_RINGS; i++) {
      const t = i / (BEAM_RINGS - 1);
      const p = arcBeamPoint(ray, length, t);
      const ta = Math.max(0, t - 1e-3);
      const tb = Math.min(1, t + 1e-3);
      const a = arcBeamPoint(ray, length, ta);
      const b = arcBeamPoint(ray, length, tb);
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
    handle.pose(ray, hot);
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
      poseBeam(s.ray, s.length, width * 1.5, s.hot);
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
