// Control-group pads — camera-locked hollow rounded triangles on the
// left/right edges, nested in/out/in so they interlock. Six colours
// (red / green / black left, blue / yellow / white right).

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  setShaderUniform,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

export const CONTROL_GROUP_DEFS = Object.freeze([
  { id: 0, name: 'red', rgb: [0.86, 0.2, 0.2], side: 'left' },
  { id: 1, name: 'green', rgb: [0.2, 0.72, 0.24], side: 'left' },
  { id: 2, name: 'blue', rgb: [0.22, 0.44, 0.95], side: 'right' },
  { id: 3, name: 'yellow', rgb: [0.9, 0.78, 0.16], side: 'right' },
  { id: 4, name: 'black', rgb: [0.16, 0.16, 0.18], side: 'left' },
  { id: 5, name: 'white', rgb: [0.93, 0.93, 0.95], side: 'right' },
]);

export const CONTROL_GROUP_SIZE_PX = 54;
/** Horizontal span — slimmer than the old square so they don't eat the playfield. */
export const CONTROL_GROUP_WIDTH_PX = 36;
/** One X carries sixteen. Two overlapping X's is the display cap. */
export const TALLY_X_VALUE = 16;
export const CONTROL_GROUP_TALLY_MAX = 32;
/** Half-height nest plus a gap so interlocking pads don't sit on top of each other. */
export const CONTROL_GROUP_NEST_GAP_PX = 16;
export const CONTROL_GROUP_PITCH_PX = CONTROL_GROUP_SIZE_PX * 0.5 + CONTROL_GROUP_NEST_GAP_PX;
export const CONTROL_GROUP_EDGE_PX = 26;
/** Extra pick slop around the triangle (CSS px). */
export const CONTROL_GROUP_HIT_PAD_PX = 6;

/** +1 points right, -1 points left. Stack index 0/2 face inward. */
export function controlGroupFacing(side, stackIndex) {
  const inward = (stackIndex & 1) === 0;
  if (side === 'right') return inward ? -1 : 1;
  return inward ? 1 : -1;
}

const ICON_DEPTH = 0.8;
const HUD_RENDER_ORDER = 425;
const HOVER_LERP = 14;
const HOVER_SCALE = 0.08;

export function visibleControlGroupDefs() {
  return CONTROL_GROUP_DEFS;
}

/**
 * Screen-space pad rects (CSS px). Vertically centered, three per side,
 * nested so in/out triangles interlock with a gap between them.
 * `dir` is +1 (point right) or -1 (point left).
 * @param {number} vw
 * @param {number} vh
 * @returns {{ id: number, name: string, rgb: number[], x: number, y: number, w: number, h: number, dir: number }[]}
 */
export function layoutControlGroups(vw, vh) {
  /** @type {typeof CONTROL_GROUP_DEFS[number][]} */
  const left = [];
  /** @type {typeof CONTROL_GROUP_DEFS[number][]} */
  const right = [];
  const defs = visibleControlGroupDefs();
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    (d.side === 'right' ? right : left).push(d);
  }
  /** @type {{ id: number, name: string, rgb: number[], x: number, y: number, w: number, h: number, dir: number }[]} */
  const rects = [];
  const height = CONTROL_GROUP_SIZE_PX;
  const width = CONTROL_GROUP_WIDTH_PX;
  const pitch = CONTROL_GROUP_PITCH_PX;
  function place(list, x, side) {
    const n = list.length;
    const total = height + Math.max(0, n - 1) * pitch;
    let y = vh * 0.5 - total * 0.5;
    for (let i = 0; i < n; i++) {
      const d = list[i];
      rects.push({
        id: d.id,
        name: d.name,
        rgb: d.rgb,
        x,
        y,
        w: width,
        h: height,
        dir: controlGroupFacing(side, i),
      });
      y += pitch;
    }
  }
  place(left, CONTROL_GROUP_EDGE_PX, 'left');
  place(right, vw - CONTROL_GROUP_EDGE_PX - width, 'right');
  return rects;
}

/**
 * Screen-space triangle for a pad. `dir` >= 0 points right.
 * @param {{ x: number, y: number, w: number, h: number, dir?: number }} r
 */
export function controlGroupTriangle(r) {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const midY = y0 + r.h * 0.5;
  if ((r.dir ?? 1) >= 0) {
    return { a: { x: x0, y: y0 }, b: { x: x0, y: y1 }, c: { x: x1, y: midY } };
  }
  return { a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, c: { x: x0, y: midY } };
}

