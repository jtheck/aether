// Official 1v1 / teams gardens (v4). Run: node scripts/generate-map.mjs
//
// Match start still plants the opening agoras and villagers. These files only
// author the table: terrain, a mirrored wood/stone camp at each start, and
// enough dry ground that those starts can path to each other.

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  TERRAIN,
  TILE_SIZE_F,
  applySeededHeight,
  createField,
  findPath,
  isPassable,
  tileCenterX,
  tileCenterY,
  worldHalfFFromMap,
  worldToTile,
  worldToTileZ,
} from '../src/sim/field.js';
import { applyTableSilhouette } from '../src/sim/tableShape.js';
import { decodeGarden, encodeGarden, fieldFromGarden, GARDEN_VERSION } from '../src/sim/garden.js';
import { buildWorldFromConfig, spawnPadsForMapType } from '../src/sim/worldSetup.js';
import { SCENERY, defaultTreeStock } from '../src/sim/scenery.js';

const TILES = 144;
const PAD_CLEAR = 10;
const here = dirname(fileURLToPath(import.meta.url));
const mapsRoot = join(here, '..', 'maps');

function paintDisc(terrain, w, h, cx, cz, radius, kind, skipWater = false) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const z0 = Math.max(0, Math.floor(cz - radius));
  const z1 = Math.min(h - 1, Math.ceil(cz + radius));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > r2) continue;
      const i = z * w + x;
      if (skipWater && terrain[i] === TERRAIN.WATER) continue;
      terrain[i] = kind;
    }
  }
}

function paintBand(terrain, w, h, vertical, centerAt, halfWidth, gaps) {
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const along = vertical ? z : x;
      const across = vertical ? x : z;
      if (gaps.some((g) => along >= g[0] && along <= g[1])) continue;
      const mid = centerAt(along);
      if (Math.abs(across - mid) <= halfWidth) terrain[z * w + x] = TERRAIN.WATER;
    }
  }
}

function paintBanks(terrain, w, h, pads, fordAlong, vertical) {
  const nearWater = (x, z) => {
    for (let dz = -2; dz <= 2; dz++) {
      const nz = z + dz;
      if (nz < 0 || nz >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        if (terrain[nz * w + nx] === TERRAIN.WATER) return true;
      }
    }
    return false;
  };
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      if (terrain[z * w + x] !== TERRAIN.GRASS) continue;
      if (nearPad(x, z, pads, PAD_CLEAR + 2)) continue;
      const along = vertical ? z : x;
      if (fordAlong.some((g) => along >= g[0] - 1 && along <= g[1] + 1)) continue;
      if (nearWater(x, z)) terrain[z * w + x] = TERRAIN.DIRT;
    }
  }
}

function nearPad(tx, tz, pads, radius) {
  const r2 = radius * radius;
  for (const p of pads) {
    const dx = tx - p.tx;
    const dz = tz - p.tz;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

function padsFor(mapType) {
  const half = worldHalfFFromMap(TILES);
  return spawnPadsForMapType(mapType, half, TILES, half).map(([x, z]) => ({
    x,
    z,
    tx: Math.floor((x + half) / TILE_SIZE_F),
    tz: Math.floor((z + half) / TILE_SIZE_F),
  }));
}

function inward(pad) {
  const c = (TILES - 1) / 2;
  const dx = c - pad.tx;
  const dz = c - pad.tz;
  return {
    ix: Math.abs(dx) > 8 ? Math.sign(dx) : 0,
    iz: Math.abs(dz) > 8 ? Math.sign(dz) : 0,
  };
}

function campSpots(pad) {
  const { ix, iz } = inward(pad);
  const at = (ox, oz) => ({ tx: pad.tx + ox * ix, tz: pad.tz + oz * iz });
  // Side starts (1v1): ix is toward center, iz is 0, so oz stays a north/south flank.
  // Corner starts (teams): both axes point inward, and ox/oz are inward steps.
  if (ix !== 0 && iz !== 0) {
    return {
      groves: [
        { ...at(16, 5), r: 5 },
        { ...at(5, 16), r: 5 },
      ],
      rocks: [
        { ...at(22, 9), kind: SCENERY.ROCK_MOSS },
        { ...at(9, 22), kind: SCENERY.ROCK_PLAIN },
      ],
    };
  }
  const flank = ix || 1;
  return {
    groves: [
      { tx: pad.tx + 18 * flank, tz: pad.tz - 18, r: 6 },
      { tx: pad.tx + 18 * flank, tz: pad.tz + 18, r: 6 },
      { tx: pad.tx - 12 * flank, tz: pad.tz, r: 5 },
    ],
    rocks: [
      { tx: pad.tx + 28 * flank, tz: pad.tz - 8, kind: SCENERY.ROCK_MOSS },
      { tx: pad.tx + 28 * flank, tz: pad.tz + 8, kind: SCENERY.ROCK_PLAIN },
    ],
  };
}

function plantTree(field, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const i = tz * field.width + tx;
  if (field.activeMask[i] === 0) return false;
  const ground = field.terrainTypes[i];
  if (ground === TERRAIN.WATER) return false;
  if (field.sceneryType[i]) return false;
  field.sceneryType[i] = SCENERY.TREE;
  field.treeStock[i] = defaultTreeStock(tx, tz, field.seed, field);
  return true;
}

function plantRock(field, tx, tz, kind) {
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return false;
  const i = tz * field.width + tx;
  if (field.activeMask[i] === 0) return false;
  if (field.terrainTypes[i] === TERRAIN.WATER) return false;
  if (field.sceneryType[i]) return false;
  field.sceneryType[i] = kind;
  return true;
}

function plantGrove(field, cx, cz, radius, pads) {
  let n = 0;
  const r2 = radius * radius;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      if (((dx + dz) & 1) !== 0) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (nearPad(tx, tz, pads, PAD_CLEAR)) continue;
      if (plantTree(field, tx, dz + cz)) n++;
    }
  }
  return n;
}

