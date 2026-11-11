// Thin-instanced visual-only doodads.
// Grove mushrooms are derived; Forge stamps persist on field.doodadType.

import {
  addToScene,
  createMeshFromData,
  createPbrMaterial,
  createTexture2DFromPixels,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { buildingMeshGroundCenter, buildingMeshOrigin } from '../sim/buildings.js';
import { capacityFor } from '../sim/capacity.js';
import {
  DOODAD,
  TORCH_FIRE_ANCHOR,
  collectDoodadSlots,
  derrickPlacementForTile,
  mushroomHostStatesNear,
  mushroomPlacementsForHost,
  standardPlacementForTile,
  torchPlacementForTile,
  wagonPlacementForTile,
  windvanePlacementForTile,
} from '../sim/doodads.js';
import { MODEL_BASE_SCALE } from './modelScale.js';
import { OWNER_TINTS } from './ownerTints.js';
import { isTeamColorMaterial, prepareTeamColorMaterial, sceneTeamRgb } from './teamColor.js';
import { loadBakedUnitMeshParts, prefetchBakedMesh } from './unitModels.js';
import { softDetachMesh } from './meshLifecycle.js';

const MUSHROOM_MODEL_URL = '/assets/models/mushroom.glb';
const WAGON_MODEL_URL = '/assets/models/wagon.glb';
const DERRICK_MODEL_URL = '/assets/models/derrick.glb';
const WINDVANE_MODEL_URL = '/assets/models/props/windvane.glb';
const STANDARD_MODEL_URL = '/assets/models/flag.glb';
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
const TORCH_TINT = [0.42, 0.24, 0.12];
const TORCH_HEAD_TINT = [0.16, 0.09, 0.05];
/** White leaves the baked albedo alone. Fog still multiplies it. */
const MODEL_TINT = [1, 1, 1];
/** Stick and fire_anchor share this. The matrix scale carries both. */
const TORCH_DRAW_SCALE = 2.5;

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
    setShown() {},
    forEachFxInstance() {},
    dispose() {},
  };
}

function pushBox(pos, nrm, uv, idx, x0, y0, z0, x1, y1, z1) {
  const faces = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
  ];
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    const n = face[4];
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const v = face[i];
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function makeBoxBatch(engine, scene, name, material, box, deferScene, tint) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  pushBox(pos, nrm, uv, idx, box[0], box[1], box[2], box[3], box[4], box[5]);
  const mesh = createMeshFromData(
    engine,
    name,
    new Float32Array(pos),
    new Float32Array(nrm),
    new Uint32Array(idx),
    new Float32Array(uv),
  );
  mesh.name = name;
  mesh.pickable = false;
  mesh.receiveShadows = true;
  mesh.material = material;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  const capacity = DOODAD_INITIAL;
  const matrices = new Float32Array(capacity * 16);
  const colors = new Float32Array(capacity * 4);
  setThinInstances(mesh, matrices, capacity);
  setThinInstanceColors(mesh, colors);
  setThinInstanceCount(mesh, 0);
  if (!deferScene) addToScene(scene, mesh);
  return { mesh, matrices, colors, capacity, tint };
}

/** Shaft plus a wrapped head. The shaft carries the fire_anchor. */
function makeTorchBatches(engine, scene, deferScene) {
  const material = makeForestMaterial(engine, 'doodad-torch');
  const shaft = makeBoxBatch(
    engine,
    scene,
    'doodad-torch-shaft',
    material,
    [-0.045, -0.05, -0.045, 0.045, 1.02, 0.045],
    deferScene,
  );
  shaft.mesh.fxSockets = [{
    name: TORCH_FIRE_ANCHOR.name,
    x: TORCH_FIRE_ANCHOR.x,
    y: TORCH_FIRE_ANCHOR.y,
    z: TORCH_FIRE_ANCHOR.z,
    scale: TORCH_FIRE_ANCHOR.scale,
  }];
  const head = makeBoxBatch(
    engine,
    scene,
    'doodad-torch-head',
    material,
    [-0.11, 0.86, -0.11, 0.11, 1.22, 0.11],
    deferScene,
    TORCH_HEAD_TINT,
  );
  return [shaft, head];
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

async function loadKindBatches(engine, scene, url, name, material, deferScene = false) {
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
    if (!deferScene) addToScene(scene, mesh);
    batches.push({ mesh, matrices, colors, capacity });
  }
  return batches;
}