function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const den = vx * vx + vy * vy;
  const t = den > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / den)) : 0;
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

function signCross(px, py, ax, ay, bx, by) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

/** 0 if inside the triangle, else distance to the nearest edge. */
export function distToControlGroupTriangle(r, px, py) {
  const { a, b, c } = controlGroupTriangle(r);
  const d0 = signCross(px, py, a.x, a.y, b.x, b.y);
  const d1 = signCross(px, py, b.x, b.y, c.x, c.y);
  const d2 = signCross(px, py, c.x, c.y, a.x, a.y);
  const hasNeg = d0 < 0 || d1 < 0 || d2 < 0;
  const hasPos = d0 > 0 || d1 > 0 || d2 > 0;
  if (!(hasNeg && hasPos)) return 0;
  return Math.min(
    distToSeg(px, py, a.x, a.y, b.x, b.y),
    distToSeg(px, py, b.x, b.y, c.x, c.y),
    distToSeg(px, py, c.x, c.y, a.x, a.y),
  );
}

/**
 * Prison-tally glyphs: hashes through 15, then an X (16) that clears them.
 * A second X at 32 is the cap (XX for anything above).
 * @param {number} count
 * @returns {{ xCount: number, hashes: number }}
 */
export function tallyGlyphs(count) {
  const n = Math.max(0, count | 0);
  if (n >= CONTROL_GROUP_TALLY_MAX) return { xCount: 2, hashes: 0 };
  return {
    xCount: (n / TALLY_X_VALUE) | 0,
    hashes: n % TALLY_X_VALUE,
  };
}

/**
 * Hash pentads walk TL, TR, BL. The first X sits in BR until XX.
 * `groupsUsed` / `xCount` are kept so callers can pass either signature.
 */
export function tallyGroupCell(group, _groupsUsed, _xCount = 0) {
  const q = group | 0;
  return { row: (q / 2) | 0, col: q & 1 };
}

/** Hash strokes for the remainder after X carries (max three pentads). */
export function tallyMarkLayout(count) {
  const { hashes, xCount } = tallyGlyphs(count);
  const groupsUsed = hashes === 0 ? 0 : Math.ceil(hashes / 5);
  /** @type {{ group: number, stroke: number, row: number, col: number, inGroup: number }[]} */
  const marks = [];
  for (let i = 0; i < hashes; i++) {
    const group = (i / 5) | 0;
    const cell = tallyGroupCell(group, groupsUsed, xCount);
    marks.push({
      group,
      stroke: i % 5,
      row: cell.row,
      col: cell.col,
      inGroup: Math.min(5, hashes - group * 5),
    });
  }
  return marks;
}

