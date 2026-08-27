// Unit-tester garden — 2-player mirror with one of every unit and building.
// Write with: node --input-type=module -e "import { writeFileSync } from 'fs'; import { buildTesterGarden } from './sim/testerGarden.js'; writeFileSync('../maps/tester.garden', JSON.stringify(buildTesterGarden()));"

import { createField, TERRAIN, SKIRMISH_MAP_W, SKIRMISH_MAP_H, activeMapW, activeMapH, setActiveMapSize } from './field.js';
import {
  applyTableSilhouette,
  createFullCellMask,
  createFullCellRadius,
  setCellRadius,
  tileCenterWorld,
} from './tableShape.js';
import { encodeGarden } from './garden.js';
import { UNIT_DEFS } from './unitTypes.js';
import { PLACEABLE_BUILDINGS } from './buildings.js';
import { SCENERY, defaultTreeStock } from './scenery.js';

export const TESTER_GARDEN_NAME = 'unit tester';
export const TESTER_GARDEN_URL = '/maps/tester.garden';
export const TESTER_SEED = 0x7e57e5;

const W = SKIRMISH_MAP_W;
const H = SKIRMISH_MAP_H;
const LAST = W - 1;

/** West-side agora tile (even 4×4 snaps cleanly). East is mirrored. */
const AGORA_TX = 50;
const AGORA_TZ = 72;
/** Building grid: 5 columns × 3 rows, west of the agora. */
const BUILD_TX0 = 16;
const BUILD_TZ0 = 36;
const BUILD_STEP_X = 14;
const BUILD_STEP_Z = 16;
/** Unit column just east of the west agora (stay well short of midfield). */
const UNIT_TX = 56;
const UNIT_TZ0 = 28;
const UNIT_STEP_Z = 7;

function mirrorTx(tx) {
  return LAST - (tx | 0);
}

function paintDisk(terrain, cx, cz, radius, kind) {
  const r2 = radius * radius;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      terrain[z * W + x] = kind;
    }
  }
}

function paintRect(terrain, x0, z0, x1, z1, kind) {
  const xa = Math.max(0, Math.min(x0, x1));
  const xb = Math.min(W - 1, Math.max(x0, x1));
  const za = Math.max(0, Math.min(z0, z1));
  const zb = Math.min(H - 1, Math.max(z0, z1));
  for (let z = za; z <= zb; z++) {
    for (let x = xa; x <= xb; x++) terrain[z * W + x] = kind;
  }
}

function plantTree(field, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= W || tz >= H) return;
  const i = tz * W + tx;
  if (field.sceneryType[i]) return;
  field.sceneryType[i] = SCENERY.TREE;
  field.treeStock[i] = defaultTreeStock(tx, tz, field.seed);
}

function plantRock(field, tx, tz, kind) {
  if (tx < 0 || tz < 0 || tx >= W || tz >= H) return;
  const i = tz * W + tx;
  if (field.sceneryType[i]) return;
  field.sceneryType[i] = kind;
}

function plantGrove(field, tx, tz, span) {
  for (let dz = -span; dz <= span; dz++) {
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx + dz * dz > span * span) continue;
      if (((dx + dz * 3) & 1) === 0) plantTree(field, tx + dx, tz + dz);
    }
  }
}

function westWorld(field, tx, tz) {
  return tileCenterWorld(field, tx, tz);
}

/**
 * Authored 2-player tester board (v4 garden JSON).
 * @returns {ReturnType<typeof encodeGarden>}
 */
export function buildTesterGarden() {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    return buildTesterGardenInner();
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}

