// .garden v4 - table + terrain + optional scenery / doodads / backdrops / placements.
// Optional `mt` is the map type (onevsone, teams, koth, adventure). Missing means
// the old generator, which dries every 1v1 and team start.
// v3 files still decode (no scenery / doodads / backdrops / placements).
// Optional `dd` is a doodadType RLE (visual-only stamps).
// Optional `bd` is a list of off-board backdrop poses.
// Optional `wl` is procedural curtain walls (style + corner runs). The forge draws
// them while editing; a match stamps them onto the field and renders that copy.

import { applyTableSilhouette, createFullCellMask, createFullCellRadius, normalizeTableShape } from './tableShape.js';
import { applySeededHeight, buildField, composeHeightMap, computeSeedRegionLift, createField, generateHeightMap, PAINTED_LIFT_MAX, PAINTED_LIFT_MIN, refreshTerrainDerived, STRESS_SPAWN_CLEAR_TILES, TILE_SIZE_F, tileCenterX, tileCenterY, worldToTile, worldToTileZ } from './field.js';
import { applyAuthoredScenery, applySavedRockStock, clearOffTableScenery, rockYield, SCENERY } from './scenery.js';
import { ensureDoodadArrays, hasAuthoredDoodads } from './doodads.js';
import { cloneBackdrops, encodeBackdrops, normalizeBackdrops } from './backdrops.js';
import { spawn } from './world.js';
import { createBuilding, snapBuildingWorld, applyWorldStructureOccupancy } from './buildings.js';
import { createAgoras } from './agora.js';
import { grantStartingResources, RESOURCE_KINDS, STARTING_RESOURCES } from './resources.js';
import { encodeStory, normalizeStory } from '../story/timeline.js';
import { encodeObjectives, normalizeObjectives } from '../story/objectives.js';
import * as fx from './fixed.js';
import { normalizeNeutralTeams, normalizeTeamByOwner } from './teams.js';
import { applyWallOccupancy, decodeWalls, encodeWalls } from './walls.js';
import { normalizeMapType } from './mapType.js';
import { isNamedUnit } from './namedUnit.js';
import { spawnPadsForMapType } from './worldSetup.js';

export const GARDEN_VERSION = 4;
export const GARDEN_VERSION_MIN = 3;
export const GARDEN_SESSION_KEY = 'aeg.garden';

export function encodeRle(arr) {
  if (!arr || arr.length === 0) return '';
  const runs = [];
  let current = arr[0];
  let count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === current && count < 255) {
      count++;
    } else {
      runs.push(`${current}:${count}`);
      current = arr[i];
      count = 1;
    }
  }
  runs.push(`${current}:${count}`);
  return runs.join(',');
}

export function decodeRle(str, length = 0) {
  const arr = [];
  if (!str) return length > 0 ? new Uint8Array(length) : new Uint8Array(0);
  const runs = String(str).split(',');
  for (let r = 0; r < runs.length; r++) {
    if (!runs[r]) continue;
    const parts = runs[r].split(':');
    const val = Number(parts[0]);
    const count = Number(parts[1]);
    for (let i = 0; i < count; i++) arr.push(val);
  }
  if (length > 0 && arr.length !== length) {
    const out = new Uint8Array(length);
    out.set(arr.slice(0, length));
    return out;
  }
  return Uint8Array.from(arr);
}

/** Rock stock above one yield (a forge stack). Values can exceed 255. */
function decodeRleU16(str, length) {
  const out = new Uint16Array(Math.max(0, length | 0));
  if (!str) return out;
  let i = 0;
  const runs = String(str).split(',');
  for (let r = 0; r < runs.length && i < out.length; r++) {
    if (!runs[r]) continue;
    const parts = runs[r].split(':');
    const val = Number(parts[0]);
    const count = Number(parts[1]);
    if (!Number.isFinite(val) || !(count > 0)) continue;
    for (let n = 0; n < count && i < out.length; n++, i++) out[i] = val;
  }
  return out;
}

