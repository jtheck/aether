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
  setShaderUniform,
  setSubtreeVisible,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { inwardNormals } from './selectionBox.js';
import { CONTROL_GROUP_DEFS, controlGroupFacing, tallyGlyphs, tallyMarkLayout } from './controlGroupHud.js';

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
const HANDLE_H = 0.016;
const HANDLE_ROD = 0.0022;
/** Other-hand ray must meet a pad within this reach. */
const HANDLE_REACH = 0.5;
const WRIST_GROUP_HIT_SLOP = 0.01;
const LABEL_W = 256;
const LABEL_H = 128;
const PAD_THICK = 0.014;
const PAD_TOP = HANDLE_H + PAD_THICK;
const PAD_SURFACE = HANDLE_H + 0.006; // pick volumes only
/** Equilateral group triangles in a row up the arm (-Z), pointing across it. */
const TRI_SIDE = 0.032;
const TRI_GAP = 0.014;
const TRI_PITCH = TRI_SIDE + TRI_GAP;
const TRI_Z0 = -0.028;
const FACE_BTN_R = 0.013;
/** Pause is the next pad in that same row, on the same face. */
const PAUSE_R = FACE_BTN_R;
/** Other-hand aim dot, just above the pad tops. */
const AIM_Y = PAD_SURFACE + 0.004;
const AIM_R = 0.0045;
const PAD_DEPRESS = 0.0035;
export const XR_BEAM_STUB_FRAC = 1.15;

function handlePad(x0, x1, z0, z1, id) {
  return { id, min: [x0, HANDLE_H, z0], max: [x1, PAD_TOP, z1] };
}

function circlePad(cx, cz, r, id) {
  return handlePad(cx - r, cx + r, cz - r, cz + r, id);
}

