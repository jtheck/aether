// Lite-native Forge — table silhouette + terrain paint. No sim worker.

import {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  addToScene,
  onBeforeRender,
  registerScene,
  invalidateRenderBundles,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
  createMeshFromData,
  createStandardMaterial,
} from '../vendor/lite/liteVendor.js';
import {
  buildField,
  FORGE_MAP_SIZES,
  paintRegionLift,
  REGION_LIFT_STEP,
  snapTilesToOddChunks,
  TABLE_CHUNK_TILES,
  TILE_SIZE_F,
  worldHalfFFromField,
} from '../sim/field.js';
import * as fx from '../sim/fixed.js';
import {
  applyTableSilhouette,
  cellWorldBox,
  chunkCornerKind,
  createFullCellMask,
  createFullCellRadius,
  DEFAULT_CELL_RADIUS,
  getCellRadius,
  isCellEnabled,
  maxCellRadius,
  paintTerrainBrush,
  refreshTableTerrain,
  setCellEnabled,
  setCellRadius,
  worldToCell,
} from '../sim/tableShape.js';
import { TERRAIN } from '../sim/field.js';
import { decodeGarden, encodeGarden, fieldFromGarden, GARDEN_SESSION_KEY } from '../sim/garden.js';
import { RESOURCE_KINDS, STARTING_RESOURCES } from '../sim/resources.js';
import { applyAuthoredScenery, populateScenery, paintSceneryBrush, SCENERY } from '../sim/scenery.js';
import { UNIT_DEFS } from '../sim/unitTypes.js';
import { PLACEABLE_BUILDINGS, snapBuildingWorld } from '../sim/buildings.js';
import { defaultMatchAgoras } from '../sim/worldSetup.js';
import { createCameraController } from '../render/cameraController.js';
import {
  CELESTIAL_PRESETS,
  celestialPresetState,
  createCelestialRig,
  defaultCelestialState,
} from '../render/celestial.js';
import { createTerrainFromField, createTileGridOverlay, surfaceHeightAt } from '../render/terrain.js';
import { softDetachMesh } from '../render/meshLifecycle.js';

const SIZES = FORGE_MAP_SIZES;
const DEFAULT_SIZE = SIZES[1];
const DEFAULT_SEED = 12345;

const state = {
  layer: 'table',
  terrain: TERRAIN.GRASS,
  lift: 0,
  scenery: SCENERY.TREE,
  placeKind: 'unit',
  placeType: 1,
  owner: 0,
  brush: 1,
  showGrid: false,
  mapName: '',
  painting: false,
  selected: [],
  units: [],
  buildings: [],
  agoras: [],
  startingResources: { ...STARTING_RESOURCES },
};

const CELESTIAL_STORE_KEY = 'aether.forge.celestial';

let field;
let engine;
let scene;
let camera;
let cam;
let celestial = null;
let terrain = null;
let grid = null;
let selectMesh = null;
let brushMesh = null;
let brushKey = '';
let lastBrushWorld = null;
let lastPaintKey = '';
let placeMeshes = [];
let fieldGen = 0;
let rebuildTimer = 0;
let sceneRegistered = false;
let paintRaf = 0;
const pendingPaintTiles = [];

function matVecUnproject(inv, ndcX, ndcY, depth) {
  const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * depth + inv[12];
  const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * depth + inv[13];
  const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * depth + inv[14];
  const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * depth + inv[15];
  const iw = 1 / w;
  return [x * iw, y * iw, z * iw];
}

function pickGround(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  const vp = getViewProjectionMatrix(camera, w / h);
  const inv = mat4Invert(vp);
  if (!inv) return null;
  const ndcX = (2 * (clientX - rect.left)) / w - 1;
  const ndcY = 1 - (2 * (clientY - rect.top)) / h;
  const near = matVecUnproject(inv, ndcX, ndcY, 1);
  const far = matVecUnproject(inv, ndcX, ndcY, 0);
  const dy = far[1] - near[1];
  if (Math.abs(dy) < 1e-8) return null;
  const t = -near[1] / dy;
  if (t < 0) return null;
  return {
    x: near[0] + (far[0] - near[0]) * t,
    z: near[2] + (far[2] - near[2]) * t,
  };
}

function newField(width, seed, extras = {}) {
  const size = snapTilesToOddChunks(width);
  const next = buildField(seed, { width: size, height: size });
  applyTableSilhouette(next, {
    cellSize: TABLE_CHUNK_TILES,
    cellMask: extras.cellMask ?? createFullCellMask(size, size, TABLE_CHUNK_TILES),
    cellRadius: extras.cellRadius ?? createFullCellRadius(size, size, TABLE_CHUNK_TILES, extras.radius ?? DEFAULT_CELL_RADIUS),
  });
  return next;
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  cancelPendingPaint();
  rebuildTimer = setTimeout(() => { rebuildTerrain(); }, 120);
}

function cancelPendingPaint() {
  if (paintRaf) cancelAnimationFrame(paintRaf);
  paintRaf = 0;
  pendingPaintTiles.length = 0;
  sceneryPending = false;
}

function atlasChunkSize(snap = field) {
  return snap?.tableShape?.cellSize || snap?.chunkSize || 16;
}

function dirtyAtlasChunks(snap, tiles) {
  const cs = atlasChunkSize(snap);
  const keys = new Set();
  for (const t of tiles) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = t.x + dx;
        const z = t.z + dz;
        if (x < 0 || z < 0 || x >= snap.width || z >= snap.height) continue;
        keys.add(`${Math.floor(x / cs)},${Math.floor(z / cs)}`);
      }
    }
  }
  return keys;
}

