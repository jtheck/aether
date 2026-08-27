// Thin-instanced plague-of-frogs renderer (frog.glb).
// Sim publishes hop *plans* on phase changes; we lerp hops locally so the
// swarm stays smooth without per-tick worker patches.
// Instance buffers start at FROG_INITIAL_CAPACITY and grow by powers of two.

import {
  addToScene,
  createSphere,
  createStandardMaterial,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import {
  FROG_INITIAL_CAPACITY,
  FROG_PHASE,
} from '../sim/frogs.js';
import { capacityFor } from '../sim/capacity.js';
import { loadBakedUnitMeshParts } from './unitModels.js';

const FROG_MODEL_URL = '/assets/models/frog.glb';
/** Raw glTF scale — no aftermarket resize. */
const FROG_SCALE = 1;
const HOP_ARC_OUT = 3.2;
const HOP_ARC_AWAY = 2.4;
const HOP_ARC_ESCAPE = 2.8;
const BODY_HEIGHT = 0.15;
/** Match sim tick length for local hop playback. */
const TICK_MS = 50;

/**
 * Keep GPU draw count at buffer capacity. Lite records opaque thin-instance
 * draws into render bundles using the first `ti.count`; growing from 0 after
 * that first upload drops later frogs (sparkles still fire from sim pulses).
 * Unused slots stay at a zero matrix, same as unit / pick-hitbox pools.
 */
function pinThinInstanceCapacity(mesh) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  const cap = ti._capacity | 0;
  if (cap > 0 && ti.count !== cap) {
    ti.count = cap;
    ti._version++;
    ti._dirtyMin = 0;
    ti._dirtyMax = cap;
  }
  mesh.visible = true;
}

function capacityForFrogs(needed) {
  return capacityFor(needed, { initial: FROG_INITIAL_CAPACITY });
}

function hideMatrix(matrices, slot) {
  const offset = slot * 16;
  for (let i = 0; i < 16; i++) matrices[offset + i] = 0;
}

/** Y-up instance matrix facing hop direction on XZ. */
function writeMatrix(matrices, slot, x, y, z, faceX, faceZ, scale) {
  const offset = slot * 16;
  let fx = faceX;
  let fz = faceZ;
  let len = Math.hypot(fx, fz);
  if (len < 1e-5) {
    fx = 0;
    fz = 1;
    len = 1;
  } else {
    fx /= len;
    fz /= len;
  }
  // Basis: right = up × forward, up = Y, forward = face.
  const rx = fz;
  const rz = -fx;
  const s = scale;
  matrices[offset] = rx * s;
  matrices[offset + 1] = 0;
  matrices[offset + 2] = rz * s;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = 0;
  matrices[offset + 5] = s;
  matrices[offset + 6] = 0;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = fx * s;
  matrices[offset + 9] = 0;
  matrices[offset + 10] = fz * s;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = x;
  matrices[offset + 13] = y;
  matrices[offset + 14] = z;
  matrices[offset + 15] = 1;
}