export function pickControlGroupAt(rects, px, py) {
  const pad = CONTROL_GROUP_HIT_PAD_PX;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const d = distToControlGroupTriangle(r, px, py);
    if (d <= pad && d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best;
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

function cameraEye(camera) {
  const wm = camera?.worldMatrix;
  if (wm && Number.isFinite(wm[12]) && Number.isFinite(wm[13]) && Number.isFinite(wm[14])) {
    return { x: wm[12], y: wm[13], z: wm[14] };
  }
  const p = camera?.position;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
    return { x: p.x, y: p.y, z: p.z };
  }
  return { x: 0, y: 40, z: 0 };
}

function setQuat(mesh, q) {
  const rq = mesh.rotationQuaternion;
  if (!rq) return;
  if (typeof rq.set === 'function') rq.set(q.x, q.y, q.z, q.w);
  else {
    rq.x = q.x;
    rq.y = q.y;
    rq.z = q.z;
    rq.w = q.w;
  }
}

function makePadMesh(engine, id) {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(
    engine,
    `ctrl-group-${id}`,
    positions,
    normals,
    indices,
    uvs,
  );
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = HUD_RENDER_ORDER;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  return mesh;
}

function makePadMaterial(rgb) {
  return createShaderMaterial({
    name: 'ctrl-group-pad-tri2',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'tint', type: 'vec3<f32>', defaultValue: rgb },
      { name: 'fill', type: 'f32', defaultValue: 0 },
      { name: 'glow', type: 'f32', defaultValue: 0 },
      { name: 'count', type: 'f32', defaultValue: 0 },
      { name: 'facing', type: 'f32', defaultValue: 1 },
    ],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    depthCompare: 'always',
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
fn sdTriangle(p: vec2<f32>, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> f32 {
  let e0 = p1 - p0;
  let e1 = p2 - p1;
  let e2 = p0 - p2;
  let v0 = p - p0;
  let v1 = p - p1;
  let v2 = p - p2;
  let pq0 = v0 - e0 * clamp(dot(v0, e0) / max(dot(e0, e0), 1e-6), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / max(dot(e1, e1), 1e-6), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / max(dot(e2, e2), 1e-6), 0.0, 1.0);
  let s = sign(e0.x * e2.y - e0.y * e2.x);
  let d0 = vec2<f32>(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x));
  let d1 = vec2<f32>(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x));
  let d2 = vec2<f32>(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x));
  let d = min(min(d0, d1), d2);
  return -sqrt(d.x) * sign(d.y);
}
fn sdSeg(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
fn hash21(n: f32) -> vec2<f32> {
  return fract(sin(vec2<f32>(n, n + 1.7)) * vec2<f32>(43758.5453, 22578.1459)) * 2.0 - 1.0;
}
fn quadCell() -> vec2<f32> {
  let inset = 0.12;
  let gap = 0.03;
  let s = (1.0 - inset * 2.0 - gap) * 0.5;
  return vec2<f32>(s, s);
}
fn quadOrigin(q: i32) -> vec2<f32> {
  let inset = 0.12;
  let gap = 0.03;
  let cell = quadCell();
  let col = q % 2;
  let row = q / 2;
  return vec2<f32>(inset + f32(col) * (cell.x + gap), inset + f32(row) * (cell.y + gap));
}
fn hashStrokeDist(local: vec2<f32>, stroke: i32, inGroup: i32, seed: f32, cell: vec2<f32>) -> f32 {
  let wob = hash21(seed);
  var d = 1.0;
  if (stroke < 4) {
    let uCount = min(4, inGroup);
    let span = 0.88;
    let x0 = 0.50 - span * 0.5;
    let step = select(0.0, span / max(f32(uCount - 1), 1.0), uCount > 1);
    let x = x0 + f32(stroke) * step + wob.x * 0.014;
    let y0 = 0.06 + wob.y * 0.02;
    let y1 = 0.94 + wob.x * 0.016;
    let lean = wob.y * 0.02;
    d = sdSeg(local, vec2<f32>(x + lean, y0), vec2<f32>(x - lean, y1));
  } else {
    d = sdSeg(
      local,
      vec2<f32>(0.04, 0.10) + wob * 0.012,
      vec2<f32>(0.96, 0.90) + vec2<f32>(wob.y, -wob.x) * 0.012,
    );
  }
  return d * min(cell.x, cell.y);
}
fn hashDistQuads(uv: vec2<f32>, n: i32) -> f32 {
  var best = 1e3;
  if (n <= 0) { return best; }
  let cell = quadCell();
  for (var i = 0; i < 15; i++) {
    if (i >= n) { break; }
    let group = i / 5;
    let cellO = quadOrigin(group);
    let local = (uv - cellO) / cell;
    best = min(best, hashStrokeDist(local, i % 5, min(5, n - group * 5), f32(i) * 3.17, cell));
  }
  return best;
}
fn oneXDist(uv: vec2<f32>, center: vec2<f32>, size: f32, rot: f32, seed: f32) -> f32 {
  let w1 = hash21(seed * 7.1) * 0.012;
  let w2 = hash21(seed * 9.3 + 2.0) * 0.012;
  let c = cos(rot);
  let s = sin(rot);
  let p = uv - center;
  let q = vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
  let half = size * 0.46;
  let d1 = sdSeg(q, vec2<f32>(-half, -half) + w1, vec2<f32>(half, half) + w2);
  let d2 = sdSeg(q, vec2<f32>(half, -half) + vec2<f32>(w2.y, w1.x), vec2<f32>(-half, half) + vec2<f32>(w1.y, w2.x));
  return min(d1, d2);
}
fn xxDist(uv: vec2<f32>) -> f32 {
  let a = oneXDist(uv, vec2<f32>(0.365, 0.50), 0.48, 0.0, 1.0);
  let b = oneXDist(vec2<f32>(1.0 - uv.x, uv.y), vec2<f32>(0.365, 0.50), 0.48, 0.0, 1.0);
  return min(a, b);
}
// Hashes in TL/TR/BL. First X sits in BR (16), hashes restart around it. XX at 32.
fn tallyDist(uv: vec2<f32>, count: f32) -> f32 {
  let raw = i32(max(count, 0.0) + 0.5);
  if (raw <= 0) { return 1e3; }
  let xCount = select(2, raw / 16, raw < 32);
  let hashes = select(0, raw % 16, raw < 32);
  if (xCount >= 2) {
    return xxDist(uv);
  }
  var best = hashDistQuads(uv, hashes);
  if (xCount == 1) {
    let cell = quadCell();
    let q3 = quadOrigin(3);
    best = min(best, oneXDist(uv, q3 + cell * 0.5, min(cell.x, cell.y) * 0.78, 0.0, 1.0));
  }
  return best;
}
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let p = input.uv * 2.0 - 1.0;
  let face = shaderUniforms.facing;
  let d = sdTriangle(
    p,
    vec2<f32>(-0.70 * face, -0.78),
    vec2<f32>(-0.70 * face, 0.78),
    vec2<f32>(0.80 * face, 0.0),
  ) - 0.18;
  let stroke = 0.07 + shaderUniforms.fill * 0.02 + shaderUniforms.glow * 0.025;
  let edge = 1.0 - smoothstep(0.0, 0.035, abs(d) - stroke * 0.5);
  let halo = 1.0 - smoothstep(stroke * 0.5, stroke * 0.5 + 0.06, abs(d));
  let frame = edge * (0.42 + shaderUniforms.fill * 0.4 + shaderUniforms.glow * 0.18)
    + halo * 0.16;
  let tallyUv = (input.uv - vec2<f32>(0.5 - face * 0.14, 0.5)) / 0.54 + vec2<f32>(0.5, 0.5);
  let tally = 1.0 - smoothstep(0.018, 0.038, tallyDist(tallyUv, shaderUniforms.count));
  let alpha = max(frame, tally * (0.88 + shaderUniforms.glow * 0.1));
  if (alpha < 0.02) { discard; }
  let lift = 0.12 + shaderUniforms.glow * 0.2;
  let rgb = shaderUniforms.tint * (0.88 + lift) + vec3<f32>(lift * 0.15);
  return vec4<f32>(rgb, clamp(alpha, 0.0, 1.0));
}`,
  });
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {{
 *   rayFromCanvas?: (x: number, y: number) => { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null,
 *   getViewport?: () => { width: number, height: number },
 *   getPointerCanvas?: () => { x: number, y: number } | null,
 *   canvas?: HTMLCanvasElement,
 * }} [screen]
 */
export function createControlGroupHud(engine, scene, screen = {}) {
  const pads = CONTROL_GROUP_DEFS.map((def) => {
    const mesh = makePadMesh(engine, def.id);
    const mat = makePadMaterial(def.rgb);
    mesh.material = mat;
    addToScene(scene, mesh);
    setSubtreeVisible(mesh, false);
    if (mesh.position) mesh.position.y = -9999;
    return {
      def,
      mesh,
      mat,
      visible: false,
      hoverT: 0,
      filled: 0,
      count: 0,
    };
  });

  let holdId = -1;
  /** @type {{ id: number, x: number, y: number, w: number, h: number, dir: number }[]} */
  let hitRects = [];
  let lastHoverMs = 0;

  function hidePad(pad) {
    if (pad.hoverT) pad.hoverT = 0;
    if (!pad.visible) return;
    setSubtreeVisible(pad.mesh, false);
    if (pad.mesh.position) pad.mesh.position.y = -9999;
    pad.mesh.markLocalDirty?.();
    pad.visible = false;
  }

  function hideAll() {
    for (let i = 0; i < pads.length; i++) hidePad(pads[i]);
    hitRects = [];
  }

  function pick(px, py) {
    return pickControlGroupAt(hitRects, px, py);
  }

  function setCount(id, n) {
    const pad = pads[id | 0];
    if (!pad) return;
    const count = Math.max(0, n | 0);
    pad.count = count;
    pad.filled = count > 0 ? 1 : 0;
  }

  function setFilled(id, on) {
    setCount(id, on ? Math.max(pads[id | 0]?.count ?? 0, 1) : 0);
  }

  function setHold(id) {
    holdId = id == null ? -1 : id | 0;
  }

  function update(camera) {
    const vp = screen.getViewport?.();
    if (!vp || !screen.rayFromCanvas) {
      hideAll();
      return;
    }
    const vw = vp.width;
    const vh = vp.height;
    if (vw < 8 || vh < 8) {
      hideAll();
      return;
    }

    const rects = layoutControlGroups(vw, vh);
    hitRects = rects;
    /** @type {Set<number>} */
    const shown = new Set();

    const now = performance.now();
    const dt = lastHoverMs ? Math.min(0.05, (now - lastHoverMs) * 0.001) : 0.016;
    lastHoverMs = now;
    const ptr = screen.getPointerCanvas?.();
    let hoverId = -1;
    if (ptr) hoverId = pickControlGroupAt(rects, ptr.x, ptr.y) ?? -1;

    const eye = cameraEye(camera);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const pad = pads[r.id];
      if (!pad) continue;
      const cx = r.x + r.w * 0.5;
      const cy = r.y + r.h * 0.5;
      const ray = screen.rayFromCanvas(cx, cy);
      const rayR = screen.rayFromCanvas(cx + 1, cy);
      if (!ray || !rayR) {
        hidePad(pad);
        continue;
      }
      const wx = ray.ox + ray.dx * ICON_DEPTH;
      const wy = ray.oy + ray.dy * ICON_DEPTH;
      const wz = ray.oz + ray.dz * ICON_DEPTH;
      const rx = rayR.ox + rayR.dx * ICON_DEPTH;
      const ry = rayR.oy + rayR.dy * ICON_DEPTH;
      const rz = rayR.oz + rayR.dz * ICON_DEPTH;
      const pixel = Math.hypot(rx - wx, ry - wy, rz - wz);
      if (!(pixel > 1e-6)) {
        hidePad(pad);
        continue;
      }

      const target = r.id === hoverId || r.id === holdId ? 1 : 0;
      pad.hoverT += (target - pad.hoverT) * Math.min(1, dt * HOVER_LERP);
      const hold = r.id === holdId ? 1 : 0;
      const glow = Math.max(pad.hoverT, hold);
      setShaderUniform(pad.mat, 'fill', pad.filled);
      setShaderUniform(pad.mat, 'glow', glow);
      setShaderUniform(pad.mat, 'count', pad.count);
      setShaderUniform(pad.mat, 'facing', r.dir ?? 1);

      let fx = eye.x - wx;
      let fy = eye.y - wy;
      let fz = eye.z - wz;
      const flen = Math.hypot(fx, fy, fz) || 1;
      fx /= flen;
      fy /= flen;
      fz /= flen;
      let rgtX = rx - wx;
      let rgtY = ry - wy;
      let rgtZ = rz - wz;
      const rlen = Math.hypot(rgtX, rgtY, rgtZ) || 1;
      rgtX /= rlen;
      rgtY /= rlen;
      rgtZ /= rlen;
      let upX = fy * rgtZ - fz * rgtY;
      let upY = fz * rgtX - fx * rgtZ;
      let upZ = fx * rgtY - fy * rgtX;
      const ulen = Math.hypot(upX, upY, upZ) || 1;
      upX /= ulen;
      upY /= ulen;
      upZ /= ulen;
      rgtX = upY * fz - upZ * fy;
      rgtY = upZ * fx - upX * fz;
      rgtZ = upX * fy - upY * fx;

      const hover = 1 + pad.hoverT * HOVER_SCALE;
      const mesh = pad.mesh;
      if (mesh.position) {
        mesh.position.x = wx;
        mesh.position.y = wy;
        mesh.position.z = wz;
      }
      if (mesh.scaling) {
        mesh.scaling.x = r.w * pixel * hover;
        mesh.scaling.y = r.h * pixel * hover;
        mesh.scaling.z = r.h * pixel * hover;
      }
      setQuat(mesh, quatFromBasis(rgtX, rgtY, rgtZ, upX, upY, upZ, fx, fy, fz));
      setSubtreeVisible(mesh, true);
      mesh.markLocalDirty?.();
      pad.visible = true;
      shown.add(r.id);
    }

    for (let i = 0; i < pads.length; i++) {
      if (!shown.has(pads[i].def.id)) hidePad(pads[i]);
    }
  }

  return { update, pick, setFilled, setCount, setHold, clear: hideAll };
}