function rockStockNeedsSave(field) {
  const stock = field?.rockStock;
  const types = field?.sceneryType;
  if (!stock || !types) return false;
  for (let i = 0; i < types.length; i++) {
    const kind = types[i];
    if (kind < SCENERY.ROCK_PLAIN) continue;
    if ((stock[i] | 0) !== rockYield(kind)) return true;
  }
  return false;
}

/** Cell radii are signed: -1 is a plinth. Uint8 RLE would wrap that to 255. */
function decodeSignedRle(str, length) {
  const out = new Int16Array(Math.max(0, length | 0));
  if (!str) return out;
  let i = 0;
  const runs = String(str).split(',');
  for (let r = 0; r < runs.length && i < out.length; r++) {
    if (!runs[r]) continue;
    const parts = runs[r].split(':');
    const val = Number(parts[0]);
    const count = Number(parts[1]);
    if (!Number.isFinite(val) || !(count > 0)) continue;
    for (let n = 0; n < count && i < out.length; n++, i++) out[i] = val;
  }
  return out;
}

function encodeCellBits(mask) {
  let bits = '';
  for (let i = 0; i < mask.length; i++) bits += mask[i] ? '1' : '0';
  return bits;
}

function decodeCellBits(str, expected) {
  const raw = String(str ?? '');
  const padded = raw.length < expected ? raw.padEnd(expected, '0') : raw;
  const mask = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) mask[i] = padded[i] === '1' ? 1 : 0;
  return mask;
}

function hasAuthoredScenery(field) {
  if (field?.sceneryAuthored === true) return true;
  if (!field?.sceneryType) return false;
  for (let i = 0; i < field.sceneryType.length; i++) {
    if (field.sceneryType[i]) return true;
  }
  return false;
}

function quantizeWorld(n) {
  return Math.round(Number(n) * 100) / 100;
}

function unitWorldCoords(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: quantizeWorld(x), z: quantizeWorld(z) };
}

function tilesForWorld(x, z) {
  return {
    tx: worldToTile(fx.fromFloat(x)),
    tz: worldToTileZ(fx.fromFloat(z)),
  };
}

function normalizeUnits(list) {
  if (!Array.isArray(list)) return [];
  return list.map((u) => {
    if (Array.isArray(u)) {
      const owner = u[0] | 0;
      const type = u[1] | 0;
      let tx = u[2] | 0;
      let tz = u[3] | 0;
      let name = '';
      let world = null;
      let hp;
      if (u.length >= 8) {
        name = u[4] ? String(u[4]) : '';
        world = unitWorldCoords(u[5], u[6]);
        hp = u[7] | 0;
      } else if (u.length >= 7) {
        name = u[4] ? String(u[4]) : '';
        world = unitWorldCoords(u[5], u[6]);
      } else if (u.length === 6 && typeof u[4] === 'number') {
        world = unitWorldCoords(u[4], u[5]);
      } else if (u.length === 6 && typeof u[4] === 'string' && Number.isFinite(Number(u[5]))) {
        name = u[4];
        hp = u[5] | 0;
      } else if (u[4]) {
        name = String(u[4]);
      }
      return { owner, type, tx, tz, name, ...(world || {}), ...(hp != null ? { hp } : {}) };
    }
    const world = unitWorldCoords(u.x, u.z);
    let tx = u.tx | 0;
    let tz = u.tz | 0;
    if (world && (u.tx == null || u.tz == null)) {
      const tiles = tilesForWorld(world.x, world.z);
      tx = tiles.tx;
      tz = tiles.tz;
    }
    const yaw = Number(u.yaw);
    return {
      owner: u.owner | 0,
      type: u.type | 0,
      tx,
      tz,
      name: u.name ? String(u.name) : '',
      ...(world || {}),
      ...(Number.isFinite(Number(u.hp)) ? { hp: u.hp | 0 } : {}),
      ...(Number.isFinite(yaw) && Math.abs(yaw) > 1e-4 ? { yaw } : {}),
    };
  });
}

