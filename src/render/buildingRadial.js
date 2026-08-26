// Agora build menu — tilted annulus framing the agora (EDGE_PIN_HUD gates
// screen-edge placement; currently off). Hub hole stays on the building;
// the player's standard is pulled in front of the category pie.
// Option angles stay screen-stable; hover/click uses CPU disc/sphere hits.

import {
  addToScene,
  createDefaultTextData,
  createMeshFromData,
  createStandardMaterial,
  createTextLayer,
  createTextRenderer,
  disposeDefaultTextData,
  disposeTextRenderer,
  flushThinInstances,
  registerTextRenderer,
  setThinInstances,
  markMaterialUboDirty,
  setSubtreeVisible,
  updateDefaultTextData,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import {
  BUILDING_MODEL_URLS,
  PLACEABLE_BUILDINGS,
} from '../sim/buildings.js';
import { poseRadialFramingBuilding } from './radialPose.js';
import { ownerTint } from './ownerTints.js';

/** Layout at HUD scale = 1 (ring outer radius in world units). */
const MENU_Y = 2.4;
/**
 * Outer option ring — fixed band width, pushed out from the center pie
 * (pads move out; pie + pad size stay put).
 */
const MENU_RING_OUTER = 19.3;
const MENU_RING_INNER = 16.5;
const MENU_RING_H = 0.35;
const RIM_R = (MENU_RING_OUTER + MENU_RING_INNER) * 0.5;
const PAD_OUTER = 4.68;
const PAD_INNER = 3.06;
const PAD_H = 0.22;
/** Lift pad rings (and icons) along the menu normal, off the base ring. */
const PAD_LIFT = 1.35;
/** Extra lift of icons along the menu normal above their pad ring. */
const ICON_LIFT = 0.85;
const OPTION_SCALE = 0.468;
/** Pick sphere around each icon (covers the mini building, not just the pad). */
const ICON_PICK_R = 9.9;
/** Center category pie — fixed size (not tied to ring radius). */
const PIE_OUTER = 11.6;
const PIE_INNER = 6.6;
const PIE_H = 0.4;
const PIE_LIFT = 0.25;
/** Constant-width channels between slices (parallel opposing edges). */
const PIE_SLICE_GAP = 0.8;
/** Slight deliberate skew so the center control is not cardinally aligned. */
const PIE_ROTATION = 0.13;
/** Three five-button pages interleave at exactly one-third of a 72° slot. */
const BUTTON_RING_BASE_ROTATION = -0.08;
const BUTTON_RING_PAGE_STEP = (Math.PI * 2) / (5 * 3);
const BUTTON_RING_ROTATIONS = /** @type {const} */ ({
  basic: BUTTON_RING_BASE_ROTATION - BUTTON_RING_PAGE_STEP,
  advanced: BUTTON_RING_BASE_ROTATION,
  elemental: BUTTON_RING_BASE_ROTATION + BUTTON_RING_PAGE_STEP,
});
/**
 * Lean from horizontal toward the camera (not a full billboard).
 * ~32° — readable without standing the ring on end.
 */
const MENU_TILT = 0.56;
/**
 * Screen-edge pin (project agora → clamp → place on ray). Off for now — menu
 * stays above the agora. Flip to true when revisiting the HUD placement.
 */
const EDGE_PIN_HUD = false;
/**
 * Preferred depth from the camera eye (edge-pin path). Scale is tied to depth
 * so on-screen size stays steady. When the agora is closer, we pull in.
 */
const HUD_PLACE_DIST = 70;
const HUD_PLACE_MIN = 24;
const HUD_PLACE_FRAC = 0.82;
const HUD_REF_DIST = 110;
const HUD_BASE_SCALE = 1;
const HUD_SCALE_MIN = 0.35;
/** While ghost-placing, shrink the open radial so it stays out of the way. */
const COMPACT_SCALE = 0.7;
const LABEL_FONT_SIZE = 28;
const LABEL_SCREEN_SCALE = 1.17;
const LABEL_DOWN = 4.32;
const LABEL_LIFT = 1.25;
/** Exp approach rate for compact scale (higher = snappier; ~30 ≈ 0.1s). */
const COMPACT_LERP_SPEED = 30;
/** Hub standard — planted in the pie hole, in front of the category wedges. */
const FLAG_HUB_LIFT = 1.35;
const FLAG_HUB_SCALE = 1.15;
const FLAG_MODEL_URL = '/assets/models/flag.glb';
/** Inset so the whole ring stays inside the viewport when edge-pinned. */
const HUD_EDGE_MARGIN_FRAC = 0.2;
const MAX_OPTIONS = 5;

/** Main ring only — sits above the world, so let terrain/units read through a bit. */
const MENU_RING_ALPHA = 0.55;
const PAD_HOVER_COLOR = [1, 0.85, 0.25];
const PAD_HOVER_EMISSIVE = [0.95, 0.7, 0.15];

/** @typedef {'basic' | 'advanced' | 'elemental'} CategoryId */

/** Category pie + ring tints. */
const CATEGORIES = /** @type {const} */ ([
  {
    id: 'basic',
    name: 'Basic',
    color: [0.2, 0.82, 0.9],
    emissive: [0.08, 0.55, 0.68],
    pad: [0.28, 0.9, 0.88],
    padEm: [0.08, 0.58, 0.56],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    color: [0.38, 0.58, 0.95],
    emissive: [0.2, 0.38, 0.78],
    pad: [0.35, 0.72, 0.92],
    padEm: [0.15, 0.45, 0.65],
  },
  {
    id: 'elemental',
    name: 'Elemental',
    color: [0.28, 0.85, 0.55],
    emissive: [0.12, 0.55, 0.35],
    pad: [0.3, 0.82, 0.58],
    padEm: [0.12, 0.5, 0.32],
  },
]);

const MODEL_URLS = BUILDING_MODEL_URLS;

/**
 * Flat washer / annulus in XZ (Y up). Unit scale: outer radius = 1.
 * @param {object} engine
 * @param {string} name
 * @param {{ inner?: number, height?: number, segments?: number }} [opts]
 *   inner = innerRadius / outerRadius (0..1). height in units of outer radius.
 */
function createAnnulusMesh(engine, name, opts = {}) {
  const innerFrac = opts.inner ?? 0.75;
  const h = opts.height ?? 0.04;
  const segments = opts.segments ?? 48;
  const ro = 1;
  const ri = Math.max(0.05, Math.min(0.95, innerFrac));
  const y0 = -h * 0.5;
  const y1 = h * 0.5;

  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const normals = [];
  /** @type {number[]} */
  const indices = [];

  function pushVert(x, y, z, nx, ny, nz) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    return positions.length / 3 - 1;
  }

  // Top + bottom caps
  for (let cap = 0; cap < 2; cap++) {
    const y = cap === 0 ? y1 : y0;
    const ny = cap === 0 ? 1 : -1;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ro, y, s * ro, 0, ny, 0);
      pushVert(c * ri, y, s * ri, 0, ny, 0);
    }
    for (let i = 0; i < segments; i++) {
      const i0 = base + i * 2;
      const i1 = base + ((i + 1) % segments) * 2;
      const o0 = i0;
      const o1 = i1;
      const n0 = i0 + 1;
      const n1 = i1 + 1;
      if (cap === 0) {
        indices.push(o0, o1, n1, o0, n1, n0);
      } else {
        indices.push(o0, n1, o1, o0, n0, n1);
      }
    }
  }

  // Outer wall
  {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ro, y0, s * ro, c, 0, s);
      pushVert(c * ro, y1, s * ro, c, 0, s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % segments) * 2;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // Inner wall
  {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ri, y0, s * ri, -c, 0, -s);
      pushVert(c * ri, y1, s * ri, -c, 0, -s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % segments) * 2;
      indices.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }

  return createMeshFromData(
    engine,
    name,
    new Float32Array(positions),
    new Float32Array(normals),
    new Uint32Array(indices),
  );
}

