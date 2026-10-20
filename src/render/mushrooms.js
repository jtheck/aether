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
/** How long a finished spore shot stays findable after its projectile ends. */
export const SPORE_SHOT_HOLD_MS = 700;

/**
 * Archive shots the projectile renderer did not see this frame, and drop
 * archives whose flight ended more than `holdMs` ago.
 * @param {Map<string, { seen: number, ended?: number }>} live
 * @param {{ seen: number, ended?: number }[]} recent
 * @param {number} frame
 * @param {number} now
 * @param {number} [holdMs]
 */
export function retireUnseenSporeShots(live, recent, frame, now, holdMs = SPORE_SHOT_HOLD_MS) {
  for (const [token, shot] of live) {
    if (shot.seen === frame) continue;
    shot.ended = now;
    recent.push(shot);
    live.delete(token);
  }
  const keep = now - holdMs;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].ended < keep) recent.splice(i, 1);
  }
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
      spawnAttackLine() { return 0; },
      beginSporePaths() {},
      noteSporePath() {},
      endSporePaths() {},
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
   * Attack sprouts follow a host. One hit used to reuse a single head-slot;
   * now each hit plants a new shroom at a random body offset.
   * @type {Array<{
   *   entity: number,
   *   ox: number, oy: number, oz: number,
   *   x: number, y: number, z: number,
   *   growT: number, shrinkT: number, age: number, killed: boolean,
   *   slot: number, yaw: number, scale: number,
   * }>}
   */
  const heads = [];
  /**
   * Ground mushrooms that pop up and sink back along a myco shot.
   * @type {Array<{
   *   x: number, z: number, yaw: number, scale: number,
   *   startAt: number, growT: number, shrinkT: number, age: number, slot: number,
   * }>}
   */
  const trails = [];
  /** @type {Map<string, { ox: number, oz: number, x: number, z: number, since: number, traveled: number, born: number, zoom: number, seen: number }>} */
  const sporeShots = new Map();
  /** Shots whose projectile already ended, kept so the hit can finish the line. */
  const recentShots = [];
  /** @type {Map<number, { x: number, y: number, z: number, yaw: number, radius: number, height: number }>} */
  const hostPoses = new Map();
  const HEAD_GROW_MS = 220;
  const HEAD_LIVE_HOLD_MS = 980;
  const HEAD_LIVE_FADE_MS = 520;
  const HEAD_KILL_HOLD_MS = 1700;
  const HEAD_KILL_FADE_MS = 900;
  const HEAD_MAX_PER_HOST = 16;
  const DEFAULT_BODY_RADIUS = 1.25;
  const DEFAULT_BODY_HEIGHT = 2.05;
  /** mushroom.glb height at scale 1, so attack sprouts can be sized in world units. */
  const MUSHROOM_MESH_HEIGHT = 0.37;
  const TRAIL_SPACING = 3.4;
  const TRAIL_STAGGER_MS = 67;
  const TRAIL_GROW_MS = 200;
  const TRAIL_HOLD_MS = 120;
  const TRAIL_FADE_MS = 290;
  const TRAIL_MAX = 280;
  let dirty = true;
  let simTick = 0;
  let previousDraw = 0;
  let clockMs = 0;
  let sporeFrame = 0;
  let lineSerial = 0;

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

  function poseWorld(pose, ox, oy, oz) {
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    return {
      x: pose.x + c * ox + s * oz,
      y: pose.y + oy,
      z: pose.z - s * ox + c * oz,
    };
  }

  function applyHostPose(h) {
    const pose = hostPoses.get(h.entity);
    if (!pose) return;
    const w = poseWorld(pose, h.ox, h.oy, h.oz);
    h.x = w.x;
    h.y = w.y;
    h.z = w.z;
  }

  function randomBodyOffset(radius, height, avoid) {
    const r = Math.max(0.45, radius);
    const h = Math.max(0.8, height);
    let best = null;
    let bestSep = -1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      // Area-uniform in the footprint, kept off the exact spine.
      const rad = r * Math.sqrt(0.15 + Math.random() * 0.85);
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      const oy = h * (0.02 + Math.random() * 0.62);
      let sep = 99;
      for (let i = 0; i < avoid.length; i++) {
        const a = avoid[i];
        const dx = ox - a.ox;
        const dy = oy - a.oy;
        const dz = oz - a.oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < sep) sep = d;
      }
      if (sep > bestSep) {
        bestSep = sep;
        best = { ox, oy, oz };
        if (sep > r * 0.45) break;
      }
    }
    return best ?? { ox: r * 0.4, oy: h * 0.55, oz: 0 };
  }

  function hostHeads(entity) {
    const out = [];
    for (let i = 0; i < heads.length; i++) {
      if (heads[i].entity === entity) out.push(heads[i]);
    }
    return out;
  }

  function hostStillHas(entity) {
    for (let i = 0; i < heads.length; i++) {
      if (heads[i].entity === entity) return true;
    }
    return false;
  }

  function expireOldestHostHead(entity) {
    let oldest = -1;
    let oldestAge = -1;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      if (h.entity !== entity) continue;
      if (h.age > oldestAge) {
        oldestAge = h.age;
        oldest = i;
      }
    }
    if (oldest < 0) return;
    releaseHead(heads[oldest]);
    heads.splice(oldest, 1);
  }

  function scaleForHeight(worldHeight) {
    return Math.max(0.2, worldHeight / MUSHROOM_MESH_HEIGHT);
  }

  function placeTrail(x, z, traveled, born, zoom) {
    if (trails.length >= TRAIL_MAX) return;
    const slot = allocSlot();
    if (slot < 0) return;
    const mixed = (
      Math.imul(Math.round(x * 17) + 1, 2654435761) ^
      Math.imul(Math.round(z * 17) + Math.round(traveled * 10) + 1, 1597334677)
    ) >>> 0;
    const jx = ((mixed & 1023) / 1023 - 0.5) * 0.85;
    const jz = (((mixed >>> 10) & 1023) / 1023 - 0.5) * 0.85;
    const worldH = (0.70 + ((mixed >>> 16) % 100) / 100 * 0.32) * (zoom > 0.2 ? zoom : 1.25);
    trails.push({
      x: x + jx,
      z: z + jz,
      yaw: (mixed % 628) / 100,
      scale: scaleForHeight(worldH),
      startAt: born + (traveled / TRAIL_SPACING) * TRAIL_STAGGER_MS,
      growT: 0,
      shrinkT: 0,
      age: 0,
      slot,
    });
    dirty = true;
  }

  function advanceShot(shot, x, z) {
    const dx = x - shot.x;
    const dz = z - shot.z;
    const seg = Math.hypot(dx, dz);
    if (seg < 1e-4) return;
    const ux = dx / seg;
    const uz = dz / seg;
    let at = TRAIL_SPACING - shot.since;
    while (at <= seg + 1e-3) {
      placeTrail(shot.x + ux * at, shot.z + uz * at, shot.traveled + at, shot.born, shot.zoom);
      at += TRAIL_SPACING;
    }
    shot.traveled += seg;
    shot.since += seg;
    while (shot.since >= TRAIL_SPACING) shot.since -= TRAIL_SPACING;
    shot.x = x;
    shot.z = z;
  }

  function considerShot(best, shot, toX, toZ) {
    const td = Math.hypot(shot.x - toX, shot.z - toZ);
    if (td > 10) return best;
    if (!best || td < best.td - 0.5 || (td <= best.td + 0.5 && shot.born > best.shot.born)) {
      return { shot, td };
    }
    return best;
  }

  function findShot(toX, toZ) {
    let best = null;
    for (const shot of sporeShots.values()) best = considerShot(best, shot, toX, toZ);
    for (let i = 0; i < recentShots.length; i++) best = considerShot(best, recentShots[i], toX, toZ);
    return best?.shot ?? null;
  }

  function beginSporePaths() {
    sporeFrame++;
  }

  function noteSporePath(slot, generation, x, z, zoom = 1.25) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const token = `${slot | 0}:${generation >>> 0}`;
    let shot = sporeShots.get(token);
    if (!shot) {
      shot = {
        ox: x,
        oz: z,
        x,
        z,
        since: 0,
        traveled: 0,
        born: clockMs,
        zoom: zoom > 0.2 ? zoom : 1.25,
        seen: sporeFrame,
      };
      sporeShots.set(token, shot);
      placeTrail(x, z, 0, shot.born, shot.zoom);
      return;
    }
    shot.seen = sporeFrame;
    advanceShot(shot, x, z);
  }

  function endSporePaths() {
    retireUnseenSporeShots(sporeShots, recentShots, sporeFrame, clockMs);
  }

  /**
   * Pop a line from the caster to the target. Returns ms until the line
   * reaches the target, so the body cluster can follow it.
   */
  function spawnAttackLine(fromX, fromZ, toX, toZ, zoom = 1.25) {
    if (!Number.isFinite(fromX) || !Number.isFinite(fromZ) || !Number.isFinite(toX) || !Number.isFinite(toZ)) {
      return 0;
    }
    let shot = findShot(toX, toZ);
    if (shot) {
      const at = recentShots.indexOf(shot);
      if (at >= 0) recentShots.splice(at, 1);
    } else {
      const z = zoom > 0.2 ? zoom : 1.25;
      shot = {
        ox: fromX,
        oz: fromZ,
        x: fromX,
        z: fromZ,
        since: 0,
        traveled: 0,
        born: clockMs,
        zoom: z,
        seen: sporeFrame,
      };
      sporeShots.set(`line:${lineSerial++}`, shot);
      placeTrail(fromX, fromZ, 0, shot.born, shot.zoom);
    }
    advanceShot(shot, toX, toZ);
    const dist = Math.hypot(toX - shot.ox, toZ - shot.oz);
    if (shot.since > 0.85) {
      placeTrail(toX, toZ, dist, shot.born, shot.zoom);
      shot.since = 0;
    }
    const arrive = shot.born + (dist / TRAIL_SPACING) * TRAIL_STAGGER_MS;
    return Math.max(0, arrive - clockMs);
  }

  function spawnHead(entity, x, z, killed, body) {
    const id = entity | 0;
    let existing = hostHeads(id);
    if (existing.length >= HEAD_MAX_PER_HOST) {
      expireOldestHostHead(id);
      existing = hostHeads(id);
    }
    const slot = allocSlot();
    if (slot < 0) return false;
    let pose = hostPoses.get(id);
    if (!pose) {
      pose = {
        x,
        y: body?.y ?? groundYAt(x, z),
        z,
        yaw: body?.yaw ?? 0,
        radius: body?.radius ?? DEFAULT_BODY_RADIUS,
        height: body?.height ?? DEFAULT_BODY_HEIGHT,
      };
      hostPoses.set(id, pose);
    }
    const off = randomBodyOffset(pose.radius, pose.height, existing);
    const mixed = (
      Math.imul(id + 1, 2654435761) ^
      Math.imul(heads.length + 1, 1597334677) ^
      (Math.random() * 0xffffffff)
    ) >>> 0;
    const world = poseWorld(pose, off.ox, off.oy, off.oz);
    const h = {
      entity: id,
      ox: off.ox,
      oy: off.oy,
      oz: off.oz,
      x: world.x,
      y: world.y,
      z: world.z,
      growT: 0,
      shrinkT: 0,
      age: 0,
      killed: !!killed,
      slot,
      yaw: ((mixed % 628) / 100),
      scale: scaleForHeight(
        pose.height * (killed ? 0.62 : 0.48) * (0.88 + Math.random() * 0.28),
      ),
    };
    heads.push(h);
    dirty = true;
    return { x: h.x, y: h.y, z: h.z };
  }

  function noteHeadPose(entity, x, y, z, yaw = 0, radius = DEFAULT_BODY_RADIUS, height = DEFAULT_BODY_HEIGHT) {
    const pose = hostPoses.get(entity | 0);
    if (!pose) return;
    pose.x = x;
    pose.y = y;
    pose.z = z;
    pose.yaw = yaw || 0;
    if (radius > 0.1) pose.radius = radius;
    if (height > 0.1) pose.height = height;
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
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const growEase = 1 - (1 - Math.min(1, h.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, h.shrinkT)) ** 3;
      if (growEase * (1 - shrinkEase) > 0.001) needed += 1;
    }
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      const growEase = 1 - (1 - Math.min(1, t.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, t.shrinkT)) ** 3;
      if (growEase * (1 - shrinkEase) > 0.001) needed += 1;
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
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      applyHostPose(h);
      const growEase = 1 - (1 - Math.min(1, h.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, h.shrinkT)) ** 3;
      const size = growEase * (1 - shrinkEase) * h.scale;
      if (size <= 0.001) continue;
      for (let b = 0; b < batches.length; b++) {
        writeMatrix(batches[b].matrices, drawCount, h.x, h.y, h.z, h.yaw, size);
      }
      drawCount++;
    }
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      const growEase = 1 - (1 - Math.min(1, t.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, t.shrinkT)) ** 3;
      const size = growEase * (1 - shrinkEase) * t.scale;
      if (size <= 0.001) continue;
      const gy = groundYAt(t.x, t.z);
      for (let b = 0; b < batches.length; b++) {
        writeMatrix(batches[b].matrices, drawCount, t.x, gy, t.z, t.yaw, size);
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

  function releaseTrail(t) {
    freeSlots.push(t.slot);
  }

  function update(deltaMs, tick) {
    if (Number.isFinite(tick)) simTick = tick;
    const dt = Math.min(100, Math.max(0, deltaMs));
    clockMs += dt;
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
    for (let i = heads.length - 1; i >= 0; i--) {
      const h = heads[i];
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
          const ent = h.entity;
          releaseHead(h);
          heads.splice(i, 1);
          if (!hostStillHas(ent)) hostPoses.delete(ent);
          dirty = true;
        }
      }
    }
    for (let i = trails.length - 1; i >= 0; i--) {
      const t = trails[i];
      const age = clockMs - t.startAt;
      if (age < 0) {
        animating = true;
        continue;
      }
      t.age = age;
      if (t.growT < 1) {
        t.growT = Math.min(1, age / TRAIL_GROW_MS);
        animating = true;
      }
      const holdEnd = TRAIL_GROW_MS + TRAIL_HOLD_MS;
      if (age >= holdEnd) {
        t.shrinkT = Math.min(1, (age - holdEnd) / TRAIL_FADE_MS);
        animating = true;
        if (t.shrinkT >= 1) {
          releaseTrail(t);
          trails.splice(i, 1);
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
    for (let i = 0; i < heads.length; i++) releaseHead(heads[i]);
    heads.length = 0;
    for (let i = 0; i < trails.length; i++) releaseTrail(trails[i]);
    trails.length = 0;
    sporeShots.clear();
    recentShots.length = 0;
    hostPoses.clear();
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
    spawnAttackLine,
    beginSporePaths,
    noteSporePath,
    endSporePaths,
    noteHeadPose,
    clearGrown,
    clear,
    update,
    commit,
  };
}
