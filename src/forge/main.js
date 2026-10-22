// Lite-native Forge - table silhouette + terrain paint. No sim worker.

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
  invertMat4,
  createMeshFromData,
  createStandardMaterial,
} from '../vendor/lite/liteVendor.js';
import { createPlacePreview } from './placePreview.js';
import {
  buildField,
  FORGE_MAX_CHUNKS,
  FORGE_MIN_CHUNKS,
  LOD_MAP_CHUNKS,
  SKIRMISH_MAP_CHUNKS,
  forgeTilesForChunks,
  consumeWaterDirty,
  HEIGHT_AMPLITUDE,
  paintRegionLevel,
  paintRegionLift,
  REGION_LIFT_STEP,
  TABLE_CHUNK_TILES,
  TILE_SIZE_F,
  tileHeightWorld,
  worldHalfFFromField,
  worldHalfZFFromField,
} from '../sim/field.js';
import * as fx from '../sim/fixed.js';
import {
  applyTableSilhouette,
  cellWorldBox,
  chunkCornerKind,
  createFullCellMask,
  createFullCellRadius,
  DEFAULT_CELL_RADIUS,
  PLINTH_CELL_RADIUS,
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
import { decodeGarden, encodeGarden, fieldFromGarden } from '../sim/garden.js';
import { stageLocalGarden, stageSessionGarden, writeCampaignPack, writeSessionGarden } from '../app/gardenSession.js';
import {
  addChapter,
  addEpisode,
  createCampaignDraft,
  draftChapterCount,
  draftFromBundle,
  draftToBundle,
  draftToIndex,
  locateChapter,
  moveChapter,
  moveEpisode,
  removeChapter,
  removeEpisode,
  renameCampaign,
  renameChapter,
  renameEpisode,
  setChapterLive,
  setCurrentEpisode,
} from './campaignDraft.js';
import { firstChapterFile, flattenCampaignChapters, formatPackRef, isCampaignBundle } from '../story/campaignPack.js';
import {
  formatWorkshopRef,
  loadGardenRef,
  workshopDescriptionFor,
  workshopNameSuggestions,
  workshopPageUrl,
} from '../app/workshop.js';
import { RESOURCE_KINDS, STARTING_RESOURCES } from '../sim/resources.js';
import { applyAuthoredScenery, clearAllScenery, clearOffTableScenery, clearSceneryCoveringTiles, clearSceneryOnWater, populateScenery, paintSceneryBrush, SCENERY } from '../sim/scenery.js';
import { DOODAD, paintDoodadBrush } from '../sim/doodads.js';
import { UNIT_DEFS } from '../sim/unitTypes.js';
import { BUILDING_FOOTPRINTS, BUILDING_YAW_SNAP, PLACEABLE_BUILDINGS, forEachFootprintTile, snapBuildingWorld, snapBuildingYaw } from '../sim/buildings.js';
import {
  OPENING_REACH,
  applyWallOccupancy,
  emptyWalls,
  placeWallOpening,
  previewWallOpening,
  previewWallSection,
  removeNearestOpening,
  removeWallSection,
  sameWallCorner,
  snapWallCorner,
} from '../sim/walls.js';
import { DEFAULT_MAP_TYPE, MAP_TYPES, normalizeMapType } from '../sim/mapType.js';
import { agorasForMapType, spawnPadsForMapType } from '../sim/worldSetup.js';
import { createCameraController, resolveCameraExtents, resolveCameraHalfF } from '../render/cameraController.js';
import {
  CLIP_CAMERA,
  CLIP_HOLD,
  CLIP_LINE,
  LINE_STYLES,
  activeReel,
  emptyStory,
  lineDuration,
  newClipId,
  replaceReel,
} from '../story/timeline.js';
import { createStoryPlayer } from '../story/player.js';
import { createStoryHud } from '../story/hud.js';
import { createStorySpeech, narratorLines } from '../story/speech.js';
import { findNamedUnit, mergeStoryParty, namedUnits, normalizeSpeaker, storyPartyPlacements } from '../story/cast.js';
import { OBJ_KINDS, TERMINAL_KINDS, isTerminalObjective, normalizeObjectives } from '../story/objectives.js';
import { createStorySheet } from './storySheet.js';
import { createHistory } from './history.js';
import {
  WAVE_ERAS,
  WAVE_ROUTE_MAX,
  appendWaveHop,
  collectWaveParams,
  popWaveHop,
  removeWaveHopAt,
  replaceWaveHop,
  setZoneAllies,
  setZoneEra,
  setZoneKind,
  setZoneParam,
  setZoneTerminal,
  setZoneWaves,
  tileToWaveFrac,
  waveFracToTile,
  waveHopName,
  waveTargetObjective,
  zoneTriggerSpec,
} from './waveRoute.js';
import {
  CELESTIAL_PRESETS,
  CONTRAST_RANGE,
  EXPOSURE_RANGE,
  celestialPresetState,
  createCelestialRig,
  defaultCelestialState,
} from '../render/celestial.js';
import { createTerrainFromField, createTileGridOverlay, surfaceHeightAt } from '../render/terrain.js';
import { buildWallGeometry } from '../render/wallGeom.js';
import { createWallMaterials, createWallMesh } from '../render/walls.js';
import {
  BACKDROP,
  BACKDROP_DEFS,
  defaultBackdropY,
  freshBackdrop,
  nearestBackdrop,
} from '../sim/backdrops.js';
import { softDetachMesh } from '../render/meshLifecycle.js';
import { OWNER_TINTS } from '../render/ownerTints.js';
import { aetherSteam } from '../app/steam.js';

/** One faction per resource-bank owner. King of the Hill uses the first five. */
const FACTION_NAMES = [
  'Blue', 'Red', 'Green', 'Yellow', 'Purple', 'Orange', 'Cyan', 'Pink',
  'White', 'Brown', 'Teal', 'Magenta', 'Olive', 'Navy', 'Gold', 'Slate',
];
const FACTIONS = FACTION_NAMES.map((name, id) => ({ id, name }));
/** Shared side A is 201, B is 202, … Own stores the faction's own id. */
const SIDE_BASE = 201;
const SIDE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function factionCss(id) {
  const rgb = OWNER_TINTS[((id % OWNER_TINTS.length) + OWNER_TINTS.length) % OWNER_TINTS.length];
  return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
}

const DEFAULT_CHUNKS = SKIRMISH_MAP_CHUNKS;
const DEFAULT_SIZE = forgeTilesForChunks(DEFAULT_CHUNKS);
const DEFAULT_SEED = 12345;
const WALL_FIELDS = [
  { key: 'height', id: 'wall-height', label: 'Height', min: 2.5, max: 14, step: 0.05 },
  { key: 'thickness', id: 'wall-thickness', label: 'Thickness', min: 0.45, max: 2.8, step: 0.05 },
  { key: 'merlonHeight', id: 'wall-merlon-h', label: 'Merlon height', min: 0, max: 2.4, step: 0.05 },
  { key: 'merlonWidth', id: 'wall-merlon-w', label: 'Merlon width', min: 0.35, max: 2.4, step: 0.05 },
  { key: 'merlonGap', id: 'wall-merlon-gap', label: 'Merlon gap', min: 0.15, max: 2.2, step: 0.05 },
  { key: 'footing', id: 'wall-footing', label: 'Footing', min: 0, max: 1.1, step: 0.01 },
  { key: 'pier', id: 'wall-pier', label: 'Corner pier', min: 0, max: 1.8, step: 0.01 },
];

const state = {
  layer: 'select',
  terrain: TERRAIN.GRASS,
  lift: 0,
  scenery: SCENERY.TREE,
  stamp: 'scenery',
  doodad: DOODAD.WAGON,
  placeKind: '',
  placeType: 0,
  owner: 0,
  /** Grabbed placements: { kind: 'unit'|'building'|'agora'|'objective', index }[]. */
  placePicks: [],
  brush: 1,
  /** 1–10. 10 matches the old full raise/lower step. */
  liftStrength: 6,
  /** 1–10. 10 stamps every tile in the scenery brush. */
  sceneryDensity: 10,
  showGrid: false,
  showScenery: true,
  showChunks: false,
  showTiles: false,
  mapName: '',
  /** Garden `mt`. Generate lays out starts for this type. */
  mapType: DEFAULT_MAP_TYPE,
  /** Garden `tm`. Null until the author picks a side, so older maps keep the mode default. */
  teamByOwner: null,
  painting: false,
  selected: [],
  units: [],
  buildings: [],
  agoras: [],
  walls: emptyWalls(),
  wallDraft: [],
  wallDraftOpenings: [],
  wallKind: 'castle',
  wallTool: 'lay',
  objectives: [],
  /** Fractional hops for the next zone (consumed when a wave zone is placed). */
  waveRoute: [],
  /** Waves / era applied to the next zone, until a zone is selected. */
  waveDraft: { waves: 0, era: 1 },
  /** Selected wave zone and hop. pending = hops not attached to a zone yet. */
  waveEdit: null,
  startingResources: { ...STARTING_RESOURCES },
  story: emptyStory(),
  storyClipId: null,
  /** 'intro' plays at chapter start. 'ending' is the win reel. */
  storyReelId: 'intro',
  /** 0 = follow the table. Positive world half-extent = custom pan/zoom box. */
  cameraHalfF: 0,
  /** Table panel: chunk silhouette, or off-board props. */
  tableTool: 'chunks',
  /** Disc/Castle arms a single drop. Empty clicks go back to chunks once it is placed. */
  propArmed: false,
  propType: BACKDROP.CASTLE,
  propIndex: -1,
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
let chunkGridMesh = null;
let tileWireMesh = null;
let tileWireTimer = 0;
let tileWireStamp = 0;
let overlayFreeze = 0;
let cameraBoundMesh = null;
let propDrag = null;
/** After a drop, the pointer-up returns the table to chunk editing. */
let propReturnChunks = false;
let propSyncGen = 0;
let brushMesh = null;
let brushKey = '';
let lastBrushWorld = null;
let lastPaintKey = '';
/** Visible height (heightMap units) locked for the current level stroke. */
let levelHold = null;
let placeMeshes = [];
let placePreview = null;
let wallParts = { castle: null, dungeon: null, wood: null, iron: null };
let wallGhostMesh = null;
let wallGhostWood = null;
let wallGhostIron = null;
let wallMats = null;
let wallCursor = null;
let openingHover = null;
let openingKey = '';
let sectionMarker = null;
let sectionKey = '';
let passGridLatched = false;
let fieldGen = 0;
let rebuildTimer = 0;
let sceneRegistered = false;
let paintRaf = 0;
const pendingPaintTiles = [];
let sceneryRaf = 0;
const pendingSceneryTiles = [];
let sceneryFullRebuild = false;
let holdPreviewCamera = false;
let workshopPreviewJpeg = '';
let workshopDescEdited = false;
let campaignDraft = createCampaignDraft();
let activeChapterFile = null;
let storyPlayer = null;
let storyHud = null;
let storySpeech = null;
let storySheet = null;
/** Pointer is dragging the grabbed placements. */
let placeDrag = null;
/** Drag on empty ground. Becomes a select box once the pointer travels. */
let placeBox = null;
let ringGesture = null;
/** New value each scenery stroke, so another pass can hit different tiles. */
let scenerySalt = 1;
const hist = createHistory();
let commitTimer = 0;

function matVecUnproject(inv, ndcX, ndcY, depth) {
  const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * depth + inv[12];
  const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * depth + inv[13];
  const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * depth + inv[14];
  const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * depth + inv[15];
  const iw = 1 / w;
  return [x * iw, y * iw, z * iw];
}

function pickGround(clientX, clientY) {
  const ray = viewRay(clientX, clientY);
  if (!ray || Math.abs(ray.dy) < 1e-8) return null;
  // The visible ground sits above y=0. A flat-plane hit lands further from
  // the camera, which reads as above the cursor.
  const at = (t) => {
    const x = ray.x + ray.dx * t;
    const y = ray.y + ray.dy * t;
    const z = ray.z + ray.dz * t;
    const h = field ? surfaceHeightAt(field, x, z) : 0;
    return { x, z, above: y - h };
  };
  let lo = 0;
  let hi = 1;
  let a = at(lo);
  let b = at(hi);
  if (a.above > 0 && b.above > 0) {
    const t = -ray.y / ray.dy;
    if (t < 0 || t > 1) return null;
    return { x: ray.x + ray.dx * t, z: ray.z + ray.dz * t };
  }
  if (a.above <= 0) return { x: a.x, z: a.z };
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) * 0.5;
    const s = at(mid);
    if (s.above > 0) lo = mid;
    else hi = mid;
  }
  const hit = at((lo + hi) * 0.5);
  return { x: hit.x, z: hit.z };
}

function viewRay(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  const vp = getViewProjectionMatrix(camera, w / h);
  const inv = invertMat4(vp);
  if (!inv) return null;
  const ndcX = (2 * (clientX - rect.left)) / w - 1;
  const ndcY = 1 - (2 * (clientY - rect.top)) / h;
  const near = matVecUnproject(inv, ndcX, ndcY, 1);
  const far = matVecUnproject(inv, ndcX, ndcY, 0);
  return {
    x: near[0], y: near[1], z: near[2],
    dx: far[0] - near[0], dy: far[1] - near[1], dz: far[2] - near[2],
  };
}

/** Ray through the cursor against the wall face, so a click on the wall is that wall. */
function pickWallAim(clientX, clientY) {
  const ground = pickGround(clientX, clientY);
  const ray = viewRay(clientX, clientY);
  if (!ray || !state.walls.runs.length) return ground;
  const reachY = (state.walls.style.height || 6) + 4;
  let bestT = Infinity;
  let best = null;
  for (const run of state.walls.runs) {
    const pts = run.points;
    if (!pts || pts.length < 2) continue;
    const count = run.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-4) continue;
      const nx = -sz / sl;
      const nz = sx / sl;
      const denom = ray.dx * nx + ray.dz * nz;
      if (Math.abs(denom) < 1e-6) continue;
      const t = ((a.x - ray.x) * nx + (a.z - ray.z) * nz) / denom;
      if (t < 0 || t >= bestT) continue;
      const hy = ray.y + ray.dy * t;
      const y0 = surfaceHeightAt(field, (a.x + b.x) * 0.5, (a.z + b.z) * 0.5) - 1;
      if (hy < y0 || hy > y0 + reachY) continue;
      const hx = ray.x + ray.dx * t;
      const hz = ray.z + ray.dz * t;
      const along = ((hx - a.x) * sx + (hz - a.z) * sz) / (sl * sl);
      if (along < -0.02 || along > 1.02) continue;
      const u = along < 0 ? 0 : along > 1 ? 1 : along;
      bestT = t;
      best = { x: a.x + sx * u, z: a.z + sz * u };
    }
  }
  return best || ground;
}

function chunksOfTiles(tiles) {
  return Math.max(1, Math.round((tiles | 0) / TABLE_CHUNK_TILES));
}

function chunkOptionLabel(chunks) {
  const n = chunks | 0;
  const tiles = n * TABLE_CHUNK_TILES;
  return `${n} chunks, ${tiles} tiles${n > LOD_MAP_CHUNKS ? ' *' : ''}`;
}

function chunkSizeOptionsHtml() {
  let html = '';
  for (let n = FORGE_MIN_CHUNKS; n <= FORGE_MAX_CHUNKS; n += 2) {
    html += `<option value="${n}">${chunkOptionLabel(n)}</option>`;
  }
  return html;
}

function selectChunkCount(select, chunks) {
  if (!select) return;
  const n = chunks | 0;
  const value = String(n);
  if (![...select.options].some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = chunkOptionLabel(n);
    select.appendChild(opt);
  }
  select.value = value;
}