/**
 * Pie wedge in XZ (Y up). Unit outer radius = 1; optional inner hub hole.
 * @param {object} engine
 * @param {string} name
 * @param {{ startAng?: number, endAng?: number, inner?: number, height?: number, segments?: number, gap?: number }} [opts]
 */
function createPieSliceMesh(engine, name, opts = {}) {
  const startAng = opts.startAng ?? 0;
  const endAng = opts.endAng ?? (Math.PI * 2) / 3;
  const segments = Math.max(4, opts.segments ?? 20);
  const h = opts.height ?? 0.04;
  const ro = 1;
  const ri = Math.max(0.02, Math.min(0.9, opts.inner ?? 0.12));
  // Each slice retreats half the requested channel width. At each radius the
  // angular retreat differs, keeping the resulting cut edge parallel to the
  // separator ray instead of producing a narrow missing wedge.
  const edgeInset = Math.max(0, opts.gap ?? 0) * 0.5;
  const insetAngle = (radius) =>
    Math.asin(Math.min(0.95, edgeInset / Math.max(radius, 1e-4)));
  const outerInsetAng = insetAngle(ro);
  const innerInsetAng = insetAngle(ri);
  const outerStartAng = startAng + outerInsetAng;
  const outerEndAng = endAng - outerInsetAng;
  const innerStartAng = startAng + innerInsetAng;
  const innerEndAng = endAng - innerInsetAng;
  const y0 = -h * 0.5;
  const y1 = h * 0.5;

  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const normals = [];
  /** @type {number[]} */
  const indices = [];

  function pushVert(x, y, z, nx, ny, nz) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    return positions.length / 3 - 1;
  }

  function angAt(i, start, end) {
    return start + (i / segments) * (end - start);
  }

  // Top + bottom caps (annulus sector)
  for (let cap = 0; cap < 2; cap++) {
    const y = cap === 0 ? y1 : y0;
    const ny = cap === 0 ? 1 : -1;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const outerAng = angAt(i, outerStartAng, outerEndAng);
      const innerAng = angAt(i, innerStartAng, innerEndAng);
      pushVert(Math.cos(outerAng) * ro, y, Math.sin(outerAng) * ro, 0, ny, 0);
      pushVert(Math.cos(innerAng) * ri, y, Math.sin(innerAng) * ri, 0, ny, 0);
    }
    for (let i = 0; i < segments; i++) {
      const o0 = base + i * 2;
      const o1 = base + (i + 1) * 2;
      const n0 = o0 + 1;
      const n1 = o1 + 1;
      if (cap === 0) {
        indices.push(o0, o1, n1, o0, n1, n0);
      } else {
        indices.push(o0, n1, o1, o0, n0, n1);
      }
    }
  }

  // Outer arc wall
  {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = angAt(i, outerStartAng, outerEndAng);
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ro, y0, s * ro, c, 0, s);
      pushVert(c * ro, y1, s * ro, c, 0, s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + (i + 1) * 2;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // Inner arc wall
  {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = angAt(i, innerStartAng, innerEndAng);
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ri, y0, s * ri, -c, 0, -s);
      pushVert(c * ri, y1, s * ri, -c, 0, -s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + (i + 1) * 2;
      indices.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }

  // Parallel cut walls at start / end.
  const cuts = [
    { separatorAng: startAng, outerAng: outerStartAng, innerAng: innerStartAng },
    { separatorAng: endAng, outerAng: outerEndAng, innerAng: innerEndAng },
  ];
  for (const cut of cuts) {
    const c = Math.cos(cut.separatorAng);
    const s = Math.sin(cut.separatorAng);
    // Outward normal for start wall faces −tangent; end wall +tangent.
    const outward = cut.separatorAng === startAng ? -1 : 1;
    const nx = -s * outward;
    const nz = c * outward;
    const innerX = Math.cos(cut.innerAng) * ri;
    const innerZ = Math.sin(cut.innerAng) * ri;
    const outerX = Math.cos(cut.outerAng) * ro;
    const outerZ = Math.sin(cut.outerAng) * ro;
    const i0 = pushVert(innerX, y0, innerZ, nx, 0, nz);
    const i1 = pushVert(outerX, y0, outerZ, nx, 0, nz);
    const i2 = pushVert(outerX, y1, outerZ, nx, 0, nz);
    const i3 = pushVert(innerX, y1, innerZ, nx, 0, nz);
    if (outward > 0) {
      indices.push(i0, i1, i2, i0, i2, i3);
    } else {
      indices.push(i0, i2, i1, i0, i3, i2);
    }
  }

  return createMeshFromData(
    engine,
    name,
    new Float32Array(positions),
    new Float32Array(normals),
    new Uint32Array(indices),
  );
}

function setThinInstanceCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  if (count > ti._capacity) {
    throw new Error(`thin-instance count ${count} exceeds capacity ${ti._capacity}`);
  }
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
}

/**
 * Thin-instance matrix: X=right, Y=up, Z=forward (column-major), uniform scale.
 * @param {Float32Array} matrices
 * @param {number} slot
 */