function queueTerrainPaint(tiles) {
  for (const t of tiles) pendingPaintTiles.push(t);
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(flushTerrainPaint);
}

let sceneryBusy = false;
let sceneryPending = false;

function queueSceneryPaint() {
  sceneryPending = true;
  if (sceneryBusy) return;
  if (state.painting) return;
  flushSceneryPaint();
}

async function flushSceneryPaint() {
  if (!sceneryPending || sceneryBusy) return;
  sceneryPending = false;
  sceneryBusy = true;
  applyAuthoredScenery(field);
  try {
    if (!terrain?.rebuildScenery) {
      scheduleRebuild();
      return;
    }
    await terrain.rebuildScenery(field, camera);
    grid?.refreshOccupancy(field);
    if (sceneRegistered) invalidateRenderBundles(engine);
  } finally {
    sceneryBusy = false;
    if (sceneryPending) queueSceneryPaint();
  }
}

function reservedFromPlacements() {
  const half = worldHalfFFromField(field);
  const pts = [];
  for (const u of state.units) {
    pts.push([(u.tx + 0.5) * TILE_SIZE_F - half, (u.tz + 0.5) * TILE_SIZE_F - half]);
  }
  for (const b of state.buildings) pts.push([b.x, b.z]);
  for (const g of state.agoras) pts.push([g.x, g.z]);
  return pts;
}

function applyPlace(pos, { remove = false } = {}) {
  if (remove) {
    removeNearestPlacement(pos);
    updatePlaceMarkers();
    return;
  }
  const half = worldHalfFFromField(field);
  const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
  const tz = Math.floor((pos.z + half) / TILE_SIZE_F);
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return;
  if (field.activeMask?.[tz * field.width + tx] === 0) return;
  if (state.placeKind === 'unit') {
    state.units.push({ owner: state.owner, type: state.placeType | 0, tx, tz });
  } else if (state.placeKind === 'agora') {
    state.agoras.push({ owner: state.owner, x: pos.x, z: pos.z });
  } else {
    const snapped = snapBuildingWorld(String(state.placeType), fx.fromFloat(pos.x), fx.fromFloat(pos.z));
    state.buildings.push({
      owner: state.owner,
      type: String(state.placeType),
      x: fx.toFloat(snapped.x),
      z: fx.toFloat(snapped.z),
      yaw: 0,
    });
  }
  updatePlaceMarkers();
}

function removeNearestPlacement(pos) {
  const pickNear = (list, getXZ) => {
    let best = -1;
    let bestD = 18;
    for (let i = 0; i < list.length; i++) {
      const p = getXZ(list[i]);
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) list.splice(best, 1);
  };
  const half = worldHalfFFromField(field);
  if (state.placeKind === 'unit') {
    pickNear(state.units, (u) => ({
      x: (u.tx + 0.5) * TILE_SIZE_F - half,
      z: (u.tz + 0.5) * TILE_SIZE_F - half,
    }));
  } else if (state.placeKind === 'agora') {
    pickNear(state.agoras, (g) => ({ x: g.x, z: g.z }));
  } else {
    pickNear(state.buildings, (b) => ({ x: b.x, z: b.z }));
  }
}