function eqTriPick(cx, cz, side, dir) {
  const r = side / Math.sqrt(3);
  const spin = (dir ?? 1) >= 0 ? 0 : Math.PI;
  const out = [];
  for (let k = 0; k < 3; k++) {
    const a = spin - (k * 2 * Math.PI) / 3;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

function eqTriPad(cx, cz, side, id, dir) {
  const v = eqTriPick(cx, cz, side, dir);
  let x0 = v[0][0];
  let x1 = v[0][0];
  let z0 = v[0][1];
  let z1 = v[0][1];
  for (let i = 1; i < v.length; i++) {
    x0 = Math.min(x0, v[i][0]);
    x1 = Math.max(x1, v[i][0]);
    z0 = Math.min(z0, v[i][1]);
    z1 = Math.max(z1, v[i][1]);
  }
  return { ...handlePad(x0, x1, z0, z1, id), tri: { cx, cz, side, dir } };
}

function pointInEqTri(x, z, tri, slop = 0) {
  const grow = tri.side > 1e-6 ? (tri.side + slop * 2) / tri.side : 1;
  const v = eqTriPick(tri.cx, tri.cz, tri.side * grow, tri.dir);
  function side(ax, az, bx, bz) {
    return (bx - ax) * (z - az) - (bz - az) * (x - ax);
  }
  const c0 = side(v[0][0], v[0][1], v[1][0], v[1][1]);
  const c1 = side(v[1][0], v[1][1], v[2][0], v[2][1]);
  const c2 = side(v[2][0], v[2][1], v[0][0], v[0][1]);
  const neg = c0 < -1e-6 || c1 < -1e-6 || c2 < -1e-6;
  const pos = c0 > 1e-6 || c1 > 1e-6 || c2 > 1e-6;
  return !(neg && pos);
}

/** Group i (0..2) on the center line, further -Z is further up the arm. */
export function wristGroupCenter(index) {
  return [0, TRI_Z0 - index * TRI_PITCH];
}

/** Pause, one pitch past the last group, on the same face. */
export function wristPauseCenter() {
  return [0, TRI_Z0 - 3 * TRI_PITCH];
}

/** Same in/out alternation as the flat control-group column for that hand. */
export function wristTriFacing(hand, index) {
  return controlGroupFacing(hand === 'left' ? 'left' : 'right', index);
}

function wristPadCenter(i) {
  if (i >= 5) return wristPauseCenter();
  if (i >= 2) return wristGroupCenter(i - 2);
  return wristGroupCenter(0);
}

/** 2–4 group triangles, 5 pause. Face A/B/X/Y pads are not on the bracer. */
export function wristHandleButtons(hand) {
  const buttons = [];
  for (let i = 0; i < 3; i++) {
    const c = wristGroupCenter(i);
    buttons.push(eqTriPad(c[0], c[1], TRI_SIDE, i + 2, wristTriFacing(hand, i)));
  }
  const p = wristPauseCenter();
  buttons.push(circlePad(p[0], p[1], PAUSE_R, 5));
  return buttons;
}

export const WRIST_CONTROL_GROUPS = {
  left: [0, 1, 4],
  right: [2, 3, 5],
};

/** Control-group id for pad indices 2–4 on that beam's hand. */
export function wristControlGroupId(hand, buttonId) {
  const key = hand === 'left' || hand === 'right' ? hand : 'right';
  if (!(buttonId >= 2 && buttonId <= 4)) return null;
  const list = WRIST_CONTROL_GROUPS[key];
  return list?.[buttonId - 2] ?? null;
}

function controlGroupRgb(id) {
  for (let i = 0; i < CONTROL_GROUP_DEFS.length; i++) {
    const d = CONTROL_GROUP_DEFS[i];
    if (d.id === id) return d.rgb;
  }
  return INK;
}

function wristPadRgb(hand, buttonId) {
  const gid = wristControlGroupId(hand, buttonId);
  return gid == null ? INK : controlGroupRgb(gid);
}

function edgeRgb(rgb) {
  const lum = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  if (lum > 0.72) return rgb.map((c) => c * 0.32);
  return rgb.map((c) => Math.min(1, c + (1 - c) * 0.62));
}

function pickPadBounds(box) {
  const s = box.id >= 5 ? WRIST_GROUP_HIT_SLOP * 0.7 : WRIST_GROUP_HIT_SLOP;
  return {
    id: box.id,
    tri: box.tri,
    min: [box.min[0] - s, box.min[1] - s * 0.6, box.min[2] - s],
    max: [box.max[0] + s, box.max[1] + s, box.max[2] + s],
  };
}

/** Pick (x,y,z) → display-local vertex for handleDisplayQuat (x, z, y). */
function bracerVert(x, y, z) {
  return [x, z, y];
}

function eqTriVerts(cx, cz, side, dir) {
  const y = PAD_SURFACE;
  return eqTriPick(cx, cz, side, dir).map((p) => bracerVert(p[0], y, p[1]));
}

function appendEqTri(plate, pi, cx, cz, side, dir) {
  const v = eqTriVerts(cx, cz, side, dir);
  const base = plate.length / 3;
  plate.push(...v[0], ...v[1], ...v[2]);
  pi.push(base, base + 1, base + 2);
}

function appendEqTriWire(pos, idx, cx, cz, side, dir) {
  const v = eqTriVerts(cx, cz, side, dir);
  const rod = HANDLE_ROD * 0.65;
  appendRod(pos, idx, v[0], v[1], rod);
  appendRod(pos, idx, v[1], v[2], rod);
  appendRod(pos, idx, v[2], v[0], rod);
}

function appendCircle(plate, pi, cx, cz, r, segments = 14, yPick = PAD_SURFACE) {
  const y = yPick;
  const base = plate.length / 3;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    plate.push(
      ...bracerVert(cx, y, cz),
      ...bracerVert(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r),
      ...bracerVert(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r),
    );
    pi.push(base + i * 3, base + i * 3 + 1, base + i * 3 + 2);
  }
}

function appendCircleWire(pos, idx, cx, cz, r, segments = 14, yPick = PAD_SURFACE) {
  const y = yPick;
  const rod = HANDLE_ROD * 0.75;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    appendRod(pos, idx,
      bracerVert(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r),
      bracerVert(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r),
      rod,
    );
  }
}

function appendPauseBars(pos, idx, cx, cz) {
  const y = PAD_SURFACE + 0.0016;
  const gap = FACE_BTN_R * 0.35;
  const w = FACE_BTN_R * 0.22;
  const h = FACE_BTN_R * 0.95;
  const rod = HANDLE_ROD * 0.85;
  const verts = (ox) => ([
    bracerVert(cx + ox - w, y, cz - h),
    bracerVert(cx + ox + w, y, cz - h),
    bracerVert(cx + ox + w, y, cz + h),
    bracerVert(cx + ox - w, y, cz + h),
  ]);
  const a = verts(-gap);
  const b = verts(gap);
  for (const q of [a, b]) {
    appendRod(pos, idx, q[0], q[1], rod);
    appendRod(pos, idx, q[1], q[2], rod);
    appendRod(pos, idx, q[2], q[3], rod);
    appendRod(pos, idx, q[3], q[0], rod);
  }
}
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

/** Pick frame: local +Z is the laser, +Y is bracer up (wrist-projected). */
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

