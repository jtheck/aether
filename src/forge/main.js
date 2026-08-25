// Lite-native Forge — table silhouette + terrain paint. No sim worker.

import {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  createHemisphericLight,
  createDirectionalLight,
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
import { buildField, TILE_SIZE_F, worldHalfFFromField } from '../sim/field.js';
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
import { encodeGarden, fieldFromGarden } from '../sim/garden.js';
import { createCameraController } from '../render/cameraController.js';
import { createTerrainFromField, createTileGridOverlay } from '../render/terrain.js';
import { softDetachMesh } from '../render/meshLifecycle.js';

const SIZES = [64, 128, 192];
const DEFAULT_SIZE = 128;
const DEFAULT_SEED = 12345;

const state = {
  layer: 'table',
  terrain: TERRAIN.GRASS,
  brush: 1,
  showGrid: true,
  mapName: '',
  painting: false,
  selected: [],
};

let field;
let engine;
let scene;
let camera;
let cam;
let terrain = null;
let grid = null;
let selectMesh = null;
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
  const next = buildField(seed, { width, height: width });
  applyTableSilhouette(next, {
    cellSize: 16,
    cellMask: extras.cellMask ?? createFullCellMask(width, width, 16),
    cellRadius: extras.cellRadius ?? createFullCellRadius(width, width, 16, extras.radius ?? DEFAULT_CELL_RADIUS),
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

function flushTerrainPaint() {
  paintRaf = 0;
  const tiles = pendingPaintTiles.splice(0);
  if (!tiles.length || !field) return;
  refreshTableTerrain(field);
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
    skipScenery: true,
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
    const dirty = paintTerrainBrush(field, tx, tz, state.terrain, state.brush);
    if (dirty.length) queueTerrainPaint(dirty);
  }
}

function exportMap() {
  const json = JSON.stringify(encodeGarden(field, { name: state.mapName }), null, 0);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.mapName || 'map').replace(/[^\w-]+/g, '_')}.garden`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFile(file) {
  file.text().then((text) => {
    field = fieldFromGarden(JSON.parse(text));
    state.mapName = JSON.parse(text).n || '';
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
  if (sizeEl) sizeEl.value = String(field.width);
  if (seedEl) seedEl.value = String(field.seed);
  if (nameEl) nameEl.value = state.mapName;
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
}

function setTerrain(type) {
  state.terrain = type;
  document.querySelectorAll('[data-terrain]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.terrain) === type);
  });
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
    </div>
    <div id="stats" class="hint"></div>
    <div id="panel-file" class="panel" style="display:none">
      <label>Name</label>
      <input id="map-name" type="text" placeholder="Map name">
      <label>Size</label>
      <select id="map-size">${SIZES.map((s) => `<option value="${s}"${s === DEFAULT_SIZE ? ' selected' : ''}>${s}×${s}</option>`).join('')}</select>
      <label>Seed</label>
      <input id="map-seed" type="number" value="${DEFAULT_SEED}">
      <div class="row">
        <button id="btn-generate">Generate</button>
        <button id="btn-export">Export</button>
        <button id="btn-import">Import</button>
      </div>
      <input id="import-file" type="file" accept=".garden,.json" style="display:none">
    </div>
    <div id="panel-table" class="panel">
      <p id="select-hint" class="hint">Click to select. Shift-click to add. Double-click to toggle on/off.</p>
      <label><input id="chunk-enabled" type="checkbox" checked disabled> Chunk enabled</label>
      <label>Radius <span id="radius-label">${DEFAULT_CELL_RADIUS}</span></label>
      <input id="chunk-radius" type="range" min="0" max="32" value="${DEFAULT_CELL_RADIUS}" disabled>
      <p class="hint">0 = corner block. Outside and inside corners use the selected chunk's radius.</p>
      <div class="row">
        <button id="btn-enable-all">Enable all chunks</button>
      </div>
      <label><input id="show-grid" type="checkbox" checked> Show pass grid (red / yellow)</label>
    </div>
    <div id="panel-terrain" class="panel" style="display:none">
      <div class="row">
        <button data-terrain="${TERRAIN.GRASS}" class="active">Grass</button>
        <button data-terrain="${TERRAIN.DIRT}">Dirt</button>
        <button data-terrain="${TERRAIN.WATER}">Water</button>
      </div>
      <label>Brush <span id="brush-label">1</span></label>
      <input id="brush-size" type="range" min="0" max="6" value="1">
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
  document.getElementById('map-name').addEventListener('input', (e) => {
    state.mapName = e.target.value;
  });
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
  document.getElementById('brush-size').addEventListener('input', (e) => {
    state.brush = Number(e.target.value) || 0;
    document.getElementById('brush-label').textContent = String(state.brush);
  });
  document.getElementById('show-grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    grid?.setVisible(state.showGrid);
  });
  document.getElementById('btn-enable-all').addEventListener('click', () => {
    applyTableSilhouette(field, {
      ...field.tableShape,
      cellMask: createFullCellMask(field.width, field.height, 16),
    });
    scheduleRebuild();
    updateSelectUi();
  });
  document.getElementById('btn-generate').addEventListener('click', () => {
    const size = Number(document.getElementById('map-size').value) || DEFAULT_SIZE;
    const seed = Number(document.getElementById('map-seed').value) || 0;
    field = newField(size, seed);
    state.selected = [];
    rebuildTerrain();
  });
  document.getElementById('btn-export').addEventListener('click', exportMap);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    e.target.value = '';
  });
}

const canvas = document.getElementById('canvas');

async function main() {
  mountUi();
  engine = await createEngine(canvas, { msaaSamples: 1 });
  scene = createSceneContext(engine);
  if (scene.clearColor) {
    scene.clearColor.r = 0.06;
    scene.clearColor.g = 0.11;
    scene.clearColor.b = 0.16;
    scene.clearColor.a = 1;
  }

  field = newField(DEFAULT_SIZE, DEFAULT_SEED);
  const worldHalfF = worldHalfFFromField(field);
  camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, worldHalfF * 1.55, {
    x: 0, y: 0, z: 0,
  });
  camera.farPlane = 40000;
  scene.camera = camera;
  cam = createCameraController(camera, canvas, { worldHalfF });

  const sky = createHemisphericLight([0.2, 1, 0.1], 0.2);
  sky.diffuseColor = [0.78, 0.86, 1];
  sky.groundColor = [0.1, 0.08, 0.06];
  addToScene(scene, sky);
  const sun = createDirectionalLight([-0.78, -0.48, -0.52], 1.55);
  sun.diffuse = [1, 0.94, 0.84];
  {
    const d = sun.direction;
    const dist = worldHalfF * 2.75;
    sun.position.x = -d.x * dist;
    sun.position.y = -d.y * dist;
    sun.position.z = -d.z * dist;
  }
  addToScene(scene, sun);

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
    if (state.painting && state.layer === 'terrain' && e.buttons & 1) {
      applyAt(pickGround(e.clientX, e.clientY));
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    cam.handlePointerUp(e);
    state.painting = false;
  });
  window.addEventListener('keydown', (e) => cam.handleKeyDown(e));
  window.addEventListener('keyup', (e) => cam.handleKeyUp(e));

  onBeforeRender(scene, (deltaMs) => {
    cam.tick(deltaMs);
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