function encodeUnitYaws(units) {
  let any = false;
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const y = Number(units[i].yaw) || 0;
    if (Math.abs(y) > 1e-4) any = true;
    out.push(Math.round(y * 1000) / 1000);
  }
  return any ? out : null;
}

function applyUnitYaws(units, raw) {
  if (!Array.isArray(raw)) return units;
  for (let i = 0; i < units.length && i < raw.length; i++) {
    const y = Number(raw[i]);
    if (Number.isFinite(y) && Math.abs(y) > 1e-4) units[i].yaw = y;
  }
  return units;
}

function fixedFaceFromYaw(yaw) {
  const y = Number(yaw);
  if (!Number.isFinite(y) || Math.abs(y) < 1e-4) return null;
  return { faceX: fx.fromFloat(Math.sin(y)), faceY: fx.fromFloat(Math.cos(y)) };
}

function encodeUnitTuple(u) {
  const hasWorld = Number.isFinite(u.x) && Number.isFinite(u.z);
  const hp = Number.isFinite(Number(u.hp)) ? u.hp | 0 : null;
  if (u.name && hasWorld) {
    return hp != null
      ? [u.owner, u.type, u.tx, u.tz, u.name, u.x, u.z, hp]
      : [u.owner, u.type, u.tx, u.tz, u.name, u.x, u.z];
  }
  if (hasWorld) return [u.owner, u.type, u.tx, u.tz, u.x, u.z];
  if (u.name) {
    return hp != null
      ? [u.owner, u.type, u.tx, u.tz, u.name, hp]
      : [u.owner, u.type, u.tx, u.tz, u.name];
  }
  if (hp != null) return [u.owner, u.type, u.tx, u.tz, '', hp];
  return [u.owner, u.type, u.tx, u.tz];
}

function normalizeBuildings(list) {
  if (!Array.isArray(list)) return [];
  return list.map((b) => {
    if (Array.isArray(b)) {
      return { owner: b[0] | 0, type: String(b[1]), x: Number(b[2]) || 0, z: Number(b[3]) || 0, yaw: Number(b[4]) || 0 };
    }
    return {
      owner: b.owner | 0,
      type: String(b.type),
      x: Number(b.x) || 0,
      z: Number(b.z) || 0,
      yaw: Number(b.yaw) || 0,
    };
  });
}

function normalizeAgoras(list) {
  if (!Array.isArray(list)) return [];
  return list.map((g) => {
    if (Array.isArray(g)) return { owner: g[0] | 0, x: Number(g[1]) || 0, z: Number(g[2]) || 0 };
    return { owner: g.owner | 0, x: Number(g.x) || 0, z: Number(g.z) || 0 };
  });
}

/** Opening bank for every owner on the map. Missing kinds fall back to STARTING_RESOURCES. */
export function normalizeStartingResources(raw) {
  if (raw == null) return null;
  const out = { ...STARTING_RESOURCES };
  if (Array.isArray(raw)) {
    for (let i = 0; i < RESOURCE_KINDS.length; i++) {
      if (raw[i] != null) out[RESOURCE_KINDS[i]] = raw[i] | 0;
    }
    return out;
  }
  if (typeof raw !== 'object') return null;
  let any = false;
  for (const k of RESOURCE_KINDS) {
    if (raw[k] != null) {
      out[k] = raw[k] | 0;
      any = true;
    }
  }
  return any ? out : null;
}

function encodeQuantized01(arr) {
  const u8 = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    u8[i] = Math.max(0, Math.min(255, Math.round(arr[i] * 255)));
  }
  return encodeRle(u8);
}