function buildTesterGardenInner() {
  const field = createField(TESTER_SEED, { width: W, height: H });
  field.terrainTypes.fill(TERRAIN.GRASS);

  // East–west dirt lane through the middle, broken by a center pond.
  paintRect(field.terrainTypes, 18, 70, 126, 73, TERRAIN.DIRT);
  paintDisk(field.terrainTypes, 72, 72, 11, TERRAIN.WATER);
  paintDisk(field.terrainTypes, 72, 72, 7, TERRAIN.WATER);

  // Dirt yards around each agora + a patch by each mine (basic row, last col).
  paintDisk(field.terrainTypes, AGORA_TX, AGORA_TZ, 6, TERRAIN.DIRT);
  paintDisk(field.terrainTypes, mirrorTx(AGORA_TX), AGORA_TZ, 6, TERRAIN.DIRT);
  const mineTx = BUILD_TX0;
  const mineTz = BUILD_TZ0 + 4 * BUILD_STEP_Z;
  paintDisk(field.terrainTypes, mineTx, mineTz, 4, TERRAIN.DIRT);
  paintDisk(field.terrainTypes, mirrorTx(mineTx), mineTz, 4, TERRAIN.DIRT);

  const cellMask = createFullCellMask(W, H, 16);
  const cellRadius = createFullCellRadius(W, H, 16, 0);
  const shape = { cellSize: 16, chunksX: 9, chunksZ: 9, cellMask, cellRadius };
  // Soften the four table corners.
  setCellRadius(shape, 0, 0, 22);
  setCellRadius(shape, 8, 0, 22);
  setCellRadius(shape, 0, 8, 22);
  setCellRadius(shape, 8, 8, 22);
  applyTableSilhouette(field, shape);

  plantGrove(field, 10, 40, 3);
  plantGrove(field, 10, 104, 3);
  plantGrove(field, mirrorTx(10), 40, 3);
  plantGrove(field, mirrorTx(10), 104, 3);
  // One of each rock kind near each mine, mirrored.
  plantRock(field, mineTx - 3, mineTz - 2, SCENERY.ROCK_PLAIN);
  plantRock(field, mineTx - 2, mineTz + 3, SCENERY.ROCK_MOSS);
  plantRock(field, mineTx + 3, mineTz + 1, SCENERY.ROCK_SNOW);
  plantRock(field, mirrorTx(mineTx - 3), mineTz - 2, SCENERY.ROCK_PLAIN);
  plantRock(field, mirrorTx(mineTx - 2), mineTz + 3, SCENERY.ROCK_MOSS);
  plantRock(field, mirrorTx(mineTx + 3), mineTz + 1, SCENERY.ROCK_SNOW);

  /** @type {{ owner: number, type: number, tx: number, tz: number }[]} */
  const units = [];
  for (let i = 0; i < UNIT_DEFS.length; i++) {
    const tz = UNIT_TZ0 + i * UNIT_STEP_Z;
    units.push({ owner: 0, type: UNIT_DEFS[i].id, tx: UNIT_TX, tz });
    units.push({ owner: 1, type: UNIT_DEFS[i].id, tx: mirrorTx(UNIT_TX), tz });
  }

  /** @type {{ owner: number, type: string, x: number, z: number, yaw: number }[]} */
  const buildings = [];
  for (let i = 0; i < PLACEABLE_BUILDINGS.length; i++) {
    const col = i % 5;
    const row = (i / 5) | 0;
    const tx = BUILD_TX0 + row * BUILD_STEP_X;
    const tz = BUILD_TZ0 + col * BUILD_STEP_Z;
    const a = westWorld(field, tx, tz);
    const b = westWorld(field, mirrorTx(tx), tz);
    buildings.push({ owner: 0, type: PLACEABLE_BUILDINGS[i].id, x: a.x, z: a.z, yaw: 0 });
    buildings.push({ owner: 1, type: PLACEABLE_BUILDINGS[i].id, x: b.x, z: b.z, yaw: 0 });
  }

  const agora0 = westWorld(field, AGORA_TX, AGORA_TZ);
  const agora1 = westWorld(field, mirrorTx(AGORA_TX), AGORA_TZ);

  return encodeGarden(field, {
    name: TESTER_GARDEN_NAME,
    authoredScenery: true,
    units,
    buildings,
    agoras: [
      { owner: 0, x: agora0.x, z: agora0.z },
      { owner: 1, x: agora1.x, z: agora1.z },
    ],
  });
}