function blankField(seed) {
  const field = createField(seed, { width: TILES, height: TILES });
  field.terrainTypes.fill(TERRAIN.GRASS);
  return field;
}

function finishField(field, pads) {
  for (const p of pads) {
    paintDisc(field.terrainTypes, field.width, field.height, p.tx, p.tz, 12, TERRAIN.GRASS, false);
    // Only the water-to-grass safety disc above; then a dirt yard on dry ground.
    paintDisc(field.terrainTypes, field.width, field.height, p.tx, p.tz, 5, TERRAIN.DIRT, true);
  }
  applySeededHeight(field);
  applyTableSilhouette(field);
  for (const p of pads) {
    const camp = campSpots(p);
    for (const g of camp.groves) plantGrove(field, g.tx, g.tz, g.r, pads);
    for (const r of camp.rocks) {
      if (!nearPad(r.tx, r.tz, pads, PAD_CLEAR)) plantRock(field, r.tx, r.tz, r.kind);
    }
  }
}

function buildFord() {
  const field = blankField(0x5f04d);
  const pads = padsFor('onevsone');
  const fords = [[40, 52], [92, 104]];
  paintBand(field.terrainTypes, TILES, TILES, true, (z) => (TILES - 1) / 2 + Math.sin(z * 0.075) * 5, 6, fords);
  paintBanks(field.terrainTypes, TILES, TILES, pads, fords, true);
  paintDisc(field.terrainTypes, TILES, TILES, 16, 16, 8, TERRAIN.WATER);
  paintDisc(field.terrainTypes, TILES, TILES, TILES - 17, TILES - 17, 8, TERRAIN.WATER);
  finishField(field, pads);
  return { field, pads, mapType: 'onevsone', links: [[0, 1]] };
}

function buildBowl() {
  const field = blankField(0xb041);
  const pads = padsFor('onevsone');
  const c = (TILES - 1) / 2;
  paintDisc(field.terrainTypes, TILES, TILES, c, c, 11, TERRAIN.WATER);
  for (let z = 0; z < TILES; z++) {
    for (let x = 0; x < TILES; x++) {
      const d = Math.hypot(x - c, z - c);
      if (d >= 30 && d <= 34 && field.terrainTypes[z * TILES + x] !== TERRAIN.WATER) {
        field.terrainTypes[z * TILES + x] = TERRAIN.DIRT;
      }
    }
  }
  paintDisc(field.terrainTypes, TILES, TILES, 14, 14, 10, TERRAIN.WATER);
  paintDisc(field.terrainTypes, TILES, TILES, TILES - 15, 14, 10, TERRAIN.WATER);
  paintDisc(field.terrainTypes, TILES, TILES, 14, TILES - 15, 10, TERRAIN.WATER);
  paintDisc(field.terrainTypes, TILES, TILES, TILES - 15, TILES - 15, 10, TERRAIN.WATER);
  finishField(field, pads);
  return { field, pads, mapType: 'onevsone', links: [[0, 1]] };
}

function buildDivide() {
  const field = blankField(0xd171de);
  const pads = padsFor('teams');
  const fords = [[34, 48], [96, 110]];
  paintBand(field.terrainTypes, TILES, TILES, false, (x) => (TILES - 1) / 2 + Math.sin(x * 0.07) * 4, 6, fords);
  paintBanks(field.terrainTypes, TILES, TILES, pads, fords, false);
  finishField(field, pads);
  return { field, pads, mapType: 'teams', links: [[0, 2], [0, 3], [1, 2], [1, 3], [0, 1], [2, 3]] };
}

function buildCorners() {
  const field = blankField(0xc04e45);
  const pads = padsFor('teams');
  const c = (TILES - 1) / 2;
  for (const p of pads) {
    const steps = Math.ceil(Math.hypot(c - p.tx, c - p.tz));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = p.tx + (c - p.tx) * t;
      const z = p.tz + (c - p.tz) * t;
      paintDisc(field.terrainTypes, TILES, TILES, x, z, 2, TERRAIN.DIRT, true);
    }
  }
  paintDisc(field.terrainTypes, TILES, TILES, c, c, 8, TERRAIN.DIRT);
  finishField(field, pads);
  return { field, pads, mapType: 'teams', links: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] };
}