function newField(width, height, seed, extras = {}) {
  const w = forgeTilesForChunks(chunksOfTiles(width));
  const h = forgeTilesForChunks(chunksOfTiles(height ?? width));
  const half = (w * TILE_SIZE_F) / 2;
  const halfZ = (h * TILE_SIZE_F) / 2;
  const mapType = extras.mapType || state.mapType;
  const next = buildField(seed, {
    width: w,
    height: h,
    spawnPads: spawnPadsForMapType(mapType, half, w, halfZ),
  });
  applyTableSilhouette(next, {
    cellSize: TABLE_CHUNK_TILES,
    cellMask: extras.cellMask ?? createFullCellMask(w, h, TABLE_CHUNK_TILES),
    cellRadius: extras.cellRadius ?? createFullCellRadius(w, h, TABLE_CHUNK_TILES, extras.radius ?? DEFAULT_CELL_RADIUS),
    suppressCenterBlock: extras.suppressCenterBlock !== false,
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
  if (sceneryRaf) cancelAnimationFrame(sceneryRaf);
  sceneryRaf = 0;
  sceneryPending = false;
  sceneryFullRebuild = false;
  pendingSceneryTiles.length = 0;
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

function queueSceneryPaint(tiles, { full = false } = {}) {
  if (full) sceneryFullRebuild = true;
  if (tiles?.length) {
    for (const t of tiles) pendingSceneryTiles.push(t);
  }
  sceneryPending = true;
  if (sceneryBusy) return;
  if (sceneryRaf) return;
  sceneryRaf = requestAnimationFrame(() => {
    sceneryRaf = 0;
    flushSceneryPaint();
  });
}

async function flushSceneryPaint() {
  if (!sceneryPending || sceneryBusy) return;
  sceneryPending = false;
  sceneryBusy = true;
  const full = sceneryFullRebuild;
  sceneryFullRebuild = false;
  const tiles = pendingSceneryTiles.splice(0);
  applyAuthoredScenery(field);
  restampWallPass();
  try {
    if (!terrain?.rebuildScenery) {
      scheduleRebuild();
      return;
    }
    if (full || !terrain.applyAuthoredSceneryTiles) {
      await terrain.rebuildScenery(field, camera);
    } else if (tiles.length) {
      terrain.applyAuthoredSceneryTiles(field, tiles);
    }
    grid?.refreshOccupancy(field);
    if (sceneRegistered) invalidateRenderBundles(engine);
  } finally {
    sceneryBusy = false;
    if (sceneryPending) queueSceneryPaint();
  }
}

function stampStructureClaim() {
  if (!field) return;
  const n = field.width * field.height;
  if (!field.structureClaim || field.structureClaim.length !== n) {
    field.structureClaim = new Uint8Array(n);
  } else {
    field.structureClaim.fill(0);
  }
  const claim = (type, x, z) => {
    forEachFootprintTile(field, type, fx.fromFloat(x), fx.fromFloat(z), (_tx, _tz, i) => {
      field.structureClaim[i] = 1;
    });
  };
  for (const b of state.buildings) claim(String(b.type), b.x, b.z);
  for (const g of state.agoras) claim('agora', g.x, g.z);
}

function clearResourcesUnderPlacements() {
  if (!field?.sceneryType) return [];
  const tiles = [];
  const claim = (type, x, z) => {
    forEachFootprintTile(field, type, fx.fromFloat(x), fx.fromFloat(z), (tx, tz) => {
      tiles.push({ tx, tz });
    });
  };
  for (const b of state.buildings) claim(String(b.type), b.x, b.z);
  for (const g of state.agoras) claim('agora', g.x, g.z);
  const dirty = clearSceneryCoveringTiles(field, tiles);
  if (dirty.length) field.sceneryAuthored = true;
  return dirty;
}

function settlePlacementScenery() {
  const dirty = clearResourcesUnderPlacements();
  if (dirty.length) queueSceneryPaint(dirty);
}

function placeGeneratedScenery() {
  if (!field) return;
  stampStructureClaim();
  populateScenery(field, null, reservedFromPlacements());
  clearResourcesUnderPlacements();
  field.sceneryAuthored = true;
}

function placeGeneratedStarts() {
  if (!field) return;
  state.agoras = agorasForMapType(
    state.mapType,
    worldHalfFFromField(field),
    field.width,
    worldHalfZFFromField(field),
  );
}

function reservedFromPlacements() {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const pts = [];
  for (const u of state.units) {
    const at = unitWorldXZ(u);
    pts.push([at.x, at.z]);
  }
  for (const o of state.objectives) {
    pts.push([(o.tx + 0.5) * TILE_SIZE_F - half, (o.tz + 0.5) * TILE_SIZE_F - halfZ]);
  }
  for (const b of state.buildings) pts.push([b.x, b.z]);
  for (const g of state.agoras) pts.push([g.x, g.z]);
  const pads = spawnPadsForMapType(state.mapType, half, field.width, halfZ);
  for (const p of pads) pts.push(p);
  return pts;
}

function readWaveForm() {
  const zone = state.waveEdit?.id ? waveZoneById(state.waveEdit.id) : null;
  if (zone) {
    return {
      waves: zone.params?.waves | 0,
      era: zone.params?.era | 0,
    };
  }
  return {
    waves: state.waveDraft.waves | 0,
    era: state.waveDraft.era | 0,
  };
}

function hopTileLabel(wp) {
  if (!field) return '';
  const tile = waveFracToTile(wp[0], wp[1], field.width, field.height);
  return `${tile.tx}, ${tile.tz}`;
}

function selectedHop(edit, id, index, pending = false) {
  if (!edit) return false;
  if (pending) return !!edit.pending && edit.hopIndex === index;
  return !edit.pending && edit.id === id && edit.hopIndex === index;
}

function renderWaveEditor(force = false) {
  renderGoalList();
  const host = document.getElementById('wave-zone-list');
  if (!host || !field) return;
  const active = document.activeElement;
  if (!force && active && host.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
  host.replaceChildren();

  const editingId = state.waveEdit?.id || null;
  const zones = state.objectives;

  const addBtn = (label, attrs, { active = false } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (active) b.classList.add('active');
    for (const [k, v] of Object.entries(attrs)) b.dataset[k] = String(v);
    return b;
  };

  const obj = editingId ? zones.find((z) => z.id === editingId) : null;
  if (obj) {
    const ends = isTerminalObjective(obj) ? ' · ends' : '';
    const row = document.createElement('div');
    row.className = 'row stay';
    row.appendChild(addBtn(
      `${obj.label || obj.kind || 'Ring'}${ends}`,
      { waveAct: 'select-zone', waveId: obj.id },
      { active: true },
    ));
    row.appendChild(addBtn('Remove', { waveAct: 'remove-zone', waveId: obj.id }));
    host.appendChild(row);
    host.appendChild(triggerPanel(obj));
    host.appendChild(waveFields(obj));
    host.appendChild(hopList(obj.params?.route || [], obj.id, false));
  } else if (state.waveRoute.length) {
    host.appendChild(hopList(state.waveRoute, '', true));
  }
  syncBench();
  syncHand();
}

function zoneInput(obj, field, value) {
  const input = document.createElement('input');
  input.dataset.zoneField = field;
  input.dataset.zoneId = obj.id;
  if (typeof value === 'number') {
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(value);
  } else {
    input.type = 'text';
    input.value = value == null ? '' : String(value);
  }
  return input;
}

function labeledZoneControl(text, control, note) {
  const label = document.createElement('label');
  label.className = 'field';
  const name = document.createElement('span');
  name.className = 'field-name';
  name.textContent = text;
  label.append(name, control);
  if (note) {
    const extra = document.createElement('span');
    extra.className = 'field-note';
    extra.textContent = note;
    label.append(extra);
  }
  return label;
}

function triggerPanel(obj) {
  const wrap = document.createElement('div');
  const spec = zoneTriggerSpec(obj.kind);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = spec.hint;
  wrap.appendChild(hint);

  const kind = document.createElement('select');
  kind.dataset.zoneField = 'kind';
  kind.dataset.zoneId = obj.id;
  for (const name of OBJ_KINDS) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    kind.appendChild(opt);
  }
  kind.value = OBJ_KINDS.includes(obj.kind) ? obj.kind : 'reach';
  wrap.appendChild(labeledZoneControl('Kind', kind));

  const ends = document.createElement('select');
  ends.dataset.zoneField = 'terminal';
  ends.dataset.zoneId = obj.id;
  for (const [value, text] of [['', 'No'], ['1', 'Yes']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    ends.appendChild(opt);
  }
  const locked = TERMINAL_KINDS.includes(obj.kind);
  ends.value = locked || obj.terminal === true ? '1' : '';
  ends.disabled = locked;
  wrap.appendChild(labeledZoneControl('Ends the chapter', ends, 'Yes wins the chapter when this zone finishes.'));

  const radius = zoneInput(obj, 'radius', obj.r);
  radius.min = '1';
  wrap.appendChild(labeledZoneControl('Radius', radius, 'Tiles. The ring on the map is this wide.'));
  const label = zoneInput(obj, 'label', obj.label || '');
  wrap.appendChild(labeledZoneControl('Label', label, 'Short name for the objective.'));
  const message = zoneInput(obj, 'message', obj.message || '');
  wrap.appendChild(labeledZoneControl('Message', message, 'Shown when it completes.'));
  const next = zoneInput(obj, 'next', obj.next || '');
  next.placeholder = 'chapter file, or blank';
  wrap.appendChild(labeledZoneControl('Next', next, 'A chapter file. Blank keeps campaign order.'));

  for (const field of spec.fields) {
    const input = zoneInput(obj, field.id, obj.params?.[field.param] ?? '');
    input.dataset.zoneParam = field.param;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.kind === 'number') {
      input.type = 'number';
      input.min = '0';
      input.step = '1';
    }
    wrap.appendChild(labeledZoneControl(field.label, input));
  }

  wrap.appendChild(allyBlock(obj));
  return wrap;
}

function allyBlock(obj) {
  const wrap = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'block-title';
  title.textContent = 'Reinforcements';
  wrap.appendChild(title);
  const ally = obj.params?.allies?.[0];
  const on = document.createElement('select');
  on.dataset.zoneField = 'ally-on';
  on.dataset.zoneId = obj.id;
  for (const [value, text] of [['', 'Off'], ['1', 'On']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    on.appendChild(opt);
  }
  on.value = ally ? '1' : '';
  wrap.appendChild(labeledZoneControl('Friendly troops', on, 'They appear on From and march to To.'));
  if (!ally || !field) return wrap;
  const from = waveFracToTile(ally.from?.[0], ally.from?.[1], field.width, field.height);
  const to = waveFracToTile(ally.to?.[0], ally.to?.[1], field.width, field.height);
  const tiles = [
    ['From X', 'ally-from-x', from.tx, 'Tile where they appear.'],
    ['From Z', 'ally-from-z', from.tz, ''],
    ['To X', 'ally-to-x', to.tx, 'Tile they march to.'],
    ['To Z', 'ally-to-z', to.tz, ''],
  ];
  for (const [text, fieldName, value, note] of tiles) {
    wrap.appendChild(labeledZoneControl(text, zoneInput(obj, fieldName, value), note));
  }
  wrap.appendChild(labeledZoneControl('Groups', zoneInput(obj, 'ally-waves', ally.waves | 0), 'How many friendly groups arrive.'));
  wrap.appendChild(labeledZoneControl('Count', zoneInput(obj, 'ally-count', ally.count | 0), 'Troops in each group.'));
  wrap.appendChild(labeledZoneControl('Delay', zoneInput(obj, 'ally-delay', ally.delay | 0), 'Seconds before the first group.'));
  wrap.appendChild(labeledZoneControl('Interval', zoneInput(obj, 'ally-interval', ally.interval | 0), 'Seconds between groups.'));
  return wrap;
}

function defaultAlly(obj) {
  const w = field?.width || 1;
  const h = field?.height || 1;
  return {
    from: tileToWaveFrac(obj.tx, Math.min(h - 1, (obj.tz | 0) + 8), w, h),
    to: tileToWaveFrac(obj.tx, obj.tz, w, h),
    waves: 1,
    count: 3,
    delay: 0,
    interval: 14,
  };
}

function patchAlly(obj, fieldName, raw) {
  const ally = obj.params?.allies?.[0] || defaultAlly(obj);
  const from = waveFracToTile(ally.from?.[0], ally.from?.[1], field.width, field.height);
  const to = waveFracToTile(ally.to?.[0], ally.to?.[1], field.width, field.height);
  const n = Math.max(0, Number(raw) || 0);
  if (fieldName === 'ally-from-x') from.tx = n;
  else if (fieldName === 'ally-from-z') from.tz = n;
  else if (fieldName === 'ally-to-x') to.tx = n;
  else if (fieldName === 'ally-to-z') to.tz = n;
  setZoneAllies(obj, {
    from: tileToWaveFrac(from.tx, from.tz, field.width, field.height),
    to: tileToWaveFrac(to.tx, to.tz, field.width, field.height),
    waves: fieldName === 'ally-waves' ? n : (ally.waves | 0),
    count: fieldName === 'ally-count' ? n : (ally.count | 0),
    delay: fieldName === 'ally-delay' ? n : (Number(ally.delay) || 0),
    interval: fieldName === 'ally-interval' ? n : (ally.interval | 0),
  });
}

function applyZoneField(obj, input) {
  const fieldName = input.dataset.zoneField;
  if (fieldName === 'kind') setZoneKind(obj, input.value);
  else if (fieldName === 'terminal') setZoneTerminal(obj, input.value === '1');
  else if (fieldName === 'radius') obj.r = Math.max(1, Number(input.value) || 1);
  else if (fieldName === 'label' || fieldName === 'message' || fieldName === 'next') {
    const text = String(input.value || '').trim();
    if (text) obj[fieldName] = text;
    else delete obj[fieldName];
  } else if (fieldName === 'escort' || fieldName === 'branch' || fieldName === 'fail') {
    setZoneParam(obj, input.dataset.zoneParam, String(input.value || '').trim());
  } else if (fieldName === 'seconds' || fieldName === 'hold' || fieldName === 'detect') {
    const n = Number(input.value);
    setZoneParam(obj, input.dataset.zoneParam, n > 0 ? n : null);
  } else if (fieldName === 'ally-on') {
    if (input.value === '1') {
      if (!obj.params?.allies?.[0]) setZoneAllies(obj, defaultAlly(obj));
    } else {
      setZoneAllies(obj, null);
    }
  } else if (fieldName?.startsWith('ally-')) {
    patchAlly(obj, fieldName, input.value);
  }
}

function waveFields(obj) {
  const wrap = document.createElement('div');
  const waves = document.createElement('input');
  waves.type = 'number';
  waves.min = '0';
  waves.step = '1';
  waves.dataset.waveField = 'waves';
  if (obj) waves.dataset.waveId = obj.id;
  waves.value = String(obj ? (obj.params?.waves | 0) : (state.waveDraft.waves | 0));
  const era = document.createElement('select');
  era.dataset.waveField = 'era';
  if (obj) era.dataset.waveId = obj.id;
  const currentEra = obj ? (obj.params?.era | 0) : (state.waveDraft.era | 0);
  const none = document.createElement('option');
  none.value = '0';
  none.textContent = 'Default mix';
  era.appendChild(none);
  for (const choice of WAVE_ERAS) {
    const opt = document.createElement('option');
    opt.value = String(choice.id);
    opt.textContent = choice.label;
    era.appendChild(opt);
  }
  era.value = String(currentEra);
  wrap.appendChild(labeledZoneControl('Waves', waves, 'How many groups march on the zone. 0 means none.'));
  wrap.appendChild(labeledZoneControl('Army', era, 'Which force. Default mix is the usual roster.'));
  return wrap;
}

function hopList(route, id, pending) {
  const wrap = document.createElement('div');
  route.forEach((wp, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(addHopButton(
      `${waveHopName(index)} · ${hopTileLabel(wp)}`,
      { waveAct: pending ? 'select-pending' : 'select-hop', waveId: id, waveIndex: index },
      selectedHop(state.waveEdit, id, index, pending),
    ));
    row.appendChild(addHopButton('Remove', {
      waveAct: pending ? 'remove-pending' : 'remove-hop',
      waveId: id,
      waveIndex: index,
    }));
    wrap.appendChild(row);
  });
  if (route.length < WAVE_ROUTE_MAX) {
    wrap.appendChild(addHopButton('Add hop', {
      waveAct: pending ? 'add-pending' : 'add-hop',
      waveId: id,
    }));
  }
  return wrap;
}

function addHopButton(label, attrs, active = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (active) b.classList.add('active');
  for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v == null ? '' : String(v);
  return b;
}

function armWaveHopPlace() {
  state.placeKind = 'wavehop';
  document.querySelectorAll('[data-place]').forEach((x) => x.classList.remove('active'));
}

function waveZoneById(id) {
  return state.objectives.find((o) => o.id === id) || null;
}

function applyWaveHop(tx, tz) {
  const hop = tileToWaveFrac(tx, tz, field.width, field.height);
  const edit = state.waveEdit;
  if (edit?.pending) {
    if (!state.waveRoute[edit.hopIndex]) return;
    state.waveRoute[edit.hopIndex] = hop;
  } else if (edit && Number.isInteger(edit.hopIndex)) {
    const obj = waveZoneById(edit.id);
    if (!obj || !replaceWaveHop(obj, edit.hopIndex, hop)) return;
  } else {
    const target = edit?.id ? waveZoneById(edit.id) : waveTargetObjective(state.objectives);
    if (target) {
      if (!appendWaveHop(target, hop, readWaveForm())) return;
      state.waveEdit = { id: target.id, hopIndex: target.params.route.length - 1 };
    } else if (state.waveRoute.length < WAVE_ROUTE_MAX) {
      state.waveRoute.push(hop);
      state.waveEdit = { pending: true, hopIndex: state.waveRoute.length - 1 };
    } else {
      return;
    }
  }
  renderWaveEditor();
}

function removeLastWaveHop() {
  const target = waveTargetObjective(state.objectives);
  if (target && popWaveHop(target)) {
    renderWaveEditor();
    return;
  }
  if (state.waveRoute.length) {
    state.waveRoute.pop();
    renderWaveEditor();
  }
}

function placeList(kind) {
  if (kind === 'unit') return state.units;
  if (kind === 'building') return state.buildings;
  if (kind === 'agora') return state.agoras;
  if (kind === 'objective') return state.objectives;
  return null;
}

function tileAtWorld(pos) {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    tx: Math.floor((pos.x + half) / TILE_SIZE_F),
    tz: Math.floor((pos.z + halfZ) / TILE_SIZE_F),
  };
}

function worldAtTile(tx, tz) {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - halfZ,
  };
}

function unitWorldXZ(u) {
  if (Number.isFinite(u.x) && Number.isFinite(u.z)) return { x: u.x, z: u.z };
  return worldAtTile(u.tx, u.tz);
}

function placementWorld(kind, item) {
  if (kind === 'unit') return unitWorldXZ(item);
  if (kind === 'objective') return worldAtTile(item.tx, item.tz);
  return { x: item.x, z: item.z };
}

function tileOpen(tx, tz) {
  if (!field) return false;
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  if (field.activeMask?.[tz * field.width + tx] === 0) return false;
  return true;
}

function grabReach(kind, item) {
  if (kind === 'unit') return TILE_SIZE_F;
  if (kind === 'objective') return Math.max(2, (item.r || 1) * 1.6);
  const fp = BUILDING_FOOTPRINTS[item?.type] || (kind === 'agora' ? BUILDING_FOOTPRINTS.agora : null);
  const half = ((fp?.w ?? 2) * TILE_SIZE_F) * 0.5;
  return Math.max(2.2, half * 0.72);
}

function hitPlacement(pos, kinds = ['unit', 'building', 'agora', 'objective']) {
  if (!pos) return null;
  let best = null;
  const consider = (kind) => {
    const list = placeList(kind);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const p = placementWorld(kind, list[i]);
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      const reach = grabReach(kind, list[i]);
      if (d > reach) continue;
      if (!best || d < best.d) best = { kind, index: i, d };
    }
  };
  for (const kind of kinds) consider(kind);
  return best;
}

function clearPlacePick() {
  state.placePicks = [];
  placeDrag = null;
  placeBox = null;
  syncPlacePickUi();
  updatePlaceMarkers();
}

function livePicks() {
  return state.placePicks.filter((p) => placeList(p.kind)?.[p.index]);
}

function groupOrigins(picks = livePicks()) {
  const out = [];
  for (const p of picks) {
    const item = placeList(p.kind)?.[p.index];
    if (!item) continue;
    const w = placementWorld(p.kind, item);
    out.push({ kind: p.kind, index: p.index, x: w.x, z: w.z });
  }
  return out;
}

function syncPlacePickUi() {
  const picks = livePicks();
  const remove = document.getElementById('btn-place-remove');
  if (remove) remove.disabled = picks.length === 0;
  const canTurn = picks.some((p) => p.kind === 'unit' || p.kind === 'building');
  const rotL = document.getElementById('place-rot-l');
  const rotR = document.getElementById('place-rot-r');
  if (rotL) rotL.disabled = !canTurn;
  if (rotR) rotR.disabled = !canTurn;
  const nameEl = document.getElementById('place-name');
  const named = picks.length === 1 && picks[0].kind === 'unit'
    ? placeList('unit')?.[picks[0].index]
    : null;
  if (nameEl) {
    nameEl.disabled = picks.length > 0 && !named;
    if (named && document.activeElement !== nameEl) nameEl.value = named.name || '';
    else if (picks.length > 0 && document.activeElement !== nameEl) nameEl.value = '';
  }
  syncFactionUi(picks);
  syncBench();
  syncHand();
}

/** Implicit forge alliances when the garden has no saved `teamByOwner`. */
function defaultForgeTeam(id) {
  if (state.mapType !== 'adventure') return id;
  if (id < 4) return SIDE_BASE;
  const otherSides = SIDE_LETTERS.length - 1;
  const total = FACTIONS.length - 4;
  const slot = id - 4;
  const base = Math.floor(total / otherSides);
  const extra = total % otherSides;
  let left = slot;
  for (let s = 0; s < otherSides; s++) {
    const block = base + (s < extra ? 1 : 0);
    if (left < block) return SIDE_BASE + 1 + s;
    left -= block;
  }
  return SIDE_BASE + otherSides;
}

function authoredTeam(id) {
  if (state.teamByOwner) {
    const t = state.teamByOwner[id];
    return Number.isInteger(t) ? t : id;
  }
  return defaultForgeTeam(id);
}

function displaySide(id) {
  const team = authoredTeam(id);
  if (team === id) return 'own';
  const offset = team - SIDE_BASE;
  if (offset >= 0 && offset < SIDE_LETTERS.length) return SIDE_LETTERS[offset];
  const groups = [];
  for (const f of FACTIONS) {
    const t = authoredTeam(f.id);
    if (t === f.id) continue;
    const off = t - SIDE_BASE;
    if (off >= 0 && off < SIDE_LETTERS.length) continue;
    if (!groups.includes(t)) groups.push(t);
  }
  const idx = groups.indexOf(team);
  return SIDE_LETTERS[idx >= 0 ? idx : 0];
}

function materializeTeams() {
  if (state.teamByOwner) return;
  state.teamByOwner = FACTIONS.map((f) => defaultForgeTeam(f.id));
}

function armySides() {
  if (state.mapType === 'adventure' || state.mapType === 'stress') {
    return [{ id: 0, name: 'Players' }, { id: 4, name: 'Enemy' }];
  }
  const spec = MAP_TYPES.find((t) => t.id === state.mapType);
  const count = spec?.players > 0 ? spec.players : 4;
  return FACTIONS.slice(0, count).map((f) => ({ id: f.id, name: f.name }));
}

function renderArmySides() {
  const sel = document.getElementById('place-owner');
  if (sel) {
    const adventure = state.mapType === 'adventure' || state.mapType === 'stress';
    for (const opt of sel.options) {
      if (opt.dataset.split) continue;
      const id = Number(opt.value);
      const faction = FACTIONS.find((f) => f.id === id);
      if (!faction) continue;
      opt.textContent = adventure && id === 0 ? 'Players' : adventure && id === 4 ? 'Enemy' : faction.name;
    }
  }
  const paint = (host) => {
    if (!host) return;
    host.replaceChildren();
    for (const side of armySides()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.classList.toggle('active', state.owner === side.id);
      const dot = document.createElement('i');
      dot.style.background = factionCss(side.id);
      const word = document.createElement('span');
      word.textContent = side.name;
      b.append(dot, word);
      b.addEventListener('click', () => {
        state.owner = side.id;
        if (sel) {
          sel.value = String(side.id);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        renderArmySides();
        syncHand();
      });
      host.appendChild(b);
    }
  };
  paint(document.getElementById('army-sides'));
  paint(document.getElementById('army-held-ink'));
}

function kindWord(kind) {
  const s = String(kind || 'reach');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const GOAL_INKS = [
  [0.30, 0.62, 1.00],
  [0.95, 0.42, 0.28],
  [0.35, 0.82, 0.45],
  [0.95, 0.78, 0.25],
  [0.70, 0.42, 0.95],
  [0.20, 0.80, 0.82],
  [0.95, 0.48, 0.72],
  [0.62, 0.85, 0.30],
];

function goalInk(index) {
  return GOAL_INKS[index % GOAL_INKS.length];
}

function goalCss(index) {
  const c = goalInk(index);
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

function goalMaking() {
  return state.placeKind === 'objective';
}

function renderGoalList() {
  const host = document.getElementById('goal-list');
  const kinds = document.getElementById('goal-new');
  const newer = document.getElementById('goal-new-btn');
  if (kinds) kinds.hidden = !goalMaking();
  if (newer) newer.classList.toggle('active', goalMaking());
  if (!host) return;
  host.replaceChildren();
  if (!state.objectives.length) {
    const empty = document.createElement('div');
    empty.textContent = 'None on the map.';
    host.appendChild(empty);
    if (goalMaking()) renderGoalKinds();
    return;
  }
  state.objectives.forEach((obj, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.classList.toggle('active', state.waveEdit?.id === obj.id);
    const sw = document.createElement('i');
    sw.className = 'swatch';
    sw.style.background = goalCss(i);
    const word = document.createElement('span');
    word.textContent = obj.label || kindWord(obj.kind);
    b.append(sw, word);
    b.addEventListener('click', () => selectGoal(i));
    host.appendChild(b);
  });
  if (goalMaking()) renderGoalKinds();
}

function renderGoalKinds() {
  const host = document.getElementById('goal-kinds');
  const sel = document.getElementById('place-obj-kind');
  if (!host || !sel) return;
  const current = sel.value || 'reach';
  host.replaceChildren();
  for (const kind of OBJ_KINDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = kindWord(kind);
    b.classList.toggle('active', kind === current);
    b.addEventListener('click', () => {
      sel.value = kind;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      state.placeKind = 'objective';
      state.waveEdit = null;
      state.placePicks = [];
      renderWaveEditor();
      renderGoalKinds();
      syncHand();
    });
    host.appendChild(b);
  }
}

function syncBench() {
  const picks = livePicks();
  const holdingPiece = picks.some((p) => p.kind === 'unit' || p.kind === 'building' || p.kind === 'agora');
  const stamps = document.getElementById('army-stamps');
  const held = document.getElementById('army-held');
  if (stamps) stamps.hidden = holdingPiece;
  if (held) held.hidden = !holdingPiece;
}

function allianceHint() {
  return '';
}

function renderAllianceEditor() {
  const list = document.getElementById('alliance-list');
  const hint = document.getElementById('alliance-hint');
  const box = document.getElementById('map-sides');
  const adventure = state.mapType === 'adventure' || state.mapType === 'stress';
  if (box) box.hidden = adventure;
  if (hint) hint.textContent = allianceHint();
  if (!list) return;
  const options = ['own', ...SIDE_LETTERS];
  list.innerHTML = FACTIONS.map((f) => {
    const side = displaySide(f.id);
    const opts = options.map((key) => {
      const label = key === 'own' ? 'Own' : `Side ${key}`;
      return `<option value="${key}"${key === side ? ' selected' : ''}>${label}</option>`;
    }).join('');
    return `<div class="row faction-row alliance-row">
      <span class="faction-swatch" style="background:${factionCss(f.id)}"></span>
      <span class="alliance-name">${f.name}</span>
      <select data-alliance="${f.id}">${opts}</select>
    </div>`;
  }).join('');
  renderArmySides();
}

function syncFactionUi(picks) {
  const sel = document.getElementById('place-owner');
  const swatch = document.getElementById('faction-swatch');
  if (!sel) return;
  const owners = [];
  for (const pick of picks) {
    const item = placeList(pick.kind)?.[pick.index];
    if (item && item.owner != null) owners.push(item.owner | 0);
  }
  const same = owners.length > 0 && owners.every((n) => n === owners[0]);
  const id = owners.length === 0 ? state.owner : (same ? owners[0] : -1);
  let split = sel.querySelector('option[data-split]');
  if (id < 0) {
    if (!split) {
      split = document.createElement('option');
      split.value = '';
      split.dataset.split = '1';
      split.disabled = true;
      split.textContent = '-';
      sel.prepend(split);
    }
    sel.value = '';
  } else {
    split?.remove();
    sel.value = String(id);
  }
  if (swatch) swatch.style.background = id < 0 ? 'transparent' : factionCss(id);
}

function writeUnitWorld(item, x, z) {
  const tile = tileAtWorld({ x, z });
  if (!tileOpen(tile.tx, tile.tz)) return false;
  item.tx = tile.tx;
  item.tz = tile.tz;
  const center = worldAtTile(tile.tx, tile.tz);
  if (Math.hypot(x - center.x, z - center.z) < 0.08) {
    delete item.x;
    delete item.z;
  } else {
    item.x = x;
    item.z = z;
  }
  return true;
}

function applyGroupDelta(origins, dx, dz) {
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return false;
  const next = [];
  for (const o of origins) {
    const x = o.x + dx;
    const z = o.z + dz;
    if (o.kind === 'unit' || o.kind === 'objective') {
      const tile = tileAtWorld({ x, z });
      if (!tileOpen(tile.tx, tile.tz)) return false;
    }
    next.push({ x, z });
  }
  let changed = false;
  for (let i = 0; i < origins.length; i++) {
    const o = origins[i];
    const item = placeList(o.kind)?.[o.index];
    if (!item) continue;
    if (o.kind === 'unit') {
      if (!writeUnitWorld(item, next[i].x, next[i].z)) return false;
      changed = true;
    } else if (o.kind === 'objective') {
      const tile = tileAtWorld(next[i]);
      if (item.tx === tile.tx && item.tz === tile.tz) continue;
      item.tx = tile.tx;
      item.tz = tile.tz;
      changed = true;
    } else if (o.kind === 'building') {
      const snapped = snapBuildingWorld(String(item.type), fx.fromFloat(next[i].x), fx.fromFloat(next[i].z));
      item.x = fx.toFloat(snapped.x);
      item.z = fx.toFloat(snapped.z);
      changed = true;
    } else if (o.kind === 'agora') {
      const snapped = snapBuildingWorld('agora', fx.fromFloat(next[i].x), fx.fromFloat(next[i].z));
      item.x = fx.toFloat(snapped.x);
      item.z = fx.toFloat(snapped.z);
      changed = true;
    }
  }
  if (changed) updatePlaceMarkers();
  return changed;
}

function beginGroupDrag(pos, pointer) {
  placeDrag = {
    x: pos.x,
    z: pos.z,
    origins: groupOrigins(),
    cx: pointer?.clientX ?? 0,
    cy: pointer?.clientY ?? 0,
    // A click selects. Movement starts only after the pointer actually travels.
    armed: !pointer,
  };
}

function moveGroupDrag(pos) {
  if (!placeDrag?.origins || !pos) return;
  applyGroupDelta(placeDrag.origins, pos.x - placeDrag.x, pos.z - placeDrag.z);
}

function turnYaw(item, step, snap) {
  let y = (Number(item.yaw) || 0) + step;
  y = snap ? snapBuildingYaw(y) : Math.atan2(Math.sin(y), Math.cos(y));
  item.yaw = Math.abs(y) < 1e-4 ? 0 : y;
}

function rotatePlacePick(dir) {
  const picks = livePicks();
  if (!picks.length) return;
  if (picks.length === 1) {
    const pick = picks[0];
    const item = placeList(pick.kind)[pick.index];
    if (pick.kind === 'building') turnYaw(item, dir * BUILDING_YAW_SNAP, true);
    else if (pick.kind === 'unit') turnYaw(item, dir * (Math.PI / 8), false);
    else return;
    updatePlaceMarkers();
    return;
  }
  const step = dir * (Math.PI / 8);
  const worlds = picks.map((p) => placementWorld(p.kind, placeList(p.kind)[p.index]));
  let cx = 0;
  let cz = 0;
  for (const w of worlds) {
    cx += w.x;
    cz += w.z;
  }
  cx /= worlds.length;
  cz /= worlds.length;
  const c = Math.cos(step);
  const s = Math.sin(step);
  const next = [];
  for (let i = 0; i < picks.length; i++) {
    const dx = worlds[i].x - cx;
    const dz = worlds[i].z - cz;
    const x = cx + c * dx - s * dz;
    const z = cz + s * dx + c * dz;
    const tile = tileAtWorld({ x, z });
    if ((picks[i].kind === 'unit' || picks[i].kind === 'objective') && !tileOpen(tile.tx, tile.tz)) return;
    next.push({ x, z, tx: tile.tx, tz: tile.tz });
  }
  for (let i = 0; i < picks.length; i++) {
    const item = placeList(picks[i].kind)[picks[i].index];
    if (picks[i].kind === 'unit') {
      if (!writeUnitWorld(item, next[i].x, next[i].z)) return;
      turnYaw(item, step, false);
    } else if (picks[i].kind === 'objective') {
      item.tx = next[i].tx;
      item.tz = next[i].tz;
    } else if (picks[i].kind === 'building') {
      const snapped = snapBuildingWorld(String(item.type), fx.fromFloat(next[i].x), fx.fromFloat(next[i].z));
      item.x = fx.toFloat(snapped.x);
      item.z = fx.toFloat(snapped.z);
      turnYaw(item, step, true);
    } else if (picks[i].kind === 'agora') {
      const snapped = snapBuildingWorld('agora', fx.fromFloat(next[i].x), fx.fromFloat(next[i].z));
      item.x = fx.toFloat(snapped.x);
      item.z = fx.toFloat(snapped.z);
    }
  }
  updatePlaceMarkers();
}

function removePlacementAt(kind, index) {
  const list = placeList(kind);
  if (!list || index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  state.placePicks = state.placePicks.flatMap((p) => {
    if (p.kind !== kind) return [p];
    if (p.index === index) return [];
    if (p.index > index) return [{ kind: p.kind, index: p.index - 1 }];
    return [p];
  });
  placeDrag = null;
  return true;
}

function removeHitPlacement(pos) {
  const hit = hitPlacement(pos, ['unit', 'building', 'agora']);
  if (!hit) return false;
  return removePlacementAt(hit.kind, hit.index);
}

function deletePlacePick() {
  const grouped = { unit: [], building: [], agora: [], objective: [] };
  for (const p of state.placePicks) grouped[p.kind]?.push(p.index);
  for (const kind of Object.keys(grouped)) {
    const list = placeList(kind);
    if (!list) continue;
    const idx = [...new Set(grouped[kind])].sort((a, b) => b - a);
    for (const i of idx) {
      if (i >= 0 && i < list.length) list.splice(i, 1);
    }
  }
  state.placePicks = [];
  placeDrag = null;
  placeBox = null;
  syncPlacePickUi();
  updatePlaceMarkers();
}

function placeStoryPartyAt(tx, tz) {
  const placed = storyPartyPlacements(tx, tz, field.width, field.height, state.owner, 'row');
  state.units = mergeStoryParty(state.units, placed);
}

function placementsInBox(x0, z0, x1, z1) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  const picks = [];
  for (const kind of ['unit', 'building', 'agora']) {
    const list = placeList(kind) || [];
    for (let i = 0; i < list.length; i++) {
      const p = placementWorld(kind, list[i]);
      if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) {
        picks.push({ kind, index: i });
      }
    }
  }
  return picks;
}

function finishPlaceBox() {
  const box = placeBox;
  if (!box) return;
  placeBox = null;
  if (box.active) {
    state.placePicks = placementsInBox(box.x0, box.z0, box.x1, box.z1);
    syncPlacePickUi();
    updatePlaceMarkers();
    return;
  }
  // A click on empty ground places. It does not relocate the current selection.
  // Dragging the selection is what moves it. Relocating on click made the first
  // overlap (a grab) stick, so every later click destroyed the previous spot.
  applyPlace({ x: box.x0, z: box.z0 });
}

function hitZone(pos) {
  if (!pos || !field) return null;
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  let best = null;
  for (let i = 0; i < state.objectives.length; i++) {
    const obj = state.objectives[i];
    const x = ((obj.tx | 0) + 0.5) * TILE_SIZE_F - half;
    const z = ((obj.tz | 0) + 0.5) * TILE_SIZE_F - halfZ;
    const reach = Math.max(TILE_SIZE_F, (Number(obj.r) || 4) * TILE_SIZE_F);
    const d = Math.hypot(x - pos.x, z - pos.z);
    if (d > reach) continue;
    if (!best || d < best.d) best = { index: i, d };
  }
  return best;
}

function removeZoneById(id) {
  const index = state.objectives.findIndex((obj) => obj.id === id);
  if (index < 0) return false;
  state.objectives.splice(index, 1);
  if (state.waveEdit?.id === id) state.waveEdit = null;
  state.placePicks = state.placePicks.filter((p) => p.kind !== 'objective');
  placeDrag = null;
  return true;
}

function disarmZoneStamp() {
  if (state.placeKind !== 'objective') return;
  state.placeKind = '';
  document.querySelectorAll('[data-place="objective"]').forEach((el) => el.classList.remove('active'));
}

function selectGoal(index) {
  const obj = state.objectives[index];
  if (!obj) return;
  if (state.placeKind !== 'wavehop') state.placeKind = '';
  state.waveEdit = { id: obj.id };
  state.placePicks = [{ kind: 'objective', index }];
  renderWaveEditor();
  syncPlacePickUi();
  updatePlaceMarkers();
}

function selectZoneAt(index, pos, e) {
  const obj = state.objectives[index];
  state.waveEdit = obj ? { id: obj.id } : null;
  state.placePicks = [{ kind: 'objective', index }];
  beginGroupDrag(pos, e);
  renderWaveEditor();
  syncPlacePickUi();
  updatePlaceMarkers();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ }
}

function ringCenter(obj) {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    x: ((obj.tx | 0) + 0.5) * TILE_SIZE_F - half,
    z: ((obj.tz | 0) + 0.5) * TILE_SIZE_F - halfZ,
  };
}

function paintRingRadius(obj) {
  obj.r = Math.max(1, obj.r);
  const input = document.querySelector(`input[data-zone-field="radius"][data-zone-id="${obj.id}"]`);
  if (input && document.activeElement !== input) input.value = String(obj.r);
  updatePlaceMarkers();
}

function beginRingResize(index) {
  const obj = state.objectives[index];
  if (!obj) return;
  state.waveEdit = { id: obj.id };
  state.placePicks = [{ kind: 'objective', index }];
  ringGesture = { index, mode: 'radius' };
  renderWaveEditor();
  syncPlacePickUi();
  updatePlaceMarkers();
}

function beginRingDraw(pos, e) {
  applyPlace(pos);
  const index = state.objectives.length - 1;
  const obj = state.objectives[index];
  if (!obj) return;
  ringGesture = { index, mode: 'draw', moved: false, cx: e.clientX, cy: e.clientY };
}

function moveRingGesture(pos, e) {
  if (!ringGesture || !pos) return;
  const obj = state.objectives[ringGesture.index];
  if (!obj) return;
  if (ringGesture.mode === 'draw') {
    const travel = Math.hypot(e.clientX - ringGesture.cx, e.clientY - ringGesture.cy);
    if (travel < 6) return;
    ringGesture.moved = true;
  }
  const c = ringCenter(obj);
  obj.r = Math.max(1, Math.round((Math.hypot(pos.x - c.x, pos.z - c.z) / TILE_SIZE_F) * 2) / 2);
  paintRingRadius(obj);
}

function handleZonePointerDown(pos, e) {
  if (!pos) return;
  if (state.placeKind === 'wavehop') {
    applyPlace(pos);
    return;
  }
  if (e.shiftKey) {
    const hit = hitZone(pos);
    if (hit) removeZoneById(state.objectives[hit.index]?.id);
    renderWaveEditor();
    updatePlaceMarkers();
    return;
  }
  const hit = hitZone(pos);
  if (hit) {
    const obj = state.objectives[hit.index];
    const reach = Math.max(TILE_SIZE_F, (Number(obj?.r) || 4) * TILE_SIZE_F);
    if (hit.d > reach * 0.62) {
      beginRingResize(hit.index);
      return;
    }
    selectZoneAt(hit.index, pos, e);
    return;
  }
  if (state.placeKind === 'objective') beginRingDraw(pos, e);
}

function handlePlacePointerDown(pos, e) {
  if (!pos) return;
  if (e.shiftKey) {
    removeHitPlacement(pos);
    syncPlacePickUi();
    updatePlaceMarkers();
    return;
  }
  const hit = hitPlacement(pos);
  if (hit) {
    const already = state.placePicks.some((p) => p.kind === hit.kind && p.index === hit.index);
    if (!already) state.placePicks = [{ kind: hit.kind, index: hit.index }];
    beginGroupDrag(pos, e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    syncPlacePickUi();
    updatePlaceMarkers();
    return;
  }
  placeBox = {
    x0: pos.x, z0: pos.z, x1: pos.x, z1: pos.z,
    cx: e.clientX, cy: e.clientY,
    active: false,
  };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ }
}

function applyPlace(pos, { remove = false } = {}) {
  if (remove) {
    removeNearestPlacement(pos);
    updatePlaceMarkers();
    return;
  }
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
  const tz = Math.floor((pos.z + halfZ) / TILE_SIZE_F);
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return;
  if (field.activeMask?.[tz * field.width + tx] === 0) return;
  if (!state.placeKind) return;
  if (state.placeKind === 'party') {
    placeStoryPartyAt(tx, tz);
  } else if (state.placeKind === 'unit') {
    const name = String(document.getElementById('place-name')?.value || '').trim();
    state.units.push({ owner: state.owner, type: state.placeType | 0, tx, tz, name });
  } else if (state.placeKind === 'wavehop') {
    applyWaveHop(tx, tz);
  } else if (state.placeKind === 'objective') {
    const kind = String(document.getElementById('place-obj-kind')?.value || 'reach');
    const r = Math.max(0.5, Number(document.getElementById('place-obj-r')?.value) || 4);
    const label = String(document.getElementById('place-obj-label')?.value || '').trim();
    const message = String(document.getElementById('place-obj-message')?.value || '').trim();
    const next = String(document.getElementById('place-obj-next')?.value || '').trim();
    const params = collectWaveParams({
      waves: state.waveDraft.waves | 0,
      era: state.waveDraft.era | 0,
      route: state.waveRoute,
    });
    const terminal = document.getElementById('place-obj-terminal')?.value === '1'
      || kind === 'escape'
      || kind === 'advance';
    const id = `obj-${state.objectives.length}`;
    state.objectives.push({
      id,
      kind,
      tx,
      tz,
      r,
      label,
      message,
      next,
      ...(terminal ? { terminal: true } : {}),
      ...(params ? { params } : {}),
    });
    if (params) state.waveRoute = [];
    state.waveEdit = { id };
    renderWaveEditor();
  } else if (state.placeKind === 'agora') {
    const snapped = snapBuildingWorld('agora', fx.fromFloat(pos.x), fx.fromFloat(pos.z));
    state.agoras.push({ owner: state.owner, x: fx.toFloat(snapped.x), z: fx.toFloat(snapped.z) });
    settlePlacementScenery();
  } else {
    const snapped = snapBuildingWorld(String(state.placeType), fx.fromFloat(pos.x), fx.fromFloat(pos.z));
    state.buildings.push({
      owner: state.owner,
      type: String(state.placeType),
      x: fx.toFloat(snapped.x),
      z: fx.toFloat(snapped.z),
      yaw: 0,
    });
    settlePlacementScenery();
  }
  updatePlaceMarkers();
}

function removeNearestPlacement(pos) {
  const pickNear = (list, getXZ) => {
    let best = -1;
    let bestD = 4;
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
  const halfZ = worldHalfZFFromField(field);
  if (state.placeKind === 'unit' || state.placeKind === 'party') {
    pickNear(state.units, (u) => unitWorldXZ(u));
  } else if (state.placeKind === 'wavehop') {
    removeLastWaveHop();
  } else if (state.placeKind === 'objective') {
    pickNear(state.objectives, (o) => ({
      x: (o.tx + 0.5) * TILE_SIZE_F - half,
      z: (o.tz + 0.5) * TILE_SIZE_F - halfZ,
    }));
  } else if (state.placeKind === 'agora') {
    pickNear(state.agoras, (g) => ({ x: g.x, z: g.z }));
  } else {
    pickNear(state.buildings, (b) => ({ x: b.x, z: b.z }));
  }
}

function pushGoalRing(pos, idx, x, z, radius) {
  const lift = 0.55;
  const ribbon = 0.34;
  const n = Math.max(1, Math.ceil((radius * 2) / (TILE_SIZE_F * 0.5)));
  const yAt = (px, pz) => (field ? surfaceHeightAt(field, px, pz) : 0);
  const side = (ax, az, bx, bz) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;
      const y = Math.max(yAt(x0, z0), yAt(x1, z1), yAt((x0 + x1) * 0.5, (z0 + z1) * 0.5)) + lift;
      pushSelectEdge(pos, idx, x0, y, z0, x1, y, z1, ribbon);
    }
  };
  side(x - radius, z - radius, x + radius, z - radius);
  side(x + radius, z - radius, x + radius, z + radius);
  side(x + radius, z + radius, x - radius, z + radius);
  side(x - radius, z + radius, x - radius, z - radius);
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
  const halfZ = field ? worldHalfZFFromField(field) : 0;
  const addMarker = (name, positions, indices, color, order = 0) => {
    if (!positions.length) return;
    const pos = new Float32Array(positions);
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    const mesh = createMeshFromData(engine, name, pos, normals, new Uint32Array(indices));
    const mat = createStandardMaterial();
    mat.diffuseColor = color;
    mat.emissiveColor = order ? color : color.map((c) => c * 0.35);
    mat.ambientColor = color.map((c) => c * 0.4);
    mat.specularColor = [0, 0, 0];
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.pickable = false;
    if (order) mesh.renderOrder = order;
    addToScene(scene, mesh);
    placeMeshes.push(mesh);
  };
  const groundY = (x, z, lift) => (field ? surfaceHeightAt(field, x, z) : 0) + lift;
  placePreview?.sync({
    units: state.units.map((u) => ({
      owner: u.owner | 0,
      type: u.type | 0,
      x: unitWorldXZ(u).x,
      z: unitWorldXZ(u).z,
      yaw: u.yaw || 0,
      name: u.name || '',
    })),
    buildings: state.buildings.map((b) => ({
      owner: b.owner | 0,
      type: String(b.type),
      x: b.x,
      z: b.z,
      yaw: b.yaw ?? 0,
      built: 1,
      hp: 1,
    })),
  });
  const gPos = [];
  const gIdx = [];
  for (const g of state.agoras) {
    pushBoxMarker(gPos, gIdx, g.x, groundY(g.x, g.z, 0.4), g.z, 16, 4, 16);
  }
  addMarker('forge-agoras', gPos, gIdx, [0.95, 0.85, 0.25]);
  if (field) {
    state.objectives.forEach((obj, i) => {
      const c = ringCenter(obj);
      const radius = Math.max(TILE_SIZE_F, (Number(obj.r) || 4) * TILE_SIZE_F);
      const pos = [];
      const idx = [];
      pushGoalRing(pos, idx, c.x, c.z, radius);
      const ink = goalInk(i).map((v) => (state.waveEdit?.id === obj.id ? Math.min(1, v + 0.22) : v));
      addMarker(`forge-goal-${i}`, pos, idx, ink, 48);
    });
  }
  if (field) {
    const hopPos = [];
    const hopIdx = [];
    const selPos = [];
    const selIdx = [];
    const pushHop = (wp, selected) => {
      const tile = waveFracToTile(wp[0], wp[1], field.width, field.height);
      const wx = (tile.tx + 0.5) * TILE_SIZE_F - half;
      const wz = (tile.tz + 0.5) * TILE_SIZE_F - halfZ;
      pushBoxMarker(selected ? selPos : hopPos, selected ? selIdx : hopIdx, wx, groundY(wx, wz, 1.6), wz, 4.2, 5, 4.2);
    };
    for (const obj of state.objectives) {
      const route = obj.params?.route || [];
      route.forEach((wp, i) => pushHop(wp, selectedHop(state.waveEdit, obj.id, i, false)));
    }
    state.waveRoute.forEach((wp, i) => pushHop(wp, selectedHop(state.waveEdit, '', i, true)));
    addMarker('forge-wave-hops', hopPos, hopIdx, [1, 0.55, 0.18]);
    addMarker('forge-wave-hop-selected', selPos, selIdx, [0.45, 0.95, 1]);
  }
  if (placeBox?.active) {
    const box = {
      x0: Math.min(placeBox.x0, placeBox.x1),
      x1: Math.max(placeBox.x0, placeBox.x1),
      z0: Math.min(placeBox.z0, placeBox.z1),
      z1: Math.max(placeBox.z0, placeBox.z1),
    };
    const bPos = [];
    const bIdx = [];
    pushCellRim(bPos, bIdx, box, 0.45, 0.28);
    addMarker('forge-select-box', bPos, bIdx, [0.45, 0.95, 1]);
  }
  const sPos = [];
  const sIdx = [];
  for (const pick of state.placePicks) {
    const picked = placeList(pick.kind)?.[pick.index];
    if (!picked) continue;
    const p = placementWorld(pick.kind, picked);
    const span = Math.min(4.2, grabReach(pick.kind, picked) * 2);
    pushBoxMarker(sPos, sIdx, p.x, groundY(p.x, p.z, 0.15), p.z, span, 0.25, span);
  }
  if (sPos.length) {
    addMarker('forge-pick', sPos, sIdx, [0.25, 1, 0.85]);
  }
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function flushTerrainPaint() {
  paintRaf = 0;
  const tiles = pendingPaintTiles.splice(0);
  if (!tiles.length || !field) return;
  applyAuthoredScenery(field);
  restampWallPass();
  drawWallBodies();
  updateWallGhost(false);
  // Flattening a pond moves water outside the brush. Those chunks have to
  // rebuild too, or the sheet splits along the last updated edge.
  const waterMoved = consumeWaterDirty(field);
  for (let i = 0; i < waterMoved.length; i++) tiles.push(waterMoved[i]);
  const keys = dirtyAtlasChunks(field, tiles);
  if (terrain?.rebuildAtlasChunks?.(field, keys)) {
    grid?.refreshOccupancy(field);
    refreshDrapeOverlays();
    if (sceneRegistered) invalidateRenderBundles(engine);
    return;
  }
  scheduleRebuild();
}

function pushSelectEdge(pos, idx, ax, ay, az, bx, by, bz, half) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * half;
  const pz = (dx / len) * half;
  const base = pos.length / 3;
  pos.push(
    ax + px, ay, az + pz,
    bx + px, by, bz + pz,
    bx - px, by, bz - pz,
    ax - px, ay, az - pz,
  );
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function chunkCornerY(x, z, lift) {
  return (field ? surfaceHeightAt(field, x, z) : 0) + lift;
}

function pushCellRim(pos, idx, box, lift, half) {
  const y00 = chunkCornerY(box.x0, box.z0, lift);
  const y10 = chunkCornerY(box.x1, box.z0, lift);
  const y11 = chunkCornerY(box.x1, box.z1, lift);
  const y01 = chunkCornerY(box.x0, box.z1, lift);
  pushSelectEdge(pos, idx, box.x0, y00, box.z0, box.x1, y10, box.z0, half);
  pushSelectEdge(pos, idx, box.x1, y10, box.z0, box.x1, y11, box.z1, half);
  pushSelectEdge(pos, idx, box.x1, y11, box.z1, box.x0, y01, box.z1, half);
  pushSelectEdge(pos, idx, box.x0, y01, box.z1, box.x0, y00, box.z0, half);
}

function makeOverlayMesh(name, pos, idx, color) {
  if (!pos.length || !engine || !scene) return null;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const mesh = createMeshFromData(engine, name, positions, normals, new Uint32Array(idx));
  const mat = createStandardMaterial();
  mat.diffuseColor = color;
  mat.emissiveColor = color;
  mat.ambientColor = color;
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  addToScene(scene, mesh);
  return mesh;
}

function dropOverlay(mesh) {
  if (!mesh) return null;
  softDetachMesh(scene, mesh);
  return null;
}

function isSelected(cx, cz) {
  return state.selected.some((s) => s.cx === cx && s.cz === cz);
}

function updateSelectIndicator({ invalidate = true, ui = true } = {}) {
  selectMesh = dropOverlay(selectMesh);
  chunkGridMesh = dropOverlay(chunkGridMesh);
  const shape = field?.tableShape;
  const wantSelect = state.layer === 'table' && state.selected.length > 0;
  const wantChunks = state.showChunks;
  if (shape && engine && scene && (wantChunks || wantSelect)) {
    const gridPos = [];
    const gridIdx = [];
    const selPos = [];
    const selIdx = [];
    for (let cz = 0; cz < shape.chunksZ; cz++) {
      for (let cx = 0; cx < shape.chunksX; cx++) {
        const box = cellWorldBox(field, cx, cz, shape.cellSize);
        const on = isCellEnabled(shape, cx, cz);
        if (wantSelect && isSelected(cx, cz)) pushCellRim(selPos, selIdx, box, 5.5, 5.2);
        else if (wantChunks) pushCellRim(gridPos, gridIdx, box, on ? 3.2 : 2.4, on ? 1.6 : 1.1);
      }
    }
    chunkGridMesh = makeOverlayMesh('chunk-grid', gridPos, gridIdx, [0.95, 0.82, 0.22]);
    selectMesh = makeOverlayMesh('chunk-select', selPos, selIdx, [0.15, 1, 1]);
  }
  if (invalidate && sceneRegistered) invalidateRenderBundles(engine);
  if (ui) updateSelectUi();
}

const TILE_WIRE_LIFT = 0.18;
const TILE_WIRE_HALF = 0.02;

function clearTileWireTimer() {
  if (!tileWireTimer) return;
  clearTimeout(tileWireTimer);
  tileWireTimer = 0;
}

function updateTileWire({ invalidate = true } = {}) {
  clearTileWireTimer();
  const had = !!tileWireMesh;
  tileWireMesh = dropOverlay(tileWireMesh);
  if (!state.showTiles || !field || !engine || !scene) {
    if (invalidate && had && sceneRegistered) invalidateRenderBundles(engine);
    return;
  }
  const { width, height } = field;
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  const mask = field.activeMask;
  const tileOn = (tx, tz) => (
    tx >= 0 && tz >= 0 && tx < width && tz < height
    && !(mask && mask[tz * width + tx] === 0)
  );
  const yAt = (tx, tz) => tileHeightWorld(field, tx, tz) + TILE_WIRE_LIFT;
  const pos = [];
  const idx = [];
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (!tileOn(tx, tz)) continue;
      const x0 = tx * TILE_SIZE_F - half;
      const x1 = (tx + 1) * TILE_SIZE_F - half;
      const z0 = tz * TILE_SIZE_F - halfZ;
      const z1 = (tz + 1) * TILE_SIZE_F - halfZ;
      const y00 = yAt(tx, tz);
      const y10 = yAt(tx + 1, tz);
      const y11 = yAt(tx + 1, tz + 1);
      const y01 = yAt(tx, tz + 1);
      pushSelectEdge(pos, idx, x0, y00, z0, x1, y10, z0, TILE_WIRE_HALF);
      pushSelectEdge(pos, idx, x0, y00, z0, x0, y01, z1, TILE_WIRE_HALF);
      if (!tileOn(tx + 1, tz)) pushSelectEdge(pos, idx, x1, y10, z0, x1, y11, z1, TILE_WIRE_HALF);
      if (!tileOn(tx, tz + 1)) pushSelectEdge(pos, idx, x0, y01, z1, x1, y11, z1, TILE_WIRE_HALF);
      // Same diagonal as the terrain quad, so the fold of the slope shows.
      pushSelectEdge(pos, idx, x0, y00, z0, x1, y11, z1, TILE_WIRE_HALF);
    }
  }
  tileWireMesh = makeOverlayMesh('tile-wire', pos, idx, [0.55, 0.9, 1]);
  if (invalidate && sceneRegistered) invalidateRenderBundles(engine);
}

