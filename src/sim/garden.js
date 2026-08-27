// .garden v4 — table + terrain + optional scenery / placements.
// v3 files still decode (no scenery / placements).

import { applyTableSilhouette, createFullCellMask, createFullCellRadius, normalizeTableShape } from './tableShape.js';
import { buildField, createField, refreshTerrainDerived, tileCenterX, tileCenterY } from './field.js';
import { applyAuthoredScenery, SCENERY } from './scenery.js';
import { spawn } from './world.js';
import { createBuilding, snapBuildingWorld, applyWorldStructureOccupancy } from './buildings.js';
import { createAgoras } from './agora.js';
import { grantStartingResources } from './resources.js';
import * as fx from './fixed.js';

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
  if (!field?.sceneryType) return false;
  for (let i = 0; i < field.sceneryType.length; i++) {
    if (field.sceneryType[i]) return true;
  }
  return false;
}

function normalizeUnits(list) {
  if (!Array.isArray(list)) return [];
  return list.map((u) => {
    if (Array.isArray(u)) return { owner: u[0] | 0, type: u[1] | 0, tx: u[2] | 0, tz: u[3] | 0 };
    return { owner: u.owner | 0, type: u.type | 0, tx: u.tx | 0, tz: u.tz | 0 };
  });
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
    t: encodeRle(field.terrainTypes),
  };
  if (authored) {
    out.sc = encodeRle(field.sceneryType);
    out.ts = encodeRle(field.treeStock);
  }
  if (units.length) out.u = units.map((u) => [u.owner, u.type, u.tx, u.tz]);
  if (buildings.length) out.b = buildings.map((b) => [b.owner, b.type, b.x, b.z, b.yaw]);
  if (agoras.length) out.g = agoras.map((g) => [g.owner, g.x, g.z]);
  return out;
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
      ? decodeRle(data.rr, expected)
      : createFullCellRadius(width, height, cellSize, Number(data.cr) || 0),
    terrainTypes: decodeRle(data.t, n),
    sceneryType: data.sc ? decodeRle(data.sc, n) : null,
    treeStock: data.ts ? decodeRle(data.ts, n) : null,
    units: normalizeUnits(data.u),
    buildings: normalizeBuildings(data.b),
    agoras: normalizeAgoras(data.g),
    authoredScenery: !!data.sc,
  };
}

/** Build a live field from garden JSON (or generate from seed if no terrain). */
export function fieldFromGarden(data) {
  const g = decodeGarden(data);
  const field = g.terrainTypes.length === g.width * g.height
    ? createField(g.seed, { width: g.width, height: g.height })
    : buildField(g.seed, { width: g.width, height: g.height });
  if (g.terrainTypes.length === field.terrainTypes.length) {
    field.terrainTypes.set(g.terrainTypes);
  }
  applyTableSilhouette(field, {
    cellSize: g.cellSize,
    cellMask: g.cellMask,
    cellRadius: g.cellRadius,
  });
  if (g.terrainTypes.length !== field.terrainTypes.length) {
    refreshTerrainDerived(field);
  }
  if (g.authoredScenery) {
    if (g.sceneryType?.length === field.sceneryType.length) field.sceneryType.set(g.sceneryType);
    if (g.treeStock?.length === field.treeStock.length) field.treeStock.set(g.treeStock);
    applyAuthoredScenery(field);
  }
  return field;
}

export function applyGardenPlacements(world, field, garden) {
  if (!world || !garden) return world;
  if (!world.buildings) world.buildings = [];
  if (!world.agoras) world.agoras = [];
  for (const u of garden.units ?? []) {
    spawn(world, {
      owner: u.owner,
      type: u.type,
      x: tileCenterX(u.tx),
      y: tileCenterY(u.tz),
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
  for (const owner of owners) {
    if (owner >= 0) grantStartingResources(world, owner);
  }
  return world;
}

export function stringifyGarden(field, extras = {}) {
  return JSON.stringify(encodeGarden(field, extras));
}

export function parseGarden(text) {
  return decodeGarden(JSON.parse(text));
}
