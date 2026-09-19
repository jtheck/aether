// Thin-instanced visual-only doodads.
// Grove mushrooms are derived; Forge stamps persist on field.doodadType.

import {
  addToScene,
  createPbrMaterial,
  createTexture2DFromPixels,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { capacityFor } from '../sim/capacity.js';
import {
  DOODAD,
  collectDoodadSlots,
  mushroomHostStatesNear,
  mushroomPlacementsForHost,
  wagonPlacementForTile,
} from '../sim/doodads.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { softDetachMesh } from './meshLifecycle.js';

const MUSHROOM_MODEL_URL = '/assets/models/mushroom.glb';
const WAGON_MODEL_URL = '/assets/models/wagon.glb';
const DOODAD_INITIAL = 64;
const GROW_IN_MS = 1100;
const FADE_OUT_MS = 700;

const MUSHROOM_TINTS = [
  [0.46, 0.30, 0.14],
  [0.58, 0.40, 0.16],
  [0.36, 0.18, 0.12],
  [0.64, 0.54, 0.34],
  [0.28, 0.22, 0.14],
];
const WAGON_TINT = [0.62, 0.48, 0.30];

const FOG_DIM = 0.16;
const VISITED_DIM = 0.50;
const VISITED_FOG_T = 110 / 255;

function fogAlbedoScale(t) {
  if (t <= 0) return 1;
  if (t >= 1) return FOG_DIM;
  if (t <= VISITED_FOG_T) {
    return 1 + (t / VISITED_FOG_T) * (VISITED_DIM - 1);
  }
  return VISITED_DIM + ((t - VISITED_FOG_T) / (1 - VISITED_FOG_T)) * (FOG_DIM - VISITED_DIM);
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

function writeMatrix(matrices, slot, x, y, z, yaw, roll, scale) {
  const o = slot * 16;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const s = scale;
  matrices[o] = cy * cr * s;
  matrices[o + 1] = sr * s;
  matrices[o + 2] = -sy * cr * s;
  matrices[o + 3] = 0;
  matrices[o + 4] = -cy * sr * s;
  matrices[o + 5] = cr * s;
  matrices[o + 6] = sy * sr * s;
  matrices[o + 7] = 0;
  matrices[o + 8] = sy * s;
  matrices[o + 9] = 0;
  matrices[o + 10] = cy * s;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function tintForMushroom(host, index) {
  const h = ((Math.imul(host | 0, 1103515245) + Math.imul(index + 1, 12345)) >>> 0);
  return MUSHROOM_TINTS[h % MUSHROOM_TINTS.length];
}

function emptyDoodads() {
  return {
    meshes: [],
    update() {},
    syncFromField() {},
    applyTreeUpdates() {},
    applyFogDim() {},
    applyFogTiles() {},
    dispose() {},
  };
}

function makeForestMaterial(engine, name) {
  const white = createTexture2DFromPixels(engine, new Uint8Array([255, 255, 255, 255]), 1, 1, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  const orm = createTexture2DFromPixels(engine, new Uint8Array([255, 160, 0, 255]), 1, 1, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createPbrMaterial({
    name,
    baseColorTexture: white,
    ormTexture: orm,
    baseColorFactor: [1, 1, 1, 1],
    doubleSided: true,
    occlusionStrength: 0,
  });
}

async function loadKindBatches(engine, scene, url, name, material) {
  const parts = await loadBakedUnitMeshParts(engine, url);
  const batches = [];
  const capacity = DOODAD_INITIAL;
  for (let p = 0; p < parts.length; p++) {
    const mesh = parts[p];
    mesh.name = `doodad-${name}-${p}`;
    mesh.pickable = false;
    mesh.receiveShadows = true;
    if (material) mesh.material = material;
    const matrices = new Float32Array(capacity * 16);
    const colors = new Float32Array(capacity * 4);
    setThinInstances(mesh, matrices, capacity);
    setThinInstanceColors(mesh, colors);
    setThinInstanceCount(mesh, 0);
    addToScene(scene, mesh);
    batches.push({ mesh, matrices, colors, capacity });
  }
  return batches;
}

function placementsForSlot(field, slot) {
  if (slot.kind === DOODAD.WAGON) return [wagonPlacementForTile(field, slot.tile)];
  return mushroomPlacementsForHost(field, slot.tile);
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {object} field
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createDoodadsFromField(engine, scene, field, groundYAt) {
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let mushroomBatches = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let wagonBatches = [];
  try {
    const forestMat = makeForestMaterial(engine, 'doodad-mushroom');
    mushroomBatches = await loadKindBatches(engine, scene, MUSHROOM_MODEL_URL, 'mushroom', forestMat);
  } catch (err) {
    console.warn('[doodads] mushroom.glb failed', err);
  }
  try {
    const wagonMat = makeForestMaterial(engine, 'doodad-wagon');
    wagonBatches = await loadKindBatches(engine, scene, WAGON_MODEL_URL, 'wagon', wagonMat);
  } catch (err) {
    console.warn('[doodads] wagon.glb failed', err);
  }
  if (mushroomBatches.length === 0 && wagonBatches.length === 0) return emptyDoodads();

  /** @type {Map<string, { kind: number, growT: number, shrinkT: number, leaving: boolean, instances: object[] }>} */
  const clusters = new Map();
  const meshes = [
    ...mushroomBatches.map((b) => b.mesh),
    ...wagonBatches.map((b) => b.mesh),
  ];
  let mushroomPrev = 0;
  let wagonPrev = 0;
  let dirty = false;
  let disposed = false;
  /** @type {((x: number, z: number) => number) | null} */
  let fogFactor = null;
  let liveField = field;

  function ensureCapacity(batches, needed) {
    if (!batches.length) return;
    const cap0 = batches[0].capacity;
    if (needed <= cap0) return;
    const cap = capacityFor(needed, { initial: DOODAD_INITIAL });
    for (const batch of batches) {
      const matrices = new Float32Array(cap * 16);
      matrices.set(batch.matrices.subarray(0, cap0 * 16));
      const colors = new Float32Array(cap * 4);
      colors.set(batch.colors.subarray(0, cap0 * 4));
      setThinInstances(batch.mesh, matrices, cap);
      setThinInstanceColors(batch.mesh, colors);
      batch.matrices = matrices;
      batch.colors = colors;
      batch.capacity = cap;
    }
  }

  function writeFogColor(colors, slot, tint, x, z, size) {
    const fogMul = fogFactor ? fogAlbedoScale(fogFactor(x, z)) : 1;
    const fade = Math.max(0.2, size);
    const o = slot * 4;
    colors[o] = tint[0] * fogMul * fade;
    colors[o + 1] = tint[1] * fogMul * fade;
    colors[o + 2] = tint[2] * fogMul * fade;
    colors[o + 3] = 1;
  }

  function rebuildKind(batches, kind, prevDraw) {
    if (!batches.length) return 0;
    let needed = 0;
    for (const c of clusters.values()) {
      if (c.kind !== kind) continue;
      const growEase = 1 - (1 - Math.min(1, c.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, c.shrinkT)) ** 3;
      if ((0.2 + 0.8 * growEase) * (1 - shrinkEase) > 0.001) needed += c.instances.length;
    }
    ensureCapacity(batches, needed);
    let drawCount = 0;
    for (const c of clusters.values()) {
      if (c.kind !== kind) continue;
      const growEase = 1 - (1 - Math.min(1, c.growT)) ** 3;
      const shrinkEase = 1 - (1 - Math.min(1, c.shrinkT)) ** 3;
      const size = (0.2 + 0.8 * growEase) * (1 - shrinkEase);
      if (size <= 0.001) continue;
      for (let i = 0; i < c.instances.length; i++) {
        const inst = c.instances[i];
        const y = groundYAt(inst.x, inst.z) + (inst.yOff ?? 0);
        const scale = inst.scale * size;
        for (let b = 0; b < batches.length; b++) {
          writeMatrix(
            batches[b].matrices,
            drawCount,
            inst.x,
            y,
            inst.z,
            inst.yaw,
            inst.roll ?? 0,
            scale,
          );
          writeFogColor(batches[b].colors, drawCount, inst.tint, inst.x, inst.z, size);
        }
        drawCount++;
      }
    }
    for (let b = 0; b < batches.length; b++) {
      for (let s = drawCount; s < prevDraw; s++) hideMatrix(batches[b].matrices, s);
      setThinInstanceCount(batches[b].mesh, drawCount);
      setThinInstanceColors(batches[b].mesh, batches[b].colors);
      flushThinInstances(batches[b].mesh);
    }
    return drawCount;
  }

  function rebuild() {
    mushroomPrev = rebuildKind(mushroomBatches, DOODAD.MUSHROOM, mushroomPrev);
    wagonPrev = rebuildKind(wagonBatches, DOODAD.WAGON, wagonPrev);
  }

  function instancesFor(slot) {
    const layout = placementsForSlot(liveField, slot);
    return layout.map((p, i) => ({
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      roll: p.roll ?? 0,
      yOff: p.yOff ?? 0,
      scale: p.scale,
      tint: slot.kind === DOODAD.WAGON ? WAGON_TINT : tintForMushroom(slot.tile, i),
    }));
  }

  function addSlot(slot, instant) {
    const existing = clusters.get(slot.key);
    if (existing) {
      existing.leaving = false;
      existing.shrinkT = 0;
      return;
    }
    const instances = instancesFor(slot);
    if (instances.length === 0) return;
    clusters.set(slot.key, {
      kind: slot.kind,
      growT: instant ? 1 : 0,
      shrinkT: 0,
      leaving: false,
      instances,
    });
    dirty = true;
  }

  function dropKey(key, instant) {
    const existing = clusters.get(key);
    if (!existing) return;
    if (instant) {
      clusters.delete(key);
      dirty = true;
      return;
    }
    if (existing.leaving) return;
    existing.leaving = true;
    dirty = true;
  }

  function syncFromField(nextField, instant = true) {
    if (disposed || !nextField) return;
    liveField = nextField;
    const slots = collectDoodadSlots(nextField);
    const wanted = new Set(slots.map((s) => s.key));
    for (const key of clusters.keys()) {
      if (!wanted.has(key)) dropKey(key, instant);
    }
    for (let i = 0; i < slots.length; i++) addSlot(slots[i], instant);
    if (dirty || instant) {
      if (instant) {
        for (const c of clusters.values()) {
          if (!c.leaving) c.growT = 1;
        }
      }
      rebuild();
      dirty = false;
    }
  }

  function applyTreeUpdates(nextField, updates) {
    if (disposed || !nextField || !updates?.tiles?.length) return;
    liveField = nextField;
    const states = mushroomHostStatesNear(nextField, updates.tiles);
    for (let i = 0; i < states.length; i++) {
      const { tile, live } = states[i];
      const key = `g:${tile}`;
      if (live) addSlot({ key, kind: DOODAD.MUSHROOM, tile, grove: true }, false);
      else dropKey(key, false);
    }
  }

  function applyFogDim(factorAt) {
    fogFactor = typeof factorAt === 'function' ? factorAt : null;
    dirty = true;
    rebuild();
    dirty = false;
  }

  function applyFogTiles() {
    if (!fogFactor) return;
    dirty = true;
    rebuild();
    dirty = false;
  }

  function update(deltaMs) {
    if (disposed) return;
    const dt = Math.min(100, Math.max(0, deltaMs));
    let animating = false;
    for (const [key, c] of clusters) {
      if (c.leaving) {
        c.shrinkT = Math.min(1, c.shrinkT + dt / FADE_OUT_MS);
        animating = true;
        if (c.shrinkT >= 1) {
          clusters.delete(key);
          dirty = true;
        }
      } else if (c.growT < 1) {
        c.growT = Math.min(1, c.growT + dt / GROW_IN_MS);
        animating = true;
      }
    }
    if (animating || dirty) {
      rebuild();
      dirty = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clusters.clear();
    for (const mesh of meshes) softDetachMesh(scene, mesh);
    mushroomBatches.length = 0;
    wagonBatches.length = 0;
    meshes.length = 0;
  }

  syncFromField(field, true);

  return {
    meshes,
    update,
    syncFromField,
    applyTreeUpdates,
    applyFogDim,
    applyFogTiles,
    dispose,
  };
}