function scheduleTileWire() {
  if (overlayFreeze || !state.showTiles) return;
  const now = performance.now();
  if (now >= tileWireStamp) {
    tileWireStamp = now + 140;
    updateTileWire();
    return;
  }
  if (tileWireTimer) return;
  tileWireTimer = setTimeout(() => {
    tileWireTimer = 0;
    tileWireStamp = performance.now() + 140;
    if (!overlayFreeze && state.showTiles) updateTileWire();
  }, tileWireStamp - now);
}

function refreshDrapeOverlays() {
  if (overlayFreeze) return;
  if (state.showChunks || (state.layer === 'table' && state.selected.length > 0)) {
    updateSelectIndicator({ invalidate: false, ui: false });
  }
  if (state.showTiles) scheduleTileWire();
}

function brushColor() {
  if (state.layer === 'terrain') {
    if (state.lift === 'level') return [0.82, 0.86, 0.78];
    if (state.lift > 0) return [0.95, 0.78, 0.28];
    if (state.lift < 0) return [0.40, 0.72, 1.0];
    if (state.terrain === TERRAIN.DIRT) return [0.78, 0.55, 0.30];
    if (state.terrain === TERRAIN.WATER) return [0.28, 0.62, 0.98];
    if (state.terrain === TERRAIN.GRAVEL) return [0.28, 0.28, 0.30];
    if (state.terrain === TERRAIN.TILE) return [0.72, 0.72, 0.74];
    return [0.35, 0.88, 0.42];
  }
  if (state.stamp === 'doodad') {
    if (state.doodad === DOODAD.NONE) return [0.95, 0.32, 0.28];
    if (state.doodad === DOODAD.WAGON) return [0.72, 0.52, 0.28];
    return [0.78, 0.58, 0.22];
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
  const halfZ = worldHalfZFFromField(field);
  const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
  const tz = Math.floor((pos.z + halfZ) / TILE_SIZE_F);
  const key = `${tx},${tz},${state.brush},${state.layer},${state.lift},${state.terrain},${state.stamp},${state.scenery},${state.doodad}`;
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
      const z0 = z * TILE_SIZE_F - halfZ + pad;
      const z1 = (z + 1) * TILE_SIZE_F - halfZ - pad;
      const y00 = surfaceHeightAt(field, x0, z0) + lift;
      const y10 = surfaceHeightAt(field, x1, z0) + lift;
      const y11 = surfaceHeightAt(field, x1, z1) + lift;
      const y01 = surfaceHeightAt(field, x0, z1) + lift;
      const base = posArr.length / 3;
      posArr.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      const wx0 = x * TILE_SIZE_F - half;
      const wx1 = wx0 + TILE_SIZE_F;
      const wz0 = z * TILE_SIZE_F - halfZ;
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

function sampleWallHeight(x, z) {
  return surfaceHeightAt(field, x, z);
}

function wallStatusText() {
  const n = state.walls.runs.length;
  const draft = state.wallDraft.length;
  let doors = 0;
  let openDoors = 0;
  let gates = 0;
  let openGates = 0;
  for (const run of state.walls.runs) {
    for (const opening of run.openings || []) {
      if (opening.gate) {
        if (opening.open) openGates += 1;
        else gates += 1;
      } else if (opening.open) openDoors += 1;
      else doors += 1;
    }
  }
  const bits = [n === 1 ? '1 run' : `${n} runs`];
  if (doors) bits.push(doors === 1 ? '1 door' : `${doors} doors`);
  if (openDoors) bits.push(openDoors === 1 ? '1 open door' : `${openDoors} open doors`);
  if (gates) bits.push(gates === 1 ? '1 gate' : `${gates} gates`);
  if (openGates) bits.push(openGates === 1 ? '1 open gate' : `${openGates} open gates`);
  if (draft) bits.push(`draft ${draft} corner${draft === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function syncWallStatus() {
  const status = document.getElementById('wall-status');
  if (status) status.textContent = wallStatusText();
}

function syncWallTools() {
  document.querySelectorAll('[data-wall-kind]').forEach((b) => {
    b.classList.toggle('active', b.dataset.wallKind === state.wallKind);
  });
  document.querySelectorAll('[data-wall-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.wallTool === state.wallTool);
  });
}

function syncWallUi() {
  const style = state.walls?.style;
  if (!style) return;
  for (const spec of WALL_FIELDS) {
    const el = document.getElementById(spec.id);
    if (!el) return;
    el.value = String(style[spec.key]);
    const label = document.getElementById(`${spec.id}-label`);
    if (label) label.textContent = Number(style[spec.key]).toFixed(2);
  }
  syncWallStatus();
  syncWallTools();
}

function previewWallRun() {
  if (state.layer !== 'walls' || state.wallTool !== 'lay') return null;
  const pts = state.wallDraft.map((p) => ({ x: p.x, z: p.z }));
  if (!pts.length) return null;
  let closed = false;
  if (wallCursor && !sameWallCorner(wallCursor, pts[pts.length - 1])) {
    if (pts.length >= 3 && sameWallCorner(wallCursor, pts[0])) closed = true;
    else pts.push({ x: wallCursor.x, z: wallCursor.z });
  }
  return {
    points: pts,
    closed,
    kind: state.wallKind,
    openings: state.wallDraftOpenings || [],
  };
}

function ensureWallMaterials() {
  if (!wallMats && engine) wallMats = createWallMaterials(engine);
  return wallMats;
}

function swapWallMesh(current, name, geometry, material, shadows) {
  if (current) softDetachMesh(scene, current);
  const mesh = createWallMesh(engine, name, geometry, material, { shadows });
  if (mesh) addToScene(scene, mesh);
  return mesh;
}

function restampWallPass() {
  if (!field) return;
  applyWallOccupancy(field, wallsForGarden());
  let blocked = false;
  const mask = field.wallBlock;
  if (mask) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        blocked = true;
        break;
      }
    }
  }
  if (blocked && !passGridLatched && !state.showGrid) {
    state.showGrid = true;
    grid?.setVisible(true);
    const box = document.getElementById('show-grid');
    if (box) box.checked = true;
  }
  if (blocked) passGridLatched = true;
  grid?.refreshOccupancy(field);
}

function updateWallGhost(invalidate = true) {
  if (!engine || !scene || !field) return;
  const mats = ensureWallMaterials();
  if (!mats) return;
  const preview = previewWallRun();
  const ghost = buildWallGeometry(preview ? [preview] : [], state.walls.style, sampleWallHeight);
  const dungeon = state.wallKind === 'dungeon';
  const part = dungeon ? ghost.dungeon : ghost.castle;
  const ghostMat = dungeon ? mats.dungeonGhost : mats.castleGhost;
  wallGhostMesh = swapWallMesh(wallGhostMesh, 'forge-walls-draft', part, ghostMat, false);
  wallGhostWood = swapWallMesh(wallGhostWood, 'forge-walls-draft-wood', ghost.wood, mats.wood, false);
  wallGhostIron = swapWallMesh(wallGhostIron, 'forge-walls-draft-iron', ghost.iron, mats.iron, false);
  if (invalidate && sceneRegistered) invalidateRenderBundles(engine);
  syncWallStatus();
}

function updateWallMeshes() {
  if (!engine || !scene || !field) return;
  const mats = ensureWallMaterials();
  if (!mats) return;
  restampWallPass();
  drawWallBodies();
  updateWallGhost(false);
  syncWallStatus();
}

function commitWallDraft(closed) {
  state.walls.runs.push({
    points: state.wallDraft.map((q) => ({ x: q.x, z: q.z })),
    closed,
    kind: state.wallKind,
    openings: (state.wallDraftOpenings || []).map((o) => ({ ...o })),
  });
  state.wallDraft = [];
  state.wallDraftOpenings = [];
}

function addWallPoint(pos) {
  if (!pos || !field) return;
  const p = snapWallCorner(field, pos.x, pos.z);
  const draft = state.wallDraft;
  if (draft.length >= 3 && sameWallCorner(p, draft[0])) {
    commitWallDraft(true);
    updateWallMeshes();
    return;
  }
  if (draft.length && sameWallCorner(p, draft[draft.length - 1])) return;
  draft.push(p);
  updateWallMeshes();
}

function deleteWallAt(pos) {
  if (!pos) return;
  const removed = removeWallSection(state.walls.runs, pos.x, pos.z);
  clearSectionMarker();
  updateWallMeshes();
  if (state.wallTool === 'erase') updateSectionMarker(pos);
  else if (!removed) setWallAim('Shift-click a wall section to remove it.');
}

function finishWallRun() {
  const had = state.wallDraft.length;
  wallCursor = null;
  if (had >= 2) commitWallDraft(false);
  else if (had) {
    state.wallDraft = [];
    state.wallDraftOpenings = [];
  } else return;
  updateWallMeshes();
}

function popWallDraftPoint() {
  if (!state.wallDraft.length) return;
  state.wallDraft.pop();
  updateWallMeshes();
}

function cancelWallDraft() {
  if (!state.wallDraft.length && !(state.wallDraftOpenings || []).length) return;
  state.wallDraft = [];
  state.wallDraftOpenings = [];
  updateWallMeshes();
}

function clearOpeningMarker() {
  const had = openingHover;
  openingKey = '';
  openingHover = null;
  if (had) drawWallBodies();
}

function runsForDraw() {
  if (!openingHover) return state.walls.runs;
  return state.walls.runs.map((run) => {
    if (run !== openingHover.run) return run;
    return {
      ...run,
      openings: [...(run.openings || []), {
        d: openingHover.d,
        span: openingHover.span,
        gate: openingHover.gate,
        open: openingHover.open,
      }],
    };
  });
}

function drawWallBodies() {
  const mats = ensureWallMaterials();
  if (!mats || !engine || !scene || !field) return;
  const geom = buildWallGeometry(runsForDraw(), state.walls.style, sampleWallHeight);
  wallParts.castle = swapWallMesh(wallParts.castle, 'forge-walls-castle', geom.castle, mats.castle, true);
  wallParts.dungeon = swapWallMesh(wallParts.dungeon, 'forge-walls-dungeon', geom.dungeon, mats.dungeon, true);
  wallParts.wood = swapWallMesh(wallParts.wood, 'forge-walls-wood', geom.wood, mats.wood, true);
  wallParts.iron = swapWallMesh(wallParts.iron, 'forge-walls-iron', geom.iron, mats.iron, true);
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function setWallAim(text) {
  const aim = document.getElementById('wall-aim');
  if (aim) aim.textContent = text || '';
}

function clearSectionMarker() {
  sectionKey = '';
  if (!sectionMarker) return;
  softDetachMesh(scene, sectionMarker);
  sectionMarker = null;
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function layAimText() {
  return 'Wall: click corners. Right-click finishes the run. Backspace drops the last corner. Erase takes out one section.';
}

function updateSectionMarker(pos) {
  const hit = pos ? previewWallSection(state.walls.runs, pos.x, pos.z) : { ok: false };
  const key = hit.ok ? `${hit.a.x},${hit.a.z},${hit.b.x},${hit.b.z}` : '';
  setWallAim(hit.ok
    ? (state.wallTool === 'erase'
      ? 'Click removes this section. Right-click returns to walls.'
      : 'Shift-click removes this section.')
    : (state.wallTool === 'erase'
      ? 'Click a wall section to remove it. Right-click returns to walls.'
      : 'Shift-click a wall section to remove it. Clear wipes every wall.'));
  if (key === sectionKey) return;
  sectionKey = key;
  if (sectionMarker) {
    softDetachMesh(scene, sectionMarker);
    sectionMarker = null;
  }
  if (hit.ok && engine && scene && field) {
    const ya = surfaceHeightAt(field, hit.a.x, hit.a.z);
    const yb = surfaceHeightAt(field, hit.b.x, hit.b.z);
    const rise = state.walls.style.height || 6;
    const positions = new Float32Array([
      hit.a.x, ya, hit.a.z, hit.b.x, yb, hit.b.z, hit.b.x, yb + rise, hit.b.z, hit.a.x, ya + rise, hit.a.z,
      hit.a.x, ya, hit.a.z, hit.a.x, ya + rise, hit.a.z, hit.b.x, yb + rise, hit.b.z, hit.b.x, yb, hit.b.z,
    ]);
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const mesh = createMeshFromData(
      engine,
      'forge-wall-section',
      positions,
      normals,
      new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
      new Float32Array(16),
    );
    const mat = createStandardMaterial();
    mat.diffuseColor = [0.95, 0.28, 0.22];
    mat.emissiveColor = [0.85, 0.2, 0.16];
    mat.ambientColor = [0.6, 0.15, 0.12];
    mat.specularColor = [0, 0, 0];
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.55;
    mesh.material = mat;
    mesh.pickable = false;
    addToScene(scene, mesh);
    sectionMarker = mesh;
  }
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function setWallTool(tool) {
  state.wallTool = tool || 'lay';
  syncWallTools();
  clearOpeningMarker();
  if (state.wallTool === 'lay') {
    clearSectionMarker();
    setWallAim(layAimText());
    updateWallGhost();
  } else if (state.wallTool === 'erase') {
    updateSectionMarker(lastBrushWorld);
  } else {
    clearSectionMarker();
    updateOpeningMarker(lastBrushWorld);
  }
  syncHand();
}

function wallOpeningMode() {
  switch (state.wallTool) {
    case 'door': return { gate: false, open: false, name: 'door' };
    case 'door-open': return { gate: false, open: true, name: 'open door' };
    case 'gate': return { gate: true, open: false, name: 'gate' };
    case 'gate-open': return { gate: true, open: true, name: 'open gate' };
    default: return null;
  }
}
function updateOpeningMarker(pos) {
  const mode = wallOpeningMode();
  const phrase = mode ? `${/^[aeiou]/.test(mode.name) ? 'an' : 'a'} ${mode.name}` : '';
  const idle = mode ? `Click a finished wall to cut ${phrase}. Right-click returns to walls.` : layAimText();
  const hit = pos && mode
    ? previewWallOpening(state.walls.runs, pos.x, pos.z, mode.gate)
    : { ok: false, reason: idle };
  const key = hit.ok
    ? `${mode.name}:${hit.d.toFixed(2)}:${hit.x.toFixed(2)}:${hit.z.toFixed(2)}`
    : `x:${hit.reason || ''}`;
  setWallAim(hit.ok ? `Click to cut ${phrase} here. Right-click returns to walls.` : hit.reason);
  if (key === openingKey) return;
  openingKey = key;
  openingHover = hit.ok ? {
    run: hit.run,
    d: hit.d,
    span: hit.span,
    gate: hit.gate,
    open: mode.open ? 1 : 0,
  } : null;
  drawWallBodies();
}

function updateWallCursor(pos, shift = false) {
  if (state.layer !== 'walls' || !pos || !field) {
    if (wallCursor || openingHover || sectionMarker) {
      wallCursor = null;
      clearOpeningMarker();
      clearSectionMarker();
      setWallAim(state.layer === 'walls' ? layAimText() : '');
      updateWallGhost();
    }
    return;
  }
  if (wallOpeningMode()) {
    clearSectionMarker();
    updateOpeningMarker(pos);
    return;
  }
  if (shift || state.wallTool === 'erase') {
    updateSectionMarker(pos);
    return;
  }
  if (sectionMarker) clearSectionMarker();
  setWallAim(layAimText());
  const p = snapWallCorner(field, pos.x, pos.z);
  if (wallCursor && sameWallCorner(wallCursor, p)) return;
  wallCursor = p;
  updateWallGhost();
}

async function rebuildTerrain() {
  cancelPendingPaint();
  overlayFreeze++;
  clearTileWireTimer();
  const gen = ++fieldGen;
  const snap = field;
  const prev = terrain;
  const prevGrid = grid;
  terrain = null;
  grid = null;
  prev?.dispose?.();
  prevGrid?.dispose?.();
  tileWireMesh = dropOverlay(tileWireMesh);
  try {
    const next = await createTerrainFromField(engine, scene, snap, camera, {
      skipScenery: false,
      // Editor meshes (including the draft ghost) are drawn separately.
      skipWalls: true,
      chunkedAtlas: true,
    });
    if (gen !== fieldGen) {
      next.dispose?.();
      return;
    }
    terrain = next;
    terrain.setSceneryVisible?.(state.showScenery);
    grid = createTileGridOverlay(engine, scene, snap, { edges: false, overModels: true });
    grid.setVisible(state.showGrid);
    if (!sceneRegistered) {
      await registerScene(scene);
      sceneRegistered = true;
    } else {
      invalidateRenderBundles(engine);
    }
    updateSelectIndicator();
    updateTileWire();
    updatePlaceMarkers();
    updateCameraBoundMesh();
    refreshBrushCursor();
    updateWallMeshes();
    updateStats();
  } finally {
    overlayFreeze = Math.max(0, overlayFreeze - 1);
  }
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
  clearOffTableScenery(field);
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

function propList() {
  if (!field) return [];
  if (!Array.isArray(field.backdrops)) field.backdrops = [];
  return field.backdrops;
}

function selectedProp() {
  const list = field?.backdrops;
  if (!list || state.propIndex < 0 || state.propIndex >= list.length) return null;
  return list[state.propIndex];
}

function setTableTool(tool) {
  state.tableTool = tool === 'props' ? 'props' : 'chunks';
  if (state.tableTool !== 'props') {
    state.propArmed = false;
    propDrag = null;
    propReturnChunks = false;
  }
  document.getElementById('table-tool-chunks')?.classList.toggle('active', state.tableTool === 'chunks');
  document.getElementById('table-tool-props')?.classList.toggle('active', state.tableTool === 'props');
  syncPropUi();
  updateSelectUi();
  syncHand();
}

function syncPropUi() {
  const list = field?.backdrops || [];
  const box = document.getElementById('prop-list');
  if (box) {
    box.replaceChildren();
    if (!list.length) box.textContent = 'No props.';
    list.forEach((pose, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.propIndex = String(i);
      btn.textContent = `${BACKDROP_DEFS[pose.type]?.label || pose.type} · ${Math.round(pose.scale)}`;
      btn.classList.toggle('active', i === state.propIndex);
      box.append(btn);
    });
  }
  document.querySelectorAll('[data-prop]').forEach((btn) => {
    btn.classList.toggle('active', state.propArmed && btn.dataset.prop === state.propType);
  });
  const pose = selectedProp();
  const scale = document.getElementById('prop-scale');
  const y = document.getElementById('prop-y');
  const yaw = document.getElementById('prop-yaw');
  const scaleLabel = document.getElementById('prop-scale-label');
  const yLabel = document.getElementById('prop-y-label');
  const yawLabel = document.getElementById('prop-yaw-label');
  if (scale) {
    scale.disabled = !pose;
    if (pose && document.activeElement !== scale) scale.value = String(Math.round(pose.scale));
  }
  if (y) {
    y.disabled = !pose;
    if (pose && document.activeElement !== y) y.value = String(Math.round(pose.y));
  }
  if (yaw) {
    yaw.disabled = !pose;
    if (pose && document.activeElement !== yaw) {
      yaw.value = String(Math.round((pose.yaw * 180) / Math.PI) % 360);
    }
  }
  if (scaleLabel) scaleLabel.textContent = pose ? String(Math.round(pose.scale)) : '-';
  if (yLabel) yLabel.textContent = pose ? String(Math.round(pose.y)) : '-';
  if (yawLabel) yawLabel.textContent = pose ? String(Math.round((pose.yaw * 180) / Math.PI) % 360) : '-';
  const remove = document.getElementById('btn-prop-remove');
  if (remove) remove.disabled = !pose;
}

function poseProps() {
  if (!terrain) return;
  if (terrain.applyBackdropPoses?.(field)) {
    if (sceneRegistered) invalidateRenderBundles(engine);
    return;
  }
  const gen = ++propSyncGen;
  const pending = terrain.syncBackdrops?.(field);
  if (!pending?.then) return;
  pending.then((ok) => {
    if (!ok || gen !== propSyncGen) return;
    if (sceneRegistered) invalidateRenderBundles(engine);
  }).catch((err) => {
    console.warn('[forge] prop sync failed', err);
  });
}

function propGesture(pos) {
  if (!pos) return false;
  if (state.propArmed) return true;
  return nearestBackdrop(propList(), pos.x, pos.z) >= 0;
}

function placeOrGrabProp(pos) {
  if (!pos || !field) return;
  const list = propList();
  const hit = nearestBackdrop(list, pos.x, pos.z);
  if (hit >= 0) {
    state.propIndex = hit;
    propDrag = { index: hit, dx: list[hit].x - pos.x, dz: list[hit].z - pos.z };
    syncPropUi();
    return;
  }
  if (!state.propArmed) return;
  const pose = freshBackdrop(state.propType, pos.x, pos.z);
  if (!pose) return;
  list.push(pose);
  state.propIndex = list.length - 1;
  propDrag = { index: state.propIndex, dx: 0, dz: 0 };
  state.propArmed = false;
  propReturnChunks = true;
  syncPropUi();
  poseProps();
}

function movePropDrag(pos) {
  if (!propDrag || !pos) return;
  const pose = propList()[propDrag.index];
  if (!pose) return;
  pose.x = Math.round((pos.x + propDrag.dx) * 1000) / 1000;
  pose.z = Math.round((pos.z + propDrag.dz) * 1000) / 1000;
  poseProps();
}

function patchSelectedProp(partial) {
  const pose = selectedProp();
  if (!pose) return;
  if (partial.scale != null && partial.y == null) {
    const seated = defaultBackdropY(pose.type, pose.scale);
    if (Math.abs(pose.y - seated) < 0.05) {
      partial = { ...partial, y: defaultBackdropY(pose.type, partial.scale) };
    }
  }
  Object.assign(pose, partial);
  syncPropUi();
  poseProps();
}

function removeSelectedProp() {
  const list = propList();
  if (state.propIndex < 0 || state.propIndex >= list.length) return;
  list.splice(state.propIndex, 1);
  state.propIndex = list.length ? Math.min(state.propIndex, list.length - 1) : -1;
  propDrag = null;
  syncPropUi();
  poseProps();
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
    const halfZ = worldHalfZFFromField(field);
    const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
    const tz = Math.floor((pos.z + halfZ) / TILE_SIZE_F);
    const leveling = state.lift === 'level';
    const key = leveling
      ? `level:${tx}:${tz}:${state.brush}:${state.liftStrength}`
      : `terrain:${tx}:${tz}:${state.brush}:${state.lift}:${state.liftStrength}:${state.terrain}:${add ? 1 : 0}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    if (leveling && (levelHold == null || !Number.isFinite(levelHold))) {
      levelHold = tileHeightWorld(field, tx, tz) / HEIGHT_AMPLITUDE;
    }
    const dirty = leveling
      ? paintRegionLevel(field, tx, tz, levelHold, state.liftStrength / 10, state.brush)
      : state.lift
        ? paintRegionLift(
          field,
          tx,
          tz,
          (add ? -state.lift : state.lift) * REGION_LIFT_STEP * (state.liftStrength / 10),
          state.brush,
        )
        : paintTerrainBrush(field, tx, tz, state.terrain, state.brush);
    if (!leveling && !state.lift && state.terrain === TERRAIN.WATER) {
      const cleared = clearSceneryOnWater(field, tx, tz, state.brush);
      if (cleared.length) {
        field.sceneryAuthored = true;
        queueSceneryPaint(cleared);
      }
    }
    if (dirty.length) {
      queueTerrainPaint(dirty);
      if (state.lift) refreshBrushCursor();
    }
    return;
  }
  if (state.layer === 'scenery') {
    const half = worldHalfFFromField(field);
    const halfZ = worldHalfZFFromField(field);
    const tx = Math.floor((pos.x + half) / TILE_SIZE_F);
    const tz = Math.floor((pos.z + halfZ) / TILE_SIZE_F);
    const stamp = state.stamp === 'doodad' ? state.doodad : state.scenery;
    const key = `scenery:${tx}:${tz}:${state.brush}:${state.stamp}:${stamp}:${state.sceneryDensity}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    if (state.stamp !== 'doodad') stampStructureClaim();
    const dirty = state.stamp === 'doodad'
      ? paintDoodadBrush(field, tx, tz, state.doodad, state.brush, {
        density: state.sceneryDensity / 10,
        salt: scenerySalt,
      })
      : paintSceneryBrush(field, tx, tz, state.scenery, state.brush, {
        refresh: false,
        tight: true,
        density: state.sceneryDensity / 10,
        salt: scenerySalt,
      });
    if (state.stamp !== 'doodad' && dirty.length) field.sceneryAuthored = true;
    if (dirty.length) {
      if (terrain?.applyAuthoredSceneryTiles) {
        terrain.applyAuthoredSceneryTiles(field, dirty);
        if (sceneRegistered) invalidateRenderBundles(engine);
      }
      queueSceneryPaint(dirty);
    }
    return;
  }
  if (state.layer === 'story') {
    aimStoryCamera(pos);
    return;
  }
  if (state.layer === 'place') applyPlace(pos, { remove: add });
}

function tableHalfF() {
  return field ? worldHalfFFromField(field) : 0;
}

function tableHalfZF() {
  return field ? worldHalfZFFromField(field) : 0;
}

function cameraExtents() {
  return resolveCameraExtents(tableHalfF(), tableHalfZF(), state.cameraHalfF);
}

function syncCenterPlinthUi() {
  const el = document.getElementById('center-plinth');
  if (el) el.checked = !field?.suppressCenterBlock;
}

function setCenterPlinth(on) {
  if (!field) return;
  applyTableSilhouette(field, {
    cellSize: field.tableShape?.cellSize,
    cellMask: field.tableShape?.cellMask,
    cellRadius: field.tableShape?.cellRadius,
    suppressCenterBlock: !on,
  });
  syncCenterPlinthUi();
  scheduleRebuild();
}

function authoredCameraHalfF() {
  return resolveCameraHalfF(tableHalfF(), state.cameraHalfF);
}

function cameraBoundPct() {
  const table = tableHalfF();
  if (!(table > 0)) return 100;
  return Math.max(20, Math.min(100, Math.round((authoredCameraHalfF() / table) * 100)));
}

function applyCameraBound() {
  const ext = cameraExtents();
  cam?.setWorldHalfF?.(ext.x, ext.z);
  updateCameraBoundMesh();
  syncCameraBoundUi();
}

function syncCameraBoundUi() {
  const slider = document.getElementById('camera-bound');
  const label = document.getElementById('camera-bound-label');
  const pct = cameraBoundPct();
  if (slider) slider.value = String(pct);
  if (label) label.textContent = `${pct}%`;
}

function setCameraBoundPct(pct) {
  const table = tableHalfF();
  const frac = Math.max(0.2, Math.min(1, (Number(pct) || 100) / 100));
  state.cameraHalfF = frac >= 0.995 || !(table > 0) ? 0 : table * frac;
  applyCameraBound();
}

function updateCameraBoundMesh() {
  if (cameraBoundMesh) {
    softDetachMesh(scene, cameraBoundMesh);
    cameraBoundMesh = null;
  }
  if (!engine || !scene || !field) return;
  const ext = cameraExtents();
  const full = ext.x >= tableHalfF() - 0.5 && ext.z >= tableHalfZF() - 0.5;
  if (!(ext.x > 0) || full) return;
  const y = 5;
  const rim = 1.8;
  const pos = [];
  const idx = [];
  pushSelectEdge(pos, idx, -ext.x, -ext.z, ext.x, -ext.z, y, rim);
  pushSelectEdge(pos, idx, ext.x, -ext.z, ext.x, ext.z, y, rim);
  pushSelectEdge(pos, idx, ext.x, ext.z, -ext.x, ext.z, y, rim);
  pushSelectEdge(pos, idx, -ext.x, ext.z, -ext.x, -ext.z, y, rim);
  const positions = new Float32Array(pos);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const mesh = createMeshFromData(engine, 'camera-bound', positions, normals, new Uint32Array(idx));
  const mat = createStandardMaterial();
  mat.diffuseColor = [0.95, 0.72, 0.2];
  mat.emissiveColor = [0.85, 0.55, 0.1];
  mat.ambientColor = [0.7, 0.45, 0.08];
  mat.specularColor = [0, 0, 0];
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.pickable = false;
  addToScene(scene, mesh);
  cameraBoundMesh = mesh;
  if (sceneRegistered) invalidateRenderBundles(engine);
}

function wallsForGarden() {
  const runs = state.walls.runs.map((run) => ({
    ...run,
    points: run.points.map((p) => ({ x: p.x, z: p.z })),
    openings: (run.openings || []).map((o) => ({ ...o })),
  }));
  if (state.wallDraft.length >= 2) {
    runs.push({
      points: state.wallDraft.map((p) => ({ x: p.x, z: p.z })),
      closed: false,
      kind: state.wallKind,
      openings: (state.wallDraftOpenings || []).map((o) => ({ ...o })),
    });
  }
  return { style: state.walls.style, runs };
}

function committedWallsSnapshot() {
  return {
    style: { ...state.walls.style },
    runs: state.walls.runs.map((run) => ({
      closed: !!run.closed,
      kind: run.kind,
      points: run.points.map((p) => ({ x: p.x, z: p.z })),
      openings: (run.openings || []).map((o) => ({ ...o })),
    })),
  };
}

function gardenExtras({ committedWalls = false } = {}) {
  return {
    name: state.mapName,
    units: state.units,
    buildings: state.buildings,
    agoras: state.agoras,
    objectives: state.objectives,
    startingResources: state.startingResources,
    story: state.story,
    cameraHalfF: state.cameraHalfF,
    walls: committedWalls ? committedWallsSnapshot() : wallsForGarden(),
    celestial: celestial?.getState?.() ?? null,
    mapType: state.mapType,
    teamByOwner: state.teamByOwner,
  };
}

function gardenPayload() {
  return encodeGarden(field, gardenExtras());
}

function currentReel() {
  const ending = state.storyReelId === 'ending';
  const id = ending ? 'ending' : 'intro';
  const found = state.story?.reels?.find((r) => r.id === id);
  if (found) return activeReel(state.story, id);
  if (ending) return { id: 'ending', when: 'win', clips: [], duration: 0 };
  return activeReel(state.story, 'intro');
}

function setStoryReel(id) {
  state.storyReelId = id === 'ending' ? 'ending' : 'intro';
  state.storyClipId = null;
  storyPlayer?.setReel(currentReel());
  storyPlayer?.toStart();
  syncStoryEditor();
}

function applyStoryReveal(value) {
  const reel = currentReel();
  const next = { ...reel, clips: reel.clips.slice() };
  if (value === 'all') next.reveal = 'all';
  else if (value === 'enemy') next.reveal = [4];
  else delete next.reveal;
  commitReel(next);
}

function worldFromTile(tx, tz) {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    x: (tx + 0.5) * TILE_SIZE_F - half,
    z: (tz + 0.5) * TILE_SIZE_F - halfZ,
  };
}

function tileFromWorld(x, z) {
  const half = worldHalfFFromField(field);
  const halfZ = worldHalfZFFromField(field);
  return {
    tx: Math.floor((x + half) / TILE_SIZE_F),
    tz: Math.floor((z + halfZ) / TILE_SIZE_F),
  };
}

function speakerWorldPos(name) {
  const u = findNamedUnit(state.units, name);
  if (!u || !field) return null;
  const { x, z } = worldFromTile(u.tx, u.tz);
  return { x, y: 2.6, z };
}

function forgeWorldToScreen(x, y, z) {
  if (!camera || !canvas) return null;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const vp = getViewProjectionMatrix(camera, w / h);
  if (!vp) return null;
  const c0 = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const c1 = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const c3 = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (Math.abs(c3) < 1e-8) return null;
  const iw = 1 / c3;
  const ndcX = c0 * iw;
  const ndcY = c1 * iw;
  return { x: (ndcX * 0.5 + 0.5) * w, y: (1 - ndcY) * 0.5 * h };
}

let holdStoryCamera = false;

function applyStorySample(s) {
  if (!s) return;
  if (s.camera && cam && field && !holdStoryCamera && state.layer === 'story') {
    const live = s.camera.char ? speakerWorldPos(s.camera.char) : null;
    const tile = worldFromTile(s.camera.tx, s.camera.tz);
    cam.setPose({
      x: live?.x ?? tile.x,
      z: live?.z ?? tile.z,
      radius: s.camera.radius,
      alpha: s.camera.alpha,
    }, { unclamped: true });
  }
  const lines = s.lines ?? (s.line ? [s.line] : []);
  if (state.layer === 'story') {
    const narrated = narratorLines(lines);
    if (narrated.length) storyHud?.show(narrated);
    else storyHud?.hide();
    storySpeech?.show(lines);
  } else {
    storyHud?.hide();
    storySpeech?.hide();
  }
}

function refreshStorySheet() {
  storySheet?.render(currentReel(), storyPlayer?.time() ?? 0, state.storyClipId);
}

function selectedStoryClip() {
  return currentReel().clips.find((c) => c.id === state.storyClipId) || null;
}

function commitReel(reel) {
  state.story = replaceReel(state.story, reel);
  storyPlayer?.setReel(currentReel());
  syncStoryEditor();
}

function aimStoryCamera(pos) {
  if (!pos || !field || storyPlayer?.rate()) return;
  const { tx, tz } = tileFromWorld(pos.x, pos.z);
  const clip = selectedStoryClip();
  if (clip?.kind !== CLIP_CAMERA) return;
  const reel = currentReel();
  const next = reel.clips.map((c) => (c.id === clip.id ? { ...c, tx, tz } : c));
  commitReel({ ...reel, clips: next });
}

function captureViewPose() {
  const pose = cam.getPose();
  const tile = tileFromWorld(pose.x, pose.z);
  return { tx: tile.tx, tz: tile.tz, radius: pose.radius, alpha: pose.alpha };
}

function addStoryCamera() {
  if (!cam || !field) return;
  const pose = captureViewPose();
  const reel = currentReel();
  const clip = {
    id: newClipId(),
    kind: CLIP_CAMERA,
    t: storyPlayer?.time() ?? 0,
    dur: 2,
    tx: pose.tx,
    tz: pose.tz,
    radius: pose.radius,
    alpha: pose.alpha,
    fromTx: pose.tx,
    fromTz: pose.tz,
    fromRadius: pose.radius,
    fromAlpha: pose.alpha,
  };
  state.storyClipId = clip.id;
  commitReel({ ...reel, clips: [...reel.clips, clip] });
}

function setCameraWaypoint(which) {
  if (!cam || !field || storyPlayer?.rate()) return;
  const clip = selectedStoryClip();
  if (clip?.kind !== CLIP_CAMERA) return;
  const pose = captureViewPose();
  if (which === 'start') {
    patchSelectedClip({
      fromTx: pose.tx,
      fromTz: pose.tz,
      fromRadius: pose.radius,
      fromAlpha: pose.alpha,
    });
  } else {
    patchSelectedClip({
      tx: pose.tx,
      tz: pose.tz,
      radius: pose.radius,
      alpha: pose.alpha,
    });
  }
  const next = selectedStoryClip();
  if (!next || !storyPlayer) return;
  storyPlayer.seek(which === 'start' ? next.t : next.t + next.dur);
}

function addStoryLine() {
  const reel = currentReel();
  const clip = {
    id: newClipId(),
    kind: CLIP_LINE,
    t: storyPlayer?.time() ?? 0,
    dur: lineDuration('New line'),
    speaker: '',
    text: 'New line',
    style: 'normal',
  };
  state.storyClipId = clip.id;
  commitReel({ ...reel, clips: [...reel.clips, clip] });
}

function addStoryHold() {
  const reel = currentReel();
  const clip = {
    id: newClipId(),
    kind: CLIP_HOLD,
    t: storyPlayer?.time() ?? 0,
    dur: 1,
  };
  state.storyClipId = clip.id;
  commitReel({ ...reel, clips: [...reel.clips, clip] });
}

function deleteStoryClip() {
  const reel = currentReel();
  const idx = reel.clips.findIndex((c) => c.id === state.storyClipId);
  if (idx < 0) return;
  const clips = reel.clips.filter((c) => c.id !== state.storyClipId);
  const next = clips[idx] || clips[idx - 1] || null;
  state.storyClipId = next?.id ?? null;
  commitReel({ ...reel, clips });
  if (next) storyPlayer?.seek(next.t);
  refreshStorySheet();
}

function storyClipLabel(clip) {
  const t = Number(clip.t) || 0;
  const stamp = `${t.toFixed(1)}s`;
  if (clip.kind === CLIP_LINE) {
    const who = clip.speaker ? `${clip.speaker}: ` : '';
    return `${stamp} Line - ${who}${clip.text || '…'}`;
  }
  if (clip.kind === CLIP_HOLD) return `${stamp} Pause`;
  const end = `${clip.tx | 0}, ${clip.tz | 0}`;
  return `${stamp} Camera - ${end}`;
}

function renderStoryClipList() {
  const host = document.getElementById('story-clip-list');
  if (!host) return;
  host.replaceChildren();
  const clips = currentReel().clips;
  if (!clips.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No clips yet.';
    host.appendChild(empty);
    return;
  }
  for (const clip of clips) {
    const row = document.createElement('button');
    row.type = 'button';
    row.textContent = storyClipLabel(clip);
    row.style.display = 'block';
    row.style.width = '100%';
    row.style.textAlign = 'left';
    if (clip.id === state.storyClipId) row.classList.add('active');
    row.addEventListener('click', () => {
      state.storyClipId = clip.id;
      storyPlayer?.seek(clip.t);
      syncStoryEditor();
      refreshStorySheet();
    });
    host.appendChild(row);
  }
}

function patchSelectedClip(patch) {
  const clip = selectedStoryClip();
  if (!clip) return;
  const reel = currentReel();
  const next = { ...clip, ...patch };
  if (next.kind === CLIP_LINE && patch.text != null && patch.dur == null) {
    next.dur = lineDuration(next.text);
  }
  commitReel({
    ...reel,
    clips: reel.clips.map((c) => (c.id === clip.id ? next : c)),
  });
}

function syncStoryEditor() {
  const clip = selectedStoryClip();
  const empty = document.getElementById('story-clip-empty');
  const camFields = document.getElementById('story-clip-camera');
  const lineFields = document.getElementById('story-clip-line');
  const holdFields = document.getElementById('story-clip-hold');
  if (empty) empty.style.display = clip ? 'none' : 'block';
  if (camFields) camFields.style.display = clip?.kind === CLIP_CAMERA ? 'block' : 'none';
  if (lineFields) lineFields.style.display = clip?.kind === CLIP_LINE ? 'block' : 'none';
  if (holdFields) holdFields.style.display = clip?.kind === CLIP_HOLD ? 'block' : 'none';
  syncStoryReelUi();
  renderStoryClipList();
  if (clip?.kind === CLIP_CAMERA) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && el !== document.activeElement) el.value = String(v); };
    set('story-cam-t', clip.t);
    set('story-cam-dur', clip.dur);
    set('story-cam-tx', clip.tx);
    set('story-cam-tz', clip.tz);
    set('story-cam-radius', Math.round(clip.radius));
    set('story-cam-alpha', clip.alpha.toFixed(2));
    const hint = document.getElementById('story-cam-waypoints');
    if (hint) {
      const who = clip.char ? ` ${clip.char}` : '';
      const end = `${clip.tx | 0},${clip.tz | 0} r${Math.round(clip.radius)}`;
      if (Number.isFinite(clip.fromTx)) {
        hint.textContent = `Start ${clip.fromTx | 0},${clip.fromTz | 0} r${Math.round(clip.fromRadius)} → End${who} ${end}`;
      } else {
        hint.textContent = `Start (previous shot) → End${who} ${end}`;
      }
    }
    const aim = document.getElementById('story-cam-char');
    if (aim && aim !== document.activeElement) aim.value = clip.char || '';
  }
  if (clip?.kind === CLIP_LINE) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && el !== document.activeElement) el.value = String(v); };
    set('story-line-t', clip.t);
    set('story-line-dur', clip.dur);
    set('story-line-speaker', clip.speaker);
    set('story-line-text', clip.text);
    set('story-line-style', clip.style);
  }
  if (clip?.kind === CLIP_HOLD) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && el !== document.activeElement) el.value = String(v); };
    set('story-hold-t', clip.t);
    set('story-hold-dur', clip.dur);
  }
  fillCastControls();
  const playBtn = document.getElementById('story-play');
  if (playBtn && storyPlayer) playBtn.textContent = storyPlayer.rate() === 0 ? 'Play' : 'Stop';
  refreshStorySheet();
}

function syncStoryReelUi() {
  const ending = state.storyReelId === 'ending';
  document.getElementById('story-reel-intro')?.classList.toggle('active', !ending);
  document.getElementById('story-reel-win')?.classList.toggle('active', ending);
  const reveal = document.getElementById('story-reveal');
  const reel = currentReel();
  if (reveal && reveal !== document.activeElement) {
    if (reel.reveal === 'all') reveal.value = 'all';
    else if (Array.isArray(reel.reveal) && reel.reveal.length) reveal.value = 'enemy';
    else reveal.value = '';
  }
}

function fillCastControls() {
  const names = namedUnits(state.units);
  const row = document.getElementById('story-cast');
  if (row) {
    row.replaceChildren();
    if (!names.length) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Name a placed unit to jump, follow, or aim a camera at them.';
      row.appendChild(hint);
    } else {
      for (const u of names) {
        const line = document.createElement('div');
        line.className = 'row';
        const label = document.createElement('span');
        label.className = 'hint';
        label.textContent = u.name;
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.dataset.castJump = u.name;
        jump.textContent = 'Jump';
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.dataset.castFollow = u.name;
        follow.textContent = 'Follow';
        line.append(label, jump, follow);
        row.appendChild(line);
      }
    }
  }
  const aim = document.getElementById('story-cam-char');
  if (aim && aim !== document.activeElement) {
    const cur = selectedStoryClip()?.char || aim.value;
    aim.replaceChildren(
      ...[{ name: '', label: 'Tile' }, ...names.map((u) => ({ name: u.name, label: u.name }))].map((opt) => {
        const el = document.createElement('option');
        el.value = opt.name;
        el.textContent = opt.label;
        return el;
      }),
    );
    aim.value = names.some((u) => u.name === cur) ? cur : '';
  }
  const list = document.getElementById('story-cast-names');
  if (list) {
    list.replaceChildren(...names.map((u) => {
      const el = document.createElement('option');
      el.value = u.name;
      return el;
    }));
  }
}

function jumpToCharacter(name) {
  const pos = speakerWorldPos(name);
  if (!pos || !cam) return;
  cam.lookAtXZ(pos.x, pos.z);
}

function followCharacter(name) {
  const pos = speakerWorldPos(name);
  if (!pos || !cam) return;
  cam.followXZ(pos.x, pos.z);
}

function aimClipAtCharacter(name) {
  const u = findNamedUnit(state.units, name);
  if (!u) {
    patchSelectedClip({ char: '' });
    return;
  }
  patchSelectedClip({ char: u.name, tx: u.tx, tz: u.tz });
}

function bindStoryUi() {
  const num = (id) => Number(document.getElementById(id)?.value);
  document.getElementById('story-to-start')?.addEventListener('click', () => storyPlayer?.toStart());
  document.getElementById('story-rew')?.addEventListener('click', () => storyPlayer?.rewind());
  document.getElementById('story-play')?.addEventListener('click', () => storyPlayer?.toggle());
  document.getElementById('story-ff')?.addEventListener('click', () => storyPlayer?.fastForward());
  document.getElementById('story-to-end')?.addEventListener('click', () => storyPlayer?.skipForward());
  document.getElementById('story-prev')?.addEventListener('click', () => storyPlayer?.prevClip());
  document.getElementById('story-next')?.addEventListener('click', () => storyPlayer?.nextClip());
  document.getElementById('story-add-camera')?.addEventListener('click', addStoryCamera);
  document.getElementById('story-add-line')?.addEventListener('click', addStoryLine);
  document.getElementById('story-add-hold')?.addEventListener('click', addStoryHold);
  document.getElementById('story-delete')?.addEventListener('click', deleteStoryClip);
  document.getElementById('story-reel-intro')?.addEventListener('click', () => setStoryReel('intro'));
  document.getElementById('story-reel-win')?.addEventListener('click', () => setStoryReel('ending'));
  document.getElementById('story-reveal')?.addEventListener('change', (e) => applyStoryReveal(e.target.value));
  document.getElementById('story-hold-t')?.addEventListener('change', () => patchSelectedClip({ t: num('story-hold-t') }));
  document.getElementById('story-hold-dur')?.addEventListener('change', () => patchSelectedClip({ dur: num('story-hold-dur') }));
  document.getElementById('story-cam-set-start')?.addEventListener('click', () => setCameraWaypoint('start'));
  document.getElementById('story-cam-set-end')?.addEventListener('click', () => setCameraWaypoint('end'));
  document.getElementById('story-cam-char')?.addEventListener('change', (e) => {
    aimClipAtCharacter(e.target.value);
  });
  document.getElementById('story-cast')?.addEventListener('click', (e) => {
    const jump = e.target?.closest?.('[data-cast-jump]');
    const follow = e.target?.closest?.('[data-cast-follow]');
    if (jump) jumpToCharacter(jump.dataset.castJump);
    if (follow) followCharacter(follow.dataset.castFollow);
  });
  const camMap = [
    ['story-cam-t', 't'],
    ['story-cam-dur', 'dur'],
    ['story-cam-tx', 'tx'],
    ['story-cam-tz', 'tz'],
    ['story-cam-radius', 'radius'],
    ['story-cam-alpha', 'alpha'],
  ];
  for (const [id, key] of camMap) {
    document.getElementById(id)?.addEventListener('change', () => patchSelectedClip({ [key]: num(id) }));
  }
  document.getElementById('story-line-t')?.addEventListener('change', () => patchSelectedClip({ t: num('story-line-t') }));
  document.getElementById('story-line-dur')?.addEventListener('change', () => patchSelectedClip({ dur: num('story-line-dur') }));
  document.getElementById('story-line-speaker')?.addEventListener('input', (e) => {
    patchSelectedClip({ speaker: e.target.value });
  });
  document.getElementById('story-line-text')?.addEventListener('input', (e) => {
    patchSelectedClip({ text: e.target.value });
  });
  document.getElementById('story-line-style')?.addEventListener('change', (e) => {
    patchSelectedClip({ style: e.target.value });
  });
}

function gardenFileName() {
  return `${(state.mapName || 'map').replace(/[^\w-]+/g, '_')}.garden`;
}

function downloadGarden(json, name) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function saveTextFile(json, name, description, extension) {
  const picker = typeof globalThis.showSaveFilePicker === 'function'
    ? globalThis.showSaveFilePicker.bind(globalThis)
    : null;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{
          description,
          accept: { 'application/json': [extension] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 20)) return;
      console.error(err);
    }
  }
  downloadGarden(json, name);
}

async function exportMap() {
  await saveTextFile(JSON.stringify(gardenPayload(), null, 0), gardenFileName(), 'Garden map', '.garden');
}

function iconButton(label, title, onClick, { disabled = false, active = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  if (disabled) b.disabled = true;
  if (active) b.classList.add('active');
  b.addEventListener('click', onClick);
  return b;
}

function renderCampaignDraft() {
  const nameEl = document.getElementById('campaign-name');
  if (nameEl && document.activeElement !== nameEl) nameEl.value = campaignDraft.name;
  const list = document.getElementById('campaign-tree');
  if (!list) return;
  list.replaceChildren();
  syncChapterTitle();
  const eps = campaignDraft.episodes;
  eps.forEach((episode, epIdx) => {
    const head = document.createElement('div');
    const noneLive = episode.chapters.length > 0 && episode.chapters.every((ch) => ch.live === false);
    head.className = epIdx === campaignDraft.episodeIndex ? 'row ep current' : 'row ep';
    if (noneLive) head.classList.add('idle');
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.value = episode.name;
    name.title = 'Episode heading - focus to make new chapters land here';
    name.addEventListener('focus', () => {
      armHistory();
      setCurrentEpisode(campaignDraft, epIdx);
      head.classList.add('current');
      scheduleCommit(0);
    });
    name.addEventListener('input', () => renameEpisode(campaignDraft, epIdx, name.value));
    name.addEventListener('change', () => renderCampaignDraft());
    head.append(name);
    head.append(iconButton('↑', 'Move episode up', () => { if (moveEpisode(campaignDraft, epIdx, -1)) renderCampaignDraft(); }, { disabled: epIdx === 0 }));
    head.append(iconButton('↓', 'Move episode down', () => { if (moveEpisode(campaignDraft, epIdx, 1)) renderCampaignDraft(); }, { disabled: epIdx === eps.length - 1 }));
    head.append(iconButton('✕', 'Delete episode and its chapters', () => {
      if (!episode.chapters.length || confirm(`Delete "${episode.name}" and its ${episode.chapters.length} chapter(s)?`)) {
        for (const ch of episode.chapters) if (ch.file === activeChapterFile) activeChapterFile = null;
        if (removeEpisode(campaignDraft, epIdx)) renderCampaignDraft();
      }
    }, { disabled: eps.length <= 1 }));
    list.append(head);

    episode.chapters.forEach((ch, chIdx) => {
      const row = document.createElement('div');
      const on = ch.live !== false;
      row.className = on ? 'row' : 'row off';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${chIdx + 1}.`;
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.value = ch.name;
      name.title = 'Chapter name in the campaign';
      name.dataset.file = ch.file;
      name.addEventListener('input', () => {
        renameChapter(campaignDraft, ch.file, name.value);
        if (ch.file === activeChapterFile) {
          state.mapName = name.value;
          const mapName = document.getElementById('map-name');
          if (mapName && document.activeElement !== mapName) mapName.value = name.value;
          syncChapterTitle();
        }
      });
      row.append(iconButton(on ? 'On' : 'Off', on ? 'Players can play this chapter. Click to switch it off.' : 'Players skip this chapter. Click to switch it on.', () => {
        setChapterLive(campaignDraft, ch.file, !on);
        renderCampaignDraft();
      }, { active: on }), num, name);
      if (ch.file === activeChapterFile) {
        row.classList.add('here');
        const here = document.createElement('span');
        here.className = 'num';
        here.textContent = 'on the table';
        row.append(here);
      }
      row.append(iconButton('✎', 'Put this chapter on the table', () => editChapter(ch.file), { active: ch.file === activeChapterFile }));
      row.append(iconButton('↑', 'Move up (into previous episode at the top)', () => { if (moveChapter(campaignDraft, ch.file, -1)) renderCampaignDraft(); }, { disabled: epIdx === 0 && chIdx === 0 }));
      row.append(iconButton('↓', 'Move down (into next episode at the bottom)', () => { if (moveChapter(campaignDraft, ch.file, 1)) renderCampaignDraft(); }, { disabled: epIdx === eps.length - 1 && chIdx === episode.chapters.length - 1 }));
      row.append(iconButton('✕', 'Remove chapter', () => {
        if (ch.file === activeChapterFile) activeChapterFile = null;
        removeChapter(campaignDraft, ch.file);
        renderCampaignDraft();
      }));
      list.append(row);
    });
  });
}

