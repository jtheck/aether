// Chapter landscape — clumped woods, leftover seeded terrain, hostile camps.

import { paintRegionLift, TABLE_CHUNK_TILES, TERRAIN } from '../sim/field.js';
import {
  applyTableSilhouette,
  cellCounts,
  createFullCellMask,
  createFullCellRadius,
  paintTerrainBrush,
  setCellRadius,
  tileCenterWorld,
} from '../sim/tableShape.js';
import { applyAuthoredScenery, paintSceneryBrush, sceneryTileHash, SCENERY } from '../sim/scenery.js';
import { UNIT } from '../sim/unitTypes.js';
import { markChapterExit } from './exits.js';

const SCENERY_OPTS = { refresh: false };

/** Owner 4 sits outside adventure's 4-seat ally table, so camps stay hostile. */
export const CHAPTER_ENEMY_OWNER = 4;

function lastChunk(n) {
  return Math.max(0, n - 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Soft value noise from the scenery hash — clumps, not a lattice. */
function patchNoise(tx, tz, seed, scale) {
  const gx = tx / scale;
  const gz = tz / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = gx - x0;
  const fz = gz - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const h00 = sceneryTileHash(x0, z0, seed);
  const h10 = sceneryTileHash(x0 + 1, z0, seed);
  const h01 = sceneryTileHash(x0, z0 + 1, seed);
  const h11 = sceneryTileHash(x0 + 1, z0 + 1, seed);
  return lerp(lerp(h00, h10, sx), lerp(h01, h11, sx), sz);
}

function beginChapterTable(field, { cornerR = 14 } = {}) {
  const { chunksX, chunksZ } = cellCounts(field.width, field.height, TABLE_CHUNK_TILES);
  const cellMask = createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES);
  const cellRadius = createFullCellRadius(field.width, field.height, TABLE_CHUNK_TILES, 0);
  const corners = [
    [0, 0],
    [lastChunk(chunksX), 0],
    [0, lastChunk(chunksZ)],
    [lastChunk(chunksX), lastChunk(chunksZ)],
  ];
  const shape = { cellSize: TABLE_CHUNK_TILES, chunksX, chunksZ, cellMask, cellRadius };
  for (const [cx, cz] of corners) setCellRadius(shape, cx, cz, cornerR);
  applyTableSilhouette(field, {
    cellSize: shape.cellSize,
    cellMask: shape.cellMask,
    cellRadius: shape.cellRadius,
    suppressCenterBlock: true,
  });
  return field;
}

function stainDirt(field, cx, cz, radius, rate) {
  const seed = field.seed >>> 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
      const falloff = Math.hypot(dx, dz) / Math.max(1, radius);
      if (falloff > 0.95) continue;
      const wobble = 0.55 + 0.45 * sceneryTileHash(x, z, seed + 17);
      if (falloff > wobble) continue;
      if (sceneryTileHash(x, z, seed + 31) > rate) continue;
      paintTerrainBrush(field, x, z, TERRAIN.DIRT, 0);
    }
  }
}

function plantNaturalWoods(field, { density = 0.4, corridorTx = null, corridorWidth = 10 } = {}) {
  const seed = field.seed >>> 0;
  const { width, height, terrainTypes } = field;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (terrainTypes[i] === TERRAIN.WATER) continue;
      const clump = patchNoise(tx, tz, seed + 11, 12);
      const mid = patchNoise(tx + 4, tz + 2, seed + 19, 7);
      let chance = density * (0.12 + 0.88 * clump * clump) * (0.55 + 0.45 * mid);
      if (terrainTypes[i] === TERRAIN.DIRT) chance *= 0.28;
      if (corridorTx != null) {
        const d = Math.abs(tx - corridorTx) / corridorWidth;
        chance *= 1 - Math.exp(-d * d * 2.4);
      }
      if (sceneryTileHash(tx, tz, seed + 41) >= chance) continue;
      paintSceneryBrush(field, tx, tz, SCENERY.TREE, 0, SCENERY_OPTS);
    }
  }
}

function scatterRocks(field) {
  const seed = field.seed >>> 0;
  const { width, height, terrainTypes } = field;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (terrainTypes[tz * width + tx] !== TERRAIN.DIRT) continue;
      if (sceneryTileHash(tx, tz, seed + 73) >= 0.035) continue;
      const roll = sceneryTileHash(tx, tz, seed + 91);
      const kind = roll < 0.35
        ? SCENERY.ROCK_PLAIN
        : roll < 0.75
          ? SCENERY.ROCK_MOSS
          : SCENERY.ROCK_SNOW;
      paintSceneryBrush(field, tx, tz, kind, 0, SCENERY_OPTS);
    }
  }
}

