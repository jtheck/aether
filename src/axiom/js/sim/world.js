import {
  createStore,
  spawnInBoxSphere,
  spawnClusterInBox,
  randomClusterCenter,
  resizeInBoxSphere,
  boxSphereOverlapFraction,
  packRenderBuffers,
  KIND_POINT,
  KIND_TRIANGLE,
  KIND_PLANE,
  KIND_TETRA,
} from './store.js';
import {
  coordToChunk,
  chunkKey,
  forEachChunkInRadius,
  maxChunksForRadius,
  sphereChunkEquivalent,
  chunkBounds,
} from './chunks.js';
import {
  behaviorCompressionWave,
  behaviorOrbitCluster,
  behaviorSpinSelf,
} from './behaviors.js';

/**
 * Default mix — equal weight per kind so each cube gets the same recipe.
 * Colors: cyan points, yellow tris, white circles, magenta tetras.
 */
export const DEFAULT_FLOCKS = [
  // Heavy on points so spherical compression/rarefaction reads clearly
  { id: 'points', meshKind: KIND_POINT, tint: { r: 0.35, g: 0.95, b: 1 }, weight: 12, baseScale: 1 },
  { id: 'tris', meshKind: KIND_TRIANGLE, tint: { r: 1, g: 0.92, b: 0.18 }, weight: 1, baseScale: 1 },
  { id: 'quads', meshKind: KIND_PLANE, tint: { r: 0.95, g: 0.95, b: 1 }, weight: 1, baseScale: 1, hardCircle: true },
  { id: 'tetras', meshKind: KIND_TETRA, tint: { r: 1, g: 0.25, b: 0.55 }, weight: 1, baseScale: 1 },
];

/** Per-chunk accent counts — circles/tetras spawn as a tight cluster. */
function accentCountFor(def) {
  if (def.meshKind === KIND_PLANE || def.meshKind === KIND_TETRA) return 8;
  if (def.meshKind === KIND_TRIANGLE) return 1;
  return 0;
}

/**
 * Split total across flocks by weight, guaranteeing at least 1 each when total >= flock count.
 * @param {number} total
 * @param {{ weight: number }[]} flocks
 */
function splitByWeight(total, flocks) {
  const n = flocks.length;
  const t = Math.max(0, total | 0);
  if (t <= 0) return flocks.map(() => 0);
  if (t < n) {
    // Prefer earlier flocks when starving
    return flocks.map((_, i) => (i < t ? 1 : 0));
  }
  const sum = flocks.reduce((a, f) => a + f.weight, 0) || 1;
  const counts = flocks.map((f) => Math.max(1, Math.floor((t * f.weight) / sum)));
  let used = counts.reduce((a, b) => a + b, 0);
  // Fix over-allocation from the max(1,…) floor
  while (used > t) {
    let richest = 0;
    for (let i = 1; i < n; i++) {
      if (counts[i] > counts[richest]) richest = i;
    }
    if (counts[richest] <= 1) break;
    counts[richest]--;
    used--;
  }
  let heaviest = 0;
  for (let i = 1; i < n; i++) {
    if (flocks[i].weight > flocks[heaviest].weight) heaviest = i;
  }
  counts[heaviest] += Math.max(0, t - used);
  return counts;
}

/**
 * Chunk-streamed volumetric particle world.
 *
 * Chunks page in a Chebyshev cube. The *visible* volume is a smooth sphere
 * inscribed in that cube; grazing/corner chunks only fill AABB ∩ sphere.
 *
 * @param {object} opts
 * @param {number} [opts.capacity=50000] max live particles (staging / budget)
 * @param {number} [opts.initialCount=15000] high-water live target (store / staging sized for this)
 * @param {number} [opts.startCount] boot live target (default = initialCount)
 * @param {number} [opts.chunkSize=16] world units per cube edge
 * @param {number} [opts.chunkRadius=5] high-water Chebyshev radius in chunks (5 → 11³)
 * @param {number} [opts.startRadius] boot stream radius (default = chunkRadius)
 * @param {number} [opts.cellSize=4] neighbor spatial hash cell size
 * @param {typeof DEFAULT_FLOCKS} [opts.flockDefs]
 */