function isHoppingPhase(phase) {
  return (
    phase === FROG_PHASE.OUT ||
    phase === FROG_PHASE.AWAY ||
    phase === FROG_PHASE.ESCAPE
  );
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {(x: number, z: number) => void} [onLand]
 */
export async function createFrogRenderer(engine, scene, groundYAt, onLand) {
  /** @type {{ mesh: object, matrices: Float32Array, colors?: Float32Array | null }[]} */
  const batches = [];
  let capacity = FROG_INITIAL_CAPACITY;

  try {
    const parts = await loadBakedUnitMeshParts(engine, FROG_MODEL_URL);
    for (let p = 0; p < parts.length; p++) {
      const mesh = parts[p];
      mesh.pickable = false;
      const matrices = new Float32Array(capacity * 16);
      setThinInstances(mesh, matrices, capacity);
      pinThinInstanceCapacity(mesh);
      addToScene(scene, mesh);
      batches.push({ mesh, matrices, colors: null });
    }
  } catch (err) {
    console.warn('[frogs] frog.glb failed, using sphere fallback', err);
    const mesh = createSphere(engine, { diameter: 1, segments: 8 });
    mesh.pickable = false;
    const material = createStandardMaterial();
    material.diffuseColor = [0.28, 0.72, 0.32];
    material.emissiveColor = [0.08, 0.28, 0.1];
    material.specularColor = [0, 0, 0];
    material.alpha = 0.99;
    material.backFaceCulling = false;
    mesh.material = material;
    const matrices = new Float32Array(capacity * 16);
    const colors = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) {
      colors[i * 4] = 0.3;
      colors[i * 4 + 1] = 0.78;
      colors[i * 4 + 2] = 0.35;
      colors[i * 4 + 3] = 1;
    }
    setThinInstances(mesh, matrices, capacity);
    setThinInstanceColors(mesh, colors);
    pinThinInstanceCapacity(mesh);
    addToScene(scene, mesh);
    batches.push({ mesh, matrices, colors });
  }

  /**
   * @type {Map<number, {
   *   ox: number, oz: number, dx: number, dz: number,
   *   hopProgress: number, hopDuration: number, phase: number,
   *   generation: number, x: number, z: number,
   *   faceX: number, faceZ: number
   * }>}
   */
  const active = new Map();
  let previousCount = 0;
  let dirty = true;
  let hopping = false;

  function ensureCapacity(needed) {
    if (needed <= capacity) return;
    const cap = capacityForFrogs(needed);
    for (const batch of batches) {
      const matrices = new Float32Array(cap * 16);
      setThinInstances(batch.mesh, matrices, cap);
      pinThinInstanceCapacity(batch.mesh);
      batch.matrices = matrices;
      if (batch.colors) {
        const colors = new Float32Array(cap * 4);
        colors.set(batch.colors);
        for (let i = capacity; i < cap; i++) {
          colors[i * 4] = 0.3;
          colors[i * 4 + 1] = 0.78;
          colors[i * 4 + 2] = 0.35;
          colors[i * 4 + 3] = 1;
        }
        setThinInstanceColors(batch.mesh, colors);
        batch.colors = colors;
      }
    }
    capacity = cap;
  }

  function hopHeight(progress, phase) {
    if (phase === FROG_PHASE.WAIT || phase === FROG_PHASE.LINGER) return BODY_HEIGHT;
    const t = Math.max(0, Math.min(1, progress));
    const peak =
      phase === FROG_PHASE.OUT ? HOP_ARC_OUT :
      phase === FROG_PHASE.ESCAPE ? HOP_ARC_ESCAPE :
      HOP_ARC_AWAY;
    return BODY_HEIGHT + 4 * t * (1 - t) * peak;
  }

  function sampleState(state) {
    const hopping = isHoppingPhase(state.phase);
    const t = hopping ? Math.max(0, Math.min(1, state.hopProgress)) : 0;
    const x = hopping ? state.ox + (state.dx - state.ox) * t : state.x;
    const z = hopping ? state.oz + (state.dz - state.oz) * t : state.z;
    return {
      x,
      z,
      yOff: hopHeight(t, state.phase),
      faceX: state.faceX,
      faceZ: state.faceZ,
    };
  }

  /** Keep last hop heading when origin/dest collapse on land. */
  function facingFromHop(ox, oz, dx, dz, prev) {
    const faceX = dx - ox;
    const faceZ = dz - oz;
    if (Math.hypot(faceX, faceZ) >= 1e-5) return { faceX, faceZ };
    return {
      faceX: prev?.faceX ?? 0,
      faceZ: prev?.faceZ ?? 1,
    };
  }

  function rebuild() {
    const n = active.size;
    ensureCapacity(n);
    let count = 0;
    for (const state of active.values()) {
      const pos = sampleState(state);
      const gy = groundYAt(pos.x, pos.z);
      for (let b = 0; b < batches.length; b++) {
        writeMatrix(
          batches[b].matrices,
          count,
          pos.x,
          gy + pos.yOff,
          pos.z,
          pos.faceX,
          pos.faceZ,
          FROG_SCALE,
        );
      }
      count++;
    }
    for (let slot = count; slot < previousCount; slot++) {
      for (let b = 0; b < batches.length; b++) {
        hideMatrix(batches[b].matrices, slot);
      }
    }
    previousCount = count;
    for (let b = 0; b < batches.length; b++) {
      pinThinInstanceCapacity(batches[b].mesh);
    }
  }

  function applyUpdates(updatesList) {
    if (!updatesList?.length) return;
    // Under load, land FX is more expensive than the frogs — throttle hard.
    const landFxBudget = active.size > 400 ? 2 : active.size > 150 ? 6 : 24;
    let landFxLeft = landFxBudget;
    for (let u = 0; u < updatesList.length; u++) {
      const patch = updatesList[u];
      const n = patch?.slots?.length ?? 0;
      for (let i = 0; i < n; i++) {
        const slot = patch.slots[i];
        if (!patch.alive[i]) {
          const cur = active.get(slot);
          if (cur && cur.generation === patch.generation[i]) {
            active.delete(slot);
          }
          if (patch.landPulse?.[i] && landFxLeft > 0) {
            landFxLeft--;
            onLand?.(patch.px[i], patch.py[i]);
          }
          continue;
        }
        const prev = active.get(slot);
        const ox = patch.originX?.[i] ?? patch.px[i];
        const oz = patch.originY?.[i] ?? patch.py[i];
        const dx = patch.destX?.[i] ?? patch.px[i];
        const dz = patch.destY?.[i] ?? patch.py[i];
        const face = facingFromHop(ox, oz, dx, dz, prev);
        active.set(slot, {
          ox,
          oz,
          dx,
          dz,
          x: patch.px[i],
          z: patch.py[i],
          hopProgress: patch.hopProgress[i] ?? 0,
          hopDuration: patch.hopDuration?.[i] || 1,
          phase: patch.phase[i],
          generation: patch.generation[i],
          faceX: face.faceX,
          faceZ: face.faceZ,
        });
        if (patch.landPulse?.[i] && landFxLeft > 0) {
          landFxLeft--;
          onLand?.(patch.px[i], patch.py[i]);
        }
      }
    }
    dirty = true;
  }

  function advance(deltaMs) {
    if (active.size === 0) return;
    const dtTicks = Math.max(0, deltaMs) / TICK_MS;
    hopping = false;
    for (const state of active.values()) {
      if (!isHoppingPhase(state.phase)) continue;
      hopping = true;
      const dur = Math.max(1, state.hopDuration);
      state.hopProgress = Math.min(1, state.hopProgress + dtTicks / dur);
    }
    if (hopping) dirty = true;
  }

  function clear() {
    active.clear();
    hopping = false;
    dirty = true;
  }

  return {
    applyUpdates,
    clear,
    advance,
    activeCount() {
      return active.size;
    },
    sync() {
      return active.size;
    },
    stats() {
      return { active: active.size, capacity };
    },
    commit() {
      if (!dirty && !hopping) return;
      if (dirty || hopping) {
        rebuild();
        dirty = false;
      }
      for (let b = 0; b < batches.length; b++) {
        flushThinInstances(batches[b].mesh);
      }
    },
  };
}