function pushBoxMarker(pos, idx, x, y, z, sx, sy, sz) {
  const x0 = x - sx * 0.5;
  const x1 = x + sx * 0.5;
  const y0 = y;
  const y1 = y + sy;
  const z0 = z - sz * 0.5;
  const z1 = z + sz * 0.5;
  const faces = [
    [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1],
    [x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0],
    [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1],
    [x1, y0, z1, x1, y1, z1, x0, y1, z1, x0, y0, z1],
    [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0],
  ];
  for (const f of faces) {
    const base = pos.length / 3;
    pos.push(...f);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function updatePlaceMarkers() {
  for (const mesh of placeMeshes) softDetachMesh(scene, mesh);
  placeMeshes = [];
  if (!engine || !scene) return;
  const half = field ? worldHalfFFromField(field) : 0;
  const ownerColor = (owner) => [
    [0.25, 0.55, 1],
    [1, 0.32, 0.25],
    [0.4, 1, 0.45],
    [0.95, 0.8, 0.25],
    [0.75, 0.45, 1],
  ][owner | 0] ?? [0.8, 0.8, 0.8];
  const addMarker = (name, positions, indices, color) => {
    if (!positions.length) return;
    const pos = new Float32Array(positions);
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    const mesh = createMeshFromData(engine, name, pos, normals, new Uint32Array(indices));
    const mat = createStandardMaterial();
    mat.diffuseColor = color;
    mat.emissiveColor = color.map((c) => c * 0.35);
    mat.ambientColor = color.map((c) => c * 0.4);
    mat.specularColor = [0, 0, 0];
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.pickable = false;
    addToScene(scene, mesh);
    placeMeshes.push(mesh);
  };
  const groundY = (x, z, lift) => (field ? surfaceHeightAt(field, x, z) : 0) + lift;
  const byOwner = new Map();
  for (const u of state.units) {
    const key = u.owner | 0;
    if (!byOwner.has(key)) byOwner.set(key, { pos: [], idx: [] });
    const b = byOwner.get(key);
    const wx = (u.tx + 0.5) * TILE_SIZE_F - half;
    const wz = (u.tz + 0.5) * TILE_SIZE_F - half;
    pushBoxMarker(b.pos, b.idx, wx, groundY(wx, wz, 1.2), wz, 3.2, 6, 3.2);
  }
  for (const [owner, b] of byOwner) addMarker(`forge-units-${owner}`, b.pos, b.idx, ownerColor(owner));
  const bBy = new Map();
  for (const building of state.buildings) {
    const key = building.owner | 0;
    if (!bBy.has(key)) bBy.set(key, { pos: [], idx: [] });
    const b = bBy.get(key);
    pushBoxMarker(b.pos, b.idx, building.x, groundY(building.x, building.z, 0.4), building.z, 10, 8, 10);
  }
  for (const [owner, b] of bBy) addMarker(`forge-buildings-${owner}`, b.pos, b.idx, ownerColor(owner));
  const gPos = [];
  const gIdx = [];
  for (const g of state.agoras) {
    pushBoxMarker(gPos, gIdx, g.x, groundY(g.x, g.z, 0.4), g.z, 16, 4, 16);
  }
  addMarker('forge-agoras', gPos, gIdx, [0.95, 0.85, 0.25]);
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function flushTerrainPaint() {
  paintRaf = 0;
  const tiles = pendingPaintTiles.splice(0);
  if (!tiles.length || !field) return;
  applyAuthoredScenery(field);
  const keys = dirtyAtlasChunks(field, tiles);
  if (terrain?.rebuildAtlasChunks?.(field, keys)) {
    grid?.refreshOccupancy(field);
    if (sceneRegistered) invalidateRenderBundles(engine);
    return;
  }
  scheduleRebuild();
}

function pushSelectEdge(pos, idx, ax, az, bx, bz, y, half) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * half;
  const pz = (dx / len) * half;
  const base = pos.length / 3;
  pos.push(
    ax + px, y, az + pz,
    bx + px, y, bz + pz,
    bx - px, y, bz - pz,
    ax - px, y, az - pz,
  );
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function isSelected(cx, cz) {
  return state.selected.some((s) => s.cx === cx && s.cz === cz);
}

function updateSelectIndicator() {
  if (selectMesh) {
    softDetachMesh(scene, selectMesh);
    selectMesh = null;
  }
  const shape = field?.tableShape;
  if (!state.selected.length || !shape || !engine || !scene) {
    updateSelectUi();
    return;
  }
  const y = 6;
  const half = 2.2;
  const pos = [];
  const idx = [];
  for (const sel of state.selected) {
    const box = cellWorldBox(field, sel.cx, sel.cz, shape.cellSize);
    pushSelectEdge(pos, idx, box.x0, box.z0, box.x1, box.z0, y, half);
    pushSelectEdge(pos, idx, box.x1, box.z0, box.x1, box.z1, y, half);
    pushSelectEdge(pos, idx, box.x1, box.z1, box.x0, box.z1, y, half);
    pushSelectEdge(pos, idx, box.x0, box.z1, box.x0, box.z0, y, half);
  }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const mesh = createMeshFromData(engine, 'chunk-select', positions, normals, new Uint32Array(idx));
  const mat = createStandardMaterial();
  mat.diffuseColor = [0.2, 0.95, 1];
  mat.emissiveColor = [0.15, 0.85, 1];
  mat.ambientColor = [0.15, 0.85, 1];
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  addToScene(scene, mesh);
  selectMesh = mesh;
  if (sceneRegistered) invalidateRenderBundles(engine);
  updateSelectUi();
}

function brushColor() {
  if (state.layer === 'terrain') {
    if (state.lift > 0) return [0.95, 0.78, 0.28];
    if (state.lift < 0) return [0.40, 0.72, 1.0];
    if (state.terrain === TERRAIN.DIRT) return [0.78, 0.55, 0.30];
    if (state.terrain === TERRAIN.WATER) return [0.28, 0.62, 0.98];
    return [0.35, 0.88, 0.42];
  }
  if (state.scenery === SCENERY.NONE) return [0.95, 0.32, 0.28];
  if (state.scenery === SCENERY.ROCK_PLAIN) return [0.78, 0.74, 0.68];
  if (state.scenery === SCENERY.ROCK_MOSS) return [0.48, 0.78, 0.42];
  if (state.scenery === SCENERY.ROCK_SNOW) return [0.78, 0.86, 0.96];
  return [0.32, 0.92, 0.40];
}

function hideBrushCursor() {
  if (brushMesh) {
    softDetachMesh(scene, brushMesh);
    brushMesh = null;
  }
  brushKey = '';
}

function refreshBrushCursor() {
  brushKey = '';
  if (lastBrushWorld) updateBrushCursor(lastBrushWorld);
}

function updateBrushCursor(pos) {
  lastBrushWorld = pos;
  if (!engine || !scene || !field) {
    hideBrushCursor();
    return;
  }
  if (state.layer !== 'terrain' && state.layer !== 'scenery') {
    hideBrushCursor();
    return;
  }
  if (!pos) {
    hideBrushCursor();
    return;
  }
  const half = worldHalfFFromField(field);
  const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
  const tz = Math.floor((pos.z + half) / TILE_SIZE_F);
  const key = `${tx},${tz},${state.brush},${state.layer},${state.lift},${state.terrain},${state.scenery}`;
  if (key === brushKey && brushMesh) return;
  brushKey = key;

  if (brushMesh) {
    softDetachMesh(scene, brushMesh);
    brushMesh = null;
  }
  const r = Math.max(0, state.brush | 0);
  const r2 = r * r;
  const pad = 0.16;
  const lift = 0.14;
  const edgeHalf = 0.2;
  const posArr = [];
  const idx = [];
  const inBrush = (x, z) => {
    const dx = x - tx;
    const dz = z - tz;
    return dx * dx + dz * dz <= r2;
  };
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      if (field.activeMask?.[z * field.width + x] === 0) continue;
      const x0 = x * TILE_SIZE_F - half + pad;
      const x1 = (x + 1) * TILE_SIZE_F - half - pad;
      const z0 = z * TILE_SIZE_F - half + pad;
      const z1 = (z + 1) * TILE_SIZE_F - half - pad;
      const y00 = surfaceHeightAt(field, x0, z0) + lift;
      const y10 = surfaceHeightAt(field, x1, z0) + lift;
      const y11 = surfaceHeightAt(field, x1, z1) + lift;
      const y01 = surfaceHeightAt(field, x0, z1) + lift;
      const base = posArr.length / 3;
      posArr.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      const wx0 = x * TILE_SIZE_F - half;
      const wx1 = wx0 + TILE_SIZE_F;
      const wz0 = z * TILE_SIZE_F - half;
      const wz1 = wz0 + TILE_SIZE_F;
      const yMid = (y00 + y11) * 0.5;
      if (!inBrush(x, z - 1)) pushSelectEdge(posArr, idx, wx0, wz0, wx1, wz0, yMid, edgeHalf);
      if (!inBrush(x + 1, z)) pushSelectEdge(posArr, idx, wx1, wz0, wx1, wz1, yMid, edgeHalf);
      if (!inBrush(x, z + 1)) pushSelectEdge(posArr, idx, wx1, wz1, wx0, wz1, yMid, edgeHalf);
      if (!inBrush(x - 1, z)) pushSelectEdge(posArr, idx, wx0, wz1, wx0, wz0, yMid, edgeHalf);
    }
  }
  if (!posArr.length) return;
  const positions = new Float32Array(posArr);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const mesh = createMeshFromData(engine, 'forge-brush', positions, normals, new Uint32Array(idx));
  const mat = createStandardMaterial();
  const color = brushColor();
  mat.diffuseColor = color;
  mat.emissiveColor = color;
  mat.ambientColor = color;
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  addToScene(scene, mesh);
  brushMesh = mesh;
  if (sceneRegistered) invalidateRenderBundles(engine);
}

async function rebuildTerrain() {
  cancelPendingPaint();
  const gen = ++fieldGen;
  const snap = field;
  const prev = terrain;
  const prevGrid = grid;
  terrain = null;
  grid = null;
  prev?.dispose?.();
  prevGrid?.dispose?.();
  const next = await createTerrainFromField(engine, scene, snap, camera, {
    skipScenery: false,
    chunkedAtlas: true,
  });
  if (gen !== fieldGen) {
    next.dispose?.();
    return;
  }
  terrain = next;
  grid = createTileGridOverlay(engine, scene, snap, { edges: false });
  grid.setVisible(state.showGrid);
  if (!sceneRegistered) {
    await registerScene(scene);
    sceneRegistered = true;
  } else {
    invalidateRenderBundles(engine);
  }
  updateSelectIndicator();
  updatePlaceMarkers();
  refreshBrushCursor();
  updateStats();
}

function selectChunk(cx, cz, { add = false } = {}) {
  const shape = field?.tableShape;
  if (!shape) return;
  if (cx < 0 || cz < 0 || cx >= shape.chunksX || cz >= shape.chunksZ) return;
  if (add) {
    if (isSelected(cx, cz)) {
      state.selected = state.selected.filter((s) => s.cx !== cx || s.cz !== cz);
    } else {
      state.selected.push({ cx, cz });
    }
  } else if (!(isSelected(cx, cz) && state.selected.length > 1)) {
    state.selected = [{ cx, cz }];
  }
  updateSelectIndicator();
}

function applySelectedShape() {
  if (!field?.tableShape) return;
  applyTableSilhouette(field, field.tableShape);
  scheduleRebuild();
  updateSelectUi();
}

function toggleSelectedChunks() {
  if (!field?.tableShape || !state.selected.length) return;
  const allOn = state.selected.every((s) => isCellEnabled(field.tableShape, s.cx, s.cz));
  const next = !allOn;
  for (const s of state.selected) setCellEnabled(field.tableShape, s.cx, s.cz, next);
  applySelectedShape();
}

function applyAt(pos, { add = false } = {}) {
  if (!pos || !field?.tableShape) return;
  const shape = field.tableShape;
  if (state.layer === 'table') {
    const { cx, cz } = worldToCell(field, pos.x, pos.z, shape.cellSize);
    selectChunk(cx, cz, { add });
    return;
  }
  if (state.layer === 'terrain') {
    const half = worldHalfFFromField(field);
    const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
    const tz = Math.floor((pos.z + half) / TILE_SIZE_F);
    const key = `terrain:${tx}:${tz}:${state.brush}:${state.lift}:${state.terrain}:${add ? 1 : 0}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    const dirty = state.lift
      ? paintRegionLift(field, tx, tz, (add ? -state.lift : state.lift) * REGION_LIFT_STEP, state.brush)
      : paintTerrainBrush(field, tx, tz, state.terrain, state.brush);
    if (dirty.length) {
      queueTerrainPaint(dirty);
      if (state.lift) refreshBrushCursor();
    }
    return;
  }
  if (state.layer === 'scenery') {
    const half = worldHalfFFromField(field);
    const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
    const tz = Math.floor((pos.z + half) / TILE_SIZE_F);
    const key = `scenery:${tx}:${tz}:${state.brush}:${state.scenery}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    const dirty = paintSceneryBrush(field, tx, tz, state.scenery, state.brush, { refresh: false });
    if (dirty.length) queueSceneryPaint();
    return;
  }
  if (state.layer === 'place') applyPlace(pos, { remove: add });
}

function gardenExtras() {
  return {
    name: state.mapName,
    units: state.units,
    buildings: state.buildings,
    agoras: state.agoras,
    startingResources: state.startingResources,
  };
}

function gardenPayload() {
  return encodeGarden(field, gardenExtras());
}

function exportMap() {
  const json = JSON.stringify(gardenPayload(), null, 0);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.mapName || 'map').replace(/[^\w-]+/g, '_')}.garden`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function playMap() {
  sessionStorage.setItem(GARDEN_SESSION_KEY, JSON.stringify(gardenPayload()));
  window.open('/?garden=session&solo=1', '_blank');
}

function importFile(file) {
  file.text().then((text) => {
    const json = JSON.parse(text);
    const g = decodeGarden(json);
    field = fieldFromGarden(json);
    state.mapName = g.name || '';
    state.units = g.units;
    state.buildings = g.buildings;
    state.agoras = g.agoras;
    state.startingResources = { ...(g.startingResources || STARTING_RESOURCES) };
    state.selected = [];
    syncFormFromField();
    rebuildTerrain();
  }).catch((err) => {
    console.error(err);
    alert('Could not import that .garden file.');
  });
}

function updateStats() {
  const el = document.getElementById('stats');
  if (!el || !field?.tableShape) return;
  const s = field.tableShape;
  let cells = 0;
  for (let i = 0; i < s.cellMask.length; i++) if (s.cellMask[i]) cells++;
  el.textContent = `${field.width}×${field.height}  ·  ${cells}/${s.cellMask.length} chunks`;
}

function updateSelectUi() {
  const hint = document.getElementById('select-hint');
  const enabledEl = document.getElementById('chunk-enabled');
  const radEl = document.getElementById('chunk-radius');
  const radLabel = document.getElementById('radius-label');
  const shape = field?.tableShape;
  if (!hint || !shape) return;
  if (!state.selected.length) {
    hint.textContent = 'Click to select. Shift-click to add. Double-click to toggle on/off.';
    if (enabledEl) {
      enabledEl.disabled = true;
      enabledEl.indeterminate = false;
    }
    if (radEl) radEl.disabled = true;
    return;
  }
  const onCount = state.selected.filter((s) => isCellEnabled(shape, s.cx, s.cz)).length;
  const radii = state.selected.map((s) => getCellRadius(shape, s.cx, s.cz));
  const sameR = radii.every((r) => r === radii[0]);
  if (state.selected.length === 1) {
    const sel = state.selected[0];
    const kind = chunkCornerKind(shape, sel.cx, sel.cz);
    hint.textContent = `Chunk (${sel.cx}, ${sel.cz})  ·  ${onCount ? 'on' : 'off'}  ·  ${kind}`;
  } else {
    hint.textContent = `${state.selected.length} chunks  ·  ${onCount} on`;
  }
  if (enabledEl) {
    enabledEl.disabled = false;
    enabledEl.indeterminate = onCount > 0 && onCount < state.selected.length;
    enabledEl.checked = onCount === state.selected.length;
  }
  if (radEl) {
    radEl.disabled = false;
    radEl.max = String(Math.floor(maxCellRadius(shape.cellSize)));
    if (sameR) radEl.value = String(radii[0]);
  }
  if (radLabel) radLabel.textContent = sameR ? String(radii[0]) : '—';
}

function syncFormFromField() {
  const sizeEl = document.getElementById('map-size');
  const seedEl = document.getElementById('map-seed');
  const nameEl = document.getElementById('map-name');
  if (sizeEl) {
    const w = String(field.width);
    if (![...sizeEl.options].some((o) => o.value === w)) {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = `${field.width}×${field.height}`;
      sizeEl.appendChild(opt);
    }
    sizeEl.value = w;
  }
  if (seedEl) seedEl.value = String(field.seed);
  if (nameEl) nameEl.value = state.mapName;
  for (const kind of RESOURCE_KINDS) {
    const el = document.getElementById(`start-${kind}`);
    if (el) el.value = String(state.startingResources[kind] | 0);
  }
  updateStats();
  updateSelectUi();
}

function setLayer(layer) {
  if (layer !== state.layer && state.selected.length) {
    state.selected = [];
    updateSelectIndicator();
  }
  state.layer = layer;
  document.querySelectorAll('[data-layer]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layer === layer);
  });
  document.getElementById('panel-file').style.display = layer === 'file' ? 'block' : 'none';
  document.getElementById('panel-table').style.display = layer === 'table' ? 'block' : 'none';
  document.getElementById('panel-terrain').style.display = layer === 'terrain' ? 'block' : 'none';
  document.getElementById('panel-scenery').style.display = layer === 'scenery' ? 'block' : 'none';
  document.getElementById('panel-place').style.display = layer === 'place' ? 'block' : 'none';
  document.getElementById('panel-light').style.display = layer === 'light' ? 'block' : 'none';
  lastPaintKey = '';
  refreshBrushCursor();
}

function setTerrain(type) {
  state.terrain = type;
  state.lift = 0;
  document.querySelectorAll('[data-terrain]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.terrain) === type);
  });
  document.querySelectorAll('[data-lift]').forEach((b) => b.classList.remove('active'));
  refreshBrushCursor();
}

function setLift(dir) {
  state.lift = dir;
  document.querySelectorAll('[data-terrain]').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('[data-lift]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.lift) === dir);
  });
  refreshBrushCursor();
}

function mountUi() {
  const ui = document.createElement('div');
  ui.id = 'forge-ui';
  ui.innerHTML = `
    <h1>Forge</h1>
    <div class="row">
      <button data-layer="file">File</button>
      <button data-layer="table" class="active">Table</button>
      <button data-layer="terrain">Terrain</button>
      <button data-layer="scenery">Scenery</button>
      <button data-layer="place">Place</button>
      <button data-layer="light">Light</button>
    </div>
    <div id="stats" class="hint"></div>
    <div id="panel-file" class="panel" style="display:none">
      <label>Name</label>
      <input id="map-name" type="text" placeholder="Map name">
      <label>Starting wood</label>
      <input id="start-wood" type="number" min="0" value="${STARTING_RESOURCES.wood}">
      <label>Starting stone</label>
      <input id="start-stone" type="number" min="0" value="${STARTING_RESOURCES.stone}">
      <label>Starting mineral</label>
      <input id="start-mineral" type="number" min="0" value="${STARTING_RESOURCES.mineral}">
      <label>Starting food</label>
      <input id="start-food" type="number" min="0" value="${STARTING_RESOURCES.food}">
      <label>Size</label>
      <select id="map-size">${SIZES.map((s) => `<option value="${s}"${s === DEFAULT_SIZE ? ' selected' : ''}>${s}×${s}</option>`).join('')}</select>
      <label>Seed</label>
      <input id="map-seed" type="number" value="${DEFAULT_SEED}">
      <div class="row">
        <button id="btn-generate">Generate</button>
        <button id="btn-export">Export .garden</button>
        <button id="btn-import">Import</button>
        <button id="btn-play">Play</button>
      </div>
      <input id="import-file" type="file" accept=".garden,.json" style="display:none">
      <p class="hint">v4 .garden: table, terrain, scenery, units, buildings, agoras, starting resources. Play opens a solo match from this map.</p>
    </div>
    <div id="panel-table" class="panel">
      <p id="select-hint" class="hint">Click to select. Shift-click to add. Double-click to toggle on/off.</p>
      <label><input id="chunk-enabled" type="checkbox" checked disabled> Chunk enabled</label>
      <label>Radius <span id="radius-label">${DEFAULT_CELL_RADIUS}</span></label>
      <input id="chunk-radius" type="range" min="0" max="32" value="${DEFAULT_CELL_RADIUS}" disabled>
      <p class="hint">0 = sharp corner + plinth. Raise radius to fillet that corner. Odd boards get a center plinth. Outer rails get matching side plinths.</p>
      <div class="row">
        <button id="btn-enable-all">Enable all chunks</button>
      </div>
      <label><input id="show-grid" type="checkbox"> Show pass grid (dev red / yellow)</label>
    </div>
    <div id="panel-terrain" class="panel" style="display:none">
      <div class="row">
        <button data-terrain="${TERRAIN.GRASS}" class="active">Grass</button>
        <button data-terrain="${TERRAIN.DIRT}">Dirt</button>
        <button data-terrain="${TERRAIN.WATER}">Water</button>
        <button data-lift="1">Raise</button>
        <button data-lift="-1">Lower</button>
      </div>
      <label>Brush <span id="brush-label">1</span></label>
      <input id="brush-size" type="range" min="0" max="6" value="1">
      <p class="hint">Raise / lower moves the felt as-is. The table rim stays locked so hills cannot spill off the rails.</p>
    </div>
    <div id="panel-scenery" class="panel" style="display:none">
      <div class="row">
        <button data-scenery="${SCENERY.TREE}" class="active">Tree</button>
        <button data-scenery="${SCENERY.ROCK_PLAIN}">Rock</button>
        <button data-scenery="${SCENERY.ROCK_MOSS}">Moss rock</button>
        <button data-scenery="${SCENERY.ROCK_SNOW}">Big rock</button>
        <button data-scenery="${SCENERY.NONE}">Erase</button>
      </div>
      <label>Brush <span id="scenery-brush-label">1</span></label>
      <input id="scenery-brush-size" type="range" min="0" max="6" value="1">
      <div class="row">
        <button id="btn-gen-scenery">Generate trees / rocks</button>
        <button id="btn-clear-scenery">Clear scenery</button>
      </div>
      <p class="hint">Uses the File seed. Generate fills around what you painted. Clear wipes the board. Units and buildings stay clear.</p>
    </div>
    <div id="panel-place" class="panel" style="display:none">
      <label>Owner</label>
      <input id="place-owner" type="number" min="0" max="4" value="0">
      <label>Units</label>
      <div class="row">
        ${UNIT_DEFS.map((u) => `<button data-place="unit" data-type="${u.id}">${u.name}</button>`).join('')}
      </div>
      <label>Buildings</label>
      <div class="row">
        <button data-place="agora" data-type="agora">Agora</button>
        ${PLACEABLE_BUILDINGS.map((b) => `<button data-place="building" data-type="${b.id}">${b.name}</button>`).join('')}
      </div>
      <p class="hint">Click to place. Shift-click to remove the nearest of that kind.</p>
    </div>
    <div id="panel-light" class="panel" style="display:none">
      <p class="hint">Body 1 casts shadows. Hemi / emit fill the olive board; moon is a cool second sun.</p>
      <label>Preset</label>
      <select id="light-preset">
        <option value="">— pick a mood —</option>
        ${CELESTIAL_PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      ${[0, 1].map((i) => `
        <p class="hint">${i === 0 ? 'Body 1' : 'Body 2'}</p>
        <label>Kind</label>
        <select id="light-${i}-kind">
          <option value="sun">Sun</option>
          <option value="moon">Moon</option>
          <option value="hemi">Hemi</option>
          <option value="emit">Emit</option>
        </select>
        <label>Azimuth <span id="light-${i}-az-label"></span></label>
        <input id="light-${i}-az" type="range" min="0" max="360" step="1">
        <label>Elevation <span id="light-${i}-el-label"></span></label>
        <input id="light-${i}-el" type="range" min="5" max="85" step="1">
        <label>Intensity <span id="light-${i}-int-label"></span></label>
        <input id="light-${i}-int" type="range" min="0" max="2.5" step="0.01">
      `).join('')}
      <div class="row">
        <button id="btn-light-spin">Spin lights</button>
        <button id="btn-light-reset">Reset lights</button>
      </div>
    </div>
  `;
  document.body.appendChild(ui);
  ui.addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.addEventListener('pointermove', (e) => e.stopPropagation());
  ui.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  ui.querySelectorAll('[data-layer]').forEach((b) => {
    b.addEventListener('click', () => setLayer(b.dataset.layer));
  });
  ui.querySelectorAll('[data-terrain]').forEach((b) => {
    b.addEventListener('click', () => setTerrain(Number(b.dataset.terrain)));
  });
  ui.querySelectorAll('[data-lift]').forEach((b) => {
    b.addEventListener('click', () => setLift(Number(b.dataset.lift)));
  });
  ui.querySelectorAll('[data-scenery]').forEach((b) => {
    b.addEventListener('click', () => {
      state.scenery = Number(b.dataset.scenery);
      ui.querySelectorAll('[data-scenery]').forEach((x) => {
        x.classList.toggle('active', Number(x.dataset.scenery) === state.scenery);
      });
      refreshBrushCursor();
    });
  });
  ui.querySelectorAll('[data-place]').forEach((b) => {
    b.addEventListener('click', () => {
      state.placeKind = b.dataset.place;
      state.placeType = b.dataset.place === 'unit' ? Number(b.dataset.type) : b.dataset.type;
      ui.querySelectorAll('[data-place]').forEach((x) => {
        x.classList.toggle('active', x === b);
      });
    });
  });
  ui.querySelector('[data-place]')?.classList.add('active');
  document.getElementById('place-owner').addEventListener('input', (e) => {
    state.owner = Math.max(0, Math.min(4, Number(e.target.value) || 0));
  });
  document.getElementById('btn-gen-scenery').addEventListener('click', () => {
    populateScenery(field, null, reservedFromPlacements(), { keepExisting: true });
    queueSceneryPaint();
    grid?.refreshOccupancy(field);
  });
  document.getElementById('btn-clear-scenery').addEventListener('click', () => {
    if (field.sceneryType) field.sceneryType.fill(0);
    if (field.treeStock) field.treeStock.fill(0);
    applyAuthoredScenery(field);
    queueSceneryPaint();
    grid?.refreshOccupancy(field);
  });
  document.getElementById('map-name').addEventListener('input', (e) => {
    state.mapName = e.target.value;
  });
  for (const kind of RESOURCE_KINDS) {
    document.getElementById(`start-${kind}`).addEventListener('input', (e) => {
      const n = Number(e.target.value);
      state.startingResources[kind] = Number.isFinite(n) && n > 0 ? n | 0 : 0;
    });
  }
  document.getElementById('chunk-enabled').addEventListener('change', (e) => {
    if (!state.selected.length || !field.tableShape) return;
    for (const s of state.selected) setCellEnabled(field.tableShape, s.cx, s.cz, e.target.checked);
    applySelectedShape();
  });
  document.getElementById('chunk-radius').addEventListener('input', (e) => {
    const r = Number(e.target.value) || 0;
    document.getElementById('radius-label').textContent = String(r);
    if (!state.selected.length || !field.tableShape) return;
    for (const s of state.selected) setCellRadius(field.tableShape, s.cx, s.cz, r);
    applySelectedShape();
  });
  function setBrush(n) {
    state.brush = Math.max(0, n | 0);
    const label = String(state.brush);
    const brushLabel = document.getElementById('brush-label');
    const sceneryLabel = document.getElementById('scenery-brush-label');
    const brushSize = document.getElementById('brush-size');
    const scenerySize = document.getElementById('scenery-brush-size');
    if (brushLabel) brushLabel.textContent = label;
    if (sceneryLabel) sceneryLabel.textContent = label;
    if (brushSize) brushSize.value = label;
    if (scenerySize) scenerySize.value = label;
    refreshBrushCursor();
  }
  document.getElementById('brush-size').addEventListener('input', (e) => {
    setBrush(Number(e.target.value) || 0);
  });
  document.getElementById('scenery-brush-size').addEventListener('input', (e) => {
    setBrush(Number(e.target.value) || 0);
  });
  document.getElementById('show-grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    grid?.setVisible(state.showGrid);
  });
  document.getElementById('btn-enable-all').addEventListener('click', () => {
    applyTableSilhouette(field, {
      ...field.tableShape,
      cellMask: createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES),
    });
    scheduleRebuild();
    updateSelectUi();
  });
  document.getElementById('btn-generate').addEventListener('click', () => {
    const size = snapTilesToOddChunks(Number(document.getElementById('map-size').value) || DEFAULT_SIZE);
    const seed = Number(document.getElementById('map-seed').value) || 0;
    field = newField(size, seed);
    state.selected = [];
    state.units = [];
    state.buildings = [];
    state.agoras = defaultMatchAgoras(worldHalfFFromField(field), field.width);
    celestial?.setWorldHalfF(worldHalfFFromField(field));
    rebuildTerrain();
  });
  document.getElementById('btn-export').addEventListener('click', exportMap);
  document.getElementById('btn-play').addEventListener('click', playMap);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    e.target.value = '';
  });
}

function loadForgeCelestial() {
  try {
    const raw = localStorage.getItem(CELESTIAL_STORE_KEY);
    return raw ? JSON.parse(raw) : defaultCelestialState();
  } catch {
    return defaultCelestialState();
  }
}

function persistCelestial() {
  if (!celestial) return;
  try {
    localStorage.setItem(CELESTIAL_STORE_KEY, JSON.stringify(celestial.getState()));
  } catch { /* quota / private mode */ }
}

function syncLightUi() {
  if (!celestial) return;
  const s = celestial.getState();
  for (let i = 0; i < 2; i++) {
    const b = s.bodies[i];
    const az = ((b.azimuth % 360) + 360) % 360;
    document.getElementById(`light-${i}-kind`).value = b.kind;
    document.getElementById(`light-${i}-az`).value = String(Math.round(az));
    document.getElementById(`light-${i}-el`).value = String(Math.round(b.elevation));
    document.getElementById(`light-${i}-int`).value = String(b.intensity);
    document.getElementById(`light-${i}-az-label`).textContent = `${Math.round(az)}°`;
    document.getElementById(`light-${i}-el-label`).textContent = `${Math.round(b.elevation)}°`;
    document.getElementById(`light-${i}-int-label`).textContent = b.intensity.toFixed(2);
  }
}

function readLightUi() {
  if (!celestial) return;
  const s = celestial.getState();
  for (let i = 0; i < 2; i++) {
    s.bodies[i].kind = document.getElementById(`light-${i}-kind`).value;
    s.bodies[i].azimuth = Number(document.getElementById(`light-${i}-az`).value);
    s.bodies[i].elevation = Number(document.getElementById(`light-${i}-el`).value);
    s.bodies[i].intensity = Number(document.getElementById(`light-${i}-int`).value);
  }
  celestial.apply(s);
  persistCelestial();
  // Hand-tuning diverges from the preset — drop the label so it is not misleading.
  const presetSel = document.getElementById('light-preset');
  if (presetSel) presetSel.value = '';
  syncLightUi();
}

function applyCelestialPreset(id) {
  const state = celestialPresetState(id);
  if (!state) return;
  celestial.apply(state);
  persistCelestial();
  syncLightUi();
}

function bindLightUi() {
  for (let i = 0; i < 2; i++) {
    for (const id of [`light-${i}-kind`, `light-${i}-az`, `light-${i}-el`, `light-${i}-int`]) {
      document.getElementById(id).addEventListener('input', readLightUi);
    }
  }
  document.getElementById('light-preset').addEventListener('change', (e) => {
    const id = e.currentTarget.value;
    if (id) applyCelestialPreset(id);
  });
  document.getElementById('btn-light-reset').addEventListener('click', () => {
    celestial.apply(defaultCelestialState());
    persistCelestial();
    document.getElementById('light-preset').value = 'default';
    syncLightUi();
  });
  document.getElementById('btn-light-spin').addEventListener('click', (e) => {
    const on = celestial.toggleSpin();
    e.currentTarget.textContent = on ? 'Stop spin' : 'Spin lights';
  });
  syncLightUi();
}

const canvas = document.getElementById('canvas');

async function main() {
  mountUi();
  engine = await createEngine(canvas, { msaaSamples: 1 });
  scene = createSceneContext(engine);

  field = newField(DEFAULT_SIZE, DEFAULT_SEED);
  state.agoras = defaultMatchAgoras(worldHalfFFromField(field), field.width);
  const worldHalfF = worldHalfFFromField(field);
  camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, worldHalfF * 1.55, {
    x: 0, y: 0, z: 0,
  });
  camera.farPlane = 40000;
  scene.camera = camera;
  cam = createCameraController(camera, canvas, { worldHalfF });

  celestial = createCelestialRig(scene, {
    worldHalfF,
    state: loadForgeCelestial(),
  });
  bindLightUi();

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.handleWheel(e);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    cam.handlePointerDown(e);
    if (e.button === 0 && !cam.isRmbPanning()) {
      state.painting = true;
      applyAt(pickGround(e.clientX, e.clientY), { add: e.shiftKey });
    }
  });
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (state.layer !== 'table') return;
    const pos = pickGround(e.clientX, e.clientY);
    if (!pos || !field?.tableShape) return;
    const { cx, cz } = worldToCell(field, pos.x, pos.z, field.tableShape.cellSize);
    if (!isSelected(cx, cz)) selectChunk(cx, cz);
    toggleSelectedChunks();
  });
  canvas.addEventListener('pointermove', (e) => {
    cam.handlePointerMove(e);
    const pos = pickGround(e.clientX, e.clientY);
    if (state.painting && (state.layer === 'terrain' || state.layer === 'scenery') && e.buttons & 1) {
      applyAt(pos);
    }
    updateBrushCursor(pos);
  });
  canvas.addEventListener('pointerup', (e) => {
    cam.handlePointerUp(e);
  });
  window.addEventListener('pointerup', () => {
    if (!state.painting && !sceneryPending) return;
    state.painting = false;
    lastPaintKey = '';
    if (sceneryPending) flushSceneryPaint();
  });
  canvas.addEventListener('pointerleave', () => {
    lastBrushWorld = null;
    hideBrushCursor();
  });
  window.addEventListener('keydown', (e) => cam.handleKeyDown(e));
  window.addEventListener('keyup', (e) => cam.handleKeyUp(e));

  onBeforeRender(scene, (deltaMs) => {
    cam.tick(deltaMs);
    celestial?.update?.(deltaMs);
    terrain?.update?.(camera, deltaMs);
  });

  await rebuildTerrain();
  syncFormFromField();
  await startEngine(engine);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:10px;left:280px;color:#f88">${err}</pre>`);
});
