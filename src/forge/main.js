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
} from '../vendor/lite/liteVendor.js';
import { buildField, worldHalfFFromField, worldToTile } from '../sim/field.js';
import {
  applyTableSilhouette,
  createFullCellMask,
  isCellEnabled,
  paintTerrainBrush,
  setCellEnabled,
  worldToCell,
} from '../sim/tableShape.js';
import { TERRAIN } from '../sim/field.js';
import { encodeGarden, fieldFromGarden } from '../sim/garden.js';
import { createCameraController } from '../render/cameraController.js';
import { createTerrainFromField, createTileGridOverlay } from '../render/terrain.js';

const SIZES = [64, 128, 192];
const DEFAULT_SIZE = 128;
const DEFAULT_SEED = 12345;
const DEFAULT_RADIUS = 12;
const DEFAULT_HOLE_R = 24;

const state = {
  layer: 'table',
  terrain: TERRAIN.GRASS,
  brush: 1,
  holeR: DEFAULT_HOLE_R,
  tableTool: 'cell',
  showGrid: true,
  mapName: '',
  painting: false,
};

let field;
let engine;
let scene;
let camera;
let cam;
let terrain = null;
let grid = null;
let fieldGen = 0;
let rebuildTimer = 0;
let sceneRegistered = false;

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
    cornerRadius: extras.cornerRadius ?? DEFAULT_RADIUS,
    holes: extras.holes ?? [],
  });
  return next;
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTerrain(); }, 120);
}

async function rebuildTerrain() {
  const gen = ++fieldGen;
  const snap = field;
  const prev = terrain;
  const prevGrid = grid;
  terrain = null;
  grid = null;
  prev?.dispose?.();
  prevGrid?.dispose?.();
  const next = await createTerrainFromField(engine, scene, snap, camera, { skipScenery: true });
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
  updateStats();
}

function applyAt(pos) {
  if (!pos || !field?.tableShape) return;
  const shape = field.tableShape;
  if (state.layer === 'table' && state.tableTool === 'cell') {
    const { cx, cz } = worldToCell(field, pos.x, pos.z, shape.cellSize);
    const on = isCellEnabled(shape, cx, cz);
    setCellEnabled(shape, cx, cz, !on);
    applyTableSilhouette(field, shape);
    scheduleRebuild();
    return;
  }
  if (state.layer === 'table' && state.tableTool === 'hole') {
    const hit = shape.holes.findIndex((h) => Math.hypot(h.x - pos.x, h.z - pos.z) < Math.max(h.r, 8));
    if (hit >= 0) shape.holes.splice(hit, 1);
    else shape.holes.push({ x: pos.x, z: pos.z, r: state.holeR });
    applyTableSilhouette(field, shape);
    scheduleRebuild();
    return;
  }
  if (state.layer === 'terrain') {
    const tx = worldToTile(pos.x);
    const tz = worldToTile(pos.z);
    if (paintTerrainBrush(field, tx, tz, state.terrain, state.brush)) {
      applyTableSilhouette(field);
      scheduleRebuild();
    }
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
  el.textContent = `${field.width}×${field.height}  ·  ${cells}/${s.cellMask.length} cells  ·  ${s.holes.length} holes  ·  r=${s.cornerRadius}`;
}

function syncFormFromField() {
  const sizeEl = document.getElementById('map-size');
  const seedEl = document.getElementById('map-seed');
  const radEl = document.getElementById('corner-radius');
  const nameEl = document.getElementById('map-name');
  if (sizeEl) sizeEl.value = String(field.width);
  if (seedEl) seedEl.value = String(field.seed);
  if (radEl) radEl.value = String(field.tableShape?.cornerRadius ?? DEFAULT_RADIUS);
  if (nameEl) nameEl.value = state.mapName;
  updateStats();
}

function setLayer(layer) {
  state.layer = layer;
  document.querySelectorAll('[data-layer]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layer === layer);
  });
  document.getElementById('panel-file').style.display = layer === 'file' ? 'block' : 'none';
  document.getElementById('panel-table').style.display = layer === 'table' ? 'block' : 'none';
  document.getElementById('panel-terrain').style.display = layer === 'terrain' ? 'block' : 'none';
}

function setTableTool(tool) {
  state.tableTool = tool;
  document.querySelectorAll('[data-table-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tableTool === tool);
  });
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
      <div class="row">
        <button data-table-tool="cell" class="active">Cells</button>
        <button data-table-tool="hole">Circle cutout</button>
      </div>
      <p class="hint">Cells are 16 tiles. Click to toggle. Cutout click places or removes a hole.</p>
      <label>Corner radius <span id="radius-label">${DEFAULT_RADIUS}</span></label>
      <input id="corner-radius" type="range" min="0" max="32" value="${DEFAULT_RADIUS}">
      <label>Hole radius <span id="hole-label">${DEFAULT_HOLE_R}</span></label>
      <input id="hole-radius" type="range" min="8" max="80" value="${DEFAULT_HOLE_R}">
      <div class="row">
        <button id="btn-enable-all">Enable all cells</button>
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
  ui.querySelectorAll('[data-table-tool]').forEach((b) => {
    b.addEventListener('click', () => setTableTool(b.dataset.tableTool));
  });
  ui.querySelectorAll('[data-terrain]').forEach((b) => {
    b.addEventListener('click', () => setTerrain(Number(b.dataset.terrain)));
  });
  document.getElementById('map-name').addEventListener('input', (e) => {
    state.mapName = e.target.value;
  });
  document.getElementById('corner-radius').addEventListener('input', (e) => {
    const r = Number(e.target.value) || 0;
    document.getElementById('radius-label').textContent = String(r);
    if (!field.tableShape) return;
    applyTableSilhouette(field, { ...field.tableShape, cornerRadius: r });
    scheduleRebuild();
  });
  document.getElementById('hole-radius').addEventListener('input', (e) => {
    state.holeR = Number(e.target.value) || DEFAULT_HOLE_R;
    document.getElementById('hole-label').textContent = String(state.holeR);
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
  });
  document.getElementById('btn-generate').addEventListener('click', () => {
    const size = Number(document.getElementById('map-size').value) || DEFAULT_SIZE;
    const seed = Number(document.getElementById('map-seed').value) || 0;
    const cr = Number(document.getElementById('corner-radius').value) || 0;
    field = newField(size, seed, { cornerRadius: cr });
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

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.handleWheel(e);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    cam.handlePointerDown(e);
    if (e.button === 0 && !cam.isRmbPanning()) {
      state.painting = true;
      applyAt(pickGround(e.clientX, e.clientY));
    }
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