function decodeQuantized01(str, n) {
  const u8 = decodeRle(str, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (u8[i] || 0) / 255;
  return out;
}

function encodeSignedSpan(arr, span) {
  const u8 = new Uint8Array(arr.length);
  let any = false;
  const s = span > 0 ? span : 1;
  for (let i = 0; i < arr.length; i++) {
    let v = arr[i];
    if (v < -s) v = -s;
    else if (v > s) v = s;
    if (v !== 0) any = true;
    u8[i] = Math.max(0, Math.min(255, Math.round((v / s + 1) * 0.5 * 255)));
  }
  return any ? encodeRle(u8) : null;
}

function decodeSignedSpan(str, n, span) {
  const u8 = decodeRle(str, n);
  const out = new Float32Array(n);
  const s = span > 0 ? span : 1;
  for (let i = 0; i < n; i++) out[i] = (((u8[i] || 0) / 255) * 2 - 1) * s;
  return out;
}

function encodeSignedUnit(arr) {
  return encodeSignedSpan(arr, 1);
}

function decodeSignedUnit(str, n) {
  return decodeSignedSpan(str, n, 1);
}

function encodeCelestial(state) {
  if (!state || !Array.isArray(state.bodies) || state.bodies.length < 2) return null;
  const bodies = [];
  for (let i = 0; i < 2; i++) {
    const body = state.bodies[i];
    if (!body) return null;
    bodies.push([
      String(body.kind || 'sun'),
      Math.round((Number(body.azimuth) || 0) * 100) / 100,
      Math.round((Number(body.elevation) || 0) * 100) / 100,
      Math.round((Number(body.intensity) || 0) * 1000) / 1000,
    ]);
  }
  const color = Array.isArray(state.clearColor) ? state.clearColor : [0, 0, 0];
  return {
    e: Math.round((Number(state.exposure) || 0) * 1000) / 1000,
    c: Math.round((Number(state.contrast) || 0) * 1000) / 1000,
    k: [0, 1, 2].map((i) => Math.round((Number(color[i]) || 0) * 1000) / 1000),
    b: bodies,
  };
}

export function decodeCelestial(raw) {
  if (!raw || !Array.isArray(raw.b) || raw.b.length < 2) return null;
  const bodies = [];
  for (let i = 0; i < 2; i++) {
    const body = raw.b[i];
    if (!Array.isArray(body)) return null;
    bodies.push({
      kind: String(body[0] || 'sun'),
      azimuth: Number(body[1]) || 0,
      elevation: Number(body[2]) || 0,
      intensity: Number(body[3]) || 0,
    });
  }
  const color = Array.isArray(raw.k) ? raw.k : [0, 0, 0];
  return {
    exposure: Number(raw.e) || 0,
    contrast: Number(raw.c) || 0,
    clearColor: [0, 1, 2].map((i) => Number(color[i]) || 0),
    bodies,
  };
}

function encodeStartingResources(raw) {
  const n = normalizeStartingResources(raw);
  if (!n) return null;
  return RESOURCE_KINDS.map((k) => n[k] | 0);
}

/**
 * The region heightmap is purely seed-derived (no editor touches it), so when it
 * matches what the seed reconstructs we skip storing it - it rebuilds for free on
 * load. This is ~90% of a generated map's bytes. Compared at quantization
 * granularity so a re-saved (already-quantized) map still counts as a match.
 */
function regionLiftMatchesSeed(field) {
  const n = field.width * field.height;
  if (!field.regionLift || field.regionLift.length !== n) return false;
  const seedLift = computeSeedRegionLift(field.seed >>> 0, field.width, field.height);
  const a = field.regionLift;
  for (let i = 0; i < n; i++) {
    const qa = Math.max(0, Math.min(255, Math.round(a[i] * 255)));
    const qb = Math.max(0, Math.min(255, Math.round(seedLift[i] * 255)));
    if (qa !== qb) return false;
  }
  return true;
}

export function encodeGarden(field, extras = {}) {
  const shape = normalizeTableShape(field, field.tableShape ?? {});
  const units = normalizeUnits(extras.units);
  const buildings = normalizeBuildings(extras.buildings);
  const agoras = normalizeAgoras(extras.agoras);
  const authored = extras.authoredScenery === true || hasAuthoredScenery(field);
  const out = {
    v: GARDEN_VERSION,
    n: extras.name || undefined,
    w: field.width,
    h: field.height,
    s: field.seed >>> 0,
    cs: shape.cellSize,
    cm: encodeCellBits(shape.cellMask),
    rr: encodeRle(shape.cellRadius),
  };
  if (extras.omitTerrain !== true) {
    out.t = encodeRle(field.terrainTypes);
    if (field.regionLift?.length === field.width * field.height && !regionLiftMatchesSeed(field)) {
      out.rl = encodeQuantized01(field.regionLift);
    }
    if (field.paintedLift?.length === field.width * field.height) {
      let wide = false;
      for (let i = 0; i < field.paintedLift.length; i++) {
        const v = field.paintedLift[i];
        if (v < -1 || v > 1) {
          wide = true;
          break;
        }
      }
      const painted = wide
        ? encodeSignedSpan(field.paintedLift, Math.max(PAINTED_LIFT_MAX, -PAINTED_LIFT_MIN))
        : encodeSignedUnit(field.paintedLift);
      if (painted) out[wide ? 'pw' : 'pl'] = painted;
    }
  }
  if (authored) {
    out.sc = encodeRle(field.sceneryType);
    out.ts = encodeRle(field.treeStock);
  }
  if (hasAuthoredDoodads(field)) {
    out.dd = encodeRle(field.doodadType);
  }
  if (rockStockNeedsSave(field)) out.rk = encodeRle(field.rockStock);
  const backdrops = normalizeBackdrops(
    extras.backdrops !== undefined ? extras.backdrops : field.backdrops,
  );
  if (backdrops.length) out.bd = encodeBackdrops(backdrops);
  if (units.length) {
    out.u = units.map(encodeUnitTuple);
    const yaws = encodeUnitYaws(units);
    if (yaws) out.uy = yaws;
  }
  if (buildings.length) out.b = buildings.map((b) => [b.owner, b.type, b.x, b.z, b.yaw]);
  if (agoras.length) out.g = agoras.map((g) => [g.owner, g.x, g.z]);
  const sr = encodeStartingResources(extras.startingResources);
  if (sr) out.sr = sr;
  const story = encodeStory(extras.story);
  if (story) out.story = story;
  const light = encodeCelestial(extras.celestial);
  if (light) out.lt = light;
  const objectives = encodeObjectives(extras.objectives);
  if (objectives) out.obj = objectives;
  const tableHalf = (field.width * TILE_SIZE_F) / 2;
  const cameraHalf = Number(extras.cameraHalfF ?? field.cameraHalfF);
  if (Number.isFinite(cameraHalf) && cameraHalf > 0 && cameraHalf < tableHalf - 0.5) {
    out.ch = Math.round(cameraHalf * 100) / 100;
  }
  if (field.suppressCenterBlock) out.ncb = 1;
  const packedWalls = encodeWalls(extras.walls);
  if (packedWalls) out.wl = packedWalls;
  const neutrals = normalizeNeutralTeams(extras.neutralTeams);
  if (neutrals) out.nr = neutrals;
  const teams = normalizeTeamByOwner(extras.teamByOwner);
  if (teams) out.tm = teams;
  if (extras.mapType != null && String(extras.mapType).trim() !== '') {
    out.mt = normalizeMapType(extras.mapType);
  }
  return out;
}

/** Swap units / opening bank on an already-encoded garden without rebuilding terrain. */
export function patchGarden(data, extras = {}) {
  if (!data || typeof data !== 'object') return data;
  const next = { ...data };
  if (extras.units) {
    const units = normalizeUnits(extras.units);
    if (units.length) next.u = units.map(encodeUnitTuple);
    else delete next.u;
  }
  if (extras.startingResources != null) {
    const sr = encodeStartingResources(extras.startingResources);
    if (sr) next.sr = sr;
    else delete next.sr;
  }
  if (extras.agoras) {
    const agoras = normalizeAgoras(extras.agoras);
    if (agoras.length) next.g = agoras.map((g) => [g.owner, g.x, g.z]);
    else delete next.g;
  }
  return next;
}

export function decodeGarden(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid garden');
  const version = data.v | 0;
  if (version < GARDEN_VERSION_MIN || version > GARDEN_VERSION) {
    throw new Error(`Unsupported garden version ${data.v}`);
  }
  const width = data.w | 0;
  const height = data.h | 0;
  if (width < 1 || height < 1) throw new Error('Invalid garden size');
  const cellSize = Math.max(1, (data.cs | 0) || 16);
  const chunksX = Math.ceil(width / cellSize);
  const chunksZ = Math.ceil(height / cellSize);
  const expected = chunksX * chunksZ;
  const n = width * height;
  return {
    version,
    name: data.n || '',
    width,
    height,
    seed: (data.s >>> 0),
    cellSize,
    cellMask: data.cm
      ? decodeCellBits(data.cm, expected)
      : createFullCellMask(width, height, cellSize),
    cellRadius: data.rr
      ? decodeSignedRle(data.rr, expected)
      : createFullCellRadius(width, height, cellSize, Number(data.cr) || 0),
    terrainTypes: data.t != null && data.t !== '' ? decodeRle(data.t, n) : new Uint8Array(0),
    sceneryType: data.sc ? decodeRle(data.sc, n) : null,
    treeStock: data.ts ? decodeRle(data.ts, n) : null,
    doodadType: data.dd ? decodeRle(data.dd, n) : null,
    rockStock: data.rk ? decodeRleU16(data.rk, n) : null,
    backdrops: normalizeBackdrops(data.bd),
    units: applyUnitYaws(normalizeUnits(data.u), data.uy),
    buildings: normalizeBuildings(data.b),
    agoras: normalizeAgoras(data.g),
    startingResources: normalizeStartingResources(data.sr ?? data.startingResources),
    authoredScenery: !!data.sc,
    regionLift: data.rl ? decodeQuantized01(data.rl, n) : null,
    paintedLift: data.pw
      ? decodeSignedSpan(data.pw, n, Math.max(PAINTED_LIFT_MAX, -PAINTED_LIFT_MIN))
      : data.pl ? decodeSignedUnit(data.pl, n) : null,
    suppressCenterBlock: !!data.ncb,
    story: data.story ? normalizeStory(data.story) : null,
    celestial: decodeCelestial(data.lt),
    objectives: normalizeObjectives(data.obj),
    cameraHalfF: Number(data.ch) > 0 ? Number(data.ch) : 0,
    neutralTeams: normalizeNeutralTeams(data.nr),
    teamByOwner: normalizeTeamByOwner(data.tm),
    walls: decodeWalls(data.wl),
    mapType: data.mt != null && String(data.mt).trim() !== '' ? normalizeMapType(data.mt) : '',
  };
}

/** Build a live field from garden JSON (or generate from seed if no terrain). */
export function fieldFromGarden(data) {
  const g = decodeGarden(data);
  const authored = g.terrainTypes.length === g.width * g.height;
  const half = (g.width * TILE_SIZE_F) / 2;
  const halfZ = (g.height * TILE_SIZE_F) / 2;
  const field = authored
    ? createField(g.seed, { width: g.width, height: g.height })
    : buildField(g.seed, {
      width: g.width,
      height: g.height,
      ...(g.mapType
        ? {
          spawnPads: spawnPadsForMapType(g.mapType, half, g.width, halfZ),
          ...(normalizeMapType(g.mapType, '') === 'stress'
            ? { spawnPadClearTiles: STRESS_SPAWN_CLEAR_TILES }
            : {}),
        }
        : {}),
    });
  if (authored) {
    if (g.regionLift) {
      generateHeightMap(field);
      field.regionLift.set(g.regionLift);
      composeHeightMap(field);
    } else {
      applySeededHeight(field);
    }
    field.terrainTypes.set(g.terrainTypes);
  }
  if (g.paintedLift?.length === field.width * field.height) {
    if (!field.paintedLift || field.paintedLift.length !== g.paintedLift.length) {
      field.paintedLift = g.paintedLift;
    } else {
      field.paintedLift.set(g.paintedLift);
    }
  }
  applyTableSilhouette(field, {
    cellSize: g.cellSize,
    cellMask: g.cellMask,
    cellRadius: g.cellRadius,
    suppressCenterBlock: g.suppressCenterBlock,
  });
  if (g.terrainTypes.length !== field.terrainTypes.length) {
    refreshTerrainDerived(field);
  }
  if (g.authoredScenery) {
    if (g.sceneryType?.length === field.sceneryType.length) field.sceneryType.set(g.sceneryType);
    if (g.treeStock?.length === field.treeStock.length) field.treeStock.set(g.treeStock);
    field.sceneryAuthored = true;
    applyAuthoredScenery(field);
    if (g.rockStock) applySavedRockStock(field, g.rockStock);
  }
  if (g.doodadType?.length === field.width * field.height) {
    ensureDoodadArrays(field);
    field.doodadType.set(g.doodadType);
  }
  clearOffTableScenery(field);
  if (g.backdrops?.length) field.backdrops = cloneBackdrops(g.backdrops);
  if (g.cameraHalfF > 0) field.cameraHalfF = g.cameraHalfF;
  if (g.walls?.runs?.length) {
    field.walls = g.walls;
    applyWallOccupancy(field, g.walls);
  }
  return field;
}

export function applyGardenPlacements(world, field, garden) {
  if (!world || !garden) return world;
  if (!world.buildings) world.buildings = [];
  if (!world.agoras) world.agoras = [];
  for (const u of garden.units ?? []) {
    const hasWorld = Number.isFinite(u.x) && Number.isFinite(u.z);
    spawn(world, {
      owner: u.owner,
      type: u.type,
      x: hasWorld ? fx.fromFloat(u.x) : tileCenterX(u.tx),
      y: hasWorld ? fx.fromFloat(u.z) : tileCenterY(u.tz),
      hp: Number.isFinite(Number(u.hp)) ? u.hp | 0 : undefined,
      named: isNamedUnit(u.name),
      ...fixedFaceFromYaw(u.yaw),
    });
  }
  for (const b of garden.buildings ?? []) {
    const snapped = snapBuildingWorld(b.type, fx.fromFloat(b.x), fx.fromFloat(b.z));
    world.buildings.push(createBuilding({
      owner: b.owner,
      type: b.type,
      x: fx.toFloat(snapped.x),
      z: fx.toFloat(snapped.z),
      yaw: b.yaw,
    }));
  }
  if (garden.agoras?.length) {
    world.agoras = createAgoras(garden.agoras.map((g) => ({ owner: g.owner, x: g.x, z: g.z })));
  }
  if ((garden.buildings?.length || garden.agoras?.length) && field) {
    applyWorldStructureOccupancy(field, world);
  }
  const owners = new Set();
  for (const u of garden.units ?? []) owners.add(u.owner | 0);
  for (const b of garden.buildings ?? []) owners.add(b.owner | 0);
  for (const g of garden.agoras ?? []) owners.add(g.owner | 0);
  const bank = garden.startingResources || STARTING_RESOURCES;
  for (const owner of owners) {
    if (owner >= 0) grantStartingResources(world, owner, bank);
  }
  return world;
}

export function stringifyGarden(field, extras = {}) {
  return JSON.stringify(encodeGarden(field, extras));
}

export function parseGarden(text) {
  return decodeGarden(JSON.parse(text));
}