function currentChapterTitle() {
  return String(state.mapName || gardenPayload().n || '').trim();
}

function nextChapterName() {
  const used = new Set();
  for (const ep of campaignDraft.episodes) for (const ch of ep.chapters) used.add(ch.name);
  let n = draftChapterCount(campaignDraft) + 1;
  while (used.has(`Chapter ${n}`)) n += 1;
  return `Chapter ${n}`;
}

/** Write the live editor state back into the chapter that is open for editing. */
function flushActiveChapter() {
  if (!activeChapterFile) return;
  const loc = locateChapter(campaignDraft, activeChapterFile);
  if (loc) loc.chapter.garden = gardenPayload();
}

/** Load a chapter's map into the forge, saving any edits to the previously open chapter first. */
function editChapter(file) {
  flushActiveChapter();
  const loc = locateChapter(campaignDraft, file);
  if (!loc) return;
  activeChapterFile = file;
  campaignDraft.episodeIndex = loc.epIndex;
  applyGardenJson(JSON.parse(JSON.stringify(loc.chapter.garden)));
  renderCampaignDraft();
}

function saveActiveChapter() {
  if (!activeChapterFile) {
    alert('This chapter is not in the campaign. Add this chapter first.');
    return;
  }
  flushActiveChapter();
  renderCampaignDraft();
}

