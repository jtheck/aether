// Building action menu — tilted ring framing a selected placeable
// (empty hub stays on the building). Outer arcs for units, upgrades, and a
// fixed bottom Pause | Cancel pair. Pad rings show progress; badges show queue counts.

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
import { loadBakedUnitMeshParts, UNIT_MODEL_URLS } from './unitModels.js';
import { VAT_UNIT_DEFS } from './vatUnits.js';
import {
  BUILDING_MENUS,
  BUILDING_MENU_UNITS,
  UPGRADE_MODEL_URLS,
  getBuildingMenu,
} from '../sim/buildings.js';
import { poseRadialFramingBuilding } from './radialPose.js';
import { formatResourceCost } from '../sim/resources.js';
import { menuGateState } from '../sim/menuGate.js';

/** Static or VAT unit GLB for radial icons. */
function unitMenuModelUrl(typeId) {
  return UNIT_MODEL_URLS[typeId] ?? VAT_UNIT_DEFS[typeId]?.url ?? null;
}

/** Layout at HUD scale = 1 (ring outer radius in world units). */
const MENU_Y = 2.4;
/**
 * Outer option ring — kept a fixed band width; pushed out so pads sit farther
 * from the empty hub without scaling the whole menu up.
 */
const MENU_RING_OUTER = 17.4;
const MENU_RING_INNER = 14.8;
const MENU_RING_H = 0.35;
const RIM_R = (MENU_RING_OUTER + MENU_RING_INNER) * 0.5;
const PAD_OUTER = 4.32;
const PAD_INNER = 2.79;
const PAD_H = 0.22;
const PAD_LIFT = 1.35;
const ICON_LIFT = 0.85;
const OPTION_SCALE = 1.8;
/** Tight to the visible pad / unit — not a pie-slice halo into the yard. */
const ICON_PICK_R = 5.2;
/** Min arc for units/upgrades when sharing the usable band (~100°). */
const MIN_ARC = (Math.PI * 2 * 100) / 360;
/** Bottom utility band split Pause (left) | Cancel (right). */
const UTILITY_SPAN = (Math.PI * 2 * 90) / 360;
const PAUSE_SPAN = UTILITY_SPAN * 0.5;
const CANCEL_SPAN = UTILITY_SPAN * 0.5;
/**
 * Constant-width channels between arcs (world units at HUD scale 1).
 * Parallel-edge treatment — not an angular wedge cut.
 */
const ARC_GAP = 2.3;
const MENU_TILT = 0.56;
const HUD_REF_DIST = 110;
const HUD_BASE_SCALE = 0.8;
const HUD_SCALE_MIN = 0.28;
const LABEL_FONT_SIZE = 28;
const LABEL_SCREEN_SCALE = 1.17;
const LABEL_DOWN = 4.32;
const LABEL_LIFT = 1.25;
const PRICE_FONT_SIZE = 16;
const PRICE_SCREEN_SCALE = 0.78;
const PRICE_DOWN = 6.35;
const PRICE_TEXT_COLOR = [0.78, 0.76, 0.7, 1];
const ICON_WASH = {
  ok: [0.82, 0.82, 0.82],
  unafford: [0.9, 0.5, 0.48],
  locked: [0.3, 0.3, 0.32],
};
const LABEL_WASH = {
  ok: [0.96, 0.94, 0.88, 1],
  unafford: [0.95, 0.62, 0.58, 1],
  locked: [0.3, 0.32, 0.34, 1],
};
const PRICE_WASH = {
  ok: PRICE_TEXT_COLOR,
  unafford: [0.92, 0.55, 0.52, 1],
  locked: [0.28, 0.3, 0.32, 1],
};
const BADGE_FONT_SIZE = 34;
const BADGE_SCREEN_SCALE = 0.95;
const BADGE_OUT = 2.8;
const BADGE_SIDE = 2.6;
const BADGE_LIFT = 1.4;
const MAX_OPTIONS = 8;
const MENU_RING_ALPHA = 0.55;
const PAD_HOVER_COLOR = [1, 0.85, 0.25];
const PAD_HOVER_EMISSIVE = [0.95, 0.7, 0.15];
const PROGRESS_COLOR = [1, 0.92, 0.35];
const PROGRESS_EMISSIVE = [0.95, 0.75, 0.2];
const ARMED_COLOR = [1, 0.45, 0.35];
const ARMED_EMISSIVE = [0.95, 0.28, 0.18];
const DULL_ALPHA = 0.28;
const DULL_COLOR = [0.35, 0.38, 0.42];
const DULL_EMISSIVE = [0.08, 0.09, 0.1];
/** Screen label colors — light when live, dark when disabled. */
const LABEL_TEXT_COLOR = [0.96, 0.94, 0.88, 1];
const CANCEL_LABEL_TEXT_COLOR = [0.98, 0.85, 0.8, 1];
const PAUSE_LABEL_TEXT_COLOR = [0.98, 0.92, 0.72, 1];
const RESUME_LABEL_TEXT_COLOR = [0.78, 0.96, 0.92, 1];
const DULL_TEXT_COLOR = [0.18, 0.2, 0.24, 1];
const PAUSED_COLOR = [0.28, 0.78, 0.72];
const PAUSED_EMISSIVE = [0.12, 0.48, 0.44];
const PAUSED_PAD = [0.35, 0.85, 0.78];
const PAUSED_PAD_EM = [0.14, 0.52, 0.48];

/** @typedef {'unit' | 'upgrade' | 'pause' | 'cancel'} ActionCategoryId */
/** @typedef {null | 'cancel'} ArmedId */

const CATEGORIES = /** @type {const} */ ({
  unit: {
    id: 'unit',
    name: 'Units',
    color: [0.92, 0.52, 0.28],
    emissive: [0.62, 0.32, 0.12],
    pad: [0.95, 0.62, 0.38],
    padEm: [0.55, 0.3, 0.12],
  },
  upgrade: {
    id: 'upgrade',
    name: 'Upgrades',
    color: [0.28, 0.78, 0.86],
    emissive: [0.12, 0.5, 0.58],
    pad: [0.38, 0.86, 0.9],
    padEm: [0.12, 0.52, 0.56],
  },
  pause: {
    id: 'pause',
    name: 'Pause',
    color: [0.95, 0.72, 0.22],
    emissive: [0.62, 0.42, 0.08],
    pad: [0.98, 0.78, 0.28],
    padEm: [0.55, 0.38, 0.08],
  },
  cancel: {
    id: 'cancel',
    name: 'Cancel',
    color: [0.85, 0.32, 0.28],
    emissive: [0.55, 0.12, 0.1],
    pad: [0.9, 0.4, 0.35],
    padEm: [0.5, 0.15, 0.12],
  },
});

/** Slash on the cancel pad (🚫) — matches pad color. Unit pad = radius 1. */
const CANCEL_SLASH_LEN = 1.55;
const CANCEL_SLASH_WIDTH = 0.38;
const CANCEL_SLASH_H = 0.12;
const CANCEL_SLASH_LIFT = 0.2;
/** Pad-plane rotation for the slash (radians). */
const CANCEL_SLASH_ANG = -Math.PI / 4;
/** Twin bars on the pause pad (⏸). */
const PAUSE_BAR_LEN = 1.15;
const PAUSE_BAR_WIDTH = 0.28;
const PAUSE_BAR_GAP = 0.44;
const PAUSE_BAR_H = 0.12;
const PAUSE_BAR_LIFT = 0.2;

/**
 * Flat washer / annulus in XZ (Y up). Unit scale: outer radius = 1.
 * @param {object} engine
 * @param {string} name
 * @param {{ inner?: number, height?: number, segments?: number }} [opts]
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
      if (cap === 0) {
        indices.push(i0, i1, i1 + 1, i0, i1 + 1, i0 + 1);
      } else {
        indices.push(i0, i1 + 1, i1, i0, i0 + 1, i1 + 1);
      }
    }
  }

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
 * Thin bar in XZ (Y up) for the cancel 🚫 slash. Length along +X.
 * @param {object} engine
 * @param {string} name
 * @param {{ length?: number, width?: number, height?: number }} [opts]
 */
