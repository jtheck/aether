// Skinny ground ring at the agora occupation radius. Shrinks as capture advances;
// color follows lock (owner → gray) and tug (gray → capturer). Display radius
// eases toward the meter in smoothed steps.

import {
  addToScene,
  createStandardMaterial,
  createTorus,
  invalidateRenderBundles,
  markMaterialUboDirty,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';
import * as fx from '../sim/fixed.js';
import { AGORA_OCCUPATION_RADIUS, AGORA_PHASE_TUG, agoraOverlayActive } from '../sim/agora.js';
import { AGORA_NEUTRAL_RGB, AGORA_SEG_COUNT, agoraMeterState } from './healthBars.js';
import { MODEL_BASE_SCALE } from './modelScale.js';
import { ownerTint } from './ownerTints.js';

export const AGORA_CAPTURE_RING_R_MAX = fx.toFloat(AGORA_OCCUPATION_RADIUS);
/** Legacy shrink curve — full pad at 0, tight at 1. */
export const AGORA_CAPTURE_RING_SHRINK = 0.82;
export const AGORA_CAPTURE_RING_MIN_FRAC = 0.13;
/** Torus tube thickness in world units (scales with the ring). */
export const AGORA_CAPTURE_RING_THICK = 0.82;
export const AGORA_CAPTURE_RING_LIFT = 0.52;
/** Ease display progress toward the sim meter (1/s). */
export const AGORA_CAPTURE_RING_SMOOTH = 14;
/** World size vs sim radius (legacy ring lived under the scaled agora mesh). */
export const AGORA_CAPTURE_RING_VISUAL_MUL = MODEL_BASE_SCALE * 2;

const MAX_RINGS = 8;
const TORUS_TESSELATION = 40;
/** Lay the torus in the XZ plane (legacy rotation.x = π/2). */
const TORUS_FLAT_QX = Math.sqrt(0.5);
const TORUS_FLAT_QW = Math.sqrt(0.5);

function lerp3(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

/** 0..1 target from milestone segments (same steps as the health dots). */
export function agoraCaptureRingTargetProgress(state = {}) {
  const { filled, frac } = agoraMeterState(state);
  const n = Math.max(1, AGORA_SEG_COUNT | 0);
  return Math.min(1, Math.max(0, (filled + frac) / n));
}

export function agoraCaptureRingRadiusAtProgress(p01) {
  const p = Math.max(0, Math.min(1, p01));
  const shrink = AGORA_CAPTURE_RING_SHRINK * p;
  return Math.max(
    AGORA_CAPTURE_RING_R_MAX * AGORA_CAPTURE_RING_MIN_FRAC,
    AGORA_CAPTURE_RING_R_MAX * (1 - shrink),
  );
}

export function agoraCaptureRingRgb(state = {}) {
  const ownerRgb = ownerTint(state.owner | 0);
  const neutral = AGORA_NEUTRAL_RGB;
  const cap = (state.capturer | 0) >= 0 ? ownerTint(state.capturer | 0) : neutral;
  const p = agoraCaptureRingTargetProgress(state);
  if ((state.phase | 0) === AGORA_PHASE_TUG) return lerp3(neutral, cap, p);
  return lerp3(ownerRgb, neutral, p);
}

export function agoraCaptureRingAlpha(state = {}, nowMs = 0) {
  const p = agoraCaptureRingTargetProgress(state);
  const contested = (state.contested | 0) !== 0;
  if (contested) {
    const pulse = 0.55 + 0.45 * Math.sin(nowMs * 0.005);
    return 0.38 + 0.28 * pulse;
  }
  return 0.42 + 0.38 * p;
}

function ringWorldRadius(r) {
  return r * AGORA_CAPTURE_RING_VISUAL_MUL;
}

function ringWorldDiameter(r) {
  const mul = AGORA_CAPTURE_RING_VISUAL_MUL;
  return 2 * ringWorldRadius(r) + AGORA_CAPTURE_RING_THICK * mul;
}

function unitTorusThickness() {
  const refD = ringWorldDiameter(AGORA_CAPTURE_RING_R_MAX);
  return AGORA_CAPTURE_RING_THICK * AGORA_CAPTURE_RING_VISUAL_MUL / refD;
}

function createRingMaterial() {
  const mat = createStandardMaterial();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.52;
  if ('unlit' in mat) mat.unlit = true;
  return mat;
}

function applyRingMaterial(mat, state, nowMs) {
  const rgb = agoraCaptureRingRgb(state);
  const contested = (state.contested | 0) !== 0;
  const pulse = contested ? 0.55 + 0.45 * Math.sin(nowMs * 0.005) : 1;
  const em = 0.42 + 0.35 * pulse;
  mat.emissiveColor = [rgb[0] * em, rgb[1] * em, rgb[2] * em];
  mat.diffuseColor = [rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.55];
  mat.alpha = agoraCaptureRingAlpha(state, nowMs);
  markMaterialUboDirty(mat);
}

function placeFlatTorus(mesh, x, y, z, scale) {
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
  mesh.markLocalDirty?.();
}

function hideTorus(mesh) {
  setSubtreeVisible(mesh, false);
}

function ringKey(a) {
  return `${(a.x * 100 + 0.5) | 0},${(a.z * 100 + 0.5) | 0}`;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createAgoraCaptureRings(engine, scene, groundYAt) {
  /** @type {{ mesh: object, material: object }[]} */
  const slots = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const mesh = createTorus(engine, {
      diameter: 1,
      thickness: unitTorusThickness(),
      tessellation: TORUS_TESSELATION,
    });
    const rq = mesh.rotationQuaternion;
    if (rq) {
      if (typeof rq.set === 'function') rq.set(TORUS_FLAT_QX, 0, 0, TORUS_FLAT_QW);
      else {
        rq.x = TORUS_FLAT_QX;
        rq.y = 0;
        rq.z = 0;
        rq.w = TORUS_FLAT_QW;
      }
    }
    mesh.pickable = false;
    mesh.receiveShadows = false;
    mesh.renderOrder = 174;
    const material = createRingMaterial();
    mesh.material = material;
    addToScene(scene, mesh);
    hideTorus(mesh);
    slots.push({ mesh, material });
  }

  /** @type {Map<string, { displayP: number }>} */
  const smooth = new Map();

  function clear() {
    smooth.clear();
    for (let i = 0; i < slots.length; i++) hideTorus(slots[i].mesh);
  }

  /**
   * @param {object[] | null | undefined} agoras
   * @param {number} deltaMs
   * @param {number} [nowMs]
   */
  function sync(agoras, deltaMs, nowMs = performance.now()) {
    const list = agoras ?? [];
    const seen = new Set();
    /** @type {{ state: object, displayP: number }[]} */
    const active = [];
    const dt = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 16) / 1000;
    const ease = 1 - Math.exp(-AGORA_CAPTURE_RING_SMOOTH * dt);

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!agoraOverlayActive(a)) continue;
      const key = ringKey(a);
      seen.add(key);
      let rec = smooth.get(key);
      const targetP = agoraCaptureRingTargetProgress(a);
      if (!rec) {
        rec = { displayP: targetP };
        smooth.set(key, rec);
      } else {
        rec.displayP += (targetP - rec.displayP) * ease;
      }
      active.push({ state: a, displayP: rec.displayP });
    }

    for (const key of smooth.keys()) {
      if (!seen.has(key)) smooth.delete(key);
    }

    active.sort((a, b) => ringKey(a.state).localeCompare(ringKey(b.state)));

    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      const item = active[s];
      if (!item) {
        hideTorus(slot.mesh);
        continue;
      }
      const { state, displayP } = item;
      const radius = agoraCaptureRingRadiusAtProgress(displayP);
      const worldD = ringWorldDiameter(radius);
      const gy = groundYAt(state.x, state.z) || 0;
      placeFlatTorus(slot.mesh, state.x, gy + AGORA_CAPTURE_RING_LIFT, state.z, worldD);
      applyRingMaterial(slot.material, state, nowMs);
      setSubtreeVisible(slot.mesh, true);
    }
    invalidateRenderBundles(engine);
  }

  return { sync, clear, commit() {} };
}
