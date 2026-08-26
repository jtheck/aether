// Thin-instanced mushroom clusters for Spore Bloom seed previews.
// Appear on pending growth tiles; linger and shrink while trees grow over them.

import {
  addToScene,
  flushThinInstances,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { capacityFor } from '../sim/capacity.js';

const MUSHROOM_MODEL_URL = '/assets/models/mushroom.glb';
/** Initial mushroom instance budget; grows by powers of two. */
const MUSHROOM_INITIAL = 256;
/** Per-tile cluster size (matches v1 preview density). */
const CLUSTER_COUNT = 9;
const GROW_IN_MS = 900;
/** Shrink away after sprout while trees grow over them (~tree grow-in). */
const FADE_OUT_MS = 1600;

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
  mesh.visible = count > 0;
}

function hideMatrix(matrices, slot) {
  const o = slot * 16;
  for (let i = 0; i < 16; i++) matrices[o + i] = 0;
}

function writeMatrix(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sc = scale;
  matrices[o] = c * sc;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sc;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * sc;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

/** Deterministic cluster offsets (world units around tile center). */
function clusterLayout(count, seed) {
  const base = [
    { x: -0.55, z: -0.1 },
    { x: 0.18, z: -0.42 },
    { x: 0.5, z: 0.14 },
    { x: -0.12, z: 0.45 },
    { x: -0.38, z: 0.28 },
    { x: 0.32, z: 0.38 },
    { x: 0.05, z: -0.05 },
    { x: -0.48, z: -0.36 },
    { x: 0.42, z: -0.22 },
  ];
  const n = Math.max(1, Math.min(base.length, count));
  const out = [];
  for (let i = 0; i < n; i++) {
    const mixed = ((seed + i * 2654435761) >>> 0);
    const jx = ((mixed & 1023) / 1023 - 0.5) * 0.18;
    const jz = (((mixed >>> 10) & 1023) / 1023 - 0.5) * 0.18;
    const yaw = ((mixed >>> 20) % 628) / 100;
    out.push({
      x: base[i].x * 1.4 + jx,
      z: base[i].z * 1.4 + jz,
      yaw,
      scale: 1,
    });
  }
  return out;
}

function tileSeed(x, z) {
  return (
    (Math.round(x * 10) * 92821) ^
    (Math.round(z * 10) * 68917)
  ) >>> 0;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createMushroomPreviews(engine, scene, groundYAt) {
  /** @type {{ mesh: object, matrices: Float32Array }[]} */
  const batches = [];
  let capacity = MUSHROOM_INITIAL;
  try {
    const parts = await loadBakedUnitMeshParts(engine, MUSHROOM_MODEL_URL);
    for (let p = 0; p < parts.length; p++) {
      const mesh = parts[p];
      mesh.pickable = false;
      const matrices = new Float32Array(capacity * 16);
      setThinInstances(mesh, matrices, capacity);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      batches.push({ mesh, matrices });
    }
  } catch (err) {
    console.warn('[mushrooms] mushroom.glb failed', err);
    return {
      spawnCluster() { return false; },
      spawnHead() { return false; },
      noteHeadPose() {},
      clearGrown() {},
      clear() {},
      update() {},
      commit() {},
    };
  }

  const freeSlots = [];
  for (let i = capacity - 1; i >= 0; i--) freeSlots.push(i);

  /**
   * @type {Map<string, {
   *   x: number, z: number, growAtTick: number,
   *   growT: number, shrinkT: number,
   *   instances: Array<{ slot: number, ox: number, oz: number, yaw: number, scale: number }>
   * }>}
   */
  const clusters = new Map();
  /**
   * @type {Map<number, {
   *   x: number, y: number, z: number,
   *   growT: number, shrinkT: number, age: number, killed: boolean,
   *   slot: number, yaw: number, scale: number,
   * }>}
   */
  const heads = new Map();
  const HEAD_GROW_MS = 380;
  const HEAD_LIVE_HOLD_MS = 720;
  const HEAD_LIVE_FADE_MS = 560;
  const HEAD_KILL_HOLD_MS = 1650;
  const HEAD_KILL_FADE_MS = 900;
  let dirty = true;
  let simTick = 0;
  let previousDraw = 0;

  function keyOf(x, z) {
    return `${x.toFixed(2)},${z.toFixed(2)}`;
  }

  function ensureCapacity(needed) {
    if (needed <= capacity) return;
    const cap = capacityFor(needed, { initial: MUSHROOM_INITIAL });
    for (const batch of batches) {
      const matrices = new Float32Array(cap * 16);
      setThinInstances(batch.mesh, matrices, cap);
      batch.matrices = matrices;
    }
    for (let i = capacity; i < cap; i++) freeSlots.push(i);
    capacity = cap;
  }

  function releaseCluster(cluster) {
    for (let i = 0; i < cluster.instances.length; i++) {
      freeSlots.push(cluster.instances[i].slot);
    }
    cluster.instances.length = 0;
  }

  function spawnCluster(x, z, growAtTick) {
    const key = keyOf(x, z);
    const existing = clusters.get(key);
    if (existing) {
      existing.growAtTick = growAtTick | 0;
      return true;
    }
    const layout = clusterLayout(CLUSTER_COUNT, tileSeed(x, z));
    ensureCapacity(capacity - freeSlots.length + layout.length);
    const instances = [];
    for (let i = 0; i < layout.length; i++) {
      if (freeSlots.length === 0) {
        ensureCapacity(capacity + layout.length - i);
      }
      if (freeSlots.length === 0) break;
      const slot = freeSlots.pop();
      instances.push({
        slot,
        ox: layout[i].x,
        oz: layout[i].z,
        yaw: layout[i].yaw,
        scale: layout[i].scale,
      });
    }
    if (instances.length === 0) return false;
    clusters.set(key, {
      x,
      z,
      growAtTick: growAtTick | 0,
      growT: 0,
      shrinkT: 0,
      instances,
    });
    dirty = true;
    return true;
  }

  function allocSlot() {
    if (freeSlots.length === 0) ensureCapacity(capacity + 8);
    return freeSlots.length ? freeSlots.pop() : -1;
  }

  function spawnHead(entity, x, z, killed) {
    const id = entity | 0;
    const existing = heads.get(id);
    if (existing) {
      existing.growT = Math.min(existing.growT, 0.2);
      existing.shrinkT = 0;
      existing.age = 0;
      existing.killed = existing.killed || !!killed;
      existing.x = x;
      existing.z = z;
      dirty = true;
      return true;
    }
    const slot = allocSlot();
    if (slot < 0) return false;
    const mixed = (id * 2654435761) >>> 0;
    heads.set(id, {
      x,
      y: groundYAt(x, z) + 2.15,
      z,
      growT: 0,
      shrinkT: 0,
      age: 0,
      killed: !!killed,
      slot,
      yaw: ((mixed % 628) / 100),
      scale: killed ? 1.7 : 1.35,
    });
    dirty = true;
    return true;
  }

  function noteHeadPose(entity, x, y, z) {
    const h = heads.get(entity | 0);
    if (!h) return;
    h.x = x;
    h.y = y;
    h.z = z;
    dirty = true;
  }

  function releaseHead(h) {
    freeSlots.push(h.slot);
  }

  function clearGrown(tick) {
    if (Number.isFinite(tick)) simTick = tick;
  }

  function rebuild() {
    // Pack live mushrooms densely into 0..drawCount-1 (Lite draws by count).
    let needed = 0;
    for (const c of clusters.values()) {
      const growEase = 1 - (1 - Math.min(1, c.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, c.shrinkT)) ** 3;
      const size = (0.2 + 0.8 * growEase) * (1 - shrinkEase);
      if (size > 0.001) needed += c.instances.length;
    }
    for (const h of heads.values()) {
      const growEase = 1 - (1 - Math.min(1, h.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, h.shrinkT)) ** 3;
      if ((0.15 + 0.85 * growEase) * (1 - shrinkEase) > 0.001) needed += 1;
    }
    ensureCapacity(needed);

    let drawCount = 0;
    for (const c of clusters.values()) {
      const gy = groundYAt(c.x, c.z);
      const growEase = 1 - (1 - Math.min(1, c.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, c.shrinkT)) ** 3;
      const size = (0.2 + 0.8 * growEase) * (1 - shrinkEase);
      if (size <= 0.001) continue;
      for (let i = 0; i < c.instances.length; i++) {
        const inst = c.instances[i];
        const scale = inst.scale * size;
        for (let b = 0; b < batches.length; b++) {
          writeMatrix(
            batches[b].matrices,
            drawCount,
            c.x + inst.ox,
            gy,
            c.z + inst.oz,
            inst.yaw,
            scale,
          );
        }
        drawCount++;
      }
    }
    for (const h of heads.values()) {
      const growEase = 1 - (1 - Math.min(1, h.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, h.shrinkT)) ** 3;
      const size = (0.15 + 0.85 * growEase) * (1 - shrinkEase) * h.scale;
      if (size <= 0.001) continue;
      for (let b = 0; b < batches.length; b++) {
        writeMatrix(batches[b].matrices, drawCount, h.x, h.y, h.z, h.yaw, size);
      }
      drawCount++;
    }
    for (let b = 0; b < batches.length; b++) {
      for (let s = drawCount; s < previousDraw; s++) {
        hideMatrix(batches[b].matrices, s);
      }
      setThinInstanceCount(batches[b].mesh, drawCount);
    }
    previousDraw = drawCount;
  }

  function update(deltaMs, tick) {
    if (Number.isFinite(tick)) simTick = tick;
    const dt = Math.min(100, Math.max(0, deltaMs));
    let animating = false;
    for (const [key, c] of clusters) {
      if (c.growT < 1) {
        c.growT = Math.min(1, c.growT + dt / GROW_IN_MS);
        animating = true;
      }
      if (simTick >= c.growAtTick) {
        if (c.shrinkT < 1) {
          c.shrinkT = Math.min(1, c.shrinkT + dt / FADE_OUT_MS);
          animating = true;
        }
        if (c.shrinkT >= 1) {
          releaseCluster(c);
          clusters.delete(key);
          dirty = true;
        }
      }
    }
    for (const [id, h] of heads) {
      h.age += dt;
      if (h.growT < 1) {
        h.growT = Math.min(1, h.growT + dt / HEAD_GROW_MS);
        animating = true;
      }
      const hold = h.killed ? HEAD_KILL_HOLD_MS : HEAD_LIVE_HOLD_MS;
      const fade = h.killed ? HEAD_KILL_FADE_MS : HEAD_LIVE_FADE_MS;
      if (h.age >= hold) {
        if (h.shrinkT < 1) {
          h.shrinkT = Math.min(1, h.shrinkT + dt / fade);
          animating = true;
        }
        if (h.shrinkT >= 1) {
          releaseHead(h);
          heads.delete(id);
          dirty = true;
        }
      }
    }
    if (animating || dirty) {
      rebuild();
      dirty = false;
    }
  }

  function commit() {
    for (let b = 0; b < batches.length; b++) {
      flushThinInstances(batches[b].mesh);
    }
  }

  function clear() {
    for (const c of clusters.values()) releaseCluster(c);
    clusters.clear();
    for (const h of heads.values()) releaseHead(h);
    heads.clear();
    for (let i = 0; i < previousDraw; i++) {
      for (let b = 0; b < batches.length; b++) hideMatrix(batches[b].matrices, i);
    }
    previousDraw = 0;
    for (let b = 0; b < batches.length; b++) {
      setThinInstanceCount(batches[b].mesh, 0);
    }
    dirty = true;
    commit();
  }

  return {
    spawnCluster,
    spawnHead,
    noteHeadPose,
    clearGrown,
    clear,
    update,
    commit,
  };
}