function clearAround(field, tx, tz, radius) {
  paintSceneryBrush(field, tx, tz, SCENERY.NONE, radius, SCENERY_OPTS);
}

function clearCorridor(field, x0, z0, x1, z1, radius) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    clearAround(field, Math.round(x0 + dx * t), Math.round(z0 + dz * t), radius);
  }
}

function finishChapterLand(field) {
  applyAuthoredScenery(field);
  return field;
}

function clearChapterPlay(field, cast, exit, corridorR = 3) {
  const from = cast[0] || { tx: exit.tx, tz: exit.tz };
  for (const u of cast) paintTerrainBrush(field, u.tx, u.tz, TERRAIN.GRASS, 3);
  paintTerrainBrush(field, exit.tx, exit.tz, TERRAIN.DIRT, Math.max(3, exit.r | 0));
  clearCorridor(field, from.tx, from.tz, exit.tx, exit.tz, corridorR);
  clearAround(field, exit.tx, exit.tz, Math.max(4, exit.r | 0));
  for (const u of cast) clearAround(field, u.tx, u.tz, 3);
  finishChapterLand(field);
}

function enemyAt(tx, tz, type) {
  return { owner: CHAPTER_ENEMY_OWNER, type, tx, tz, name: '' };
}

function buildingAt(field, type, tx, tz) {
  const { x, z } = tileCenterWorld(field, tx, tz);
  return { owner: CHAPTER_ENEMY_OWNER, type, x, z, yaw: 0 };
}

function placeCamps(field, camps) {
  const units = [];
  const buildings = [];
  for (const camp of camps) {
    paintTerrainBrush(field, camp.tx, camp.tz, TERRAIN.DIRT, 4);
    clearAround(field, camp.tx, camp.tz, camp.clear ?? 5);
    if (camp.building) buildings.push(buildingAt(field, camp.building, camp.tx, camp.tz));
    for (const [type, dx, dz] of camp.units) {
      units.push(enemyAt(camp.tx + dx, camp.tz + dz, type));
    }
  }
  return { units, buildings };
}

/** Seeded grove + a blight stain east of the road. One camp in the east trees. */
export function dressChapter1(field, cast, exit) {
  beginChapterTable(field, { cornerR: 14 });
  stainDirt(field, 56, 32, 11, 0.62);
  paintRegionLift(field, 26, 20, 0.1, 16);
  markChapterExit(field, cast[0].tx, cast[0].tz, exit);
  plantNaturalWoods(field, { density: 0.48, corridorTx: 30, corridorWidth: 8 });
  scatterRocks(field);
  const camps = placeCamps(field, [{
    tx: 56,
    tz: 38,
    building: 'camp',
    units: [
      [UNIT.WARRIOR, -3, 2],
      [UNIT.WARRIOR, 3, 1],
      [UNIT.ARCHER, 0, -3],
    ],
  }]);
  clearChapterPlay(field, cast, exit);
  return camps;
}

/** Flanking woods, open north road, ridge lift, camp off the east shoulder. */
export function dressChapter2(field, cast, exit) {
  beginChapterTable(field, { cornerR: 14 });
  stainDirt(field, 40, 14, 8, 0.5);
  paintRegionLift(field, 40, 12, 0.18, 14);
  markChapterExit(field, cast[0].tx, cast[0].tz, exit);
  plantNaturalWoods(field, { density: 0.4, corridorTx: 40, corridorWidth: 11 });
  scatterRocks(field);
  const camps = placeCamps(field, [{
    tx: 58,
    tz: 28,
    building: 'tower',
    units: [
      [UNIT.ARCHER, -3, 2],
      [UNIT.ARCHER, 3, 2],
      [UNIT.WARRIOR, 0, 3],
    ],
  }]);
  clearChapterPlay(field, cast, exit, 4);
  return camps;
}

/** Thinner woods, open hollow, one last camp west of the road. */
export function dressChapter3(field, cast, exit) {
  beginChapterTable(field, { cornerR: 16 });
  stainDirt(field, 48, 18, 7, 0.45);
  paintRegionLift(field, 48, 28, 0.08, 12);
  markChapterExit(field, cast[0].tx, cast[0].tz, exit);
  plantNaturalWoods(field, { density: 0.32, corridorTx: 48, corridorWidth: 10 });
  scatterRocks(field);
  const camps = placeCamps(field, [{
    tx: 30,
    tz: 30,
    building: 'camp',
    units: [
      [UNIT.WARRIOR, -3, 2],
      [UNIT.WARRIOR, 3, 1],
      [UNIT.ARCHER, -1, -3],
    ],
  }]);
  clearChapterPlay(field, cast, exit, 4);
  return camps;
}