function countNear(field, pad, radius, kind) {
  let n = 0;
  const r2 = radius * radius;
  for (let z = 0; z < field.height; z++) {
    for (let x = 0; x < field.width; x++) {
      const dx = x - pad.tx;
      const dz = z - pad.tz;
      if (dx * dx + dz * dz > r2) continue;
      if (field.sceneryType[z * field.width + x] === kind) n++;
    }
  }
  return n;
}

function assertPlayable(name, data, spec) {
  const decoded = decodeGarden(data);
  if (decoded.version !== GARDEN_VERSION) {
    throw new Error(`${name} encoded v${decoded.version}`);
  }
  const field = fieldFromGarden(data);
  const half = worldHalfFFromMap(field.width);
  const pads = spawnPadsForMapType(spec.mapType, half, field.width, half).map(([x, z]) => ({
    tx: Math.floor((x + half) / TILE_SIZE_F),
    tz: Math.floor((z + half) / TILE_SIZE_F),
  }));
  for (const p of pads) {
    const i = p.tz * field.width + p.tx;
    if (field.terrainTypes[i] === TERRAIN.WATER || !isPassable(field, p.tx, p.tz)) {
      throw new Error(`${name} start ${p.tx},${p.tz} is not dry ground`);
    }
    const trees = countNear(field, p, 40, SCENERY.TREE);
    const stone = countNear(field, p, 40, SCENERY.ROCK_MOSS);
    const mineral = countNear(field, p, 40, SCENERY.ROCK_PLAIN);
    if (trees < 12 || stone < 1 || mineral < 1) {
      throw new Error(`${name} start ${p.tx},${p.tz} resources trees=${trees} stone=${stone} mineral=${mineral}`);
    }
  }
  const wx = new Float64Array(64);
  const wy = new Float64Array(64);
  for (const [a, b] of spec.links) {
    const n = findPath(
      field,
      tileCenterX(pads[a].tx),
      tileCenterY(pads[a].tz),
      tileCenterX(pads[b].tx),
      tileCenterY(pads[b].tz),
      wx,
      wy,
    );
    if (n <= 0) throw new Error(`${name} has no path between starts ${a} and ${b}`);
  }
  const slots = spec.mapType === 'teams' ? [0, 1, 2, 3] : [0, 1];
  const world = buildWorldFromConfig({
    seed: decoded.seed,
    mode: 'skirmish',
    mapW: field.width,
    mapH: field.height,
    laneBases: spec.mapType === 'teams',
    activeSlots: slots,
  });
  if (world.agoras.length !== slots.length) {
    throw new Error(`${name} opened with ${world.agoras.length} agoras`);
  }
  for (let i = 0; i < world.count; i++) {
    const tx = worldToTile(world.px[i]);
    const tz = worldToTileZ(world.py[i]);
    if (!isPassable(field, tx, tz)) {
      throw new Error(`${name} spawned a unit on blocked ground ${tx},${tz}`);
    }
  }
  return { trees: pads.map((p) => countNear(field, p, 40, SCENERY.TREE)) };
}

const MAPS = [
  { dir: '1v1', file: 'ford.garden', name: 'The Ford', mapType: 'onevsone', build: buildFord },
  { dir: '1v1', file: 'bowl.garden', name: 'The Bowl', mapType: 'onevsone', build: buildBowl },
  { dir: 'teams', file: 'divide.garden', name: 'The Divide', mapType: 'teams', build: buildDivide },
  { dir: 'teams', file: 'corners.garden', name: 'Four Corners', mapType: 'teams', build: buildCorners },
];

const retired = [
  ['1v1', 'island.garden'],
  ['1v1', 'arena.garden'],
  ['teams', 'arena.garden'],
];

for (const [dir, file] of retired) {
  rmSync(join(mapsRoot, dir, file), { force: true });
}

const written = [];
for (const map of MAPS) {
  const spec = map.build();
  const data = encodeGarden(spec.field, {
    name: map.name,
    mapType: map.mapType,
    authoredScenery: true,
  });
  const stats = assertPlayable(map.name, data, spec);
  const dir = join(mapsRoot, map.dir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, map.file);
  writeFileSync(path, JSON.stringify(data));
  written.push({ ...map, bytes: JSON.stringify(data).length, trees: stats.trees });
}

function writeIndex(dir, rows) {
  const index = {
    maps: rows.map((row) => ({ file: row.file, name: row.name, mapType: row.mapType })),
  };
  writeFileSync(join(mapsRoot, dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}

writeIndex('1v1', written.filter((m) => m.dir === '1v1'));
writeIndex('teams', written.filter((m) => m.dir === 'teams'));

for (const row of written) {
  console.log(`${row.dir}/${row.file}  ${row.name}  ${row.bytes} bytes  trees/start ${row.trees.join(',')}`);
}