function createSlashBarMesh(engine, name, opts = {}) {
  const len = opts.length ?? CANCEL_SLASH_LEN;
  const width = opts.width ?? CANCEL_SLASH_WIDTH;
  const h = opts.height ?? CANCEL_SLASH_H;
  const hx = len * 0.5;
  const hz = width * 0.5;
  const hy = h * 0.5;
  const positions = new Float32Array([
    // top (+Y)
    -hx, hy, -hz, hx, hy, -hz, hx, hy, hz, -hx, hy, hz,
    // bottom (−Y)
    -hx, -hy, -hz, -hx, -hy, hz, hx, -hy, hz, hx, -hy, -hz,
    // +Z
    -hx, -hy, hz, -hx, hy, hz, hx, hy, hz, hx, -hy, hz,
    // −Z
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
    // +X
    hx, -hy, -hz, hx, -hy, hz, hx, hy, hz, hx, hy, -hz,
    // −X
    -hx, -hy, -hz, -hx, hy, -hz, -hx, hy, hz, -hx, -hy, hz,
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);
  /** @type {number[]} */
  const indices = [];
  for (let f = 0; f < 6; f++) {
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return createMeshFromData(engine, name, positions, normals, new Uint32Array(indices));
}

/**
 * Twin vertical bars in XZ (Y up) for the pause ⏸ icon.
 * @param {object} engine
 * @param {string} name
 * @param {{ length?: number, width?: number, gap?: number, height?: number }} [opts]
 */
function createPauseBarsMesh(engine, name, opts = {}) {
  const len = opts.length ?? PAUSE_BAR_LEN;
  const width = opts.width ?? PAUSE_BAR_WIDTH;
  const gap = opts.gap ?? PAUSE_BAR_GAP;
  const h = opts.height ?? PAUSE_BAR_H;
  const hx = width * 0.5;
  const hz = len * 0.5;
  const hy = h * 0.5;
  const ox = gap * 0.5;
  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const normals = [];
  /** @type {number[]} */
  const indices = [];

  function pushBox(cx) {
    const base = positions.length / 3;
    const verts = [
      // top (+Y)
      -hx, hy, -hz, hx, hy, -hz, hx, hy, hz, -hx, hy, hz,
      // bottom (−Y)
      -hx, -hy, -hz, -hx, -hy, hz, hx, -hy, hz, hx, -hy, -hz,
      // +Z
      -hx, -hy, hz, -hx, hy, hz, hx, hy, hz, hx, -hy, hz,
      // −Z
      -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
      // +X
      hx, -hy, -hz, hx, -hy, hz, hx, hy, hz, hx, hy, -hz,
      // −X
      -hx, -hy, -hz, -hx, hy, -hz, -hx, hy, hz, -hx, -hy, hz,
    ];
    for (let i = 0; i < verts.length; i += 3) {
      positions.push(verts[i] + cx, verts[i + 1], verts[i + 2]);
    }
    normals.push(
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    );
    for (let f = 0; f < 6; f++) {
      const b = base + f * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  pushBox(-ox);
  pushBox(ox);
  return createMeshFromData(
    engine,
    name,
    new Float32Array(positions),
    new Float32Array(normals),
    new Uint32Array(indices),
  );
}

/**
 * Annulus sector in XZ (Y up). Unit outer radius = 1.
 * @param {object} engine
 * @param {string} name
 * @param {{ startAng?: number, endAng?: number, inner?: number, height?: number, segments?: number, gap?: number }} [opts]
 */
function createPieSliceMesh(engine, name, opts = {}) {
  const startAng = opts.startAng ?? 0;
  const endAng = opts.endAng ?? Math.PI;
  const segments = Math.max(4, opts.segments ?? 24);
  const h = opts.height ?? 0.04;
  const ro = 1;
  const ri = Math.max(0.02, Math.min(0.9, opts.inner ?? 0.12));
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
      if (cap === 0) {
        indices.push(o0, o1, o1 + 1, o0, o1 + 1, o0 + 1);
      } else {
        indices.push(o0, o1 + 1, o1, o0, o0 + 1, o1 + 1);
      }
    }
  }

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

  const cuts = [
    { separatorAng: startAng, outerAng: outerStartAng, innerAng: innerStartAng },
    { separatorAng: endAng, outerAng: outerEndAng, innerAng: innerEndAng },
  ];
  for (const cut of cuts) {
    const c = Math.cos(cut.separatorAng);
    const s = Math.sin(cut.separatorAng);
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

function makeIconPreviewMaterial(source) {
  const color = previewColorFromMaterial(source);
  const mat = createStandardMaterial();
  mat.name = `${source?.name ?? 'action'}-radial`;
  mat.diffuseColor = color;
  mat.emissiveColor = [0.82, 0.82, 0.82];
  mat.alpha = 1;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  markMaterialUboDirty(mat);
  return mat;
}

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
 * Pause (left) + Cancel (right) sit at screen-bottom (+π/2). Units/upgrades
 * share the remaining band above them. Arcs abut on separator rays; ARC_GAP
 * is parallel mesh channels.
 * @param {number} unitCount
 * @param {number} upgradeCount
 */
function computeArcs(unitCount, upgradeCount) {
  const hasU = unitCount > 0;
  const hasG = upgradeCount > 0;
  if (!hasU && !hasG) {
    return { units: null, upgrades: null, pause: null, cancel: null };
  }

  const utilStart = Math.PI / 2 - UTILITY_SPAN * 0.5;
  const pause = { start: utilStart, span: PAUSE_SPAN };
  const cancel = { start: utilStart + PAUSE_SPAN, span: CANCEL_SPAN };
  const usableStart = utilStart + UTILITY_SPAN;
  const usableSpan = Math.PI * 2 - UTILITY_SPAN;

  if (hasU && !hasG) {
    return {
      units: { start: usableStart, span: usableSpan },
      upgrades: null,
      pause,
      cancel,
    };
  }
  if (!hasU && hasG) {
    return {
      units: null,
      upgrades: { start: usableStart, span: usableSpan },
      pause,
      cancel,
    };
  }

  const minSide = Math.min(MIN_ARC, usableSpan * 0.42);
  const spare = Math.max(0, usableSpan - 2 * minSide);
  const totalN = unitCount + upgradeCount;
  const arcU = minSide + spare * (unitCount / totalN);
  const arcG = usableSpan - arcU;
  return {
    units: { start: usableStart, span: arcU },
    upgrades: { start: usableStart + arcU, span: arcG },
    pause,
    cancel,
  };
}

function trackKey(kind, id) {
  return `${kind}:${id}`;
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
export async function createBuildingActionRadial(engine, scene, groundYAt, screen = {}) {
  /** @type {Map<'unit' | 'upgrade' | 'pause' | 'cancel', { mesh: object | null, mat: object, startAng: number, endAng: number }>} */
  const arcRings = new Map([
    [
      'unit',
      {
        mesh: null,
        mat: makeRingMaterial(
          CATEGORIES.unit.color,
          CATEGORIES.unit.emissive,
          MENU_RING_ALPHA,
        ),
        startAng: 0,
        endAng: 0,
      },
    ],
    [
      'upgrade',
      {
        mesh: null,
        mat: makeRingMaterial(
          CATEGORIES.upgrade.color,
          CATEGORIES.upgrade.emissive,
          MENU_RING_ALPHA,
        ),
        startAng: 0,
        endAng: 0,
      },
    ],
    [
      'pause',
      {
        mesh: null,
        mat: makeRingMaterial(
          CATEGORIES.pause.color,
          CATEGORIES.pause.emissive,
          MENU_RING_ALPHA,
        ),
        startAng: 0,
        endAng: 0,
      },
    ],
    [
      'cancel',
      {
        mesh: null,
        mat: makeRingMaterial(
          CATEGORIES.cancel.color,
          CATEGORIES.cancel.emissive,
          MENU_RING_ALPHA,
        ),
        startAng: 0,
        endAng: 0,
      },
    ],
  ]);
  /** @type {Map<string, object>} */
  const arcMeshByKey = new Map();

  /**
   * @param {'unit' | 'upgrade' | 'pause' | 'cancel'} id
   * @param {number} startAng
   * @param {number} endAng
   */
  function ensureArcMesh(id, startAng, endAng) {
    const entry = arcRings.get(id);
    if (!entry) return null;
    const key = `${id}:${startAng.toFixed(4)}:${endAng.toFixed(4)}`;
    const cached = arcMeshByKey.get(key);
    if (cached) {
      if (entry.mesh && entry.mesh !== cached) hideMesh(entry.mesh);
      entry.mesh = cached;
      entry.startAng = startAng;
      entry.endAng = endAng;
      return entry;
    }
    const mesh = createPieSliceMesh(engine, `action-menu-arc-${key}`, {
      startAng,
      endAng,
      inner: MENU_RING_INNER / MENU_RING_OUTER,
      height: MENU_RING_H / MENU_RING_OUTER,
      segments: 32,
      gap: ARC_GAP / MENU_RING_OUTER,
    });
    mesh.material = entry.mat;
    mesh.pickable = false;
    mesh.renderOrder = 210;
    hideMesh(mesh);
    addToScene(scene, mesh);
    arcMeshByKey.set(key, mesh);
    if (entry.mesh) hideMesh(entry.mesh);
    entry.mesh = mesh;
    entry.startAng = startAng;
    entry.endAng = endAng;
    return entry;
  }

  function hideArcRings() {
    for (const entry of arcRings.values()) {
      if (entry.mesh) hideMesh(entry.mesh);
    }
    for (const mesh of arcMeshByKey.values()) hideMesh(mesh);
  }

  /** @type {{ mesh: object, mat: object, category: ActionCategoryId }[]} */
  const pads = [];
  /** Progress overlays — recreated when quantized progress changes. */
  /** @type {{ mesh: object | null, mat: object, q: number }[]} */
  const progressPads = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const pad = createAnnulusMesh(engine, `action-menu-pad-${i}`, {
      inner: PAD_INNER / PAD_OUTER,
      height: PAD_H / PAD_OUTER,
      segments: 28,
    });
    const mat = makeRingMaterial(CATEGORIES.unit.pad, CATEGORIES.unit.padEm);
    pad.material = mat;
    pad.pickable = false;
    pad.renderOrder = 220;
    hideMesh(pad);
    addToScene(scene, pad);
    pads.push({ mesh: pad, mat, category: 'unit' });
    progressPads.push({
      mesh: null,
      mat: makeRingMaterial(PROGRESS_COLOR, PROGRESS_EMISSIVE, 0.95),
      q: -1,
    });
  }

  // Dedicated cancel pad + 🚫 slash (no GLB).
  const cancelPadMesh = createAnnulusMesh(engine, 'action-menu-pad-cancel', {
    inner: PAD_INNER / PAD_OUTER,
    height: PAD_H / PAD_OUTER,
    segments: 28,
  });
  const cancelPadMat = makeRingMaterial(
    CATEGORIES.cancel.pad,
    CATEGORIES.cancel.padEm,
  );
  cancelPadMesh.material = cancelPadMat;
  cancelPadMesh.pickable = false;
  cancelPadMesh.renderOrder = 220;
  hideMesh(cancelPadMesh);
  addToScene(scene, cancelPadMesh);

  const cancelSlashMesh = createSlashBarMesh(engine, 'action-menu-pad-cancel-slash', {
    length: CANCEL_SLASH_LEN,
    width: CANCEL_SLASH_WIDTH,
    height: CANCEL_SLASH_H / PAD_OUTER,
  });
  const cancelSlashMat = makeRingMaterial(
    CATEGORIES.cancel.pad,
    CATEGORIES.cancel.padEm,
    0.98,
  );
  cancelSlashMesh.material = cancelSlashMat;
  cancelSlashMesh.pickable = false;
  cancelSlashMesh.renderOrder = 221;
  hideMesh(cancelSlashMesh);
  addToScene(scene, cancelSlashMesh);

  const pausePadMesh = createAnnulusMesh(engine, 'action-menu-pad-pause', {
    inner: PAD_INNER / PAD_OUTER,
    height: PAD_H / PAD_OUTER,
    segments: 28,
  });
  const pausePadMat = makeRingMaterial(
    CATEGORIES.pause.pad,
    CATEGORIES.pause.padEm,
  );
  pausePadMesh.material = pausePadMat;
  pausePadMesh.pickable = false;
  pausePadMesh.renderOrder = 220;
  hideMesh(pausePadMesh);
  addToScene(scene, pausePadMesh);

  const pauseBarsMesh = createPauseBarsMesh(engine, 'action-menu-pad-pause-bars', {
    length: PAUSE_BAR_LEN,
    width: PAUSE_BAR_WIDTH,
    gap: PAUSE_BAR_GAP,
    height: PAUSE_BAR_H / PAD_OUTER,
  });
  const pauseBarsMat = makeRingMaterial(
    CATEGORIES.pause.pad,
    CATEGORIES.pause.padEm,
    0.98,
  );
  pauseBarsMesh.material = pauseBarsMat;
  pauseBarsMesh.pickable = false;
  pauseBarsMesh.renderOrder = 221;
  hideMesh(pauseBarsMesh);
  addToScene(scene, pauseBarsMesh);

  /**
   * Icon key: `unit:warlock` / `upgrade:patronage`
   * @type {Map<string, { layers: { mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null, visible: boolean }[] }>}
   */
  const icons = new Map();

  /** @type {Map<string, Promise<void>>} */
  const iconInflight = new Map();

  async function loadIcon(key, url) {
    if (icons.has(key) || !url) return;
    let pending = iconInflight.get(key);
    if (pending) return pending;
    pending = loadIconInner(key, url);
    iconInflight.set(key, pending);
    try {
      await pending;
    } finally {
      iconInflight.delete(key);
    }
  }

  async function loadIconInner(key, url) {
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      /** @type {{ mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null, visible: boolean }[]} */
      const layers = [];
      for (const mesh of parts) {
        mesh.position.x = 0;
        mesh.position.y = 0;
        mesh.position.z = 0;
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
      icons.set(key, { layers });
    } catch (err) {
      console.warn(`[buildingActionRadial] icon ${key} failed`, err);
    }
  }

  async function ensureMenuIcons(menu) {
    if (!menu) return;
    for (const item of menu.units ?? []) {
      const typeId = item.unitType ?? BUILDING_MENU_UNITS[item.id];
      const url = typeId != null ? unitMenuModelUrl(typeId) : null;
      await loadIcon(`unit:${item.id}`, url);
    }
    for (const item of menu.upgrades ?? []) {
      await loadIcon(`upgrade:${item.id}`, UPGRADE_MODEL_URLS[item.id]);
    }
  }

  /** @type {{ data: object, layer: object, text: string }[]} */
  const labels = [];
  /** @type {{ data: object, layer: object, text: string }[]} */
  const prices = [];
  /** @type {{ data: object, layer: object, text: string }[]} */
  const badges = [];
  /** @type {{ data: object, layer: object, text: string } | null} */
  let cancelLabel = null;
  /** @type {{ data: object, layer: object, text: string, dull: boolean } | null} */
  let pauseLabel = null;
  let textRenderer = null;
  let textRendererRegistered = false;

  if (screen.font) {
    try {
      /** @type {object[]} */
      const layers = [];
      for (let i = 0; i < MAX_OPTIONS; i++) {
        const data = createDefaultTextData(
          screen.font,
          LABEL_FONT_SIZE,
          'Action',
          [0.96, 0.94, 0.88, 1],
        );
        const layer = createTextLayer(data, {
          order: i,
          opacity: 0,
          visible: false,
        });
        labels.push({ data, layer, text: 'Action' });
        layers.push(layer);
      }
      for (let i = 0; i < MAX_OPTIONS; i++) {
        const data = createDefaultTextData(
          screen.font,
          PRICE_FONT_SIZE,
          '0 Wood',
          PRICE_TEXT_COLOR,
          { align: 'center' },
        );
        const layer = createTextLayer(data, {
          order: MAX_OPTIONS + i,
          opacity: 0,
          visible: false,
        });
        prices.push({ data, layer, text: '' });
        layers.push(layer);
      }
      for (let i = 0; i < MAX_OPTIONS; i++) {
        const data = createDefaultTextData(
          screen.font,
          BADGE_FONT_SIZE,
          '0',
          [1, 0.95, 0.55, 1],
        );
        const layer = createTextLayer(data, {
          order: MAX_OPTIONS * 2 + i,
          opacity: 0,
          visible: false,
        });
        badges.push({ data, layer, text: '0' });
        layers.push(layer);
      }
      {
        const data = createDefaultTextData(
          screen.font,
          LABEL_FONT_SIZE,
          'Cancel',
          CANCEL_LABEL_TEXT_COLOR,
        );
        const layer = createTextLayer(data, {
          order: MAX_OPTIONS * 3,
          opacity: 0,
          visible: false,
        });
        cancelLabel = { data, layer, text: 'Cancel', dull: false };
        layers.push(layer);
      }
      {
        const data = createDefaultTextData(
          screen.font,
          LABEL_FONT_SIZE,
          'Pause',
          PAUSE_LABEL_TEXT_COLOR,
        );
        const layer = createTextLayer(data, {
          order: MAX_OPTIONS * 3 + 1,
          opacity: 0,
          visible: false,
        });
        pauseLabel = { data, layer, text: 'Pause', dull: false };
        layers.push(layer);
      }
      textRenderer = createTextRenderer(engine, {
        layers,
        clear: false,
      });
    } catch (err) {
      console.warn('[buildingActionRadial] native labels unavailable', err);
      for (const label of labels) disposeDefaultTextData(label.data);
      for (const price of prices) disposeDefaultTextData(price.data);
      for (const badge of badges) disposeDefaultTextData(badge.data);
      if (cancelLabel) disposeDefaultTextData(cancelLabel.data);
      if (pauseLabel) disposeDefaultTextData(pauseLabel.data);
      labels.length = 0;
      prices.length = 0;
      badges.length = 0;
      cancelLabel = null;
      pauseLabel = null;
      textRenderer = null;
    }
  }

  /**
   * @type {{
   *   kind: 'unit' | 'upgrade' | 'pause' | 'cancel',
   *   id: string,
   *   name: string,
   *   costText: string,
   *   iconKey: string | null,
   *   ang: number,
   *   x: number,
   *   y: number,
   *   z: number,
   *   category: ActionCategoryId,
   * }[]}
   */
  let slots = [];
  /** @type {Record<string, number> | null} */
  let menuBank = null;
  /** @type {Set<string>} */
  let ownedTypes = new Set();
  /** @type {{
   *   units: { start: number, span: number } | null,
   *   upgrades: { start: number, span: number } | null,
   *   pause: { start: number, span: number } | null,
   *   cancel: { start: number, span: number } | null,
   * }}
   */
  let arcs = { units: null, upgrades: null, pause: null, cancel: null };
  /** Cancel pad world pose (separate from unit/upgrade slots). */
  let cancelSlot = /** @type {{ ang: number, x: number, y: number, z: number } | null} */ (
    null
  );
  /** Pause pad world pose (left of cancel). */
  let pauseSlot = /** @type {{ ang: number, x: number, y: number, z: number } | null} */ (
    null
  );
  let open = false;
  let anchorX = 0;
  let anchorZ = 0;
  let centerX = 0;
  let centerZ = 0;
  let centerY = 0;
  let hudScale = 1;
  let hoverIndex = -1;
  let cancelHovered = false;
  let pauseHovered = false;
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
  let hx = 0;
  let hz = 1;
  /** @type {string | null} */
  let activeBuildingType = null;

  /** Pause / Cancel pads are live only while a queue/research track is running. */
  let utilityAvailable = {
    pause: false,
    cancel: false,
  };
  let prodPaused = false;
  /** Upgrade ids already researched by the local player (dull + full ring). */
  /** @type {Set<string>} */
  const researchedUpgrades = new Set();
  /** @type {ArmedId} */
  let armed = null;
  /** @type {Map<string, { progress: number, count: number }>} */
  const tracks = new Map();

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
    const t = camera?.target;
    const tx0 = t?.x ?? 0;
    const ty0 = t?.y ?? 0;
    const tz0 = t?.z ?? 0;
    const a = camera?.alpha ?? -Math.PI / 2.1;
    const b = camera?.beta ?? Math.PI / 3.2;
    const r = camera?.radius ?? 110;
    let sb = Math.sin(b);
    if (Math.abs(sb) < 1e-4) sb = 1e-4;
    const cb = Math.cos(b);
    return {
      x: tx0 + r * Math.cos(a) * sb,
      y: ty0 + r * cb,
      z: tz0 + r * Math.sin(a) * sb,
    };
  }

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
    nx = thx * st;
    ny = ct;
    nz = thz * st;

    bx = thz;
    by = 0;
    bz = -thx;

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

  function disposeProgressMesh(entry) {
    if (!entry?.mesh) return;
    hideMesh(entry.mesh);
    entry.mesh.dispose?.();
    entry.mesh = null;
    entry.q = -1;
  }

  function hideAllProgress() {
    for (const entry of progressPads) disposeProgressMesh(entry);
  }

  function anyTracksActive() {
    for (const t of tracks.values()) {
      if ((t.count | 0) > 0 || t.progress > 0) return true;
    }
    return false;
  }

  function syncCancelAvailability() {
    const on = anyTracksActive();
    utilityAvailable.cancel = on;
    utilityAvailable.pause = on;
  }

  function pauseLabelText() {
    return prodPaused ? 'Resume' : 'Pause';
  }

  function pauseLabelColor(dull) {
    if (dull) return DULL_TEXT_COLOR;
    return prodPaused ? RESUME_LABEL_TEXT_COLOR : PAUSE_LABEL_TEXT_COLOR;
  }

  function slotResearched(slot) {
    return slot?.kind === 'upgrade' && researchedUpgrades.has(slot.id);
  }

  function gateForSlot(slot) {
    if (!slot || slotResearched(slot)) return 'ok';
    return menuGateState({
      cost: slot.cost,
      requires: slot.requires,
      bank: menuBank,
      ownedTypes,
    });
  }

  function restWash(gate) {
    return ICON_WASH[gate] ?? ICON_WASH.ok;
  }

  function setMenuGate(snapshot) {
    menuBank = snapshot?.bank ?? null;
    ownedTypes = snapshot?.ownedTypes instanceof Set
      ? snapshot.ownedTypes
      : new Set(snapshot?.ownedTypes ?? []);
    for (const slot of slots) slot.gate = gateForSlot(slot);
    if (!open) return;
    for (let i = 0; i < slots.length; i++) {
      if (labels[i]) labels[i].gate = undefined;
      if (prices[i]) prices[i].gate = undefined;
      if (slots[i]?.iconKey) applyIconHover(slots[i].iconKey, i === hoverIndex);
    }
  }

  function applyPadHover(index, hovered) {
    const pad = pads[index];
    if (!pad) return;
    const cat = CATEGORIES[pad.category] ?? CATEGORIES.unit;
    const mat = pad.mat;
    const owned = slotResearched(slots[index]);
    if (owned && !hovered) {
      mat.diffuseColor = [...DULL_COLOR];
      mat.emissiveColor = [...DULL_EMISSIVE];
      mat.alpha = DULL_ALPHA;
    } else if (hovered) {
      mat.diffuseColor = [...PAD_HOVER_COLOR];
      mat.emissiveColor = [...PAD_HOVER_EMISSIVE];
      mat.alpha = 0.95;
    } else {
      mat.diffuseColor = [...cat.pad];
      mat.emissiveColor = [...cat.padEm];
      mat.alpha = 0.92;
    }
    markMaterialUboDirty(mat);
  }

  function applyCancelPadAppearance() {
    const mat = cancelPadMat;
    const available = utilityAvailable.cancel;
    if (!available) {
      mat.diffuseColor = [...DULL_COLOR];
      mat.emissiveColor = [...DULL_EMISSIVE];
      mat.alpha = DULL_ALPHA;
    } else if (armed === 'cancel') {
      mat.diffuseColor = [...ARMED_COLOR];
      mat.emissiveColor = [...ARMED_EMISSIVE];
      mat.alpha = 0.98;
    } else if (cancelHovered) {
      mat.diffuseColor = [...PAD_HOVER_COLOR];
      mat.emissiveColor = [...PAD_HOVER_EMISSIVE];
      mat.alpha = 0.95;
    } else {
      mat.diffuseColor = [...CATEGORIES.cancel.pad];
      mat.emissiveColor = [...CATEGORIES.cancel.padEm];
      mat.alpha = 0.92;
    }
    markMaterialUboDirty(mat);

    // Same color/state as the cancel pad.
    cancelSlashMat.diffuseColor = [...mat.diffuseColor];
    cancelSlashMat.emissiveColor = [...mat.emissiveColor];
    cancelSlashMat.alpha = mat.alpha;
    markMaterialUboDirty(cancelSlashMat);

    const arcMat = arcRings.get('cancel')?.mat;
    if (arcMat) {
      if (!available) {
        arcMat.diffuseColor = [...DULL_COLOR];
        arcMat.emissiveColor = [...DULL_EMISSIVE];
        arcMat.alpha = DULL_ALPHA;
      } else if (armed === 'cancel') {
        arcMat.diffuseColor = [...ARMED_COLOR];
        arcMat.emissiveColor = [...ARMED_EMISSIVE];
        arcMat.alpha = 0.85;
      } else {
        arcMat.diffuseColor = [...CATEGORIES.cancel.color];
        arcMat.emissiveColor = [...CATEGORIES.cancel.emissive];
        arcMat.alpha = MENU_RING_ALPHA;
      }
      markMaterialUboDirty(arcMat);
    }
  }

  function applyPausePadAppearance() {
    const mat = pausePadMat;
    const available = utilityAvailable.pause;
    if (!available) {
      mat.diffuseColor = [...DULL_COLOR];
      mat.emissiveColor = [...DULL_EMISSIVE];
      mat.alpha = DULL_ALPHA;
    } else if (pauseHovered) {
      mat.diffuseColor = [...PAD_HOVER_COLOR];
      mat.emissiveColor = [...PAD_HOVER_EMISSIVE];
      mat.alpha = 0.95;
    } else if (prodPaused) {
      mat.diffuseColor = [...PAUSED_PAD];
      mat.emissiveColor = [...PAUSED_PAD_EM];
      mat.alpha = 0.98;
    } else {
      mat.diffuseColor = [...CATEGORIES.pause.pad];
      mat.emissiveColor = [...CATEGORIES.pause.padEm];
      mat.alpha = 0.92;
    }
    markMaterialUboDirty(mat);

    pauseBarsMat.diffuseColor = [...mat.diffuseColor];
    pauseBarsMat.emissiveColor = [...mat.emissiveColor];
    pauseBarsMat.alpha = mat.alpha;
    markMaterialUboDirty(pauseBarsMat);

    const arcMat = arcRings.get('pause')?.mat;
    if (arcMat) {
      if (!available) {
        arcMat.diffuseColor = [...DULL_COLOR];
        arcMat.emissiveColor = [...DULL_EMISSIVE];
        arcMat.alpha = DULL_ALPHA;
      } else if (prodPaused) {
        arcMat.diffuseColor = [...PAUSED_COLOR];
        arcMat.emissiveColor = [...PAUSED_EMISSIVE];
        arcMat.alpha = 0.85;
      } else {
        arcMat.diffuseColor = [...CATEGORIES.pause.color];
        arcMat.emissiveColor = [...CATEGORIES.pause.emissive];
        arcMat.alpha = MENU_RING_ALPHA;
      }
      markMaterialUboDirty(arcMat);
    }
  }

  function pushSlotsForArc(items, category, arc) {
    if (!arc || !items.length) return;
    const n = Math.min(items.length, MAX_OPTIONS - slots.length);
    for (let i = 0; i < n; i++) {
      const item = items[i];
      const ang = arc.start + ((i + 0.5) / n) * arc.span;
      const iconKey = `${category}:${item.id}`;
      slots.push({
        kind: category,
        id: item.id,
        name: item.name,
        costText: formatResourceCost(item.cost),
        cost: item.cost,
        requires: item.requires,
        gate: 'ok',
        iconKey,
        ang,
        x: 0,
        y: centerY,
        z: 0,
        category,
      });
    }
  }

  function rebuildSlots(menu) {
    hoverIndex = -1;
    cancelHovered = false;
    pauseHovered = false;
    hideAllIcons();
    hideAllProgress();
    slots = [];
    cancelSlot = null;
    pauseSlot = null;
    if (!menu) {
      arcs = { units: null, upgrades: null, pause: null, cancel: null };
      return;
    }
    arcs = computeArcs(menu.units.length, menu.upgrades.length);
    pushSlotsForArc(menu.units, 'unit', arcs.units);
    pushSlotsForArc(menu.upgrades, 'upgrade', arcs.upgrades);
    for (const slot of slots) slot.gate = gateForSlot(slot);
    if (arcs.pause) {
      pauseSlot = {
        ang: arcs.pause.start + arcs.pause.span * 0.5,
        x: 0,
        y: centerY,
        z: 0,
      };
    }
    if (arcs.cancel) {
      cancelSlot = {
        ang: arcs.cancel.start + arcs.cancel.span * 0.5,
        x: 0,
        y: centerY,
        z: 0,
      };
    }

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const text = slots[i]?.name;
      hideLabel(label);
      if (text && text !== label.text) {
        updateDefaultTextData(label.data, text, LABEL_TEXT_COLOR);
        label.text = text;
        label.dull = false;
      }
    }
    for (const price of prices) hideLabel(price);
    for (const badge of badges) hideLabel(badge);
    hideLabel(cancelLabel);
    hideLabel(pauseLabel);
    for (let i = 0; i < pads.length; i++) {
      const cat = slots[i]?.category ?? 'unit';
      pads[i].category = cat;
      applyPadHover(i, false);
    }
    applyCancelPadAppearance();
    applyPausePadAppearance();
  }

  function applyIconHover(iconKey, hovered) {
    const batch = icons.get(iconKey);
    if (!batch) return;
    const slot = slots.find((s) => s.iconKey === iconKey);
    const wash = restWash(slot?.gate ?? 'ok');
    for (const layer of batch.layers) {
      const mat = layer.mesh.material;
      if (!mat) continue;
      if (hovered) {
        if (mat.emissiveColor && layer.baseEmissive) {
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
        if (mat.emissiveColor) {
          mat.emissiveColor = [...wash];
        }
        if (mat.diffuseColor && layer.baseDiffuse) {
          mat.diffuseColor = [...layer.baseDiffuse];
        }
        if (mat.specularColor) mat.specularColor = [0, 0, 0];
      }
      markMaterialUboDirty(mat);
    }
  }

  function scaleForDist(dist) {
    if (!Number.isFinite(dist) || dist < 1e-3) return HUD_BASE_SCALE;
    return Math.max(HUD_SCALE_MIN, HUD_BASE_SCALE * (dist / HUD_REF_DIST));
  }

  function syncPose(camera) {
    const eye = cameraEye(camera);
    const gy = groundYAt(anchorX, anchorZ);
    const groundY = Number.isFinite(gy) ? gy : 0;
    const posed = poseRadialFramingBuilding(
      eye,
      anchorX,
      groundY + MENU_Y,
      anchorZ,
      scaleForDist,
      RIM_R,
      MENU_TILT,
    );
    hudScale = posed.hudScale;
    centerX = posed.x;
    centerY = posed.y;
    centerZ = posed.z;
    updateBasis(camera);
  }

  function ensurePadProgress(i, progress) {
    const entry = progressPads[i];
    if (!entry) return;
    const p = Math.max(0, Math.min(1, progress));
    const q = p <= 0 ? 0 : Math.max(1, Math.round(p * 32)) / 32;
    if (q <= 0) {
      disposeProgressMesh(entry);
      return;
    }
    if (entry.q === q && entry.mesh) return;
    disposeProgressMesh(entry);
    const startAng = -Math.PI / 2;
    const endAng = startAng + q * Math.PI * 2;
    const mesh = createPieSliceMesh(engine, `action-menu-progress-${i}-${q}`, {
      startAng,
      endAng,
      inner: PAD_INNER / PAD_OUTER,
      height: (PAD_H * 1.35) / PAD_OUTER,
      segments: Math.max(6, Math.ceil(q * 28)),
      gap: 0,
    });
    mesh.material = entry.mat;
    mesh.pickable = false;
    mesh.renderOrder = 225;
    hideMesh(mesh);
    addToScene(scene, mesh);
    entry.mesh = mesh;
    entry.q = q;
  }

  function redrawSlot(i) {
    const s = slots[i];
    if (!s) return;
    const iconScale = OPTION_SCALE * hudScale;
    const lift = ICON_LIFT * hudScale;
    const iconX = s.x + nx * lift;
    const iconY = s.y + ny * lift;
    const iconZ = s.z + nz * lift;
    if (s.iconKey) {
      const batch = icons.get(s.iconKey);
      if (batch) {
        for (const layer of batch.layers) {
          writeFacingMatrix(
            layer.matrices,
            0,
            iconX,
            iconY,
            iconZ,
            bx,
            0,
            bz,
            0,
            1,
            0,
            hx,
            0,
            hz,
            iconScale,
          );
          setThinInstanceCount(layer.mesh, 1);
          flushThinInstances(layer.mesh);
          if (!layer.visible) {
            setSubtreeVisible(layer.mesh, true);
            layer.visible = true;
          }
        }
        applyIconHover(s.iconKey, i === hoverIndex);
      }
    }
    applyPadHover(i, i === hoverIndex);

    const track = tracks.get(trackKey(s.kind, s.id));
    // Owned upgrades stay dull with no yellow fill; in-progress uses the same ring as units.
    const progress = slotResearched(s) ? 0 : track?.progress ?? 0;
    ensurePadProgress(i, progress);
    const prog = progressPads[i];
    if (prog?.mesh) {
      placeMeshOriented(
        prog.mesh,
        s.x,
        s.y,
        s.z,
        PAD_OUTER * hudScale,
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
  }

  function placeScreenText(label, worldX, worldY, worldZ, scaleMul, opacity) {
    const worldToScreen = screen.worldToScreen;
    const getViewport = screen.getViewport;
    if (!label || !open || !worldToScreen || !getViewport) {
      hideLabel(label);
      return;
    }
    const origin = worldToScreen(worldX, worldY, worldZ);
    const viewport = getViewport();
    if (!origin || !viewport?.width || !viewport?.height) {
      hideLabel(label);
      return;
    }
    const sx = (viewport.pixelWidth ?? viewport.width) / viewport.width;
    const sy = (viewport.pixelHeight ?? viewport.height) / viewport.height;
    const pixelRatio = (sx + sy) * 0.5;
    const scale = scaleMul * pixelRatio;
    const centerOffset = label.data.width * scale * 0.5;
    const layer = label.layer;
    layer.positionPx.x = origin.x * sx - centerOffset;
    layer.positionPx.y = origin.y * sy;
    layer.rotationRad = 0;
    layer.scale = scale;
    layer.opacity = opacity;
    layer.visible = true;
    layer._version++;
  }

  function redrawLabel(i) {
    const label = labels[i];
    const slot = slots[i];
    if (!label || !slot) {
      hideLabel(label);
      return;
    }
    const hovered = i === hoverIndex;
    const owned = slotResearched(slot);
    const gate = owned ? 'owned' : (slot.gate ?? 'ok');
    if (label.dull !== owned || label.gate !== gate) {
      const color = owned
        ? DULL_TEXT_COLOR
        : (LABEL_WASH[gate] ?? LABEL_WASH.ok);
      updateDefaultTextData(label.data, label.text || slot.name, color);
      label.dull = owned;
      label.gate = gate;
    }
    const down = LABEL_DOWN * hudScale;
    const lift = LABEL_LIFT * hudScale;
    placeScreenText(
      label,
      slot.x + tx * down + nx * lift,
      slot.y + ty * down + ny * lift,
      slot.z + tz * down + nz * lift,
      LABEL_SCREEN_SCALE * (hovered ? 1.05 : 1),
      owned ? 0.82 : hovered ? 1 : 0.88,
    );
  }

  function redrawPrice(i) {
    const price = prices[i];
    const slot = slots[i];
    if (!price || !slot?.costText) {
      hideLabel(price);
      return;
    }
    const hovered = i === hoverIndex;
    const owned = slotResearched(slot);
    const gate = owned ? 'owned' : (slot.gate ?? 'ok');
    if (price.text !== slot.costText || price.dull !== owned || price.gate !== gate) {
      updateDefaultTextData(
        price.data,
        slot.costText,
        owned ? DULL_TEXT_COLOR : (PRICE_WASH[gate] ?? PRICE_WASH.ok),
      );
      price.text = slot.costText;
      price.dull = owned;
      price.gate = gate;
    }
    const down = PRICE_DOWN * hudScale;
    const lift = LABEL_LIFT * hudScale;
    placeScreenText(
      price,
      slot.x + tx * down + nx * lift,
      slot.y + ty * down + ny * lift,
      slot.z + tz * down + nz * lift,
      PRICE_SCREEN_SCALE * (hovered ? 1.05 : 1),
      owned ? 0.72 : hovered ? 0.95 : 0.8,
    );
  }

  function redrawBadge(i) {
    const badge = badges[i];
    const slot = slots[i];
    if (!badge || !slot) {
      hideLabel(badge);
      return;
    }
    const track = tracks.get(trackKey(slot.kind, slot.id));
    const count = track?.count | 0;
    if (count < 1) {
      hideLabel(badge);
      return;
    }
    const text = String(count);
    if (text !== badge.text) {
      updateDefaultTextData(badge.data, text, [1, 0.95, 0.55, 1]);
      badge.text = text;
    }
    const out = BADGE_OUT * hudScale;
    const side = BADGE_SIDE * hudScale;
    const lift = BADGE_LIFT * hudScale;
    // Top-right of pad: outward along -tx (toward screen-up-ish) + along bx.
    placeScreenText(
      badge,
      slot.x - tx * out + bx * side + nx * lift,
      slot.y - ty * out + by * side + ny * lift,
      slot.z - tz * out + bz * side + nz * lift,
      BADGE_SCREEN_SCALE,
      1,
    );
  }

  function redrawPauseLabel() {
    if (!pauseLabel || !pauseSlot || !open) {
      hideLabel(pauseLabel);
      return;
    }
    const down = LABEL_DOWN * hudScale;
    const lift = LABEL_LIFT * hudScale;
    const dull = !utilityAvailable.pause;
    const text = pauseLabelText();
    if (pauseLabel.text !== text || pauseLabel.dull !== dull) {
      updateDefaultTextData(pauseLabel.data, text, pauseLabelColor(dull));
      pauseLabel.text = text;
      pauseLabel.dull = dull;
    }
    const opacity = dull ? 0.82 : pauseHovered || prodPaused ? 1 : 0.88;
    placeScreenText(
      pauseLabel,
      pauseSlot.x + tx * down + nx * lift,
      pauseSlot.y + ty * down + ny * lift,
      pauseSlot.z + tz * down + nz * lift,
      LABEL_SCREEN_SCALE * (pauseHovered || prodPaused ? 1.05 : 1),
      opacity,
    );
  }

  function redrawCancelLabel() {
    if (!cancelLabel || !cancelSlot || !open) {
      hideLabel(cancelLabel);
      return;
    }
    const down = LABEL_DOWN * hudScale;
    const lift = LABEL_LIFT * hudScale;
    const dull = !utilityAvailable.cancel;
    if (cancelLabel.dull !== dull) {
      updateDefaultTextData(
        cancelLabel.data,
        cancelLabel.text,
        dull ? DULL_TEXT_COLOR : CANCEL_LABEL_TEXT_COLOR,
      );
      cancelLabel.dull = dull;
    }
    const opacity = dull
      ? 0.82
      : cancelHovered || armed === 'cancel'
        ? 1
        : 0.88;
    placeScreenText(
      cancelLabel,
      cancelSlot.x + tx * down + nx * lift,
      cancelSlot.y + ty * down + ny * lift,
      cancelSlot.z + tz * down + nz * lift,
      LABEL_SCREEN_SCALE * (cancelHovered || armed === 'cancel' ? 1.05 : 1),
      opacity,
    );
  }

  function layoutRings(s) {
    hideArcRings();
    for (const side of [
      { id: /** @type {const} */ ('unit'), arc: arcs.units },
      { id: /** @type {const} */ ('upgrade'), arc: arcs.upgrades },
      { id: /** @type {const} */ ('pause'), arc: arcs.pause },
      { id: /** @type {const} */ ('cancel'), arc: arcs.cancel },
    ]) {
      if (!side.arc) {
        const entry = arcRings.get(side.id);
        if (entry?.mesh) hideMesh(entry.mesh);
        continue;
      }
      const start = side.arc.start;
      const end = side.arc.start + side.arc.span;
      const entry = ensureArcMesh(side.id, start, end);
      if (!entry?.mesh) continue;
      placeMeshOriented(
        entry.mesh,
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
    }
    applyCancelPadAppearance();
    applyPausePadAppearance();
  }

  function layout() {
    const s = hudScale;
    layoutRings(s);

    const rimR = RIM_R * s;
    const padLift = PAD_LIFT * s;
    const n = slots.length;
    for (let i = 0; i < pads.length; i++) {
      if (i >= n) {
        hideMesh(pads[i].mesh);
        disposeProgressMesh(progressPads[i]);
        applyPadHover(i, false);
        hideLabel(labels[i]);
        hideLabel(prices[i]);
        hideLabel(badges[i]);
        continue;
      }
      const slot = slots[i];
      const ca = Math.cos(slot.ang);
      const sa = Math.sin(slot.ang);
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
      redrawPrice(i);
      redrawBadge(i);
    }

    if (pauseSlot && arcs.pause) {
      const ca = Math.cos(pauseSlot.ang);
      const sa = Math.sin(pauseSlot.ang);
      pauseSlot.x = centerX + (ca * bx + sa * tx) * rimR + nx * padLift;
      pauseSlot.y = centerY + (ca * by + sa * ty) * rimR + ny * padLift;
      pauseSlot.z = centerZ + (ca * bz + sa * tz) * rimR + nz * padLift;
      placeMeshOriented(
        pausePadMesh,
        pauseSlot.x,
        pauseSlot.y,
        pauseSlot.z,
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
      const barLift = PAUSE_BAR_LIFT * s;
      placeMeshOriented(
        pauseBarsMesh,
        pauseSlot.x + nx * barLift,
        pauseSlot.y + ny * barLift,
        pauseSlot.z + nz * barLift,
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
      applyPausePadAppearance();
      redrawPauseLabel();
    } else {
      hideMesh(pausePadMesh);
      hideMesh(pauseBarsMesh);
      hideLabel(pauseLabel);
    }

    if (cancelSlot && arcs.cancel) {
      const ca = Math.cos(cancelSlot.ang);
      const sa = Math.sin(cancelSlot.ang);
      cancelSlot.x = centerX + (ca * bx + sa * tx) * rimR + nx * padLift;
      cancelSlot.y = centerY + (ca * by + sa * ty) * rimR + ny * padLift;
      cancelSlot.z = centerZ + (ca * bz + sa * tz) * rimR + nz * padLift;
      placeMeshOriented(
        cancelPadMesh,
        cancelSlot.x,
        cancelSlot.y,
        cancelSlot.z,
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
      // Rotate right/tangent in the pad plane so the bar reads as 🚫.
      const sc = Math.cos(CANCEL_SLASH_ANG);
      const ss = Math.sin(CANCEL_SLASH_ANG);
      const srx = bx * sc + tx * ss;
      const sry = by * sc + ty * ss;
      const srz = bz * sc + tz * ss;
      const stx = -bx * ss + tx * sc;
      const sty = -by * ss + ty * sc;
      const stz = -bz * ss + tz * sc;
      const slashLift = CANCEL_SLASH_LIFT * s;
      placeMeshOriented(
        cancelSlashMesh,
        cancelSlot.x + nx * slashLift,
        cancelSlot.y + ny * slashLift,
        cancelSlot.z + nz * slashLift,
        PAD_OUTER * s,
        srx,
        sry,
        srz,
        nx,
        ny,
        nz,
        stx,
        sty,
        stz,
      );
      applyCancelPadAppearance();
      redrawCancelLabel();
    } else {
      hideMesh(cancelPadMesh);
      hideMesh(cancelSlashMesh);
      hideLabel(cancelLabel);
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {string} buildingType
   * @param {object | null} [camera]
   */
  function showAt(x, z, buildingType, camera = null) {
    const menu = getBuildingMenu(buildingType);
    if (!menu) {
      hide();
      return;
    }
    anchorX = x;
    anchorZ = z;
    activeBuildingType = buildingType;
    hoverIndex = -1;
    cancelHovered = false;
    pauseHovered = false;
    armed = null;
    prodPaused = false;
    tracks.clear();
    utilityAvailable = {
      pause: false,
      cancel: false,
    };
    syncPose(camera);
    rebuildSlots(menu);
    open = true;
    layout();
    const want = buildingType;
    void ensureMenuIcons(menu).then(() => {
      if (open && activeBuildingType === want) {
        rebuildSlots(getBuildingMenu(want));
        layout();
      }
    });
  }

  function update(camera) {
    if (!open) return;
    syncPose(camera);
    layout();
  }

  function hide() {
    hideArcRings();
    for (let i = 0; i < pads.length; i++) {
      hideMesh(pads[i].mesh);
      applyPadHover(i, false);
    }
    hideMesh(cancelPadMesh);
    hideMesh(cancelSlashMesh);
    hideMesh(pausePadMesh);
    hideMesh(pauseBarsMesh);
    hideAllProgress();
    hideAllIcons();
    for (const label of labels) hideLabel(label);
    for (const price of prices) hideLabel(price);
    for (const badge of badges) hideLabel(badge);
    hideLabel(cancelLabel);
    hideLabel(pauseLabel);
    slots = [];
    cancelSlot = null;
    pauseSlot = null;
    arcs = { units: null, upgrades: null, pause: null, cancel: null };
    hoverIndex = -1;
    cancelHovered = false;
    pauseHovered = false;
    armed = null;
    prodPaused = false;
    tracks.clear();
    activeBuildingType = null;
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
      const prevSlot = slots[prev];
      if (prevSlot?.iconKey) applyIconHover(prevSlot.iconKey, false);
      applyPadHover(prev, false);
      redrawLabel(prev);
      redrawBadge(prev);
    }
    if (hoverIndex >= 0) {
      const slot = slots[hoverIndex];
      if (slot?.iconKey) applyIconHover(slot.iconKey, true);
      applyPadHover(hoverIndex, true);
      redrawLabel(hoverIndex);
      redrawBadge(hoverIndex);
    }
  }

  function setUtilityHover(kind) {
    const nextPause = kind === 'pause';
    const nextCancel = kind === 'cancel';
    if (pauseHovered !== nextPause) {
      pauseHovered = nextPause;
      applyPausePadAppearance();
      redrawPauseLabel();
    }
    if (cancelHovered !== nextCancel) {
      cancelHovered = nextCancel;
      applyCancelPadAppearance();
      redrawCancelLabel();
    }
  }

  function clearHover() {
    setHover(-1);
    setUtilityHover(null);
  }

  /**
   * @param {{ kind: string, id?: string } | null | undefined} pick
   */
  function setHoverFromPick(pick) {
    if (!pick) {
      clearHover();
      return;
    }
    if (pick.kind === 'cancel' || pick.kind === 'pause') {
      setHover(-1);
      setUtilityHover(pick.kind);
      return;
    }
    setUtilityHover(null);
    setHover(
      slots.findIndex((s) => s.kind === pick.kind && s.id === pick.id),
    );
  }

  function padPlanePoint() {
    const lift = PAD_LIFT * hudScale;
    return {
      x: centerX + nx * lift,
      y: centerY + ny * lift,
      z: centerZ + nz * lift,
    };
  }

  function wrapAngFrom(ang, start) {
    let a = ang;
    while (a < start) a += Math.PI * 2;
    while (a >= start + Math.PI * 2) a -= Math.PI * 2;
    return a;
  }

  function arcContainsAng(arc, ang, edgeInsetAng) {
    if (!arc) return false;
    const a = wrapAngFrom(ang, arc.start);
    return a >= arc.start + edgeInsetAng && a < arc.start + arc.span - edgeInsetAng;
  }

  /**
   * Visible colored ring band only — not the empty pie inside.
   * @param {{ x: number, y: number, z: number, t: number }} hit
   */
  function pickVisibleArcAtPlaneHit(hit) {
    const d = Math.hypot(hit.x - centerX, hit.y - centerY, hit.z - centerZ);
    const outer = MENU_RING_OUTER * hudScale;
    const inner = MENU_RING_INNER * hudScale;
    if (d < inner || d > outer) return null;
    const dx = hit.x - centerX;
    const dy = hit.y - centerY;
    const dz = hit.z - centerZ;
    const ang = Math.atan2(dx * tx + dy * ty + dz * tz, dx * bx + dy * by + dz * bz);
    const edgeInsetAng = Math.asin(
      Math.min(0.95, (ARC_GAP * 0.5 * hudScale) / Math.max(d, 1e-4)),
    );
    if (arcContainsAng(arcs.pause, ang, edgeInsetAng)) {
      return { kind: /** @type {const} */ ('pause') };
    }
    if (arcContainsAng(arcs.cancel, ang, edgeInsetAng)) {
      return { kind: /** @type {const} */ ('cancel') };
    }
    const kind = arcContainsAng(arcs.units, ang, edgeInsetAng)
      ? 'unit'
      : arcContainsAng(arcs.upgrades, ang, edgeInsetAng)
        ? 'upgrade'
        : null;
    if (!kind) return null;
    let best = null;
    let bestDa = Infinity;
    for (const s of slots) {
      if (s.kind !== kind) continue;
      let da = Math.abs(ang - s.ang);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < bestDa) {
        bestDa = da;
        best = { kind: s.kind, id: s.id };
      }
    }
    return best;
  }

  /**
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   * @returns {{ kind: 'unit' | 'upgrade' | 'pause' | 'cancel', id?: string } | null}
   */
  function pickOptionAtRay(ray) {
    if (!open || !ray) return null;

    const pp = padPlanePoint();
    const padHit = rayHitPlane(ray, pp.x, pp.y, pp.z, nx, ny, nz);
    const padR = PAD_OUTER * hudScale;
    const padR2 = padR * padR;
    const iconR = ICON_PICK_R * hudScale;
    const iconLift = ICON_LIFT * hudScale;

    let best = null;
    let bestT = Infinity;

    if (pauseSlot && padHit) {
      const dx = padHit.x - pauseSlot.x;
      const dy = padHit.y - pauseSlot.y;
      const dz = padHit.z - pauseSlot.z;
      if (dx * dx + dy * dy + dz * dz <= padR2 && padHit.t < bestT) {
        bestT = padHit.t;
        best = { kind: /** @type {const} */ ('pause') };
      }
    }
    if (cancelSlot && padHit) {
      const dx = padHit.x - cancelSlot.x;
      const dy = padHit.y - cancelSlot.y;
      const dz = padHit.z - cancelSlot.z;
      if (dx * dx + dy * dy + dz * dz <= padR2 && padHit.t < bestT) {
        bestT = padHit.t;
        best = { kind: /** @type {const} */ ('cancel') };
      }
    }

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (padHit) {
        const dx = padHit.x - s.x;
        const dy = padHit.y - s.y;
        const dz = padHit.z - s.z;
        if (dx * dx + dy * dy + dz * dz <= padR2 && padHit.t < bestT) {
          bestT = padHit.t;
          best = { kind: s.kind, id: s.id };
        }
      }
      const ix = s.x + nx * iconLift;
      const iy = s.y + ny * iconLift;
      const iz = s.z + nz * iconLift;
      const iconT = rayHitSphereT(ray, ix, iy, iz, iconR);
      if (iconT != null && iconT < bestT) {
        bestT = iconT;
        best = { kind: s.kind, id: s.id };
      }
    }
    if (best) return best;

    const planeHit = rayHitPlane(ray, centerX, centerY, centerZ, nx, ny, nz);
    return planeHit ? pickVisibleArcAtPlaneHit(planeHit) : null;
  }

  function hitHubHoleAtRay() {
    // Empty yard inside the ring is world (terrain / building), not a hub disc.
    return false;
  }

  function hitAtRay(ray) {
    return !!pickOptionAtRay(ray);
  }

  /**
   * @param {{ cancel?: boolean, pause?: boolean }} avail
   */
  function setUtilityAvailability(avail) {
    if (avail.cancel != null) utilityAvailable.cancel = Boolean(avail.cancel);
    if (avail.pause != null) utilityAvailable.pause = Boolean(avail.pause);
    if (avail.cancel == null && avail.pause == null) syncCancelAvailability();
    if (open) {
      applyCancelPadAppearance();
      applyPausePadAppearance();
      redrawCancelLabel();
      redrawPauseLabel();
    }
  }

  /** @param {boolean} on */
  function setPaused(on) {
    const next = Boolean(on);
    if (prodPaused === next) return;
    prodPaused = next;
    if (open) {
      applyPausePadAppearance();
      redrawPauseLabel();
    }
  }

  /**
   * @param {Iterable<string> | Record<string, boolean> | null | undefined} ids
   */
  function setResearchedUpgrades(ids) {
    researchedUpgrades.clear();
    if (ids) {
      if (Array.isArray(ids) || ids instanceof Set) {
        for (const id of ids) if (id) researchedUpgrades.add(String(id));
      } else {
        for (const [id, on] of Object.entries(ids)) {
          if (on) researchedUpgrades.add(id);
        }
      }
    }
    if (open) layout();
  }

  /**
   * @param {Record<string, { progress?: number, count?: number }> | Map<string, { progress?: number, count?: number }>} next
   */
  function setTrackDisplay(next) {
    tracks.clear();
    const entries =
      next instanceof Map ? next.entries() : Object.entries(next ?? {});
    for (const [key, val] of entries) {
      if (!val) continue;
      tracks.set(key, {
        progress: Math.max(0, Math.min(1, Number(val.progress) || 0)),
        count: Math.max(0, val.count | 0),
      });
    }
    syncCancelAvailability();
    if (open) layout();
  }

  /** @param {ArmedId} id */
  function setArmed(id) {
    armed = id ?? null;
    if (open) {
      applyCancelPadAppearance();
      redrawCancelLabel();
    }
  }

  function clearTracks() {
    tracks.clear();
    syncCancelAvailability();
    armed = armed === 'cancel' ? null : armed;
    if (open) layout();
  }

  function getTracks() {
    /** @type {Record<string, { progress: number, count: number }>} */
    const out = {};
    for (const [k, v] of tracks) out[k] = { ...v };
    return out;
  }

  function getArmed() {
    return armed;
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
    for (const label of labels) disposeDefaultTextData(label.data);
    for (const price of prices) disposeDefaultTextData(price.data);
    for (const badge of badges) disposeDefaultTextData(badge.data);
    if (cancelLabel) disposeDefaultTextData(cancelLabel.data);
    if (pauseLabel) disposeDefaultTextData(pauseLabel.data);
    hideAllProgress();
  }

  return {
    showAt,
    update,
    hide,
    isOpen,
    setHover,
    setHoverFromPick,
    clearHover,
    pickOptionAtRay,
    hitAtRay,
    hitHubHoleAtRay,
    setUtilityAvailability,
    setPaused,
    setResearchedUpgrades,
    setMenuGate,
    setTrackDisplay,
    setArmed,
    clearTracks,
    getTracks,
    getArmed,
    registerLabels,
    disposeLabels,
    get buildingType() {
      return activeBuildingType;
    },
    get center() {
      return open ? { x: centerX, y: centerY, z: centerZ } : null;
    },
    get scale() {
      return hudScale;
    },
  };
}