function addCurrentChapter() {
  const garden = gardenPayload();
  const title = currentChapterTitle() || nextChapterName();
  const chapter = addChapter(campaignDraft, { name: title, garden });
  if (chapter) activeChapterFile = chapter.file;
  renderCampaignDraft();
}

/** Import a .campaign (loads it as the whole list) or a .garden (adds it as a new chapter). */
function importCampaignFile(file) {
  const release = holdHistory();
  flushActiveChapter();
  file.text().then((text) => {
    const data = JSON.parse(text);
    if (isCampaignBundle(data)) {
      const draft = draftFromBundle(data);
      if (!draft) throw new Error('empty campaign');
      campaignDraft = draft;
      const first = draft.episodes.flatMap((ep) => ep.chapters)[0];
      activeChapterFile = first?.file || null;
      if (first) applyGardenJson(JSON.parse(JSON.stringify(data.gardens[first.file])));
      renderCampaignDraft();
      return;
    }
    const title = String(data?.n || '').trim() || nextChapterName();
    const chapter = addChapter(campaignDraft, { name: title, garden: data });
    if (chapter) {
      activeChapterFile = chapter.file;
      applyGardenJson(JSON.parse(JSON.stringify(data)));
    }
    renderCampaignDraft();
  }).catch((err) => {
    console.error(err);
    alert('Could not import that file.');
  }).finally(release);
}

async function exportCampaign() {
  flushActiveChapter();
  const bundle = draftToBundle(campaignDraft);
  if (!bundle) {
    alert('Add a chapter before exporting a campaign.');
    return;
  }
  const name = `${(bundle.name || 'campaign').replace(/[^\w-]+/g, '_')}.campaign`;
  await saveTextFile(JSON.stringify(bundle), name, 'Campaign', '.campaign');
}

