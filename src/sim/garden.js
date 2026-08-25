// .garden v3 — cell mask + per-chunk radii + terrain RLE.

import { applyTableSilhouette, createFullCellMask, createFullCellRadius, normalizeTableShape } from './tableShape.js';
import { buildField, createField, refreshTerrainDerived } from './field.js';

export const GARDEN_VERSION = 3;

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

export function encodeGarden(field, extras = {}) {
  const shape = normalizeTableShape(field, field.tableShape ?? {});
  return {
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
}

export function decodeGarden(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid garden');
  if ((data.v | 0) !== GARDEN_VERSION) throw new Error(`Unsupported garden version ${data.v}`);
  const width = data.w | 0;
  const height = data.h | 0;
  if (width < 1 || height < 1) throw new Error('Invalid garden size');
  const cellSize = Math.max(1, (data.cs | 0) || 16);
  const chunksX = Math.ceil(width / cellSize);
  const chunksZ = Math.ceil(height / cellSize);
  const expected = chunksX * chunksZ;
  return {
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
    terrainTypes: decodeRle(data.t, width * height),
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
  return field;
}

export function stringifyGarden(field, extras = {}) {
  return JSON.stringify(encodeGarden(field, extras));
}

export function parseGarden(text) {
  return decodeGarden(JSON.parse(text));
}