function placementsForSlot(field, slot) {
  if (slot.kind === DOODAD.WAGON) return [wagonPlacementForTile(field, slot.tile)];
  if (slot.kind === DOODAD.TORCH) return [torchPlacementForTile(field, slot.tile)];
  if (slot.kind === DOODAD.DERRICK) return [derrickPlacementForTile(field, slot.tile)];
  if (slot.kind === DOODAD.WINDVANE) return [windvanePlacementForTile(field, slot.tile)];
  if (slot.kind === DOODAD.STANDARD) return [standardPlacementForTile(field, slot.tile)];
  return mushroomPlacementsForHost(field, slot.tile);
}

function bannerRgb(colorIndex) {
  const n = OWNER_TINTS.length;
  const i = ((colorIndex | 0) % n + n) % n;
  return sceneTeamRgb(OWNER_TINTS[i]);
}

function tagTeamColorBatches(engine, batches) {
  for (let i = 0; i < batches.length; i++) {
    const mesh = batches[i].mesh;
    if (!isTeamColorMaterial(mesh?.material)) continue;
    prepareTeamColorMaterial(engine, mesh);
    batches[i].teamColor = true;
  }
}

function meshGroundFit(batches, scale) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < batches.length; i++) {
    const min = batches[i].mesh?.boundMin;
    const max = batches[i].mesh?.boundMax;
    if (!min || !max) continue;
    minX = Math.min(minX, min[0]);
    minZ = Math.min(minZ, min[2]);
    maxX = Math.max(maxX, max[0]);
    maxZ = Math.max(maxZ, max[2]);
  }
  const center = buildingMeshGroundCenter(
    Number.isFinite(minX) ? { minX, maxX, minZ, maxZ } : null,
  );
  return { scale, cx: center.cx, cz: center.cz };
}