function playCampaign() {
  flushActiveChapter();
  const bundle = draftToBundle(campaignDraft);
  if (!bundle) {
    alert('Add a chapter before playing a campaign.');
    return;
  }
  const startFile = (activeChapterFile && locateChapter(campaignDraft, activeChapterFile))
    ? activeChapterFile
    : firstChapterFile(bundle);
  if (!startFile) {
    alert('Turn a chapter on before playing.');
    return;
  }
  const first = formatPackRef(startFile);
  const url = `/?garden=${encodeURIComponent(first)}&solo=1`;
  writeCampaignPack(JSON.stringify(bundle)).then(() => {
    window.open(url, '_blank');
  }).catch((err) => {
    console.error(err);
    alert('Could not start that campaign.');
  });
}

function playMap() {
  const json = JSON.stringify(gardenPayload());
  const url = '/?garden=session&solo=1';
  let gen = null;
  try {
    stageSessionGarden(json);
    gen = stageLocalGarden(json);
  } catch (err) {
    console.error(err);
    alert('Could not start that map.');
    return;
  }
  // Open the match directly. about:blank is an opaque origin under COOP, so
  // the opener cannot navigate it afterwards. localStorage is already visible
  // to the new tab; IndexedDB catches gardens that do not fit there.
  const pending = writeSessionGarden(json, gen);
  const opened = window.open(url, '_blank');
  if (!opened) alert('Allow popups to play the map.');
  pending.catch((err) => {
    console.error(err);
    alert('Could not start that map.');
  });
}

function applyGardenJson(json) {
  const g = decodeGarden(json);
  field = fieldFromGarden(json);
  state.mapName = g.name || '';
  state.mapType = g.mapType || DEFAULT_MAP_TYPE;
  state.teamByOwner = g.teamByOwner || null;
  state.units = g.units;
  state.placePicks = [];
  placeDrag = null;
  placeBox = null;
  state.buildings = g.buildings;
  state.agoras = g.agoras;
  state.objectives = normalizeObjectives(g.objectives);
  state.waveRoute = [];
  state.startingResources = { ...(g.startingResources || STARTING_RESOURCES) };
  state.story = g.story || emptyStory();
  state.storyClipId = null;
  state.cameraHalfF = g.cameraHalfF || 0;
  state.walls = g.walls || emptyWalls();
  state.wallDraft = [];
  state.wallDraftOpenings = [];
  wallCursor = null;
  storyPlayer?.setReel(currentReel());
  state.selected = [];
  state.propIndex = -1;
  state.propArmed = false;
  propDrag = null;
  propReturnChunks = false;
  celestial?.setWorldHalfF(Math.max(worldHalfFFromField(field), worldHalfZFFromField(field)));
  if (g.celestial) {
    celestial?.apply(g.celestial);
    persistCelestial();
    syncLightUi();
  }
  applyCameraBound();
  clearResourcesUnderPlacements();
  syncFormFromField();
  syncPlacePickUi();
  renderAllianceEditor();
  syncStoryEditor();
  renderWaveEditor();
  rebuildTerrain();
  syncPropUi();
}

function importFile(file) {
  const release = holdHistory();
  file.text().then((text) => {
    const data = JSON.parse(text);
    if (isCampaignBundle(data)) {
      alert('That\u2019s a campaign - open the Campaign tab and use its Import button.');
      return;
    }
    applyGardenJson(data);
  }).catch((err) => {
    console.error(err);
    alert('Could not import that map.');
  }).finally(release);
}

async function loadGardenFromSearch() {
  const raw = new URLSearchParams(location.search).get('garden');
  if (!raw) return;
  try {
    applyGardenJson(await loadGardenRef(raw, {
      loadWorkshopGarden: (id, file) => aetherSteam.loadWorkshopGarden(id, file),
    }));
    forgetHistory();
  } catch (err) {
    console.error(err);
    alert('Could not load that garden URL.');
  }
}

function workshopOptionLabel(item, garden) {
  const title = item.title || garden.name || item.id;
  if ((item.gardens?.length || 0) > 1) return `${title} - ${garden.name || garden.file}`;
  return title;
}