/** Pad labels and coloured meshes share this basis. */
function handleDisplayQuat(frame) {
  return quatFromBasis(
    frame.rx, frame.ry, frame.rz,
    frame.fx, frame.fy, frame.fz,
    frame.ux, frame.uy, frame.uz,
  );
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
 * 2–4 control groups, 5 pause. The other hand has to be close.
 */
function bracerHand(ray) {
  return ray?.hand === 'left' ? 'left' : 'right';
}

export function pickHandleButton(ray, other) {
  if (!ray || !other) return null;
  const frame = pointerFrame(ray);
  const local = rayToHandle(frame, { x: ray.ox, y: ray.oy, z: ray.oz }, other);
  const buttons = wristHandleButtons(bracerHand(ray));
  let best = null;
  let bestT = HANDLE_REACH;
  for (let i = 0; i < buttons.length; i++) {
    const box = pickPadBounds(buttons[i]);
    const t = rayHitLocalBox(local, box.min, box.max);
    if (t == null || !(t < bestT)) continue;
    const hx = local.ox + local.dx * t;
    const hz = local.oz + local.dz * t;
    if (box.tri && !pointInEqTri(hx, hz, box.tri, WRIST_GROUP_HIT_SLOP)) continue;
    bestT = t;
    best = box.id;
  }
  return best;
}

/**
 * Where the other controller's ray meets the top of the bracer, in pick
 * space, or null when it misses the button band. A dot, not a hand.
 * @param {object} ray bracer ray
 * @param {object} other other controller ray
 */
export function wristAimLocal(ray, other) {
  if (!ray || !other) return null;
  const frame = pointerFrame(ray);
  const local = rayToHandle(frame, { x: ray.ox, y: ray.oy, z: ray.oz }, other);
  if (Math.abs(local.dy) < 1e-5) return null;
  const t = (AIM_Y - local.oy) / local.dy;
  if (!(t >= 0) || t > HANDLE_REACH) return null;
  const x = local.ox + local.dx * t;
  const z = local.oz + local.dz * t;
  const xLim = 0.05;
  const zHi = wristGroupCenter(0)[1] + TRI_SIDE * 0.5 + 0.012;
  const zLo = wristPauseCenter()[1] - PAUSE_R - 0.012;
  if (x < -xLim || x > xLim || z > zHi || z < zLo) return null;
  return { x, y: AIM_Y, z };
}

/** A point just above pad `id`, for tests and hover. */
export function handleButtonPoint(ray, id) {
  const box = wristHandleButtons(bracerHand(ray)).find((b) => b.id === id);
  if (!box) return null;
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

function makeInkMaterial(name, alpha, ink = INK) {
  return createShaderMaterial({
    name,
    attributes: ['position'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'ink', type: 'vec3<f32>', defaultValue: ink },
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

/** Filled group triangles and a pause pad, one row on the bracer face. */
function createPointerHandle(engine, scene, hand) {
  const id = handleSeq++;
  const specs = wristHandleButtons(hand);
  const pads = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const plate = [];
    const pi = [];
    const edgePos = [];
    const edgeIdx = [];
    const c = wristPadCenter(spec.id);
    const rgb = wristPadRgb(hand, spec.id);
    let bars = null;
    if (spec.tri) {
      appendEqTri(plate, pi, c[0], c[1], TRI_SIDE, spec.tri.dir);
      appendEqTriWire(edgePos, edgeIdx, c[0], c[1], TRI_SIDE, spec.tri.dir);
    } else {
      appendCircle(plate, pi, c[0], c[1], PAUSE_R);
      appendCircleWire(edgePos, edgeIdx, c[0], c[1], PAUSE_R);
      const barPos = [];
      const barIdx = [];
      appendPauseBars(barPos, barIdx, c[0], c[1]);
      const barMat = makeInkMaterial(`xr-pause-bars-${id}`, '0.96', [0.05, 0.1, 0.06]);
      bars = meshFromLists(engine, `xr-pause-bars-${id}`, barPos, barIdx, barMat);
      bars.renderOrder = 183;
      addToScene(scene, bars);
      setSubtreeVisible(bars, false);
    }
    const fillMat = makeInkMaterial(`xr-pad-ink-${id}-${spec.id}`, '0.94', rgb);
    const fill = meshFromLists(engine, `xr-pad-${id}-${spec.id}`, plate, pi, fillMat);
    fill.renderOrder = 180;
    addToScene(scene, fill);
    setSubtreeVisible(fill, false);
    const edgeMat = makeInkMaterial(`xr-pad-edge-${id}-${spec.id}`, '0.96', edgeRgb(rgb));
    const edge = meshFromLists(engine, `xr-pad-edge-${id}-${spec.id}`, edgePos, edgeIdx, edgeMat);
    edge.renderOrder = 182;
    addToScene(scene, edge);
    setSubtreeVisible(edge, false);
    const hotMat = makeInkMaterial(`xr-pad-hot-${id}-${spec.id}`, '0.55', edgeRgb(rgb));
    const hot = meshFromLists(engine, `xr-pad-hot-${id}-${spec.id}`, plate, pi, hotMat);
    hot.renderOrder = 181;
    addToScene(scene, hot);
    setSubtreeVisible(hot, false);
    const tally = spec.tri && typeof document !== 'undefined'
      ? makeTallyLabel(engine, scene, `xr-tally-${id}-${spec.id}`)
      : null;
    pads.push({ id: spec.id, fill, edge, hot, bars, tally, rgb });
  }

  const aimPlate = [];
  const aimIdx = [];
  appendCircle(aimPlate, aimIdx, 0, 0, AIM_R, 12, 0);
  const aimMat = makeInkMaterial(`xr-aim-${id}`, '0.95', [0.9, 1, 0.92]);
  const aimMesh = meshFromLists(engine, `xr-aim-${id}`, aimPlate, aimIdx, aimMat);
  aimMesh.renderOrder = 186;
  addToScene(scene, aimMesh);
  setSubtreeVisible(aimMesh, false);
  let visible = false;
  const tallySig = [];
  const parts = [aimMesh];
  for (let i = 0; i < pads.length; i++) {
    parts.push(pads[i].fill, pads[i].edge, pads[i].hot);
    if (pads[i].bars) parts.push(pads[i].bars);
    if (pads[i].tally) parts.push(pads[i].tally.mesh);
  }

  function hide() {
    if (!visible) return;
    for (let i = 0; i < parts.length; i++) setSubtreeVisible(parts[i], false);
    visible = false;
    tallySig.length = 0;
  }

  function poseRigid(mesh, ray, frame, sink = 0) {
    if (mesh.position) {
      mesh.position.x = ray.ox + frame.ux * sink;
      mesh.position.y = ray.oy + frame.uy * sink;
      mesh.position.z = ray.oz + frame.uz * sink;
    }
    setQuat(mesh, handleDisplayQuat(frame));
    mesh.markLocalDirty?.();
    setSubtreeVisible(mesh, true);
  }

  function padSink(buttonId, press) {
    if (!press) return 0;
    if (buttonId === 5 && press.pause) return -PAD_DEPRESS;
    if (press.group === buttonId) return -PAD_DEPRESS;
    return 0;
  }

  function poseAim(ray, frame, aim) {
    if (!aim) {
      setSubtreeVisible(aimMesh, false);
      return;
    }
    if (aimMesh.position) {
      aimMesh.position.x = ray.ox + frame.rx * aim.x + frame.ux * aim.y + frame.fx * aim.z;
      aimMesh.position.y = ray.oy + frame.ry * aim.x + frame.uy * aim.y + frame.fy * aim.z;
      aimMesh.position.z = ray.oz + frame.rz * aim.x + frame.uz * aim.y + frame.fz * aim.z;
    }
    setQuat(aimMesh, handleDisplayQuat(frame));
    aimMesh.markLocalDirty?.();
    setSubtreeVisible(aimMesh, true);
  }

  function poseTally(pad, ray, frame, sink, count) {
    const mesh = pad.tally?.mesh;
    if (!mesh) return;
    const n = count | 0;
    if (!(n > 0)) {
      setSubtreeVisible(mesh, false);
      return;
    }
    const sig = `${n}|${pad.rgb.join(',')}`;
    const slot = pad.id;
    if (tallySig[slot] !== sig) {
      pad.tally.paint(n, pad.rgb);
      tallySig[slot] = sig;
    }
    const c = wristPadCenter(pad.id);
    const y = PAD_SURFACE + 0.0022;
    if (mesh.position) {
      mesh.position.x = ray.ox + frame.rx * c[0] + frame.ux * (y + sink) + frame.fx * c[1];
      mesh.position.y = ray.oy + frame.ry * c[0] + frame.uy * (y + sink) + frame.fy * c[1];
      mesh.position.z = ray.oz + frame.rz * c[0] + frame.uz * (y + sink) + frame.fz * c[1];
    }
    if (mesh.scaling) {
      const span = TRI_SIDE * 0.46;
      mesh.scaling.x = span;
      mesh.scaling.y = span;
      mesh.scaling.z = 1;
    }
    setQuat(mesh, handleDisplayQuat(frame));
    mesh.markLocalDirty?.();
    setSubtreeVisible(mesh, true);
  }

  function pose(ray, hot, press, aim, counts) {
    if (!ray) {
      hide();
      return;
    }
    const frame = pointerFrame(ray);
    poseAim(ray, frame, aim);
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const sink = padSink(pad.id, press);
      poseRigid(pad.fill, ray, frame, sink);
      poseRigid(pad.edge, ray, frame, sink);
      if (pad.bars) poseRigid(pad.bars, ray, frame, sink);
      if (hot === pad.id) poseRigid(pad.hot, ray, frame, sink + 0.0012);
      else setSubtreeVisible(pad.hot, false);
      const gid = wristControlGroupId(ray.hand, pad.id);
      const count = gid == null || !counts ? 0 : counts[gid];
      poseTally(pad, ray, frame, sink, count);
    }
    visible = true;
  }

  return { hide, pose };
}

function makeTallyLabel(engine, scene, name) {
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

  function paint(count, rgb) {
    if (!ctx) return;
    try {
      paintWristTally(ctx, LABEL_W, LABEL_H, count, rgb);
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

/** Prison tallies on a clear plate. Strokes sit in the triangle, not a colour square. */
function paintWristTally(ctx, w, h, count, rgb) {
  ctx.clearRect(0, 0, w, h);
  const n = count | 0;
  if (!(n > 0)) return;
  const r = rgb?.[0] ?? 1;
  const g = rgb?.[1] ?? 1;
  const b = rgb?.[2] ?? 1;
  const lum = r * 0.3 + g * 0.59 + b * 0.11;
  ctx.strokeStyle = lum > 0.62 ? '#141416' : '#f4fff2';
  ctx.lineWidth = Math.max(8, Math.round(Math.min(w, h) * 0.045));
  ctx.lineCap = 'round';
  const side = Math.min(w, h);
  const inset = side * 0.12;
  const gap = side * 0.03;
  const cell = (side - inset * 2 - gap) * 0.5;
  const ox0 = (w - side) * 0.5;
  const oy0 = (h - side) * 0.5;
  function origin(q) {
    const col = q % 2;
    const row = (q / 2) | 0;
    return [ox0 + inset + col * (cell + gap), oy0 + inset + row * (cell + gap)];
  }
  function strokeX(x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x1, y0);
    ctx.lineTo(x0, y1);
    ctx.stroke();
  }
  const glyphs = tallyGlyphs(n);
  if (glyphs.xCount >= 2) {
    const m = side * 0.16;
    strokeX(ox0 + m, oy0 + side * 0.22, ox0 + side * 0.48, oy0 + side * 0.78);
    strokeX(ox0 + side * 0.52, oy0 + side * 0.22, ox0 + side - m, oy0 + side * 0.78);
    return;
  }
  const marks = tallyMarkLayout(n);
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const [ox, oy] = origin(m.group);
    if (m.stroke < 4) {
      const uCount = Math.min(4, m.inGroup);
      const span = cell * 0.78;
      const x0 = ox + cell * 0.5 - span * 0.5;
      const step = uCount > 1 ? span / (uCount - 1) : 0;
      const x = x0 + m.stroke * step;
      ctx.beginPath();
      ctx.moveTo(x, oy + cell * 0.1);
      ctx.lineTo(x, oy + cell * 0.9);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(ox + cell * 0.1, oy + cell * 0.14);
      ctx.lineTo(ox + cell * 0.9, oy + cell * 0.86);
      ctx.stroke();
    }
  }
  if (glyphs.xCount === 1) {
    const [ox, oy] = origin(3);
    const m = cell * 0.16;
    strokeX(ox + m, oy + m, ox + cell - m, oy + cell - m);
  }
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createXrLassoOverlay(engine, scene, groundYAt, hand = 'right') {
  const ribbon = makeRibbonMesh(engine);
  ribbon.mesh.material = makeRibbonMaterial();
  addToScene(scene, ribbon.mesh);
  setSubtreeVisible(ribbon.mesh, false);
  let quads = 0;

  const beam = makeBeamMesh(engine);
  beam.mesh.material = makeBeamMaterial();
  addToScene(scene, beam.mesh);
  setSubtreeVisible(beam.mesh, false);
  const handle = createPointerHandle(engine, scene, hand);

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

  function poseBeam(ray, length, width, hot, press, aim, counts) {
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
    handle.pose(ray, hot, press, aim, counts);
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
     *   press?: { cast?: boolean, cancel?: boolean, pause?: boolean },
     * }} s `width` is the lasso line width in world units; the beam and tip scale off it.
     */
    show(s) {
      const width = s.width > 0 ? s.width : 0.5;
      poseBeam(s.ray, s.length, width * 1.5, s.hot, s.press, s.aim, s.counts);
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