/** Decode mushroom and wagon packages while terrain sheets are still in flight. */
export function prefetchDoodadModels(engine) {
  if (!engine) return;
  void prefetchBakedMesh(engine, MUSHROOM_MODEL_URL).catch(() => {});
  void prefetchBakedMesh(engine, WAGON_MODEL_URL).catch(() => {});
  void prefetchBakedMesh(engine, DERRICK_MODEL_URL).catch(() => {});
  void prefetchBakedMesh(engine, WINDVANE_MODEL_URL).catch(() => {});
  void prefetchBakedMesh(engine, STANDARD_MODEL_URL).catch(() => {});
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {object} field
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createDoodadsFromField(engine, scene, field, groundYAt, opts = {}) {
  prefetchDoodadModels(engine);
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let mushroomBatches = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let wagonBatches = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let derrickBatches = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number }[]} */
  let windvaneBatches = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, capacity: number, teamColor?: boolean }[]} */
  let standardBatches = [];
  const torchBatches = makeTorchBatches(engine, scene, opts.deferScene === true);
  const defer = opts.deferScene === true;
  const [mushrooms, wagons, derricks, windvanes, standards] = await Promise.all([
    loadKindBatches(
      engine,
      scene,
      MUSHROOM_MODEL_URL,
      'mushroom',
      makeForestMaterial(engine, 'doodad-mushroom'),
      opts.deferScene === true,
    ).catch((err) => {
      console.warn('[doodads] mushroom.glb failed', err);
      return [];
    }),
    loadKindBatches(
      engine,
      scene,
      WAGON_MODEL_URL,
      'wagon',
      makeForestMaterial(engine, 'doodad-wagon'),
      defer,
    ).catch((err) => {
      console.warn('[doodads] wagon.glb failed', err);
      return [];
    }),
    loadKindBatches(engine, scene, DERRICK_MODEL_URL, 'derrick', null, defer).catch((err) => {
      console.warn('[doodads] derrick.glb failed', err);
      return [];
    }),
    loadKindBatches(engine, scene, WINDVANE_MODEL_URL, 'windvane', null, defer).catch((err) => {
      console.warn('[doodads] windvane.glb failed', err);
      return [];
    }),
    loadKindBatches(engine, scene, STANDARD_MODEL_URL, 'standard', null, defer).catch((err) => {
      console.warn('[doodads] flag.glb failed', err);
      return [];
    }),
  ]);
  mushroomBatches = mushrooms;
  wagonBatches = wagons;
  derrickBatches = derricks;
  windvaneBatches = windvanes;
  standardBatches = standards;
  tagTeamColorBatches(engine, standardBatches);
  if (
    mushroomBatches.length === 0
    && wagonBatches.length === 0
    && torchBatches.length === 0
    && derrickBatches.length === 0
    && windvaneBatches.length === 0
    && standardBatches.length === 0
  ) {
    return emptyDoodads();
  }
  const derrickFit = meshGroundFit(derrickBatches, MODEL_BASE_SCALE);
  const windvaneFit = meshGroundFit(windvaneBatches, MODEL_BASE_SCALE);
  const standardFit = meshGroundFit(standardBatches, MODEL_BASE_SCALE);

  /** @type {Map<string, { kind: number, growT: number, shrinkT: number, leaving: boolean, instances: object[] }>} */
  const clusters = new Map();
  const meshes = [
    ...mushroomBatches.map((b) => b.mesh),
    ...wagonBatches.map((b) => b.mesh),
    ...torchBatches.map((b) => b.mesh),
    ...derrickBatches.map((b) => b.mesh),
    ...windvaneBatches.map((b) => b.mesh),
    ...standardBatches.map((b) => b.mesh),
  ];
  let shown = true;
  function applyShown() {
    if (shown) return;
    for (let i = 0; i < meshes.length; i++) meshes[i].visible = false;
  }
  function setShown(on) {
    shown = on !== false;
    if (shown) {
      for (let i = 0; i < meshes.length; i++) {
        const n = meshes[i].thinInstances?.count ?? 0;
        meshes[i].visible = n > 0;
      }
      return;
    }
    applyShown();
  }
  let mushroomPrev = 0;
  let wagonPrev = 0;
  let torchPrev = 0;
  let derrickPrev = 0;
  let windvanePrev = 0;
  let standardPrev = 0;
  let dirty = false;
  let disposed = false;
  /** @type {((x: number, z: number) => number) | null} */
  let fogFactor = null;
  let liveField = field;
  // Same ring as the tiles. Infinity keeps every doodad (normal boards).
  const dropSq = Number.isFinite(opts.drop) && opts.drop > 0 ? opts.drop * opts.drop : Infinity;
  let lookX = 0;
  let lookZ = 0;
  let lodElapsed = 0;
  let lastLookX = Infinity;
  let lastLookZ = Infinity;

  function cameraLookAt(camera) {
    const t = camera?.target;
    if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: t.x, z: t.z };
    const wm = camera?.worldMatrix;
    if (wm && Number.isFinite(wm[12]) && Number.isFinite(wm[14])) return { x: wm[12], z: wm[14] };
    return null;
  }

  function inRing(x, z) {
    if (dropSq === Infinity) return true;
    const dx = lookX - x;
    const dz = lookZ - z;
    return dx * dx + dz * dz <= dropSq;
  }

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

  function rebuildKind(batches, kind, prevDraw, fit) {
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
        if (!inRing(inst.x, inst.z)) continue;
        const y = groundYAt(inst.x, inst.z) + (inst.yOff ?? 0);
        const scale = inst.scale * (fit?.scale ?? 1) * size;
        const origin = fit
          ? buildingMeshOrigin(inst.x, inst.z, inst.yaw, scale, fit.cx, fit.cz)
          : null;
        for (let b = 0; b < batches.length; b++) {
          writeMatrix(
            batches[b].matrices,
            drawCount,
            origin ? origin.x : inst.x,
            y,
            origin ? origin.z : inst.z,
            inst.yaw,
            inst.roll ?? 0,
            scale,
          );
          const tint = batches[b].teamColor ? (inst.banner || MODEL_TINT) : (batches[b].tint || inst.tint);
          writeFogColor(batches[b].colors, drawCount, tint, inst.x, inst.z, size);
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
    torchPrev = rebuildKind(torchBatches, DOODAD.TORCH, torchPrev);
    derrickPrev = rebuildKind(derrickBatches, DOODAD.DERRICK, derrickPrev, derrickFit);
    windvanePrev = rebuildKind(windvaneBatches, DOODAD.WINDVANE, windvanePrev, windvaneFit);
    standardPrev = rebuildKind(standardBatches, DOODAD.STANDARD, standardPrev, standardFit);
    applyShown();
  }

  function instancesFor(slot) {
    const layout = placementsForSlot(liveField, slot);
    return layout.map((p, i) => ({
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      roll: p.roll ?? 0,
      yOff: p.yOff ?? 0,
      scale: slot.kind === DOODAD.TORCH ? p.scale * TORCH_DRAW_SCALE : p.scale,
      tint: slot.kind === DOODAD.WAGON
        ? WAGON_TINT
        : slot.kind === DOODAD.TORCH
          ? TORCH_TINT
          : slot.kind === DOODAD.DERRICK || slot.kind === DOODAD.WINDVANE || slot.kind === DOODAD.STANDARD
            ? MODEL_TINT
            : tintForMushroom(slot.tile, i),
      banner: slot.kind === DOODAD.STANDARD ? bannerRgb(slot.color) : null,
    }));
  }

  function addSlot(slot, instant) {
    const existing = clusters.get(slot.key);
    const color = slot.color | 0;
    if (existing) {
      existing.leaving = false;
      existing.shrinkT = 0;
      if ((existing.color | 0) !== color) {
        existing.color = color;
        existing.instances = instancesFor(slot);
        dirty = true;
      }
      return;
    }
    const instances = instancesFor(slot);
    if (instances.length === 0) return;
    clusters.set(slot.key, {
      kind: slot.kind,
      color,
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

  function update(camera, deltaMs = 16) {
    if (disposed) return;
    const dt = Math.min(100, Math.max(0, deltaMs));
    if (dropSq !== Infinity && camera) {
      lodElapsed += dt;
      const look = cameraLookAt(camera);
      if (look) {
        const moved = (look.x - lastLookX) ** 2 + (look.z - lastLookZ) ** 2;
        const due = lastLookX === Infinity || (lodElapsed >= 120 && moved >= 16);
        if (due) {
          lookX = look.x;
          lookZ = look.z;
          lastLookX = look.x;
          lastLookZ = look.z;
          lodElapsed = 0;
          dirty = true;
        }
      }
    }
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
    applyShown();
  }

  function forEachFxInstance(fn) {
    if (!shown || disposed || !torchBatches.length) return;
    const batch = torchBatches[0];
    const sockets = batch.mesh.fxSockets;
    if (!sockets?.length) return;
    const count = batch.mesh.thinInstances?.count ?? 0;
    const m = batch.matrices;
    for (let slot = 0; slot < count; slot++) {
      if (!(m[slot * 16 + 15] > 0)) continue;
      fn(m, slot, sockets);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clusters.clear();
    for (const mesh of meshes) softDetachMesh(scene, mesh);
    mushroomBatches.length = 0;
    wagonBatches.length = 0;
    torchBatches.length = 0;
    derrickBatches.length = 0;
    windvaneBatches.length = 0;
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
    setShown,
    forEachFxInstance,
    dispose,
  };
}