export function createWorld(opts = {}) {
  const flockDefs = opts.flockDefs ?? DEFAULT_FLOCKS;
  const chunkSize = opts.chunkSize ?? 16;
  /** High-water Chebyshev radius in chunks (staging / store caps sized for this). */
  const radiusMax = opts.chunkRadius ?? 5;
  /** Live stream radius — FPS throttle may grow/shrink this. */
  let chunkRadius = Math.max(1, Math.min(radiusMax, opts.startRadius ?? radiusMax));
  const maxChunks = maxChunksForRadius(radiusMax);
  const fillAtMax = Math.max(1, sphereChunkEquivalent(radiusMax));
  const budget = opts.capacity ?? 50000;
  const highWaterCount = Math.min(budget, opts.initialCount ?? 15000);
  let targetTotal = Math.min(highWaterCount, opts.startCount ?? highWaterCount);
  // Store caps from high-water / *sphere* fill — paging cube is larger than the
  // live volume and must not dilute per-chunk density.
  const highWaterPerChunk = Math.max(
    flockDefs.length,
    Math.floor(highWaterCount / fillAtMax),
  );
  let perChunkTotal = Math.max(
    flockDefs.length,
    Math.floor(targetTotal / Math.max(1, sphereChunkEquivalent(chunkRadius))),
  );

  // High-water caps (store sizing). Mesh accents use a fixed per-chunk recipe and
  // are not resized when the FPS throttle moves the point budget.
  const perChunkCaps = splitByWeight(
    Math.max(highWaterPerChunk, flockDefs.length),
    flockDefs,
  );

  /** @type {Map<string, { cx: number, cy: number, cz: number, bounds: ReturnType<typeof chunkBounds>, stores: Map<string, ReturnType<typeof createStore>> }>} */
  const active = new Map();

  /** @type {Map<string, ReturnType<typeof createStore>[]>} */
  const pools = new Map();
  for (const def of flockDefs) pools.set(def.id, []);

  // Staging buffers for GPU upload (one contiguous SoA per flock)
  const stagingCap = Math.min(budget, maxChunks * (Math.max(...perChunkCaps) + 4) * flockDefs.length);
  // Safer: per-flock staging = maxChunks * that flock's per-chunk cap
  const flocks = flockDefs.map((def, i) => {
    // storeCap stays at the high-water mark so FPS throttle can shrink/grow without realloc.
    const isPoint = def.meshKind === KIND_POINT;
    const accent = accentCountFor(def);
    const storeCap = Math.max(1, isPoint ? perChunkCaps[i] : accent);
    const capacity = Math.min(budget, maxChunks * storeCap);
    return {
      id: def.id,
      meshKind: def.meshKind,
      tint: def.tint,
      weight: def.weight,
      baseScale: def.baseScale ?? 1,
      hardCircle: !!def.hardCircle,
      isPoint,
      cluster: def.meshKind === KIND_PLANE || def.meshKind === KIND_TETRA,
      storeCap,
      // Mesh: fixed accent. Points: filled by setTargetCount.
      chunkCap: storeCap,
      capacity,
      staging: createStore(capacity),
    };
  });

  let time = 0;
  let focus = { x: 0, y: 0, z: 0 };
  let lastChunk = { cx: NaN, cy: NaN, cz: NaN };
  /** Bumps when the active chunk set changes (wireframe / debug consumers). */
  let chunksVersion = 0;

  function acquireStore(flockId) {
    const pool = pools.get(flockId);
    const s = pool.pop();
    if (s) {
      s.count = 0;
      return s;
    }
    const f = flocks.find((x) => x.id === flockId);
    return createStore(f?.storeCap ?? 1);
  }

  function releaseStore(flockId, store) {
    store.count = 0;
    pools.get(flockId).push(store);
  }

  const CLUSTER_SPREAD = 0.14;

  /** Smooth live volume inscribed in the streamed cube of chunks. */
  function volumeSphere() {
    const s = chunkSize;
    const r = (chunkRadius + 0.5) * s;
    return {
      x: (lastChunk.cx + 0.5) * s,
      y: (lastChunk.cy + 0.5) * s,
      z: (lastChunk.cz + 0.5) * s,
      r,
    };
  }

  function fillChunk(ch, sphere) {
    const frac = boxSphereOverlapFraction(ch.bounds, sphere);
    const c = ch.cluster;
    const clusterIn =
      !!c &&
      (c.x - sphere.x) ** 2 + (c.y - sphere.y) ** 2 + (c.z - sphere.z) ** 2 <=
        sphere.r * sphere.r;
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i];
      const store = ch.stores.get(f.id);
      if (!store) continue;
      const cap = Math.min(f.storeCap, f.chunkCap);
      if (f.cluster) {
        if (clusterIn) {
          spawnClusterInBox(store, cap, ch.bounds, {
            spread: CLUSTER_SPREAD,
            center: c,
          });
        } else {
          store.count = 0;
        }
      } else {
        const want = Math.round(cap * frac);
        if (frac >= 0.999) {
          resizeInBoxSphere(store, want, ch.bounds, sphere);
        } else {
          spawnInBoxSphere(store, want, ch.bounds, sphere);
        }
      }
    }
  }

  function restockAll() {
    if (!Number.isFinite(lastChunk.cx)) return;
    const sphere = volumeSphere();
    for (const ch of active.values()) fillChunk(ch, sphere);
  }

  function activateChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (active.has(key)) return;
    const bounds = chunkBounds(cx, cy, cz, chunkSize);
    // One shared center so white circles + red tetras sit in the same clump.
    const clusterCenter = randomClusterCenter(bounds, CLUSTER_SPREAD);
    /** @type {Map<string, ReturnType<typeof createStore>>} */
    const stores = new Map();
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i];
      stores.set(f.id, acquireStore(f.id));
    }
    const ch = { cx, cy, cz, bounds, stores, cluster: clusterCenter };
    active.set(key, ch);
    fillChunk(ch, volumeSphere());
    chunksVersion++;
  }

  function deactivateChunk(key) {
    const ch = active.get(key);
    if (!ch) return;
    for (const [fid, store] of ch.stores) releaseStore(fid, store);
    active.delete(key);
    chunksVersion++;
  }

  function syncChunks(camX, camY, camZ, force = false) {
    focus.x = camX;
    focus.y = camY;
    focus.z = camZ;
    const cx = coordToChunk(camX, chunkSize);
    const cy = coordToChunk(camY, chunkSize);
    const cz = coordToChunk(camZ, chunkSize);
    // Same focus chunk → active set unchanged; skip Set rebuild (was 729 allocs/frame).
    if (!force && cx === lastChunk.cx && cy === lastChunk.cy && cz === lastChunk.cz) return;
    lastChunk = { cx, cy, cz };

    /** @type {Set<string>} */
    const wanted = new Set();
    forEachChunkInRadius(cx, cy, cz, chunkRadius, (x, y, z) => {
      wanted.add(chunkKey(x, y, z));
    });

    for (const key of active.keys()) {
      if (!wanted.has(key)) deactivateChunk(key);
    }
    for (const key of wanted) {
      if (!active.has(key)) {
        const [x, y, z] = key.split(',').map(Number);
        activateChunk(x, y, z);
      }
    }
    restockAll();
  }

  function totalCount() {
    let n = 0;
    for (const ch of active.values()) {
      for (const s of ch.stores.values()) n += s.count;
    }
    return n;
  }

  /**
   * @param {{ rx: number, ry: number, rz: number, ux: number, uy: number, uz: number } | null} billboard
   */
  function packStaging(billboard) {
    for (const f of flocks) {
      let offset = 0;
      const st = f.staging;
      const needsBillboard =
        !!billboard && (f.meshKind === KIND_PLANE || f.meshKind === KIND_TRIANGLE);
      for (const ch of active.values()) {
        const src = ch.stores.get(f.id);
        if (!src || src.count === 0) continue;
        packRenderBuffers(src, f.tint, f.baseScale, {
          billboard: needsBillboard ? billboard : null,
          positionsOnly: f.isPoint,
        });
        const n = src.count;
        if (offset + n > st.capacity) break;
        if (!f.isPoint) {
          st.matrices.set(src.matrices.subarray(0, n * 16), offset * 16);
          st.colors.set(src.colors.subarray(0, n * 4), offset * 4);
        }
        st.positions.set(src.positions.subarray(0, n * 3), offset * 3);
        offset += n;
      }
      st.count = offset;
    }
  }

  /** Update flock.chunkCap from a live target. Does not spawn/resize. */
  function applyTargetCaps(n) {
    const liveChunks = Math.max(1, sphereChunkEquivalent(chunkRadius));
    targetTotal = Math.max(0, Math.min(budget, n | 0));
    let meshPerChunk = 0;
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i];
      if (f.isPoint) continue;
      f.chunkCap = Math.min(f.storeCap, accentCountFor(f));
      meshPerChunk += f.chunkCap;
    }
    const pointBudget = Math.max(0, targetTotal - meshPerChunk * liveChunks);
    const pointPerChunk = Math.floor(pointBudget / Math.max(1, liveChunks));
    perChunkTotal = pointPerChunk + meshPerChunk;
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i];
      if (!f.isPoint) continue;
      f.chunkCap = Math.max(0, Math.min(f.storeCap, pointPerChunk));
    }
  }

  // Caps first, then boot-load so chunks spawn at startCount (not high-water).
  applyTargetCaps(targetTotal);
  syncChunks(0, 4, 0);

  return {
    flocks,
    chunkSize,
    get chunkRadius() {
      return chunkRadius;
    },
    get radiusMax() {
      return radiusMax;
    },
    get species() {
      return flocks.map((f) => ({
        id: f.id,
        meshKind: f.meshKind,
        capacity: f.capacity,
        tint: f.tint,
        // Non-point marks (points stay 1px)
        size:
          f.meshKind === KIND_TETRA
            ? 0.03
            : f.meshKind === KIND_TRIANGLE
              ? 0.045
              : f.meshKind === KIND_PLANE
                ? 0.04
                : 0.05,
        hardCircle: f.hardCircle,
      }));
    },
    get count() {
      return totalCount();
    },
    get capacity() {
      return budget;
    },
    get targetCount() {
      return targetTotal;
    },
    get chunkCount() {
      return active.size;
    },
    get focusChunk() {
      return { ...lastChunk };
    },
    get chunksVersion() {
      return chunksVersion;
    },

    /** Max particles current store caps can hold in the live sphere at radius `r`. */
    maxLiveForRadius(r) {
      const rr = Math.max(1, Math.min(radiusMax, r | 0));
      let per = 0;
      for (const f of flocks) per += f.storeCap;
      return Math.min(budget, Math.floor(sphereChunkEquivalent(rr) * per));
    },

    /**
     * Active cube volumes for debug wireframes.
     * `shell` = furthest Chebyshev layer of the paging cube.
     */
    getChunkBounds() {
      const out = [];
      const fcx = lastChunk.cx;
      const fcy = lastChunk.cy;
      const fcz = lastChunk.cz;
      for (const [key, ch] of active) {
        const dist = Math.max(
          Math.abs(ch.cx - fcx),
          Math.abs(ch.cy - fcy),
          Math.abs(ch.cz - fcz),
        );
        out.push({
          key,
          cx: ch.cx,
          cy: ch.cy,
          cz: ch.cz,
          minX: ch.bounds.minX,
          minY: ch.bounds.minY,
          minZ: ch.bounds.minZ,
          size: ch.bounds.size,
          focus: dist === 0,
          shell: dist === chunkRadius,
        });
      }
      return out;
    },

    /**
     * Target live particle count at the *current* radius.
     * Only point flocks resize — mesh accents are set once per chunk and left alone.
     * @param {number} n
     */
    setTargetCount(n) {
      applyTargetCaps(n);
      if (!Number.isFinite(lastChunk.cx) || active.size === 0) return;
      const sphere = volumeSphere();
      for (const ch of active.values()) {
        const frac = boxSphereOverlapFraction(ch.bounds, sphere);
        for (let i = 0; i < flocks.length; i++) {
          const f = flocks[i];
          if (!f.isPoint) continue; // mesh: set and forget
          const store = ch.stores.get(f.id);
          if (!store) continue;
          resizeInBoxSphere(
            store,
            Math.round(Math.min(f.storeCap, f.chunkCap) * frac),
            ch.bounds,
            sphere,
          );
        }
      }
    },

    /**
     * Shrink/grow streamed Chebyshev radius, then re-apply target so `n` stays
     * about the live count (denser when smaller — until storeCap).
     * @param {number} r
     * @param {{ x: number, y: number, z: number }} [at] focus position (default: last focus)
     * @param {number} [targetN] live target after the change (default: current targetTotal)
     * @returns {boolean} true if radius changed
     */
    setChunkRadius(r, at, targetN) {
      const next = Math.max(1, Math.min(radiusMax, r | 0));
      if (next === chunkRadius && targetN == null) return false;
      chunkRadius = next;
      const x = at?.x ?? focus.x;
      const y = at?.y ?? focus.y;
      const z = at?.z ?? focus.z;
      const want = targetN != null ? targetN : targetTotal;
      // Caps first so newly activated chunks spawn at the right fill
      this.setTargetCount(want);
      syncChunks(x, y, z, true);
      // Fill any new shells / trim after unload
      this.setTargetCount(want);
      return true;
    },

    /**
     * @param {number} dt
     * @param {{ x: number, y: number, z: number, billboard?: { rx: number, ry: number, rz: number, ux: number, uy: number, uz: number } }} [camera]
     */
    tick(dt, camera) {
      const step = Math.max(0, dt || 0);
      time += step;
      // cellSize reserved for neighbor hash when that returns
      void opts.cellSize;

      if (camera) syncChunks(camera.x, camera.y, camera.z);

      // Points: spherical compression wave from origin.
      for (const f of flocks) {
        if (f.meshKind !== KIND_POINT) continue;
        for (const ch of active.values()) {
          const pts = ch.stores.get(f.id);
          if (pts?.count) behaviorCompressionWave(pts, time);
        }
      }

      // Circles + tetras: orbit shared cluster; tetras also spin about their own center.
      for (const ch of active.values()) {
        if (!ch.cluster) continue;
        for (const f of flocks) {
          if (!f.cluster) continue;
          const store = ch.stores.get(f.id);
          if (!store?.count) continue;
          const tetra = f.meshKind === KIND_TETRA;
          behaviorOrbitCluster(
            store,
            time,
            ch.cluster,
            tetra ? 0.55 : 0.32,
            tetra ? 0.45 : 0.16,
          );
          if (tetra) behaviorSpinSelf(store, step, 1.6);
        }
      }

      packStaging(camera?.billboard ?? null);
    },

    getRenderSpecies(id) {
      if (id) {
        const f = flocks.find((x) => x.id === id);
        if (!f) return null;
        return {
          id: f.id,
          meshKind: f.meshKind,
          count: f.staging.count,
          matrices: f.staging.matrices,
          colors: f.staging.colors,
          positions: f.staging.positions,
        };
      }
      return flocks.map((f) => ({
        id: f.id,
        meshKind: f.meshKind,
        count: f.staging.count,
        matrices: f.staging.matrices,
        colors: f.staging.colors,
        positions: f.staging.positions,
      }));
    },
  };
}