async function refreshWorkshopMaps() {
  const select = document.getElementById('workshop-maps');
  if (!select) return;
  const items = await aetherSteam.listWorkshopMaps();
  const current = select.value;
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = items.length ? 'Subscribed maps…' : 'No subscribed maps';
  select.appendChild(blank);
  for (const item of items) {
    for (const garden of item.gardens || []) {
      const opt = document.createElement('option');
      opt.value = formatWorkshopRef(item.id, garden.file);
      opt.textContent = workshopOptionLabel(item, garden);
      select.appendChild(opt);
    }
  }
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

function waitFrames(n) {
  return new Promise((resolve) => {
    let left = Math.max(1, n | 0);
    function step() {
      if (--left <= 0) resolve();
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function previewLooksBlank(ctx, w, h) {
  const sw = Math.min(w, 64);
  const sh = Math.min(h, 64);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] + data[i + 1] + data[i + 2] > 30) lit++;
  }
  return lit < 8;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function encodePreviewJpeg(srcCanvas) {
  const w = srcCanvas.width || srcCanvas.clientWidth;
  const h = srcCanvas.height || srcCanvas.clientHeight;
  if (!w || !h) return '';
  const maxEdge = 512;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const off = document.createElement('canvas');
  off.width = tw;
  off.height = th;
  const ctx = off.getContext('2d');
  if (!ctx) return '';
  try {
    if (typeof srcCanvas.convertToBlob === 'function') {
      const blob = await srcCanvas.convertToBlob({ type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      ctx.drawImage(bmp, 0, 0, tw, th);
      bmp.close?.();
    } else {
      const bmp = await createImageBitmap(srcCanvas);
      ctx.drawImage(bmp, 0, 0, tw, th);
      bmp.close?.();
    }
  } catch {
    try { ctx.drawImage(srcCanvas, 0, 0, tw, th); } catch { return ''; }
  }
  if (previewLooksBlank(ctx, tw, th)) return '';
  const out = await new Promise((resolve) => off.toBlob(resolve, 'image/jpeg', 0.82));
  if (!out || out.size > 1024 * 1024) return '';
  const url = await blobToDataUrl(out);
  return url.startsWith('data:image/jpeg') ? url : '';
}

async function captureWorkshopPreview() {
  if (!canvas) return '';
  const hide = [
    document.getElementById('forge-ui'),
    document.getElementById('story-sheet'),
    document.getElementById('workshop-publish-dlg'),
  ];
  const prevDisplay = hide.map((el) => el?.style.display ?? '');
  hide.forEach((el) => { if (el) el.style.display = 'none'; });
  holdPreviewCamera = true;
  try {
    await waitFrames(2);
    return await encodePreviewJpeg(canvas);
  } catch {
    return '';
  } finally {
    holdPreviewCamera = false;
    hide.forEach((el, i) => { if (el) el.style.display = prevDisplay[i]; });
  }
}

function closeWorkshopPublishDlg() {
  document.getElementById('workshop-publish-dlg')?.classList.remove('open');
}

function fillWorkshopNameSuggestions(garden, current) {
  const row = document.getElementById('workshop-publish-names');
  if (!row) return workshopNameSuggestions(garden, current);
  const names = workshopNameSuggestions(garden, current);
  row.replaceChildren();
  if (names.length <= 1 && current && names[0] === current) return names;
  for (const name of names) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      const nameEl = document.getElementById('workshop-publish-name');
      if (nameEl) nameEl.value = name;
      syncWorkshopDescription(garden, name);
    });
    row.appendChild(btn);
  }
  return names;
}

function syncWorkshopDescription(garden, title) {
  if (workshopDescEdited) return;
  const descEl = document.getElementById('workshop-publish-desc');
  if (descEl) descEl.value = workshopDescriptionFor(garden, title);
}

async function beginWorkshopPublish() {
  if (!aetherSteam.isAvailable()) {
    alert('Publishing needs the Steam build.');
    return;
  }
  const garden = gardenPayload();
  const dlg = document.getElementById('workshop-publish-dlg');
  const nameEl = document.getElementById('workshop-publish-name');
  const imgEl = document.getElementById('workshop-publish-preview');
  const hint = document.getElementById('workshop-publish-hint');
  workshopDescEdited = false;
  const names = fillWorkshopNameSuggestions(garden, state.mapName);
  if (nameEl) nameEl.value = names[0] || state.mapName || '';
  syncWorkshopDescription(garden, nameEl?.value || names[0] || '');
  if (imgEl) {
    imgEl.removeAttribute('src');
    imgEl.hidden = true;
  }
  if (hint) hint.textContent = 'Taking a snapshot…';
  workshopPreviewJpeg = '';
  dlg?.classList.add('open');
  placeMenus();
  const preview = await captureWorkshopPreview();
  workshopPreviewJpeg = preview.replace(/^data:image\/jpeg;base64,/, '');
  if (imgEl && preview) {
    imgEl.src = preview;
    imgEl.hidden = false;
  }
  if (hint) {
    hint.textContent = preview
      ? 'This is your current view. Pick a name, edit the description if you want, then confirm.'
      : 'Could not capture a thumbnail. Name it and confirm to publish without one.';
  }
}

async function confirmWorkshopPublish() {
  const name = document.getElementById('workshop-publish-name')?.value.trim() || '';
  if (!name) {
    alert('Name this garden before publishing.');
    return;
  }
  state.mapName = name;
  const mapName = document.getElementById('map-name');
  if (mapName) mapName.value = name;
  closeWorkshopPublishDlg();
  await publishWorkshopMap();
}

async function publishWorkshopMap() {
  if (!aetherSteam.isAvailable()) {
    alert('Publishing needs the Steam build.');
    return;
  }
  const btn = document.getElementById('btn-workshop-publish');
  if (btn) btn.disabled = true;
  try {
    flushActiveChapter();
    const bundle = draftChapterCount(campaignDraft) ? draftToBundle(campaignDraft) : null;
    const description = document.getElementById('workshop-publish-desc')?.value.trim()
      || workshopDescriptionFor(bundle ? bundle.gardens[firstChapterFile(bundle)] : gardenPayload(), state.mapName);
    const published = bundle ? draftToIndex(campaignDraft, { liveOnly: true }) : null;
    if (bundle && !published) {
      alert('Turn a chapter on before publishing.');
      return;
    }
    const body = bundle
      ? {
        title: bundle.name || state.mapName || 'Campaign',
        description,
        previewJpeg: workshopPreviewJpeg || undefined,
        campaign: published,
        files: flattenCampaignChapters(published).map((ch) => ({
          file: ch.file,
          garden: bundle.gardens[ch.file],
        })),
      }
      : {
        garden: gardenPayload(),
        title: state.mapName || gardenPayload().n || workshopNameSuggestions(gardenPayload())[0] || 'Garden',
        description,
        previewJpeg: workshopPreviewJpeg || undefined,
      };
    const result = await aetherSteam.publishWorkshopGarden(body);
    if (!result?.ok) {
      console.warn('[forge] workshop publish failed', result);
      if (result?.needsAgreement) aetherSteam.openOverlay('workshop-legal');
      alert(result?.error || 'Could not publish to the Workshop.');
      return;
    }
    if (result.needsAgreement) aetherSteam.openOverlay('workshop-legal');
    else aetherSteam.openOverlay(`workshop:${result.id}`);
    await refreshWorkshopMaps();
  } catch (err) {
    console.error(err);
    alert('Could not publish to the Workshop.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function syncWorkshopChrome() {
  const steam = aetherSteam.isAvailable();
  const select = document.getElementById('workshop-maps');
  const load = document.getElementById('btn-workshop-load');
  const hint = document.getElementById('workshop-hint');
  if (select) select.hidden = !steam;
  if (load) load.hidden = !steam;
  if (hint) {
    hint.textContent = steam
      ? 'Subscribe to a map on Steam Workshop, then Load it here. Publish uploads this map, or the campaign if you have added chapters. Play opens a solo match from this map.'
      : 'Subscribe and publish from the Steam build. On the web, export a .garden or a .campaign, then Load it in Adventure. Play opens a solo match from this map.';
  }
}

async function loadWorkshopSelection() {
  const release = holdHistory();
  const select = document.getElementById('workshop-maps');
  const raw = select?.value;
  try {
    if (!raw) {
      await refreshWorkshopMaps();
      if (!select?.value) {
        alert(select && select.options.length > 1
          ? 'Pick a subscribed map first.'
          : 'No subscribed maps yet. Browse Workshop and subscribe, then Load.');
      }
      return;
    }
    applyGardenJson(await loadGardenRef(raw, {
      loadWorkshopGarden: (id, file) => aetherSteam.loadWorkshopGarden(id, file),
    }));
  } catch (err) {
    console.error(err);
    alert('Could not load that Workshop map.');
  } finally {
    release();
  }
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
  const armed = state.tableTool === 'props' && state.propArmed;
  if (!state.selected.length) {
    hint.textContent = armed
      ? 'Click empty ground to place it. Click Chunks to edit the table.'
      : 'Click to select. Shift-click to add. Double-click to toggle on/off.';
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
  if (armed) {
    hint.textContent = 'Click empty ground to place it. Click Chunks to edit the table.';
  } else if (state.selected.length === 1) {
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
  if (radLabel) radLabel.textContent = sameR ? String(radii[0]) : '-';
}

function syncFormFromField() {
  const seedEl = document.getElementById('map-seed');
  const nameEl = document.getElementById('map-name');
  const chunksX = document.getElementById('map-chunks-x');
  const chunksY = document.getElementById('map-chunks-y');
  selectChunkCount(chunksX, chunksOfTiles(field.width));
  selectChunkCount(chunksY, chunksOfTiles(field.height));
  if (seedEl) seedEl.value = String(field.seed);
  if (nameEl) nameEl.value = state.mapName;
  const typeEl = document.getElementById('map-type');
  if (typeEl) typeEl.value = normalizeMapType(state.mapType);
  syncCenterPlinthUi();
  syncCameraBoundUi();
  for (const kind of RESOURCE_KINDS) {
    const el = document.getElementById(`start-${kind}`);
    if (el) el.value = String(state.startingResources[kind] | 0);
  }
  updateStats();
  updateSelectUi();
  syncWallUi();
}

function toolOf(layer) {
  if (layer === 'file') return 'file';
  if (layer === 'terrain') return 'land';
  if (layer === 'table') return 'table';
  if (layer === 'scenery') return 'trees';
  if (layer === 'walls') return 'walls';
  if (layer === 'place') return 'army';
  if (layer === 'zones') return 'goal';
  if (layer === 'story') return 'story';
  if (layer === 'light') return 'light';
  return '';
}

function pickTool(tool) {
  if (toolOf(state.layer) === tool) {
    restHand();
    return;
  }
  const layer = tool === 'land' ? 'terrain'
    : tool === 'trees' ? 'scenery'
    : tool === 'army' ? 'place'
    : tool === 'goal' ? 'zones'
    : tool;
  setLayer(layer);
}

function handLabel() {
  if (state.layer === 'file') return 'File';
  if (state.layer === 'terrain') {
    if (state.lift === 'level') return 'Level';
    if (state.lift === 1) return 'Raise';
    if (state.lift === -1) return 'Lower';
    if (state.terrain === TERRAIN.DIRT) return 'Dirt';
    if (state.terrain === TERRAIN.WATER) return 'Water';
    if (state.terrain === TERRAIN.GRAVEL) return 'Gravel';
    if (state.terrain === TERRAIN.TILE) return 'Tile';
    return 'Grass';
  }
  if (state.layer === 'table') return state.tableTool === 'props' ? 'Prop' : 'Table';
  if (state.layer === 'scenery') return state.stamp === 'doodad' ? 'Doodad' : 'Trees';
  if (state.layer === 'walls') return 'Wall';
  if (state.layer === 'place') {
    const picks = livePicks().filter((p) => p.kind !== 'objective');
    if (picks.length > 1) return `${picks.length} selected`;
    if (picks.length === 1) {
      const item = placeList(picks[0].kind)?.[picks[0].index];
      if (picks[0].kind === 'unit') {
        return item?.name || UNIT_DEFS.find((u) => u.id === (item?.type | 0))?.name || 'Unit';
      }
      if (picks[0].kind === 'agora') return 'Agora';
      return PLACEABLE_BUILDINGS.find((b) => b.id === item?.type)?.name || 'Building';
    }
    if (state.placeKind === 'party') return 'Party';
    if (state.placeKind === 'agora') return 'Agora';
    if (state.placeKind === 'unit') return UNIT_DEFS.find((u) => u.id === (state.placeType | 0))?.name || 'Unit';
    if (state.placeKind === 'building') {
      return PLACEABLE_BUILDINGS.find((b) => b.id === state.placeType)?.name || 'Building';
    }
    return armySides().find((s) => s.id === state.owner)?.name || 'Army';
  }
  if (state.layer === 'zones') {
    if (state.placeKind === 'wavehop') return 'March stop';
    const held = state.waveEdit?.id ? state.objectives.find((o) => o.id === state.waveEdit.id) : null;
    if (held) return held.label || kindWord(held.kind);
    if (state.placeKind === 'objective') return kindWord(document.getElementById('place-obj-kind')?.value || 'reach');
    return 'Goal';
  }
  if (state.layer === 'story') {
    const clip = currentReel().clips.find((c) => c.id === state.storyClipId);
    if (!clip) return 'Story';
    if (clip.kind === CLIP_LINE) return clip.speaker || 'Line';
    if (clip.kind === CLIP_HOLD) return 'Pause';
    return 'Camera';
  }
  if (state.layer === 'light') return 'Light';
  return 'Select';
}

function syncHand() {
  const el = document.getElementById('holding');
  if (el) el.textContent = `Holding: ${handLabel()}`;
}

function syncChapterTitle() {
  const btn = document.getElementById('btn-chapter');
  const place = document.getElementById('chapter-place');
  const loc = activeChapterFile ? locateChapter(campaignDraft, activeChapterFile) : null;
  const map = state.mapName || 'Untitled';
  if (btn) btn.textContent = loc ? `${campaignDraft.name} · ${loc.chapter.name || map}` : map;
  if (place) {
    place.textContent = loc
      ? `In ${campaignDraft.name} · ${loc.episode.name || 'Episode'} · chapter ${loc.chIndex + 1}.`
      : 'Not in the campaign.';
  }
}

function restHand() {
  state.placeKind = '';
  state.placePicks = [];
  placeDrag = null;
  placeBox = null;
  ringGesture = null;
  state.propArmed = false;
  state.waveEdit = null;
  document.querySelectorAll('[data-place]').forEach((el) => el.classList.remove('active'));
  if (state.wallDraft?.length) cancelWallDraft();
  setLayer('select');
  syncPlacePickUi();
  updatePlaceMarkers();
}

function placeMenus() {
  const tray = document.getElementById('forge-ui');
  const sheet = document.getElementById('story-sheet');
  const dlg = document.getElementById('workshop-publish-dlg');
  const trayOpen = !!tray?.classList.contains('open');
  const x = trayOpen ? 84 + (tray.offsetWidth || 260) + 8 : 84;
  if (sheet) sheet.style.left = `${x}px`;
  if (dlg?.classList.contains('open')) dlg.style.left = `${x}px`;
}

function setLayer(layer) {
  if (layer !== state.layer && state.selected.length) {
    state.selected = [];
    updateSelectIndicator();
  }
  state.layer = layer;
  const tool = toolOf(layer);
  document.querySelectorAll('#forge-rail [data-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const tray = document.getElementById('forge-ui');
  if (tray) {
    tray.classList.toggle('open', !!tool);
  }
  document.getElementById('panel-file').style.display = layer === 'file' ? 'block' : 'none';
  document.getElementById('panel-campaign').style.display = layer === 'file' ? 'block' : 'none';
  document.getElementById('panel-table').style.display = layer === 'table' ? 'block' : 'none';
  document.getElementById('panel-terrain').style.display = layer === 'terrain' ? 'block' : 'none';
  document.getElementById('panel-scenery').style.display = layer === 'scenery' ? 'block' : 'none';
  document.getElementById('panel-walls').style.display = layer === 'walls' ? 'block' : 'none';
  document.getElementById('panel-place').style.display = layer === 'place' ? 'block' : 'none';
  const zonesPanel = document.getElementById('panel-zones');
  if (zonesPanel) zonesPanel.style.display = layer === 'zones' ? 'block' : 'none';
  document.getElementById('panel-light').style.display = layer === 'light' ? 'block' : 'none';
  if (layer === 'zones') {
    if (state.placeKind !== 'wavehop' && state.placeKind !== 'objective') state.placeKind = '';
    renderWaveEditor();
  }
  const storyPanel = document.getElementById('panel-story');
  if (storyPanel) storyPanel.style.display = layer === 'story' ? 'block' : 'none';
  storySheet?.setOpen(layer === 'story');
  holdStoryCamera = true;
  if (layer === 'story') {
    storyPlayer?.setReel(currentReel());
    applyStorySample(storyPlayer?.sample());
    syncStoryEditor();
  } else {
    storyPlayer?.stop();
    storyHud?.hide();
    storySpeech?.hide();
  }
  holdStoryCamera = false;
  lastPaintKey = '';
  if (layer !== 'walls') wallCursor = null;
  refreshBrushCursor();
  updateWallGhost();
  updateSelectIndicator();
  syncHand();
  syncBench();
  placeMenus();
}

function liftToken(raw) {
  return raw === 'level' ? 'level' : Number(raw);
}

function setTerrain(type) {
  state.terrain = type;
  state.lift = 0;
  levelHold = null;
  document.querySelectorAll('[data-terrain]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.terrain) === type);
  });
  document.querySelectorAll('[data-lift]').forEach((b) => b.classList.remove('active'));
  refreshBrushCursor();
  syncHand();
}

function setLift(dir) {
  state.lift = dir;
  levelHold = null;
  document.querySelectorAll('[data-terrain]').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('[data-lift]').forEach((b) => {
    b.classList.toggle('active', liftToken(b.dataset.lift) === dir);
  });
  refreshBrushCursor();
  syncHand();
}

function isTextEditing(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = String(el.type || 'text').toLowerCase();
  return type === 'text' || type === 'search' || type === 'number' || type === 'password' || type === 'email' || type === 'url';
}

function historyChord(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return '';
  const key = String(e.key || '').toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return '';
}

function isHistoryKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  if (isTextEditing(e.target)) return false;
  return e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Enter' || e.key === '[' || e.key === ']' || e.key === 'Escape';
}

function captureDocument() {
  if (!field || !state.walls) return null;
  return {
    garden: encodeGarden(field, gardenExtras({ committedWalls: true })),
    wallDraft: state.wallDraft.map((p) => ({ x: p.x, z: p.z })),
    wallDraftOpenings: (state.wallDraftOpenings || []).map((o) => ({ ...o })),
    wallKind: state.wallKind,
    waveRoute: state.waveRoute.map((hop) => [Number(hop[0]), Number(hop[1])]),
    waveDraft: { waves: state.waveDraft.waves | 0, era: state.waveDraft.era | 0 },
    waveEdit: state.waveEdit ? { ...state.waveEdit } : null,
    campaign: JSON.parse(JSON.stringify(campaignDraft)),
    activeChapterFile: activeChapterFile || null,
  };
}

function applyDocument(snap) {
  // applyGardenJson refreshes the story reel (seek → applyStorySample). Keep the
  // editor camera while undo/redo restores map data.
  holdStoryCamera = true;
  try {
    applyGardenJson(snap.garden);
    state.wallDraft = (snap.wallDraft || []).map((p) => ({ x: p.x, z: p.z }));
    state.wallDraftOpenings = (snap.wallDraftOpenings || []).map((o) => ({ ...o }));
    state.wallKind = snap.wallKind === 'dungeon' ? 'dungeon' : 'castle';
    state.waveRoute = (snap.waveRoute || []).map((hop) => [hop[0], hop[1]]);
    state.waveDraft = {
      waves: snap.waveDraft?.waves | 0,
      era: snap.waveDraft?.era | 0,
    };
    state.waveEdit = snap.waveEdit ? { ...snap.waveEdit } : null;
    campaignDraft = JSON.parse(JSON.stringify(snap.campaign));
    activeChapterFile = snap.activeChapterFile || null;
    syncWallTools();
    updateWallMeshes();
    renderWaveEditor(true);
    updatePlaceMarkers();
    const nameEl = document.getElementById('campaign-name');
    if (nameEl) nameEl.value = campaignDraft.name;
    renderCampaignDraft();
    syncStoryEditor();
  } finally {
    holdStoryCamera = false;
  }
}

function syncHistoryUi() {
  const undo = document.getElementById('btn-undo');
  const redo = document.getElementById('btn-redo');
  if (undo) undo.disabled = !hist.canUndo && !hist.pending();
  if (redo) redo.disabled = !hist.canRedo;
}

function scheduleCommit(delay = 0) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = 0;
    if (hist.suspended()) return;
    if (hist.busy()) {
      scheduleCommit(40);
      return;
    }
    hist.commit(captureDocument);
    syncHistoryUi();
  }, delay);
}

function armHistory() {
  hist.begin(captureDocument);
  syncHistoryUi();
}

function holdHistory() {
  const releaseHold = hist.hold();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseHold();
    scheduleCommit(0);
  };
  try {
    armHistory();
  } catch (err) {
    release();
    throw err;
  }
  return release;
}

function forgetHistory() {
  clearTimeout(commitTimer);
  commitTimer = 0;
  hist.cancel();
  hist.clear();
  syncHistoryUi();
}

function runHistory(dir) {
  const drawing = hist.pointerCount() > 0;
  const el = document.activeElement;
  if (isTextEditing(el)) el.blur();
  clearTimeout(commitTimer);
  commitTimer = 0;
  const did = dir === 'redo'
    ? hist.redo(captureDocument, applyDocument)
    : hist.undo(captureDocument, applyDocument);
  if (drawing) hist.begin(captureDocument);
  syncHistoryUi();
  return did;
}

function bindHistory() {
  window.addEventListener('pointerdown', (e) => {
    if (e.button > 2) return;
    hist.notePointer(true);
    armHistory();
  }, true);
  const endPointer = (e) => {
    if (e.button > 2) return;
    hist.notePointer(false);
    scheduleCommit(0);
  };
  window.addEventListener('pointerup', endPointer, true);
  window.addEventListener('pointercancel', endPointer, true);
  window.addEventListener('blur', () => {
    hist.releasePointers();
    scheduleCommit(0);
  });
  window.addEventListener('input', (e) => {
    if (e.target?.id === 'workshop-publish-name' || e.target?.id === 'workshop-publish-desc') return;
    armHistory();
    if (!hist.busy()) scheduleCommit(isTextEditing(e.target) ? 400 : 0);
  }, true);
  window.addEventListener('change', (e) => {
    armHistory();
    if (!hist.busy()) scheduleCommit(0);
  }, true);
  window.addEventListener('focusout', (e) => {
    if (!isTextEditing(e.target) || hist.busy()) return;
    scheduleCommit(0);
  }, true);
  window.addEventListener('keydown', (e) => {
    const chord = historyChord(e);
    if (chord) {
      e.preventDefault();
      e.stopPropagation();
      runHistory(chord);
      return;
    }
    if (!isHistoryKey(e)) return;
    armHistory();
    scheduleCommit(0);
  }, true);
  document.getElementById('btn-undo')?.addEventListener('click', () => runHistory('undo'));
  document.getElementById('btn-redo')?.addEventListener('click', () => runHistory('redo'));
  syncHistoryUi();
}

function mountUi() {
  const ui = document.createElement('div');
  ui.id = 'forge-ui';
  ui.innerHTML = `
    <div id="panel-file" class="panel" style="display:none">
      <p class="block-title">This chapter</p>
      <div id="chapter-place">Not in the campaign.</div>
      <label>Name</label>
      <input id="map-name" type="text" placeholder="Chapter name">
      <label>Map type</label>
      <select id="map-type">
        ${MAP_TYPES.map((t) => `<option value="${t.id}"${t.id === state.mapType ? ' selected' : ''}>${t.name}</option>`).join('')}
      </select>
      <div id="map-sides">
        <p class="block-title">Sides</p>
        <p class="hint" id="alliance-hint"></p>
        <div id="alliance-list"></div>
      </div>
      <label>Starting wood</label>
      <input id="start-wood" type="number" min="0" value="${STARTING_RESOURCES.wood}">
      <label>Starting stone</label>
      <input id="start-stone" type="number" min="0" value="${STARTING_RESOURCES.stone}">
      <label>Starting mineral</label>
      <input id="start-mineral" type="number" min="0" value="${STARTING_RESOURCES.mineral}">
      <label>Starting food</label>
      <input id="start-food" type="number" min="0" value="${STARTING_RESOURCES.food}">
      <label>Width</label>
      <select id="map-chunks-x">${chunkSizeOptionsHtml()}</select>
      <label>Depth</label>
      <select id="map-chunks-y">${chunkSizeOptionsHtml()}</select>
      <p class="hint">* Past ${LOD_MAP_CHUNKS} chunks (${forgeTilesForChunks(LOD_MAP_CHUNKS)} tiles), LOD is enabled.</p>
      <label>Seed</label>
      <input id="map-seed" type="number" value="${DEFAULT_SEED}">
      <div class="row">
        <button id="btn-generate">Generate</button>
        <button id="btn-random" type="button">Random</button>
        <button id="btn-export">Export .garden</button>
        <button id="btn-import">Import .garden</button>
        <button id="btn-workshop-publish" type="button">Publish</button>
        <button id="btn-play">Play chapter</button>
      </div>
      <label>Steam Workshop</label>
      <select id="workshop-maps">
        <option value="">Subscribed maps…</option>
      </select>
      <div class="row">
        <button id="btn-workshop-load" type="button">Load subscribed</button>
        <a id="btn-workshop-browse" class="kakko" href="${workshopPageUrl()}" target="_blank" rel="noopener noreferrer">Browse Workshop</a>
      </div>
      <input id="import-file" type="file" accept=".garden,.json" style="display:none">
      <p class="hint" id="workshop-hint">Subscribe and publish from the Steam build. On the web, export a .garden or a .campaign, then Load it in Adventure. Play opens a solo match from this map.</p>
    </div>
    <div id="panel-campaign" class="panel" style="display:none">
      <p class="block-title">Campaign</p>
      <div>Chapters below belong to this campaign.</div>
      <label>Name</label>
      <input id="campaign-name" type="text" maxlength="80" value="Campaign">
      <div class="row">
        <button id="btn-chapter-add" type="button">Add this chapter</button>
        <button id="btn-chapter-new" type="button">New chapter</button>
        <button id="btn-chapter-save" type="button">Save this chapter</button>
      </div>
      <div class="row">
        <button id="btn-episode-new" type="button">Add episode</button>
        <button id="btn-campaign-import" type="button">Import .campaign</button>
        <button id="btn-campaign-export" type="button">Export .campaign</button>
        <button id="btn-campaign-play" type="button">Play campaign</button>
      </div>
      <input id="campaign-import-file" type="file" accept=".garden,.campaign,.json" style="display:none">
      <div id="campaign-tree"></div>
    </div>
    <div id="workshop-publish-dlg">
      <label>Publish name</label>
      <input id="workshop-publish-name" type="text" maxlength="64" placeholder="Garden name">
      <div id="workshop-publish-names" class="row"></div>
      <label>Description</label>
      <textarea id="workshop-publish-desc" rows="6" maxlength="8000"></textarea>
      <img id="workshop-publish-preview" alt="Workshop preview" hidden>
      <p class="hint" id="workshop-publish-hint">Name it, then confirm.</p>
      <div class="row">
        <button id="btn-workshop-publish-confirm" type="button">Publish</button>
        <button id="btn-workshop-publish-cancel" type="button">Cancel</button>
      </div>
    </div>
    <div id="panel-table" class="panel" style="display:none">
      <p id="select-hint" class="hint">Click to select. Shift-click to add. Double-click to toggle on/off.</p>
      <label class="check"><input id="chunk-enabled" type="checkbox" checked disabled> Chunk enabled</label>
      <p id="chunk-note" class="field-note">Double-click a chunk to toggle it as well.</p>
      <label>Radius <span id="radius-label">${DEFAULT_CELL_RADIUS}</span></label>
      <input id="chunk-radius" type="range" min="${PLINTH_CELL_RADIUS}" max="32" step="1" value="${DEFAULT_CELL_RADIUS}" disabled>
      <label class="check"><input id="center-plinth" type="checkbox"> Center plinth</label>
      <p class="hint">-1 places a plinth. 0 is a sharp corner with none. Raise the radius to fillet that corner. Outer rails get matching side plinths. Odd boards can also plant a center plinth - check to put one in the middle.</p>
      <label>Camera bound <span id="camera-bound-label">100%</span></label>
      <input id="camera-bound" type="range" min="20" max="100" value="100">
      <p class="hint">Pan and zoom stay inside this box. 100% is the full table - lower it to keep a vista rim the camera cannot cross.</p>
      <div class="row">
        <button id="btn-enable-all">Enable all chunks</button>
      </div>
      <label>Props</label>
      <div class="row">
        <button id="table-tool-chunks" type="button" class="active">Chunks</button>
        <button id="table-tool-props" type="button">Props</button>
      </div>
      <div class="row">
        <button data-prop="${BACKDROP.DISC}" type="button">Disc</button>
        <button data-prop="${BACKDROP.CASTLE}" type="button">Castle</button>
        <button id="btn-prop-remove" type="button">Remove</button>
      </div>
      <div id="prop-list" class="hint">No props.</div>
      <label>Size <span id="prop-scale-label">${BACKDROP_DEFS[BACKDROP.CASTLE].defaultScale}</span></label>
      <input id="prop-scale" type="range" min="4" max="240" step="1" value="${BACKDROP_DEFS[BACKDROP.CASTLE].defaultScale}" disabled>
      <label>Height <span id="prop-y-label">0</span></label>
      <input id="prop-y" type="range" min="-800" max="40" step="1" value="0" disabled>
      <label>Turn <span id="prop-yaw-label">0</span></label>
      <input id="prop-yaw" type="range" min="0" max="360" step="1" value="0" disabled>
      <p class="hint">Props sit beside the table or in a hole. Disc or Castle arms one drop - click the ground once, then chunk clicks work again. Double-click a chunk to turn it on or off. Click a prop to drag it. They do not block movement.</p>
    </div>
    <div id="panel-terrain" class="panel" style="display:none">
      <div class="palette">
        <button data-terrain="${TERRAIN.GRASS}" class="active"><i class="swatch" style="background:#7d9a3a"></i>Grass</button>
        <button data-terrain="${TERRAIN.DIRT}"><i class="swatch" style="background:#9a6a3c"></i>Dirt</button>
        <button data-terrain="${TERRAIN.WATER}"><i class="swatch" style="background:#3a7ea8"></i>Water</button>
        <button data-terrain="${TERRAIN.GRAVEL}"><i class="swatch" style="background:#8d887c"></i>Gravel</button>
        <button data-terrain="${TERRAIN.TILE}"><i class="swatch" style="background:#c4b49a"></i>Tile</button>
        <button data-lift="1">Raise</button>
        <button data-lift="-1">Lower</button>
        <button data-lift="level">Level</button>
      </div>
      <label>Brush <span id="brush-label">1</span></label>
      <input id="brush-size" type="range" min="0" max="6" value="1">
      <label>Strength <span id="lift-strength-label">6</span></label>
      <input id="lift-strength" type="range" min="1" max="10" value="6">
    </div>
    <div id="panel-scenery" class="panel" style="display:none">
      <div class="palette">
        <button data-scenery="${SCENERY.TREE}" class="active"><i class="swatch" style="background:#3d6b32"></i>Tree</button>
        <button data-scenery="${SCENERY.ROCK_PLAIN}"><i class="swatch" style="background:#8a8680"></i>Rock</button>
        <button data-scenery="${SCENERY.ROCK_MOSS}"><i class="swatch" style="background:#5d7354"></i>Moss rock</button>
        <button data-scenery="${SCENERY.ROCK_SNOW}"><i class="swatch" style="background:#d5d8df"></i>Big rock</button>
        <button data-scenery="${SCENERY.NONE}">Erase trees</button>
        <button data-doodad="${DOODAD.MUSHROOM}"><i class="swatch" style="background:#c4563a"></i>Mushroom</button>
        <button data-doodad="${DOODAD.WAGON}"><i class="swatch" style="background:#6a5340"></i>Wagon</button>
        <button data-doodad="${DOODAD.NONE}">Erase doodads</button>
      </div>
      <label>Brush <span id="scenery-brush-label">1</span></label>
      <input id="scenery-brush-size" type="range" min="0" max="6" value="1">
      <label>Density <span id="scenery-density-label">100%</span></label>
      <input id="scenery-density" type="range" min="1" max="10" value="10">
      <div class="row stay">
        <button id="btn-gen-scenery">Generate trees / rocks</button>
        <button id="btn-clear-scenery">Clear scenery</button>
        <button id="btn-clear-doodads">Clear doodads</button>
      </div>
    </div>
    <div id="panel-walls" class="panel" style="display:none">
      <p class="hint" id="wall-aim">Wall: click corners. Right-click finishes the run. Backspace drops the last corner. Erase takes out one section.</p>
      <div class="row">
        <button data-wall-kind="castle" class="active" type="button">Castle</button>
        <button data-wall-kind="dungeon" type="button">Dungeon</button>
      </div>
      <div class="row">
        <button data-wall-tool="lay" class="active" type="button">Wall</button>
        <button data-wall-tool="erase" type="button">Erase</button>
        <button data-wall-tool="door" type="button">Door</button>
        <button data-wall-tool="door-open" type="button">Open door</button>
        <button data-wall-tool="gate" type="button">Gate</button>
        <button data-wall-tool="gate-open" type="button">Open gate</button>
      </div>
      ${WALL_FIELDS.map((spec) => `
        <label>${spec.label} <span id="${spec.id}-label">${Number(state.walls.style[spec.key]).toFixed(2)}</span></label>
        <input id="${spec.id}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${state.walls.style[spec.key]}">
      `).join('')}
      <div class="row">
        <button id="wall-finish" type="button">Finish run</button>
        <button id="wall-clear" type="button">Clear</button>
      </div>
      <p class="hint" id="wall-status">0 runs</p>
      <p class="hint">Castle is large pale ashlar. Dungeon is the same wall in smaller grey stone. The choice sticks to the run you finish.</p>
    </div>
    <div id="panel-place" class="panel" style="display:none">
      <div id="army-stamps">
        <div id="army-sides" class="ink"></div>
        <div class="palette">
          <button data-place="party" type="button"><i class="swatch" style="background:#e6c35c"></i>Party</button>
          ${UNIT_DEFS.map((u) => `<button data-place="unit" data-type="${u.id}"><i class="swatch" style="background:rgb(${Math.round(u.color[0] * 255)}, ${Math.round(u.color[1] * 255)}, ${Math.round(u.color[2] * 255)})"></i>${u.name}</button>`).join('')}
        </div>
        <div class="palette">
          <button data-place="agora" data-type="agora"><i class="swatch" style="background:#e6c35c"></i>Agora</button>
          ${PLACEABLE_BUILDINGS.map((b) => {
            const ink = b.category === 'elemental' ? '#7d6aa8' : b.category === 'advanced' ? '#8aa0b8' : '#c4a574';
            return `<button data-place="building" data-type="${b.id}"><i class="swatch" style="background:${ink}"></i>${b.name}</button>`;
          }).join('')}
        </div>
      </div>
      <div id="army-held" hidden>
        <label>Name</label>
        <input id="place-name" type="text" placeholder="Name">
        <div id="army-held-ink" class="ink"></div>
        <select id="place-owner" hidden>
          ${FACTIONS.map((f) => `<option value="${f.id}"${f.id === 0 ? ' selected' : ''}>${f.name}</option>`).join('')}
        </select>
        <div class="row stay">
          <button id="place-rot-l" type="button" disabled>Rotate left</button>
          <button id="place-rot-r" type="button" disabled>Rotate right</button>
          <button id="btn-place-remove" type="button" disabled>Remove</button>
        </div>
      </div>
    </div>
    <div id="panel-zones" class="panel" style="display:none">
      <div class="palette" id="goal-list"></div>
      <div class="row stay">
        <button id="goal-new-btn" type="button">New goal</button>
      </div>
      <div id="goal-new" hidden>
        <div class="palette" id="goal-kinds"></div>
        <select id="place-obj-kind" hidden>
          ${OBJ_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}
        </select>
        <select id="place-obj-terminal" hidden>
          <option value="">No</option>
          <option value="1">Yes</option>
        </select>
        <input id="place-obj-r" type="hidden" value="5">
        <input id="place-obj-label" type="hidden" value="">
        <input id="place-obj-message" type="hidden" value="">
        <input id="place-obj-next" type="hidden" value="">
      </div>
      <div id="wave-zone-list"></div>
    </div>
    <div id="panel-story" class="panel" style="display:none">
      <div class="row stay">
        <button id="story-reel-intro" type="button" class="active">Intro</button>
        <button id="story-reel-win" type="button">Win</button>
        <label>Reveal
          <select id="story-reveal">
            <option value="">Hidden</option>
            <option value="enemy">Enemy</option>
            <option value="all">Everyone</option>
          </select>
        </label>
      </div>
      <div class="row stay">
        <button id="story-to-start" type="button">|&lt;</button>
        <button id="story-rew" type="button">&lt;&lt;</button>
        <button id="story-play" type="button">Play</button>
        <button id="story-ff" type="button">&gt;&gt;</button>
        <button id="story-to-end" type="button">&gt;|</button>
        <button id="story-prev" type="button">Prev</button>
        <button id="story-next" type="button">Next</button>
      </div>
      <div class="row">
        <button id="story-add-camera" type="button">Add camera</button>
        <button id="story-add-line" type="button">Add line</button>
        <button id="story-add-hold" type="button">Add pause</button>
        <button id="story-delete" type="button">Delete clip</button>
      </div>
      <p id="story-clip-empty" class="hint">Intro plays at the start. Win plays when the chapter is won. Reveal opens sight for that reel. Add a camera, a line, or a pause, then pick it in the list.</p>
      <div id="story-clip-list"></div>
      <div id="story-cast"></div>
      <div id="story-clip-camera" style="display:none">
        <div class="row">
          <button id="story-cam-set-start" type="button">Set start from view</button>
          <button id="story-cam-set-end" type="button">Set end from view</button>
        </div>
        <p id="story-cam-waypoints" class="hint"></p>
        <p class="block-title">Look</p>
        <label class="field"><span class="field-name">Aim at</span>
          <select id="story-cam-char">
            <option value="">A tile</option>
          </select>
          <span class="field-note">A named unit, or a tile on the map.</span>
        </label>
        <label class="field"><span class="field-name">Tile X</span>
          <input id="story-cam-tx" type="number" step="1">
        </label>
        <label class="field"><span class="field-name">Tile Z</span>
          <input id="story-cam-tz" type="number" step="1">
        </label>
        <label class="field"><span class="field-name">Distance</span>
          <input id="story-cam-radius" type="number" min="8" step="1">
          <span class="field-note">How far the camera sits from that spot.</span>
        </label>
        <label class="field"><span class="field-name">Orbit</span>
          <input id="story-cam-alpha" type="number" step="0.05">
          <span class="field-note">Which way the camera faces. Turn the view, then Set end.</span>
        </label>
        <p class="block-title">Timing</p>
        <label class="field"><span class="field-name">Starts at</span>
          <input id="story-cam-t" type="number" min="0" step="0.1">
          <span class="field-note">Seconds into the reel.</span>
        </label>
        <label class="field"><span class="field-name">How long</span>
          <input id="story-cam-dur" type="number" min="0.05" step="0.1">
          <span class="field-note">Seconds this shot lasts.</span>
        </label>
      </div>
      <div id="story-clip-line" style="display:none">
        <p class="block-title">Dialogue</p>
        <label class="field"><span class="field-name">Who</span>
          <input id="story-line-speaker" type="text" list="story-cast-names">
          <span class="field-note">A unit’s name. Blank means the narrator.</span>
        </label>
        <datalist id="story-cast-names"></datalist>
        <label class="field"><span class="field-name">What they say</span>
          <textarea id="story-line-text"></textarea>
        </label>
        <label class="field"><span class="field-name">Delivery</span>
          <select id="story-line-style">
            ${LINE_STYLES.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </label>
        <p class="block-title">Timing</p>
        <label class="field"><span class="field-name">Starts at</span>
          <input id="story-line-t" type="number" min="0" step="0.1">
          <span class="field-note">Seconds into the reel.</span>
        </label>
        <label class="field"><span class="field-name">Stays up</span>
          <input id="story-line-dur" type="number" min="0.05" step="0.1">
          <span class="field-note">Seconds the line remains on screen.</span>
        </label>
      </div>
      <div id="story-clip-hold" style="display:none">
        <p class="block-title">Pause</p>
        <label class="field"><span class="field-name">Starts at</span>
          <input id="story-hold-t" type="number" min="0" step="0.1">
          <span class="field-note">Seconds into the reel.</span>
        </label>
        <label class="field"><span class="field-name">How long</span>
          <input id="story-hold-dur" type="number" min="0.05" step="0.1">
          <span class="field-note">Seconds to hold before the next beat.</span>
        </label>
      </div>
    </div>
    <div id="panel-light" class="panel" style="display:none">
      <p class="hint">Brightness is the whole map, sky included. Intensity is one light. A strong fill washes the shadows. Body 1 casts them.</p>
      <label>Preset</label>
      <select id="light-preset">
        <option value="">- pick a mood -</option>
        ${CELESTIAL_PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      <label>Brightness <span id="light-exposure-label"></span></label>
      <input id="light-exposure" type="range" min="${EXPOSURE_RANGE.min}" max="${EXPOSURE_RANGE.max}" step="0.01">
      <label>Contrast <span id="light-contrast-label"></span></label>
      <input id="light-contrast" type="range" min="${CONTRAST_RANGE.min}" max="${CONTRAST_RANGE.max}" step="0.01">
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
  const dlg = document.getElementById('workshop-publish-dlg');
  if (dlg) document.body.appendChild(dlg);
  const top = document.createElement('div');
  top.id = 'forge-top';
  top.innerHTML = `
    <button id="btn-chapter" type="button">Untitled</button>
    <button id="btn-top-play" type="button">Play</button>
    <span id="holding">Holding: Select</span>
    <span id="stats"></span>
    <span class="spacer"></span>
  `;
  const view = document.createElement('div');
  view.id = 'forge-view';
  view.innerHTML = `
    <button id="btn-undo" type="button" title="Ctrl+Z" disabled>Undo</button>
    <button id="btn-redo" type="button" title="Ctrl+Y" disabled>Redo</button>
    <label title="Red is blocked, yellow is slow"><input id="show-grid" type="checkbox"> Collision</label>
    <label title="Chunk outlines"><input id="show-chunks" type="checkbox"> Chunk borders</label>
    <label title="Tile corners, plus the slope diagonal"><input id="show-tiles" type="checkbox"> Tile wireframe</label>
    <label title="Hide trees, rocks, and doodads without removing them"><input id="show-scenery" type="checkbox" checked> Scenery</label>
  `;
  top.appendChild(view);
  document.body.appendChild(top);
  const rail = document.createElement('div');
  rail.id = 'forge-rail';
  rail.innerHTML = `
    <button type="button" data-tool="file">File</button>
    <button type="button" data-tool="table">Table</button>
    <button type="button" data-tool="land">Land</button>
    <button type="button" data-tool="trees">Trees</button>
    <button type="button" data-tool="walls">Walls</button>
    <button type="button" data-tool="army">Army</button>
    <button type="button" data-tool="goal">Goal</button>
    <button type="button" data-tool="story">Story</button>
    <button type="button" data-tool="light">Light</button>
  `;
  document.body.appendChild(rail);
  for (const el of [ui, top, rail]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointermove', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }
  document.getElementById('btn-chapter')?.addEventListener('click', () => pickTool('file'));
  const placeChrome = () => {
    const bar = document.getElementById('forge-top');
    if (!bar) return;
    const y = `${Math.ceil(bar.getBoundingClientRect().bottom) + 6}px`;
    for (const id of ['forge-rail', 'forge-ui', 'workshop-publish-dlg']) {
      const el = document.getElementById(id);
      if (el) el.style.top = y;
    }
    placeMenus();
  };
  placeChrome();
  window.addEventListener('resize', placeChrome);
  document.getElementById('btn-top-play')?.addEventListener('click', () => {
    const live = (campaignDraft.episodes || []).some((ep) => (ep.chapters || []).some((ch) => ch.live !== false));
    if (live) playCampaign();
    else playMap();
  });
  rail.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => pickTool(b.dataset.tool));
  });
  ui.querySelectorAll('[data-terrain]').forEach((b) => {
    b.addEventListener('click', () => setTerrain(Number(b.dataset.terrain)));
  });
  ui.querySelectorAll('[data-lift]').forEach((b) => {
    b.addEventListener('click', () => setLift(liftToken(b.dataset.lift)));
  });
  ui.querySelectorAll('[data-scenery]').forEach((b) => {
    b.addEventListener('click', () => {
      state.stamp = 'scenery';
      state.scenery = Number(b.dataset.scenery);
      ui.querySelectorAll('[data-scenery]').forEach((x) => {
        x.classList.toggle('active', Number(x.dataset.scenery) === state.scenery);
      });
      ui.querySelectorAll('[data-doodad]').forEach((x) => x.classList.remove('active'));
      refreshBrushCursor();
      syncHand();
    });
  });
  ui.querySelectorAll('[data-doodad]').forEach((b) => {
    b.addEventListener('click', () => {
      state.stamp = 'doodad';
      state.doodad = Number(b.dataset.doodad);
      ui.querySelectorAll('[data-doodad]').forEach((x) => {
        x.classList.toggle('active', Number(x.dataset.doodad) === state.doodad);
      });
      ui.querySelectorAll('[data-scenery]').forEach((x) => x.classList.remove('active'));
      refreshBrushCursor();
      syncHand();
    });
  });
  ui.querySelectorAll('[data-place]').forEach((b) => {
    b.addEventListener('click', () => {
      state.placeKind = b.dataset.place;
      state.placeType = b.dataset.place === 'unit' ? Number(b.dataset.type) : b.dataset.type;
      ui.querySelectorAll('[data-place]').forEach((x) => {
        x.classList.toggle('active', x === b);
      });
      const grabbedUnit = state.placePicks.some((p) => p.kind === 'unit');
      state.placePicks = [];
      placeDrag = null;
      placeBox = null;
      if (grabbedUnit) {
        const nameEl = document.getElementById('place-name');
        if (nameEl) nameEl.value = '';
      }
      syncPlacePickUi();
      updatePlaceMarkers();
      if (b.dataset.place === 'objective') {
        state.waveEdit = null;
        renderWaveEditor();
      }
      syncHand();
    });
  });
  renderAllianceEditor();
  document.getElementById('alliance-list').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-alliance]');
    if (!sel) return;
    const id = Number(sel.dataset.alliance);
    if (!Number.isInteger(id) || id < 0 || id >= FACTIONS.length) return;
    const key = sel.value;
    const team = key === 'own' ? id : SIDE_BASE + SIDE_LETTERS.indexOf(key);
    if (!Number.isInteger(team) || team < 0) return;
    materializeTeams();
    state.teamByOwner[id] = team;
    renderAllianceEditor();
  });
  document.getElementById('place-owner').addEventListener('change', (e) => {
    if (e.target.value === '') return;
    const n = Number(e.target.value);
    if (!Number.isInteger(n) || n < 0 || n >= FACTIONS.length) return;
    state.owner = n;
    let changed = false;
    for (const pick of state.placePicks) {
      const item = placeList(pick.kind)?.[pick.index];
      if (item && item.owner != null) {
        item.owner = n;
        changed = true;
      }
    }
    syncFactionUi(livePicks());
    renderArmySides();
    if (changed) updatePlaceMarkers();
  });
  document.getElementById('place-name')?.addEventListener('input', (e) => {
    const picks = livePicks();
    if (picks.length !== 1 || picks[0].kind !== 'unit') return;
    const u = state.units[picks[0].index];
    if (u) u.name = String(e.target.value || '');
  });
  document.getElementById('place-rot-l')?.addEventListener('click', () => rotatePlacePick(-1));
  document.getElementById('place-rot-r')?.addEventListener('click', () => rotatePlacePick(1));
  document.getElementById('btn-place-remove')?.addEventListener('click', () => {
    if (!livePicks().length) return;
    deletePlacePick();
  });
  const waveList = document.getElementById('wave-zone-list');
  document.getElementById('goal-new-btn')?.addEventListener('click', () => {
    if (state.placeKind === 'objective') state.placeKind = '';
    else {
      state.placeKind = 'objective';
      state.waveEdit = null;
      state.placePicks = [];
    }
    renderWaveEditor();
    syncHand();
    updatePlaceMarkers();
  });
  waveList?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wave-act]');
    if (!btn || !waveList.contains(btn)) return;
    const act = btn.dataset.waveAct;
    const id = btn.dataset.waveId || '';
    const index = Number(btn.dataset.waveIndex);
    if (act === 'select-zone') {
      state.waveEdit = { id };
    } else if (act === 'select-hop') {
      state.waveEdit = { id, hopIndex: index };
      armWaveHopPlace();
    } else if (act === 'select-pending') {
      state.waveEdit = { pending: true, hopIndex: index };
      armWaveHopPlace();
    } else if (act === 'add-hop') {
      state.waveEdit = { id };
      armWaveHopPlace();
    } else if (act === 'add-pending') {
      state.waveEdit = null;
      armWaveHopPlace();
    } else if (act === 'remove-hop') {
      removeWaveHopAt(waveZoneById(id), index);
      if (state.waveEdit?.id === id && state.waveEdit.hopIndex === index) state.waveEdit = { id };
    } else if (act === 'remove-pending') {
      if (index >= 0 && index < state.waveRoute.length) state.waveRoute.splice(index, 1);
      if (state.waveEdit?.pending && state.waveEdit.hopIndex === index) state.waveEdit = null;
    } else if (act === 'remove-zone') {
      removeZoneById(id);
    }
    renderWaveEditor();
    updatePlaceMarkers();
  });
  waveList?.addEventListener('change', (e) => {
    const input = e.target.closest('[data-wave-field]');
    if (!input) return;
    const id = input.dataset.waveId || '';
    const obj = id ? waveZoneById(id) : null;
    const n = Number(input.value) || 0;
    if (input.dataset.waveField === 'waves') {
      if (obj) setZoneWaves(obj, n);
      else state.waveDraft.waves = Math.max(0, n | 0);
    } else if (input.dataset.waveField === 'era') {
      if (obj) setZoneEra(obj, n);
      else state.waveDraft.era = Math.max(0, Math.min(5, n | 0));
    }
    renderWaveEditor(true);
    updatePlaceMarkers();
  });
  waveList?.addEventListener('change', (e) => {
    const input = e.target.closest('[data-zone-field]');
    if (!input || !waveList.contains(input)) return;
    const obj = waveZoneById(input.dataset.zoneId || '');
    if (!obj) return;
    applyZoneField(obj, input);
    renderWaveEditor(true);
    updatePlaceMarkers();
  });
  const placeKind = document.getElementById('place-obj-kind');
  const syncPlaceTerminal = () => {
    const box = document.getElementById('place-obj-terminal');
    if (!box) return;
    const lock = placeKind?.value === 'escape' || placeKind?.value === 'advance';
    box.disabled = lock;
    if (lock) box.value = '1';
  };
  placeKind?.addEventListener('change', syncPlaceTerminal);
  syncPlaceTerminal();
  renderWaveEditor();
  document.getElementById('btn-gen-scenery').addEventListener('click', () => {
    stampStructureClaim();
    populateScenery(field, null, reservedFromPlacements(), { keepExisting: true });
    clearResourcesUnderPlacements();
    field.sceneryAuthored = true;
    queueSceneryPaint(null, { full: true });
    grid?.refreshOccupancy(field);
  });
  document.getElementById('btn-clear-scenery').addEventListener('click', () => {
    clearAllScenery(field);
    queueSceneryPaint(null, { full: true });
    grid?.refreshOccupancy(field);
  });
  document.getElementById('btn-clear-doodads').addEventListener('click', () => {
    if (field.doodadType) field.doodadType.fill(0);
    if (terrain?.applyAuthoredSceneryTiles) {
      terrain.applyAuthoredSceneryTiles(field, []);
      if (sceneRegistered) invalidateRenderBundles(engine);
    }
    queueSceneryPaint(null, { full: true });
  });
  document.getElementById('map-name').addEventListener('input', (e) => {
    state.mapName = e.target.value;
    if (activeChapterFile) {
      renameChapter(campaignDraft, activeChapterFile, e.target.value);
      const listed = document.querySelector(`#campaign-tree input[data-file="${CSS.escape(activeChapterFile)}"]`);
      if (listed && document.activeElement !== listed) listed.value = e.target.value;
    }
    syncChapterTitle();
  });
  document.getElementById('map-type').addEventListener('change', (e) => {
    state.mapType = normalizeMapType(e.target.value);
    renderAllianceEditor();
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
    const raw = Number(e.target.value);
    const r = Number.isFinite(raw) ? raw : 0;
    document.getElementById('radius-label').textContent = String(r);
    if (!state.selected.length || !field.tableShape) return;
    for (const s of state.selected) setCellRadius(field.tableShape, s.cx, s.cz, r);
    applySelectedShape();
  });
  document.getElementById('center-plinth').addEventListener('change', (e) => {
    setCenterPlinth(e.target.checked);
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
  document.getElementById('lift-strength').addEventListener('input', (e) => {
    const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
    state.liftStrength = n;
    const label = document.getElementById('lift-strength-label');
    if (label) label.textContent = String(n);
  });
  document.getElementById('scenery-brush-size').addEventListener('input', (e) => {
    setBrush(Number(e.target.value) || 0);
  });
  document.getElementById('scenery-density').addEventListener('input', (e) => {
    const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
    state.sceneryDensity = n;
    const label = document.getElementById('scenery-density-label');
    if (label) label.textContent = `${n * 10}%`;
  });
  for (const spec of WALL_FIELDS) {
    const el = document.getElementById(spec.id);
    el.addEventListener('input', () => {
      state.walls.style[spec.key] = Number(el.value);
      const label = document.getElementById(`${spec.id}-label`);
      if (label) label.textContent = Number(el.value).toFixed(2);
      updateWallMeshes();
    });
  }
  document.getElementById('wall-finish').addEventListener('click', finishWallRun);
  document.getElementById('wall-clear').addEventListener('click', () => {
    state.walls.runs = [];
    state.wallDraft = [];
    state.wallDraftOpenings = [];
    wallCursor = null;
    updateWallMeshes();
  });
  document.querySelectorAll('[data-wall-kind]').forEach((b) => {
    b.addEventListener('click', () => {
      state.wallKind = b.dataset.wallKind === 'dungeon' ? 'dungeon' : 'castle';
      syncWallTools();
      updateWallGhost();
    });
  });
  document.querySelectorAll('[data-wall-tool]').forEach((b) => {
    b.addEventListener('click', () => setWallTool(b.dataset.wallTool || 'lay'));
  });
  document.getElementById('show-grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    grid?.setVisible(state.showGrid);
    if (sceneRegistered) invalidateRenderBundles(engine);
  });
  document.getElementById('show-chunks').addEventListener('change', (e) => {
    state.showChunks = e.target.checked;
    updateSelectIndicator();
  });
  document.getElementById('show-tiles').addEventListener('change', (e) => {
    state.showTiles = e.target.checked;
    tileWireStamp = 0;
    updateTileWire();
  });
  document.getElementById('show-scenery').addEventListener('change', (e) => {
    state.showScenery = e.target.checked;
    terrain?.setSceneryVisible?.(state.showScenery);
    if (sceneRegistered) invalidateRenderBundles(engine);
  });
  document.getElementById('camera-bound').addEventListener('input', (e) => {
    setCameraBoundPct(Number(e.target.value) || 100);
  });
  document.getElementById('btn-enable-all').addEventListener('click', () => {
    applyTableSilhouette(field, {
      ...field.tableShape,
      cellMask: createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES),
    });
    scheduleRebuild();
    updateSelectUi();
  });
  document.getElementById('table-tool-chunks')?.addEventListener('click', () => setTableTool('chunks'));
  document.getElementById('table-tool-props')?.addEventListener('click', () => {
    state.propArmed = false;
    setTableTool('props');
  });
  document.querySelectorAll('[data-prop]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.propType = btn.dataset.prop;
      state.propArmed = true;
      setTableTool('props');
    });
  });
  document.getElementById('prop-list')?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-prop-index]');
    if (!btn) return;
    state.propIndex = Number(btn.dataset.propIndex);
    setTableTool('props');
    syncPropUi();
  });
  document.getElementById('btn-prop-remove')?.addEventListener('click', removeSelectedProp);
  document.getElementById('prop-scale')?.addEventListener('input', (e) => {
    const scale = Number(e.target.value);
    if (!(scale > 0)) return;
    patchSelectedProp({ scale });
  });
  document.getElementById('prop-y')?.addEventListener('input', (e) => {
    patchSelectedProp({ y: Number(e.target.value) || 0 });
  });
  document.getElementById('prop-yaw')?.addEventListener('input', (e) => {
    const deg = Number(e.target.value) || 0;
    patchSelectedProp({ yaw: (deg * Math.PI) / 180 });
  });
  function generateFromSeed(seed) {
    const width = forgeTilesForChunks(Number(document.getElementById('map-chunks-x').value));
    const height = forgeTilesForChunks(Number(document.getElementById('map-chunks-y').value));
    field = newField(width, height, seed >>> 0, { suppressCenterBlock: field?.suppressCenterBlock === true });
    state.selected = [];
    state.propIndex = -1;
    state.propArmed = false;
    propDrag = null;
    propReturnChunks = false;
    state.units = [];
    state.teamByOwner = null;
    state.placePicks = [];
    placeDrag = null;
    placeBox = null;
    state.buildings = [];
    state.objectives = [];
    state.waveRoute = [];
    state.walls.runs = [];
    state.wallDraft = [];
    state.wallDraftOpenings = [];
    wallCursor = null;
    state.cameraHalfF = 0;
    placeGeneratedStarts();
    placeGeneratedScenery();
    celestial?.setWorldHalfF(Math.max(worldHalfFFromField(field), worldHalfZFFromField(field)));
    applyCameraBound();
    syncCenterPlinthUi();
    renderWaveEditor();
    syncFormFromField();
    syncPlacePickUi();
    renderAllianceEditor();
    syncPropUi();
    rebuildTerrain();
  }
  document.getElementById('btn-generate').addEventListener('click', () => {
    generateFromSeed(Number(document.getElementById('map-seed').value) || 0);
  });
  document.getElementById('btn-random').addEventListener('click', () => {
    generateFromSeed((Math.random() * 0x100000000) >>> 0);
  });
  document.getElementById('btn-export').addEventListener('click', exportMap);
  document.getElementById('btn-play').addEventListener('click', playMap);
  document.getElementById('btn-chapter-add')?.addEventListener('click', addCurrentChapter);
  document.getElementById('btn-chapter-new')?.addEventListener('click', () => {
    flushActiveChapter();
    generateFromSeed((Math.random() * 0x100000000) >>> 0);
    const chapter = addChapter(campaignDraft, { name: nextChapterName(), garden: gardenPayload() });
    if (chapter) activeChapterFile = chapter.file;
    renderCampaignDraft();
  });
  document.getElementById('btn-chapter-save')?.addEventListener('click', saveActiveChapter);
  document.getElementById('btn-episode-new')?.addEventListener('click', () => {
    addEpisode(campaignDraft, '');
    renderCampaignDraft();
  });
  document.getElementById('btn-campaign-export')?.addEventListener('click', exportCampaign);
  document.getElementById('btn-campaign-play')?.addEventListener('click', () => { playCampaign(); });
  document.getElementById('btn-campaign-import')?.addEventListener('click', () => {
    document.getElementById('campaign-import-file').click();
  });
  document.getElementById('campaign-import-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importCampaignFile(file);
    e.target.value = '';
  });
  document.getElementById('campaign-name')?.addEventListener('input', (e) => {
    renameCampaign(campaignDraft, e.target.value);
    syncChapterTitle();
  });
  renderCampaignDraft();
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    e.target.value = '';
  });
  document.getElementById('btn-workshop-load')?.addEventListener('click', () => {
    void loadWorkshopSelection();
  });
  document.getElementById('btn-workshop-browse')?.addEventListener('click', (e) => {
    if (aetherSteam.openOverlay('workshop')) e.preventDefault();
  });
  document.getElementById('btn-workshop-publish')?.addEventListener('click', () => {
    void beginWorkshopPublish();
  });
  document.getElementById('btn-workshop-publish-confirm')?.addEventListener('click', () => {
    void confirmWorkshopPublish();
  });
  document.getElementById('btn-workshop-publish-cancel')?.addEventListener('click', () => {
    closeWorkshopPublishDlg();
  });
  document.getElementById('workshop-publish-name')?.addEventListener('input', () => {
    syncWorkshopDescription(gardenPayload(), document.getElementById('workshop-publish-name')?.value || '');
  });
  document.getElementById('workshop-publish-desc')?.addEventListener('input', () => {
    workshopDescEdited = true;
  });
  syncWorkshopChrome();
  bindHistory();
  setLayer('select');
  syncChapterTitle();
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
  document.getElementById('light-exposure').value = String(s.exposure);
  document.getElementById('light-contrast').value = String(s.contrast);
  document.getElementById('light-exposure-label').textContent = s.exposure.toFixed(2);
  document.getElementById('light-contrast-label').textContent = s.contrast.toFixed(2);
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
  s.exposure = Number(document.getElementById('light-exposure').value);
  s.contrast = Number(document.getElementById('light-contrast').value);
  celestial.apply(s);
  persistCelestial();
  // Hand-tuning diverges from the preset - drop the label so it is not misleading.
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
  for (const id of ['light-exposure', 'light-contrast']) {
    document.getElementById(id).addEventListener('input', readLightUi);
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
  placePreview = createPlacePreview(engine, scene, (x, z) => (
    field ? surfaceHeightAt(field, x, z) : 0
  ), () => {
    if (sceneRegistered) invalidateRenderBundles(engine);
  });

  field = newField(DEFAULT_SIZE, DEFAULT_SIZE, DEFAULT_SEED);
  placeGeneratedStarts();
  placeGeneratedScenery();
  const worldHalfF = worldHalfFFromField(field);
  const worldHalfZF = worldHalfZFFromField(field);
  camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, Math.max(worldHalfF, worldHalfZF) * 1.55, {
    x: 0, y: 0, z: 0,
  });
  camera.farPlane = 40000;
  scene.camera = camera;
  cam = createCameraController(camera, canvas, { worldHalfF, worldHalfZF });

  storyHud = createStoryHud(document.body);
  storySpeech = createStorySpeech({
    host: document.body,
    getSpeakerPos: (name) => speakerWorldPos(name),
    worldToScreen: (x, y, z) => forgeWorldToScreen(x, y, z),
  });
  storySheet = createStorySheet({
    onSeek: (t) => storyPlayer?.seek(t),
    onSelect: (id) => {
      state.storyClipId = id;
      syncStoryEditor();
    },
    onNudge: (id, patch) => {
      state.storyClipId = id;
      patchSelectedClip(patch);
    },
  });
  document.body.appendChild(storySheet.el);
  storySheet.setOpen(state.layer === 'story');
  storyPlayer = createStoryPlayer({
    reel: currentReel(),
    onSample: applyStorySample,
  });
  storyPlayer.subscribe(() => {
    refreshStorySheet();
    const playBtn = document.getElementById('story-play');
    if (playBtn) playBtn.textContent = storyPlayer.rate() === 0 ? 'Play' : 'Stop';
  });
  bindStoryUi();
  refreshStorySheet();

  celestial = createCelestialRig(scene, {
    worldHalfF,
    state: loadForgeCelestial(),
  });
  bindLightUi();

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  function storyDriving() {
    return state.layer === 'story' && storyPlayer && storyPlayer.rate() !== 0;
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (storyDriving()) return;
    cam.handleWheel(e);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    if (!storyDriving()) cam.handlePointerDown(e);
    if (e.button === 0 && !cam.isRmbPanning()) {
      state.painting = true;
      if (state.layer === 'scenery') scenerySalt = (Math.random() * 0x100000000) >>> 0;
      const mode = wallOpeningMode();
      const erase = state.layer === 'walls' && (state.wallTool === 'erase' || (!mode && e.shiftKey));
      const pos = (state.layer === 'walls' && (mode || erase))
        ? pickWallAim(e.clientX, e.clientY)
        : pickGround(e.clientX, e.clientY);
      if (state.layer === 'walls') {
        if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
        if ((e.detail | 0) < 2) {
          if (mode) {
            if (e.shiftKey) removeNearestOpening(state.walls.runs, pos.x, pos.z, OPENING_REACH);
            else if (!placeWallOpening(state.walls.runs, pos.x, pos.z, mode.gate, OPENING_REACH, mode.open)) {
              const hit = previewWallOpening(state.walls.runs, pos.x, pos.z, mode.gate);
              setWallAim(hit.reason || 'Click a finished wall.');
            }
            clearOpeningMarker();
            updateWallMeshes();
            if (pos) updateOpeningMarker(pos);
          } else if (erase) deleteWallAt(pos);
          else addWallPoint(pos);
        }
      } else if (state.layer === 'place') {
        handlePlacePointerDown(pos, e);
      } else if (state.layer === 'zones') {
        handleZonePointerDown(pos, e);
      } else if (state.layer === 'table' && state.tableTool === 'props' && propGesture(pos)) {
        placeOrGrabProp(pos);
      } else if (state.layer === 'table' || state.layer === 'terrain' || state.layer === 'scenery' || state.layer === 'story') {
        applyAt(pos, { add: e.shiftKey });
      }
    }
  });
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (state.layer !== 'table') return;
    if (state.tableTool === 'props' && state.propArmed) return;
    const pos = pickGround(e.clientX, e.clientY);
    if (!pos || !field?.tableShape) return;
    if (state.tableTool === 'props' && nearestBackdrop(propList(), pos.x, pos.z) >= 0) return;
    const { cx, cz } = worldToCell(field, pos.x, pos.z, field.tableShape.cellSize);
    if (!isSelected(cx, cz)) selectChunk(cx, cz);
    toggleSelectedChunks();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!storyDriving()) cam.handlePointerMove(e);
    const pos = pickGround(e.clientX, e.clientY);
    if (propDrag && state.layer === 'table' && state.tableTool === 'props' && (e.buttons & 1)) {
      movePropDrag(pos);
    }
    if (state.painting && (state.layer === 'terrain' || state.layer === 'scenery') && e.buttons & 1) {
      applyAt(pos);
    }
    if (ringGesture && (e.buttons & 1)) moveRingGesture(pos, e);
    if (placeBox && state.layer === 'place' && (e.buttons & 1) && pos) {
      if (!placeBox.active) {
        const travel = Math.hypot(e.clientX - placeBox.cx, e.clientY - placeBox.cy);
        if (travel > 6) placeBox.active = true;
      }
      if (placeBox.active) {
        placeBox.x1 = pos.x;
        placeBox.z1 = pos.z;
        updatePlaceMarkers();
      }
    } else if (placeDrag && (state.layer === 'place' || state.layer === 'zones') && (e.buttons & 1)) {
      if (!placeDrag.armed) {
        const travel = Math.hypot(e.clientX - placeDrag.cx, e.clientY - placeDrag.cy);
        if (travel > 6 && pos) {
          placeDrag.armed = true;
          placeDrag.x = pos.x;
          placeDrag.z = pos.z;
        }
      }
      if (placeDrag.armed) moveGroupDrag(pos);
    }
    const aiming = state.layer === 'walls' && (wallOpeningMode() || state.wallTool === 'erase' || e.shiftKey);
    const wallPos = aiming ? pickWallAim(e.clientX, e.clientY) : pos;
    if (state.layer === 'walls') updateWallCursor(wallPos, (state.wallTool === 'erase' || e.shiftKey) && !wallOpeningMode());
    updateBrushCursor(pos);
  });
  canvas.addEventListener('pointerup', (e) => {
    const panned = cam.handlePointerUp(e);
    if (e.button === 0 && state.layer === 'place') finishPlaceBox();
    if (e.button !== 2 || panned || storyDriving()) return;
    if (state.layer === 'walls' && (state.wallDraft?.length || wallOpeningMode() || state.wallTool === 'erase')) {
      if (wallOpeningMode() || state.wallTool === 'erase') setWallTool('lay');
      else finishWallRun();
      return;
    }
    if (state.layer === 'place' && state.placePicks.length) {
      clearPlacePick();
      return;
    }
    if (state.layer !== 'select') restHand();
  });
  window.addEventListener('pointerup', () => {
    ringGesture = null;
    const draggedPlacement = !!placeDrag?.armed;
    finishPlaceBox();
    placeDrag = null;
    if (draggedPlacement) settlePlacementScenery();
    propDrag = null;
    if (propReturnChunks) {
      propReturnChunks = false;
      setTableTool('chunks');
    }
    levelHold = null;
    if (!state.painting && !sceneryPending) return;
    state.painting = false;
    lastPaintKey = '';
    if (sceneryPending) flushSceneryPaint();
  });
  canvas.addEventListener('pointerleave', () => {
    lastBrushWorld = null;
    hideBrushCursor();
    if (wallCursor || openingHover || sectionMarker) {
      wallCursor = null;
      clearOpeningMarker();
      clearSectionMarker();
      setWallAim('');
      updateWallGhost();
    }
  });
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
    if (!typing && e.key === 'Escape') {
      if (state.layer === 'place' && state.placePicks.length) {
        e.preventDefault();
        clearPlacePick();
        return;
      }
      if (state.layer !== 'select') {
        e.preventDefault();
        restHand();
        return;
      }
    }
    if (state.layer === 'story' && !typing && e.code === 'Space') {
      e.preventDefault();
      storyPlayer?.toggle();
      return;
    }
    const slider = e.target?.tagName === 'INPUT' && e.target.type === 'range';
    if (state.layer === 'walls' && (!typing || slider) && e.target?.tagName !== 'BUTTON') {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishWallRun();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        popWallDraftPoint();
        return;
      }
    }
    if (state.layer === 'place' && !typing) {
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        rotatePlacePick(e.key === ']' ? 1 : -1);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.placePicks.length) {
        e.preventDefault();
        deletePlacePick();
        return;
      }
    }
    if (state.layer === 'zones' && !typing && (e.key === 'Delete' || e.key === 'Backspace') && state.waveEdit?.id) {
      e.preventDefault();
      removeZoneById(state.waveEdit.id);
      renderWaveEditor();
      updatePlaceMarkers();
      return;
    }
    if (storyDriving()) return;
    cam.handleKeyDown(e);
  });
  window.addEventListener('keyup', (e) => cam.handleKeyUp(e));

  onBeforeRender(scene, (deltaMs) => {
    if (state.layer === 'story') {
      storyPlayer?.tick(deltaMs);
      storySpeech?.tick();
    }
    if (!storyDriving() && !holdPreviewCamera) cam.tick(deltaMs);
    celestial?.update?.(deltaMs);
    terrain?.update?.(camera, deltaMs);
    placePreview?.update?.(deltaMs);
  });

  await rebuildTerrain();
  syncFormFromField();
  await loadGardenFromSearch();
  await refreshWorkshopMaps();
  await startEngine(engine);
  notifyForgeOpened();
}

function notifyForgeOpened() {
  if (aetherSteam.notifyForgeOpened()) {
    syncWorkshopChrome();
    void refreshWorkshopMaps();
    return;
  }
  let tries = 0;
  const id = setInterval(() => {
    const ready = aetherSteam.notifyForgeOpened();
    if (ready) {
      syncWorkshopChrome();
      void refreshWorkshopMaps();
    }
    if (ready || ++tries >= 15) clearInterval(id);
  }, 1000);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:absolute;top:10px;left:280px;color:#f88">${err}</pre>`);
});