function writeFacingMatrix(matrices, slot, x, y, z, rx, ry, rz, ux, uy, uz, fx, fy, fz, scale) {
  const o = slot * 16;
  const sc = scale;
  matrices[o] = rx * sc;
  matrices[o + 1] = ry * sc;
  matrices[o + 2] = rz * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = ux * sc;
  matrices[o + 5] = uy * sc;
  matrices[o + 6] = uz * sc;
  matrices[o + 7] = 0;
  matrices[o + 8] = fx * sc;
  matrices[o + 9] = fy * sc;
  matrices[o + 10] = fz * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

/**
 * Quaternion from orthonormal basis columns (X, Y, Z).
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
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

function makeRingMaterial(diffuse, emissive, alpha = 1) {
  const mat = createStandardMaterial();
  mat.diffuseColor = [...diffuse];
  mat.emissiveColor = [...emissive];
  mat.alpha = alpha;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  return mat;
}

function previewColorFromMaterial(mat) {
  const color =
    mat?.baseColorFactor ??
    mat?._baseColorFactor ??
    mat?.diffuseColor;
  if (color?.length >= 3) {
    return [
      Math.max(0.12, Math.min(1, color[0])),
      Math.max(0.12, Math.min(1, color[1])),
      Math.max(0.12, Math.min(1, color[2])),
    ];
  }
  return [0.72, 0.75, 0.8];
}

/**
 * Radial icons use isolated lit StandardMaterials. A strong emissive wash keeps
 * the resting icon silhouette-like; hover lowers it to reveal normal shading.
 */
function makeIconPreviewMaterial(source) {
  const color = previewColorFromMaterial(source);
  const mat = createStandardMaterial();
  mat.name = `${source?.name ?? 'building'}-radial`;
  mat.diffuseColor = color;
  mat.emissiveColor = [0.82, 0.82, 0.82];
  mat.alpha = 1;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  markMaterialUboDirty(mat);
  return mat;
}

/** Unlit HUD copy of the ownership standard — opaque, same pass as the pie. */
function makeHubFlagMaterial(source, isTeamColor) {
  const color = isTeamColor ? [1, 1, 1] : previewColorFromMaterial(source);
  const mat = createStandardMaterial();
  mat.name = `${source?.name ?? 'flag'}-radial`;
  mat.diffuseColor = color;
  mat.emissiveColor = isTeamColor ? [0.22, 0.22, 0.22] : [0.16, 0.16, 0.16];
  mat.alpha = 1;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if ('backFaceCulling' in mat) mat.backFaceCulling = false;
  markMaterialUboDirty(mat);
  return mat;
}

/**
 * Ray × plane. Plane through (px,py,pz) with unit normal (nx,ny,nz).
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 */
function rayHitPlane(ray, px, py, pz, nx, ny, nz) {
  const denom = ray.dx * nx + ray.dy * ny + ray.dz * nz;
  if (Math.abs(denom) < 1e-8) return null;
  const t = ((px - ray.ox) * nx + (py - ray.oy) * ny + (pz - ray.oz) * nz) / denom;
  if (t < 0) return null;
  return {
    x: ray.ox + ray.dx * t,
    y: ray.oy + ray.dy * t,
    z: ray.oz + ray.dz * t,
    t,
  };
}

/**
 * Nearest positive ray–sphere hit distance, or null.
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 */
function rayHitSphereT(ray, cx, cy, cz, radius) {
  const lx = ray.ox - cx;
  const ly = ray.oy - cy;
  const lz = ray.oz - cz;
  const b = ray.dx * lx + ray.dy * ly + ray.dz * lz;
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = -b - root;
  if (t0 >= 0) return t0;
  const t1 = -b + root;
  return t1 >= 0 ? t1 : null;
}

/**
 * Place annulus (local Y = face normal) with camera-facing basis.
 * Basis columns: X=right, Y=normal(toCam), Z=planeZ (−screenUp).
 */
function placeMeshOriented(mesh, x, y, z, scale, rx, ry, rz, nx, ny, nz, tx, ty, tz) {
  if (mesh.position) {
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;
  }
  if (mesh.scaling) {
    mesh.scaling.x = scale;
    mesh.scaling.y = scale;
    mesh.scaling.z = scale;
  }
  const q = quatFromBasis(rx, ry, rz, nx, ny, nz, tx, ty, tz);
  const rq = mesh.rotationQuaternion;
  if (rq) {
    if (typeof rq.set === 'function') rq.set(q.x, q.y, q.z, q.w);
    else {
      rq.x = q.x;
      rq.y = q.y;
      rq.z = q.z;
      rq.w = q.w;
    }
  }
  setSubtreeVisible(mesh, true);
  mesh.markLocalDirty?.();
}

function hideMesh(mesh) {
  setSubtreeVisible(mesh, false);
  if (mesh.position) mesh.position.y = -9999;
  mesh.markLocalDirty?.();
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   rayFromCanvas?: (canvasX: number, canvasY: number) => { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null,
 *   getViewport?: () => { width: number, height: number, pixelWidth?: number, pixelHeight?: number },
 *   font?: object | null,
 * }} [screen]
 */
export async function createBuildingRadialMenu(engine, scene, groundYAt, screen = {}) {
  const basicCat = CATEGORIES[0];
  const ringMat = makeRingMaterial(basicCat.color, basicCat.emissive, MENU_RING_ALPHA);

  // Menu ring: annulus authored at outerR=1 → scale XZ to MENU_RING_OUTER.
  const menuRing = createAnnulusMesh(engine, 'build-menu-ring', {
    inner: MENU_RING_INNER / MENU_RING_OUTER,
    height: MENU_RING_H / MENU_RING_OUTER,
    segments: 64,
  });
  menuRing.material = ringMat;
  menuRing.pickable = false;
  menuRing.renderOrder = 210;
  hideMesh(menuRing);
  addToScene(scene, menuRing);

  /** Center category pie — 3 wedges. Angles match rim coords (−π/2 = screen-top). */
  const sliceSpan = (Math.PI * 2) / CATEGORIES.length;
  const sliceStart0 = -Math.PI / 2 - sliceSpan * 0.5 + PIE_ROTATION;
  /** @type {{ id: CategoryId, mesh: object, mat: object, startAng: number, endAng: number }[]} */
  const pieSlices = [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    const startAng = sliceStart0 + i * sliceSpan;
    const endAng = startAng + sliceSpan;
    const mesh = createPieSliceMesh(engine, `build-menu-pie-${cat.id}`, {
      startAng,
      endAng,
      inner: PIE_INNER / PIE_OUTER,
      height: PIE_H / PIE_OUTER,
      segments: 18,
      gap: PIE_SLICE_GAP / PIE_OUTER,
    });
    const mat = makeRingMaterial(cat.color, cat.emissive, 0.92);
    mesh.material = mat;
    mesh.pickable = false;
    mesh.renderOrder = 215;
    hideMesh(mesh);
    addToScene(scene, mesh);
    pieSlices.push({ id: cat.id, mesh, mat, startAng, endAng });
  }

  /** Pad rings under each option — own material so hover can recolor. */
  /** @type {{ mesh: object, mat: object }[]} */
  const pads = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const pad = createAnnulusMesh(engine, `build-menu-pad-${i}`, {
      inner: PAD_INNER / PAD_OUTER,
      height: PAD_H / PAD_OUTER,
      segments: 28,
    });
    const mat = makeRingMaterial(basicCat.pad, basicCat.padEm);
    pad.material = mat;
    pad.pickable = false;
    pad.renderOrder = 220;
    hideMesh(pad);
    addToScene(scene, pad);
    pads.push({ mesh: pad, mat });
  }

  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null, visible: boolean }[] }>} */
  const icons = new Map();

  await Promise.all(
    PLACEABLE_BUILDINGS.map(async (def) => {
      const url = MODEL_URLS[def.id];
      if (!url) return;
      try {
        const parts = await loadBakedUnitMeshParts(engine, url);
        /** @type {{ mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null, visible: boolean }[]} */
        const layers = [];
        for (const mesh of parts) {
          mesh.position.x = 0;
          mesh.position.y = 0;
          mesh.position.z = 0;
          // Hover/click uses CPU pad discs — icons need not be GPU-pickable.
          mesh.pickable = false;
          mesh.material = makeIconPreviewMaterial(mesh.material);
          const mat = mesh.material;
          let baseEmissive = null;
          let baseDiffuse = null;
          if (mat) {
            if (mat.emissiveColor) baseEmissive = [...mat.emissiveColor];
            else {
              mat.emissiveColor = [0, 0, 0];
              baseEmissive = [0, 0, 0];
            }
            if (mat.diffuseColor) baseDiffuse = [...mat.diffuseColor];
          }
          const matrices = new Float32Array(16);
          setThinInstances(mesh, matrices, 1);
          setThinInstanceCount(mesh, 0);
          addToScene(scene, mesh);
          setSubtreeVisible(mesh, false);
          layers.push({ mesh, matrices, baseEmissive, baseDiffuse, visible: false });
        }
        icons.set(def.id, { layers });
      } catch (err) {
        console.warn(`[buildingRadial] icon ${def.id} failed`, err);
      }
    }),
  );

  /** @type {{ mesh: object, isTeamColor: boolean }[]} */
  const hubFlagLayers = [];
  try {
    const parts = await loadBakedUnitMeshParts(engine, FLAG_MODEL_URL);
    for (const mesh of parts) {
      mesh.position.x = 0;
      mesh.position.y = 0;
      mesh.position.z = 0;
      mesh.pickable = false;
      // After the opaque category pie (215).
      mesh.renderOrder = 226;
      const isTeamColor = String(mesh.material?.name ?? '')
        .toLowerCase()
        .includes('teamcolor');
      mesh.material = makeHubFlagMaterial(mesh.material, isTeamColor);
      addToScene(scene, mesh);
      hideMesh(mesh);
      hubFlagLayers.push({ mesh, isTeamColor });
    }
  } catch (err) {
    console.warn('[buildingRadial] hub flag failed', err);
  }

  /** @type {{ data: object, layer: object, text: string }[]} */
  const labels = [];
  let textRenderer = null;
  let textRendererRegistered = false;
  if (screen.font) {
    try {
      for (let i = 0; i < MAX_OPTIONS; i++) {
        const data = createDefaultTextData(
          screen.font,
          LABEL_FONT_SIZE,
          'Building',
          [0.86, 0.96, 1, 1],
        );
        const layer = createTextLayer(data, {
          order: i,
          opacity: 0,
          visible: false,
        });
        labels.push({ data, layer, text: 'Building' });
      }
      // A separate load-op text pass cannot leak its bind group into the
      // scene render pass, unlike world-space TextRenderable.
      textRenderer = createTextRenderer(engine, {
        layers: labels.map((label) => label.layer),
        clear: false,
      });
    } catch (err) {
      console.warn('[buildingRadial] native labels unavailable', err);
      for (const label of labels) {
        disposeDefaultTextData(label.data);
      }
      labels.length = 0;
      textRenderer = null;
    }
  }
  /** @type {CategoryId} */
  let activeCategory = 'basic';
  /**
   * After a pie-slice click, hover no longer switches pages — so the cursor can
   * cross other wedges to reach ring buildings without flipping the menu.
   */
  let categoryLocked = false;
  /** @type {CategoryId | null} */
  let pieHoverId = null;

  function categoryDef(id) {
    return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
  }

  function itemsForCategory(catId) {
    return PLACEABLE_BUILDINGS.filter(
      (b) => b.category === catId && icons.has(b.id),
    );
  }

  /** @type {{ type: string, name: string, ang: number, x: number, y: number, z: number }[]} */
  let slots = [];
  let open = false;
  let anchorX = 0;
  let anchorZ = 0;
  let centerX = 0;
  let centerZ = 0;
  let centerY = 0;
  let hudScale = 1;
  /** Animated scale mul (1 full → COMPACT_SCALE while placing). */
  let compactMul = 1;
  let compactTarget = 1;
  let compactLastMs = 0;
  let hoverIndex = -1;
  // Menu basis: right (screen X), normal (tilted up), planeZ (−planeUp), planeUp.
  let bx = 1;
  let by = 0;
  let bz = 0;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  let tx = 0;
  let ty = 0;
  let tz = -1;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  // Horizontal toward-camera (for upright icon facing).
  let hx = 0;
  let hz = 1;

  let hubOwner = 0;

  function applyHubFlagOwner(owner) {
    hubOwner = owner | 0;
    const tint = ownerTint(hubOwner);
    for (const layer of hubFlagLayers) {
      if (!layer.isTeamColor) continue;
      const mat = layer.mesh.material;
      if (!mat) continue;
      mat.diffuseColor = [tint[0], tint[1], tint[2]];
      mat.emissiveColor = [tint[0] * 0.32, tint[1] * 0.32, tint[2] * 0.32];
      markMaterialUboDirty(mat);
    }
  }

  function hideHubFlag() {
    for (const layer of hubFlagLayers) hideMesh(layer.mesh);
  }

  function redrawHubFlag() {
    if (!open || !hubFlagLayers.length) {
      hideHubFlag();
      return;
    }
    const lift = FLAG_HUB_LIFT * hudScale;
    const scale = Math.max(0.9, FLAG_HUB_SCALE * hudScale);
    const x = centerX + nx * lift;
    const y = centerY + ny * lift;
    const z = centerZ + nz * lift;
    // Upright, yawed toward camera — same basis as ring icons.
    for (const layer of hubFlagLayers) {
      placeMeshOriented(
        layer.mesh,
        x,
        y,
        z,
        scale,
        -bx,
        0,
        -bz,
        0,
        1,
        0,
        -hx,
        0,
        -hz,
      );
      if (layer.mesh.visible === false) layer.mesh.visible = true;
    }
  }

  function hideLabel(label) {
    if (!label) return;
    label.layer.opacity = 0;
    label.layer.visible = false;
    label.layer._version++;
  }

  function cameraEye(camera) {
    const wm = camera?.worldMatrix;
    if (
      wm &&
      Number.isFinite(wm[12]) &&
      Number.isFinite(wm[13]) &&
      Number.isFinite(wm[14])
    ) {
      return { x: wm[12], y: wm[13], z: wm[14] };
    }
    const p = camera?.position;
    if (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.z)
    ) {
      return { x: p.x, y: p.y, z: p.z };
    }
    // ArcRotate: eye = target + (r·cosα·sinβ, r·cosβ, r·sinα·sinβ).
    const t = camera?.target;
    const tx = t?.x ?? 0;
    const ty = t?.y ?? 0;
    const tz = t?.z ?? 0;
    const a = camera?.alpha ?? -Math.PI / 2.1;
    const b = camera?.beta ?? Math.PI / 3.2;
    const r = camera?.radius ?? 110;
    let sb = Math.sin(b);
    if (Math.abs(sb) < 1e-4) sb = 1e-4;
    const cb = Math.cos(b);
    return {
      x: tx + r * Math.cos(a) * sb,
      y: ty + r * cb,
      z: tz + r * Math.sin(a) * sb,
    };
  }

  /**
   * Tilt the menu toward the camera (fixed lean, not a billboard).
   * Option angles stay screen-stable: ang=−π/2 is screen-top.
   * Annulus local axes: X=right, Y=normal, Z=−planeUp.
   * @param {object | null | undefined} camera
   */
  function updateBasis(camera) {
    const eye = cameraEye(camera);
    let thx = eye.x - centerX;
    let thz = eye.z - centerZ;
    let hlen = Math.hypot(thx, thz);
    if (hlen < 1e-4) {
      const a = camera?.alpha ?? 0;
      thx = Math.cos(a);
      thz = Math.sin(a);
      hlen = 1;
    } else {
      thx /= hlen;
      thz /= hlen;
    }
    hx = thx;
    hz = thz;

    const st = Math.sin(MENU_TILT);
    const ct = Math.cos(MENU_TILT);
    // Lean toward camera azimuth; stay mostly horizontal.
    nx = thx * st;
    ny = ct;
    nz = thz * st;

    // Screen-right = worldUp × towardCamHorizontal.
    bx = thz;
    by = 0;
    bz = -thx;

    // planeUp = normal × right → toward screen-top on the tilted disc.
    let pux = ny * bz - nz * by;
    let puy = nz * bx - nx * bz;
    let puz = nx * by - ny * bx;
    const pulen = Math.hypot(pux, puy, puz) || 1;
    pux /= pulen;
    puy /= pulen;
    puz /= pulen;
    ux = pux;
    uy = puy;
    uz = puz;

    tx = -ux;
    ty = -uy;
    tz = -uz;
  }

  function hideAllIcons() {
    for (const batch of icons.values()) {
      for (const layer of batch.layers) {
        if (layer.visible) {
          // Event-only visibility changes invalidate the cached bundle without
          // rebuilding it from the per-frame layout path.
          setSubtreeVisible(layer.mesh, false);
          layer.visible = false;
        }
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
        if (layer.baseEmissive && layer.mesh.material?.emissiveColor) {
          layer.mesh.material.emissiveColor = [...layer.baseEmissive];
        }
        if (layer.baseDiffuse && layer.mesh.material?.diffuseColor) {
          layer.mesh.material.diffuseColor = [...layer.baseDiffuse];
        }
      }
    }
  }

  function applyPadHover(index, hovered) {
    const pad = pads[index];
    if (!pad) return;
    const cat = categoryDef(activeCategory);
    const mat = pad.mat;
    if (hovered) {
      mat.diffuseColor = [...PAD_HOVER_COLOR];
      mat.emissiveColor = [...PAD_HOVER_EMISSIVE];
    } else {
      mat.diffuseColor = [...cat.pad];
      mat.emissiveColor = [...cat.padEm];
    }
    markMaterialUboDirty(mat);
  }

  function applyPieAppearance() {
    for (const slice of pieSlices) {
      const cat = categoryDef(slice.id);
      const selected = slice.id === activeCategory;
      const hovered = slice.id === pieHoverId;
      // Inactive wedges stay readable — only a mild dim vs the active page.
      const boost = selected ? 1 : hovered ? 0.9 : 0.78;
      slice.mat.diffuseColor = [
        cat.color[0] * boost,
        cat.color[1] * boost,
        cat.color[2] * boost,
      ];
      slice.mat.emissiveColor = [
        cat.emissive[0] * (selected || hovered ? 1.15 : 0.75),
        cat.emissive[1] * (selected || hovered ? 1.15 : 0.75),
        cat.emissive[2] * (selected || hovered ? 1.15 : 0.75),
      ];
      slice.mat.alpha = selected ? 0.95 : hovered ? 0.88 : 0.72;
      markMaterialUboDirty(slice.mat);
    }
  }

  function applyRingColor() {
    const cat = categoryDef(activeCategory);
    ringMat.diffuseColor = [...cat.color];
    ringMat.emissiveColor = [...cat.emissive];
    markMaterialUboDirty(ringMat);
  }

  function rebuildSlots() {
    const items = itemsForCategory(activeCategory);
    const n = Math.min(MAX_OPTIONS, items.length);
    hoverIndex = -1;
    hideAllIcons();
    slots = [];
    const ringRotation = BUTTON_RING_ROTATIONS[activeCategory] ?? 0;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + ringRotation + (i / n) * Math.PI * 2;
      slots.push({
        type: items[i].id,
        name: items[i].name,
        ang,
        x: 0,
        y: centerY,
        z: 0,
      });
    }
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const text = slots[i]?.name;
      hideLabel(label);
      if (text && text !== label.text) {
        updateDefaultTextData(label.data, text, [0.86, 0.96, 1, 1]);
        label.text = text;
      }
    }
    applyRingColor();
    applyPieAppearance();
    for (let i = 0; i < pads.length; i++) applyPadHover(i, false);
  }

  /**
   * @param {CategoryId | string} catId
   * @param {{ lock?: boolean }} [opts]
   *   lock: true after a pie click — hover stops changing pages until reopen.
   */
  function setCategory(catId, opts = {}) {
    if (!CATEGORIES.some((c) => c.id === catId)) return;
    if (opts.lock) categoryLocked = true;
    if (catId === activeCategory && slots.length) return;
    activeCategory = /** @type {CategoryId} */ (catId);
    rebuildSlots();
    if (open) layout();
  }

  /** Allow pie hover to switch pages again (e.g. after canceling a building ghost). */
  function unlockCategory() {
    if (!categoryLocked) return;
    categoryLocked = false;
  }

  function applyIconHover(type, hovered) {
    const batch = icons.get(type);
    if (!batch) return;
    for (const layer of batch.layers) {
      const mat = layer.mesh.material;
      if (!mat) continue;
      if (hovered) {
        if (mat.emissiveColor && layer.baseEmissive) {
          // Remove the flat silhouette wash so scene lighting reveals normals.
          mat.emissiveColor = [0.06, 0.075, 0.09];
        }
        if (mat.diffuseColor && layer.baseDiffuse) {
          mat.diffuseColor = [
            Math.min(1, layer.baseDiffuse[0] * 1.2 + 0.06),
            Math.min(1, layer.baseDiffuse[1] * 1.2 + 0.06),
            Math.min(1, layer.baseDiffuse[2] * 1.2 + 0.06),
          ];
        }
        if (mat.specularColor) mat.specularColor = [0.12, 0.14, 0.16];
      } else {
        if (mat.emissiveColor && layer.baseEmissive) {
          mat.emissiveColor = [...layer.baseEmissive];
        }
        if (mat.diffuseColor && layer.baseDiffuse) {
          mat.diffuseColor = [...layer.baseDiffuse];
        }
        if (mat.specularColor) mat.specularColor = [0, 0, 0];
      }
      markMaterialUboDirty(mat);
    }
  }

  /** World scale for a given camera depth (∝ depth → steady on-screen size). */
  function scaleForPlaceDist(placeDist) {
    if (!Number.isFinite(placeDist) || placeDist < 1e-3) {
      return HUD_BASE_SCALE * compactMul;
    }
    return (
      Math.max(HUD_SCALE_MIN, HUD_BASE_SCALE * (placeDist / HUD_REF_DIST)) *
      compactMul
    );
  }

  /**
   * Shrink (or restore) the open radial while placing.
   * Target is approached smoothly in `update`.
   * @param {boolean} on
   */
  function setCompact(on) {
    compactTarget = on ? COMPACT_SCALE : 1;
  }

  /** Ease compactMul toward compactTarget (frame-rate independent). */
  function tickCompact() {
    const now = performance.now();
    const dt =
      compactLastMs > 0
        ? Math.min(0.05, Math.max(0, (now - compactLastMs) / 1000))
        : 0;
    compactLastMs = now;
    const err = compactTarget - compactMul;
    if (Math.abs(err) < 1e-4) {
      compactMul = compactTarget;
      return;
    }
    compactMul += err * (1 - Math.exp(-COMPACT_LERP_SPEED * dt));
  }

  /** Frame the agora in the hub hole; scale from the posed center. */
  function syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye) {
    const posed = poseRadialFramingBuilding(
      eye,
      agoraX,
      agoraY,
      agoraZ,
      scaleForPlaceDist,
      RIM_R,
      MENU_TILT,
    );
    hudScale = posed.hudScale;
    centerX = posed.x;
    centerY = posed.y;
    centerZ = posed.z;
    updateBasis(camera);
  }

  /**
   * Pose the menu. With EDGE_PIN_HUD: project agora → clamp → place on ray.
   * Otherwise: stay above the agora.
   * @param {object | null | undefined} camera
   */
  function syncPose(camera) {
    const eye = cameraEye(camera);
    const gy = groundYAt(anchorX, anchorZ);
    const groundY = Number.isFinite(gy) ? gy : 0;
    const agoraX = anchorX;
    const agoraY = groundY + MENU_Y;
    const agoraZ = anchorZ;

    if (!EDGE_PIN_HUD) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const distA =
      Math.hypot(eye.x - agoraX, eye.y - agoraY, eye.z - agoraZ) || HUD_PLACE_DIST;
    const placeDist = Math.min(
      HUD_PLACE_DIST,
      Math.max(HUD_PLACE_MIN, distA * HUD_PLACE_FRAC),
    );
    hudScale = scaleForPlaceDist(placeDist);

    const worldToScreen = screen.worldToScreen;
    const rayFromCanvas = screen.rayFromCanvas;
    const getViewport = screen.getViewport;

    // Fallback: sit above the agora if screen helpers aren't wired.
    if (!worldToScreen || !rayFromCanvas || !getViewport) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const vp = getViewport();
    const vw = vp?.width ?? 0;
    const vh = vp?.height ?? 0;
    if (vw < 8 || vh < 8) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const margin = Math.min(vw, vh) * HUD_EDGE_MARGIN_FRAC;
    const scr = worldToScreen(agoraX, agoraY, agoraZ);
    let sx = vw * 0.5;
    let sy = vh * 0.5;
    if (scr && Number.isFinite(scr.x) && Number.isFinite(scr.y)) {
      sx = scr.x;
      sy = scr.y;
    }

    const cx = Math.min(vw - margin, Math.max(margin, sx));
    const cy = Math.min(vh - margin, Math.max(margin, sy));
    const ray = rayFromCanvas(cx, cy);
    if (!ray) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    // Aim along the screen ray, then sit at placeDist from the eye.
    const aimX = ray.ox + ray.dx * Math.max(placeDist, 10);
    const aimY = ray.oy + ray.dy * Math.max(placeDist, 10);
    const aimZ = ray.oz + ray.dz * Math.max(placeDist, 10);
    let ax = aimX - eye.x;
    let ay = aimY - eye.y;
    let az = aimZ - eye.z;
    const alen = Math.hypot(ax, ay, az);
    if (alen < 1e-6) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }
    ax /= alen;
    ay /= alen;
    az /= alen;

    const px = eye.x + ax * placeDist;
    const py = eye.y + ay * placeDist;
    const pz = eye.z + az * placeDist;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    centerX = px;
    centerY = py;
    centerZ = pz;
    updateBasis(camera);
  }

  function redrawSlot(i) {
    const s = slots[i];
    if (!s) return;
    const iconScale = OPTION_SCALE * hudScale;
    const lift = ICON_LIFT * hudScale;
    const iconX = s.x + nx * lift;
    const iconY = s.y + ny * lift;
    const iconZ = s.z + nz * lift;
    const batch = icons.get(s.type);
    if (!batch) return;
    // Upright icons, yawed toward camera (right-handed: X×Y=Z, −Z toward camera).
    for (const layer of batch.layers) {
      writeFacingMatrix(
        layer.matrices,
        0,
        iconX,
        iconY,
        iconZ,
        -bx,
        0,
        -bz,
        0,
        1,
        0,
        -hx,
        0,
        -hz,
        iconScale,
      );
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
      if (!layer.visible) {
        setSubtreeVisible(layer.mesh, true);
        layer.visible = true;
      }
    }
    applyIconHover(s.type, i === hoverIndex);
    applyPadHover(i, i === hoverIndex);
  }

  function redrawLabel(i) {
    const label = labels[i];
    const slot = slots[i];
    const worldToScreen = screen.worldToScreen;
    const getViewport = screen.getViewport;
    if (!label || !slot || !open || !worldToScreen || !getViewport) {
      hideLabel(label);
      return;
    }
    const hovered = i === hoverIndex;
    const down = LABEL_DOWN * hudScale;
    const lift = LABEL_LIFT * hudScale;
    const worldX = slot.x + tx * down + nx * lift;
    const worldY = slot.y + ty * down + ny * lift;
    const worldZ = slot.z + tz * down + nz * lift;
    const origin = worldToScreen(worldX, worldY, worldZ);
    const viewport = getViewport();
    if (!origin || !viewport?.width || !viewport?.height) {
      hideLabel(label);
      return;
    }
    const sx = (viewport.pixelWidth ?? viewport.width) / viewport.width;
    const sy = (viewport.pixelHeight ?? viewport.height) / viewport.height;
    const pixelRatio = (sx + sy) * 0.5;
    const scale =
      LABEL_SCREEN_SCALE * pixelRatio * compactMul * (hovered ? 1.05 : 1);
    const centerOffset = label.data.width * scale * 0.5;
    const layer = label.layer;
    layer.positionPx.x = origin.x * sx - centerOffset;
    layer.positionPx.y = origin.y * sy;
    layer.rotationRad = 0;
    layer.scale = scale;
    layer.opacity = hovered ? 1 : 0.88;
    layer.visible = true;
    layer._version++;
  }

  function layout() {
    const s = hudScale;
    // Annulus mesh outerR=1 → world outer = MENU_RING_OUTER * s
    placeMeshOriented(
      menuRing,
      centerX,
      centerY,
      centerZ,
      MENU_RING_OUTER * s,
      bx,
      by,
      bz,
      nx,
      ny,
      nz,
      tx,
      ty,
      tz,
    );

    const pieLift = PIE_LIFT * s;
    const pieScale = PIE_OUTER * s;
    for (const slice of pieSlices) {
      placeMeshOriented(
        slice.mesh,
        centerX + nx * pieLift,
        centerY + ny * pieLift,
        centerZ + nz * pieLift,
        pieScale,
        bx,
        by,
        bz,
        nx,
        ny,
        nz,
        tx,
        ty,
        tz,
      );
    }

    const rimR = RIM_R * s;
    const padLift = PAD_LIFT * s;
    const n = slots.length;
    for (let i = 0; i < pads.length; i++) {
      if (i >= n) {
        hideMesh(pads[i].mesh);
        applyPadHover(i, false);
        hideLabel(labels[i]);
        continue;
      }
      const slot = slots[i];
      const ca = Math.cos(slot.ang);
      const sa = Math.sin(slot.ang);
      // Polar on the tilted plane; ang=−π/2 → screen-top.
      slot.x = centerX + (ca * bx + sa * tx) * rimR + nx * padLift;
      slot.y = centerY + (ca * by + sa * ty) * rimR + ny * padLift;
      slot.z = centerZ + (ca * bz + sa * tz) * rimR + nz * padLift;
      placeMeshOriented(
        pads[i].mesh,
        slot.x,
        slot.y,
        slot.z,
        PAD_OUTER * s,
        bx,
        by,
        bz,
        nx,
        ny,
        nz,
        tx,
        ty,
        tz,
      );
      redrawSlot(i);
      redrawLabel(i);
    }
    redrawHubFlag();
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {object | null} [camera]
   * @param {number} [owner]
   */
  function showAt(x, z, camera = null, owner = 0) {
    anchorX = x;
    anchorZ = z;
    hoverIndex = -1;
    pieHoverId = null;
    categoryLocked = false;
    applyHubFlagOwner(owner);
    syncPose(camera);
    rebuildSlots();
    open = true;
    layout();
  }

  /**
   * @param {object} camera
   */
  function update(camera) {
    if (!open) return;
    tickCompact();
    syncPose(camera);
    layout();
  }

  function hide() {
    if (!open) return;
    hideMesh(menuRing);
    for (const slice of pieSlices) hideMesh(slice.mesh);
    for (let i = 0; i < pads.length; i++) {
      hideMesh(pads[i].mesh);
      applyPadHover(i, false);
    }
    hideAllIcons();
    hideHubFlag();
    for (const label of labels) hideLabel(label);
    slots = [];
    hoverIndex = -1;
    pieHoverId = null;
    categoryLocked = false;
    compactMul = 1;
    compactTarget = 1;
    compactLastMs = 0;
    open = false;
  }

  function isOpen() {
    return open;
  }

  function setHover(index) {
    if (!open) return;
    const next = index | 0;
    if (next === hoverIndex) return;
    const prev = hoverIndex;
    hoverIndex = next >= 0 && next < slots.length ? next : -1;
    if (prev >= 0) {
      applyIconHover(slots[prev].type, false);
      applyPadHover(prev, false);
      redrawLabel(prev);
    }
    if (hoverIndex >= 0) {
      applyIconHover(slots[hoverIndex].type, true);
      applyPadHover(hoverIndex, true);
      redrawLabel(hoverIndex);
    }
  }

  /** @param {string | null | undefined} type */
  function setHoverByType(type) {
    if (!type) {
      setHover(-1);
      return;
    }
    setHover(slots.findIndex((s) => s.type === type));
  }

  /**
   * @param {{ kind: 'building' | 'category', id: string } | null | undefined} pick
   */
  function setHoverFromPick(pick) {
    if (!pick) {
      clearHover();
      return;
    }
    if (pick.kind === 'category') {
      setHover(-1);
      if (pieHoverId !== pick.id) {
        pieHoverId = /** @type {CategoryId} */ (pick.id);
        applyPieAppearance();
      }
      return;
    }
    if (pieHoverId != null) {
      pieHoverId = null;
      applyPieAppearance();
    }
    setHoverByType(pick.id);
  }

  function clearHover() {
    setHover(-1);
    if (pieHoverId != null) {
      pieHoverId = null;
      applyPieAppearance();
    }
  }

  function hoveredType() {
    if (!open || hoverIndex < 0) return null;
    return slots[hoverIndex]?.type ?? null;
  }

  function padPlanePoint() {
    const lift = PAD_LIFT * hudScale;
    return {
      x: centerX + nx * lift,
      y: centerY + ny * lift,
      z: centerZ + nz * lift,
    };
  }

  function piePlanePoint() {
    const lift = PIE_LIFT * hudScale;
    return {
      x: centerX + nx * lift,
      y: centerY + ny * lift,
      z: centerZ + nz * lift,
    };
  }

  /**
   * Normalize atan2 angle into [startAng, startAng+2π) then test slice span.
   * @param {number} ang
   * @param {number} startAng
   * @param {number} endAng
   */
  function angInSlice(ang, startAng, endAng) {
    let a = ang;
    while (a < startAng) a += Math.PI * 2;
    while (a >= startAng + Math.PI * 2) a -= Math.PI * 2;
    return a >= startAng && a < endAng;
  }

  /**
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
   * @returns {{ kind: 'category', id: CategoryId } | null}
   */
  function pickCategoryAtRay(ray) {
    const pp = piePlanePoint();
    const hit = rayHitPlane(ray, pp.x, pp.y, pp.z, nx, ny, nz);
    if (!hit) return null;
    const dx = hit.x - pp.x;
    const dy = hit.y - pp.y;
    const dz = hit.z - pp.z;
    const dist = Math.hypot(dx, dy, dz);
    const outer = PIE_OUTER * hudScale;
    const inner = PIE_INNER * hudScale;
    if (dist > outer || dist < inner) return null;
    const alongB = dx * bx + dy * by + dz * bz;
    const alongT = dx * tx + dy * ty + dz * tz;
    const ang = Math.atan2(alongT, alongB);
    const edgeInsetAng = Math.asin(
      Math.min(0.95, (PIE_SLICE_GAP * 0.5 * hudScale) / Math.max(dist, 1e-4)),
    );
    for (const slice of pieSlices) {
      if (
        angInSlice(
          ang,
          slice.startAng + edgeInsetAng,
          slice.endAng - edgeInsetAng,
        )
      ) {
        return { kind: 'category', id: slice.id };
      }
    }
    return null;
  }

  /**
   * Option under the cursor: category pie, then pad disc / icon sphere.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   * @returns {{ kind: 'building' | 'category', id: string } | null}
   */
  function pickOptionAtRay(ray) {
    if (!open || !ray) return null;

    const catPick = pickCategoryAtRay(ray);
    if (catPick) return catPick;

    if (!slots.length) return null;
    const pp = padPlanePoint();
    const padHit = rayHitPlane(ray, pp.x, pp.y, pp.z, nx, ny, nz);
    const padR = PAD_OUTER * hudScale;
    const padR2 = padR * padR;
    const iconR = ICON_PICK_R * hudScale;
    const iconLift = ICON_LIFT * hudScale;

    let bestType = null;
    let bestT = Infinity;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];

      // Pad disc on the tilted menu plane (full disc including hole).
      if (padHit) {
        const dx = padHit.x - s.x;
        const dy = padHit.y - s.y;
        const dz = padHit.z - s.z;
        if (dx * dx + dy * dy + dz * dz <= padR2 && padHit.t < bestT) {
          bestT = padHit.t;
          bestType = s.type;
        }
      }

      // Icon volume — models sit above the pad and are larger than PAD_OUTER.
      const ix = s.x + nx * iconLift;
      const iy = s.y + ny * iconLift;
      const iz = s.z + nz * iconLift;
      const iconT = rayHitSphereT(ray, ix, iy, iz, iconR);
      if (iconT != null && iconT < bestT) {
        bestT = iconT;
        bestType = s.type;
      }
    }
    return bestType ? { kind: 'building', id: bestType } : null;
  }

  function hitHubHoleAtRay(ray) {
    if (!open || !ray) return false;
    const pp = piePlanePoint();
    const hit = rayHitPlane(ray, pp.x, pp.y, pp.z, nx, ny, nz);
    if (!hit) return false;
    const d = Math.hypot(hit.x - pp.x, hit.y - pp.y, hit.z - pp.z);
    return d < PIE_INNER * hudScale;
  }

  /**
   * Sync gesture: over an option, category pie, hub hole, or the main ring band.
   * Hub is a gesture so box-select does not start on the building; pointer-up
   * click-through is decided in gameInput.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   */
  function hitAtRay(ray) {
    if (!open || !ray) return false;
    if (pickOptionAtRay(ray)) return true;
    // Empty hub — gesture so box-select does not start on the agora.
    if (hitHubHoleAtRay(ray)) return true;
    const hit = rayHitPlane(ray, centerX, centerY, centerZ, nx, ny, nz);
    if (!hit) return false;
    const d = Math.hypot(hit.x - centerX, hit.y - centerY, hit.z - centerZ);
    const outer = MENU_RING_OUTER * hudScale;
    const inner = MENU_RING_INNER * hudScale;
    return d >= inner && d <= outer;
  }

  let labelsDisposed = false;
  function registerLabels() {
    if (!textRenderer || textRendererRegistered || labelsDisposed) return;
    registerTextRenderer(textRenderer);
    textRendererRegistered = true;
  }

  function disposeLabels() {
    if (labelsDisposed) return;
    labelsDisposed = true;
    if (textRenderer) disposeTextRenderer(textRenderer);
    textRenderer = null;
    textRendererRegistered = false;
    for (const label of labels) {
      disposeDefaultTextData(label.data);
    }
  }

  function refreshHubFlagOwner() {
    if (open) applyHubFlagOwner(hubOwner);
  }

  return {
    showAt,
    refreshHubFlagOwner,
    update,
    hide,
    isOpen,
    setCompact,
    setCategory,
    unlockCategory,
    setHover,
    setHoverByType,
    setHoverFromPick,
    clearHover,
    hoveredType,
    pickOptionAtRay,
    hitAtRay,
    hitHubHoleAtRay,
    registerLabels,
    disposeLabels,
    get category() {
      return activeCategory;
    },
    get categoryLocked() {
      return categoryLocked;
    },
    get center() {
      return open ? { x: centerX, y: centerY, z: centerZ } : null;
    },
    /** World agora flag to hide while the HUD standard is up. */
    get hubFlagPose() {
      if (!open) return null;
      return { anchorX, anchorZ };
    },
    get scale() {
      return hudScale;
    },
  };
}
