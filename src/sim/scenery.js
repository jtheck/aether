// Deterministic v1-style static scenery placement.
// Sim owns the layout because rocks affect passability and trees affect speed.

import * as fx from './fixed.js';
import { TERRAIN, worldToTile } from './field.js';

export const SCENERY = {
  NONE: 0,
  TREE: 1,
  ROCK_PLAIN: 2,
  ROCK_MOSS: 3,
  ROCK_SNOW: 4,
};

export const TREE_SLOW_MULTIPLIER = fx.HALF;
export const SPAWN_CLEAR_RADIUS_TILES = 6;

const ROCK_RATE = 0.03;
const TREE_GRASS_RATE = 0.2;
const TREE_DIRT_RATE = 0.05;

/** Exact v1 tile hash, isolated from the simulation RNG stream. */
export function sceneryTileHash(x, z, seed) {
  let hash = seed;
  hash = hash ^ (x * 374761393);
  hash = hash ^ (z * 668265263);
  hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
  hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
  hash = hash ^ (hash >>> 16);
  return Math.abs(hash >>> 0) / 4294967296;
}

export function rockFootprintRadius(kind) {
  if (kind === SCENERY.ROCK_SNOW) return 2;
  if (kind === SCENERY.ROCK_MOSS) return 1;
  return 0;
}

/**
 * Populate scenery after terrain and initial world spawns exist.
 * @param {object} field
 * @param {object | null} world
 * @param {Array<[number, number]>} reservedWorldPoints
 */
export function populateScenery(field, world = null, reservedWorldPoints = []) {
  const { width, height, seed, activeMask, pass, terrainTypes } = field;
  const n = width * height;
  const sceneryType = field.sceneryType?.length === n
    ? field.sceneryType
    : new Uint8Array(n);
  const slowMask = field.slowMask?.length === n
    ? field.slowMask
    : new Uint8Array(n);
  sceneryType.fill(SCENERY.NONE);
  slowMask.fill(0);
  field.sceneryType = sceneryType;
  field.slowMask = slowMask;

  const reserved = buildReservedMask(field, world, reservedWorldPoints);
  const occupied = new Uint8Array(n);

  // Pass 1: rocks on dirt.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (!isEligible(field, i, reserved)) continue;
      if (terrainTypes[i] !== TERRAIN.DIRT) continue;
      if (sceneryTileHash(tx, tz, seed + 1000) >= ROCK_RATE) continue;

      const regionX = Math.floor(tx / 5);
      const regionZ = Math.floor(tz / 5);
      const sizeRoll = sceneryTileHash(regionX, regionZ, seed + 2000);
      const kind = sizeRoll < 0.3
        ? SCENERY.ROCK_PLAIN
        : sizeRoll < 0.7
          ? SCENERY.ROCK_MOSS
          : SCENERY.ROCK_SNOW;
      const radius = rockFootprintRadius(kind);
      if (!footprintAvailable(field, occupied, reserved, tx, tz, radius)) continue;

      sceneryType[i] = kind;
      markFootprint(field, occupied, pass, tx, tz, radius);
    }
  }

  // Pass 2: trees on unoccupied grass/dirt.
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (!isEligible(field, i, reserved) || occupied[i]) continue;
      const terrain = terrainTypes[i];
      if (terrain !== TERRAIN.GRASS && terrain !== TERRAIN.DIRT) continue;
      const rate = terrain === TERRAIN.GRASS ? TREE_GRASS_RATE : TREE_DIRT_RATE;
      if (sceneryTileHash(tx, tz, seed + 3000) >= rate) continue;
      sceneryType[i] = SCENERY.TREE;
      slowMask[i] = 1;
      occupied[i] = 1;
    }
  }

  return field;
}

function isEligible(field, i, reserved) {
  if (field.activeMask && field.activeMask[i] === 0) return false;
  if (field.pass[i] === 0) return false;
  return reserved[i] === 0;
}

function buildReservedMask(field, world, reservedWorldPoints) {
  const mask = new Uint8Array(field.width * field.height);
  for (const point of reservedWorldPoints) {
    markReservedCircle(field, mask, worldToTile(fx.fromFloat(point[0])), worldToTile(fx.fromFloat(point[1])));
  }
  if (world) {
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      markReservedCircle(field, mask, worldToTile(world.px[i]), worldToTile(world.py[i]));
    }
  }
  return mask;
}

function markReservedCircle(field, mask, cx, cz) {
  const radius = SPAWN_CLEAR_RADIUS_TILES;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) continue;
      mask[tz * field.width + tx] = 1;
    }
  }
}

function footprintAvailable(field, occupied, reserved, cx, cz, radius) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
      const i = tz * field.width + tx;
      if (occupied[i] || reserved[i]) return false;
      if (field.activeMask && field.activeMask[i] === 0) return false;
      if (field.pass[i] === 0) return false;
    }
  }
  return true;
}

function markFootprint(field, occupied, pass, cx, cz, radius) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > (radius + 0.5) ** 2) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) continue;
      const i = tz * field.width + tx;
      occupied[i] = 1;
      pass[i] = 0;
    }
  }
}
