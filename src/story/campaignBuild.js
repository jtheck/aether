// Generic chapter → v4 garden builder for the campaign manifest.
// One code path dresses every chapter: table size + silhouette, themed
// scenery/terrain, the four heroes, hostile camps, objectives, and the
// intro/win reels. Deterministic from each chapter's seed.

import {
  TABLE_CHUNK_TILES,
  TERRAIN,
  activeMapH,
  activeMapW,
  buildField,
  refreshTerrainDerived,
  setActiveMapSize,
  tilesForOddChunks,
} from '../sim/field.js';
import {
  applyTableSilhouette,
  cellCounts,
  createFullCellMask,
  createFullCellRadius,
  maxCellRadius,
  paintTerrainBrush,
  setCellEnabled,
  setCellRadius,
  tileCenterWorld,
} from '../sim/tableShape.js';
import {
  SCENERY,
  applyAuthoredScenery,
  paintSceneryBrush,
  sceneryTileHash,
} from '../sim/scenery.js';
import { UNIT } from '../sim/unitTypes.js';
import { encodeGarden } from '../sim/garden.js';
import { CLIP_CAMERA, normalizeStory } from './timeline.js';
import { isTerminalObjective } from './objectives.js';
import { markChapterExit } from './exits.js';
import { reelFromSteps } from './reel.js';
import { CAMPAIGN_CHAPTERS, EPISODES } from './campaign.js';

const NO_REFRESH = { refresh: false };
const ENEMY_OWNER = 4;

/** The four heroes, laid in a small diamond around the spawn anchor. */
const HEROES = [
  { name: 'Stumpey', type: UNIT.MYCO, dx: 0, dz: 1 },
  { name: 'Goblin', type: UNIT.WARLOCK, dx: -3, dz: 1 },
  { name: 'Lady', type: UNIT.PRIEST, dx: 0, dz: -1 },
  { name: 'Doc', type: UNIT.SHAMAN, dx: 3, dz: -1 },
];

function clampTile(v, n) {
  return Math.max(0, Math.min(n - 1, v | 0));
}

function tileFromFrac(f, n) {
  return clampTile(Math.round((Number(f) || 0) * (n - 1)), n);
}

function shapeTable(field, def) {
  const { chunksX, chunksZ } = cellCounts(field.width, field.height, TABLE_CHUNK_TILES);
  const cellMask = createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES);
  const cellRadius = createFullCellRadius(field.width, field.height, TABLE_CHUNK_TILES, 0);
  const shape = { cellSize: TABLE_CHUNK_TILES, chunksX, chunksZ, cellMask, cellRadius };
  const maxR = maxCellRadius(TABLE_CHUNK_TILES);
  const lastX = chunksX - 1;
  const lastZ = chunksZ - 1;
  const corners = [[0, 0], [lastX, 0], [0, lastZ], [lastX, lastZ]];

  const kind = def.shape || 'square';
  let cornerR = def.corner;
  if (cornerR == null) {
    if (kind === 'round') cornerR = maxR;
    else if (kind === 'corridor') cornerR = 3;
    else if (kind === 'square') cornerR = 6;
    else cornerR = 10; // notched / wedge keep softly rounded corners
  }
  cornerR = Math.min(maxR, Math.max(0, cornerR));
  for (const [cx, cz] of corners) setCellRadius(shape, cx, cz, cornerR);

  // `disable` replaces the shape default; `hole` is extra bites for giant
  // off-board props (castle mass, ice wall, caldera mouth) that sit in the gap.
  let carve = def.disable;
  if (!carve) {
    if (kind === 'notched') carve = [[0, 0], [lastX, lastZ]];
    else if (kind === 'wedge') carve = [[lastX, 0]];
    else carve = [];
  } else {
    carve = [...carve];
  }
  if (Array.isArray(def.hole)) carve.push(...def.hole);
  for (const [cx, cz] of carve) {
    if (cx >= 0 && cz >= 0 && cx <= lastX && cz <= lastZ) setCellEnabled(shape, cx, cz, false);
  }

  applyTableSilhouette(field, {
    cellSize: shape.cellSize,
    cellMask: shape.cellMask,
    cellRadius: shape.cellRadius,
    suppressCenterBlock: true,
  });
}

function terrainBlob(field, fx, fz, rFrac, terrain) {
  const tx = tileFromFrac(fx, field.width);
  const tz = tileFromFrac(fz, field.height);
  const r = Math.max(2, Math.round(field.width * rFrac));
  paintTerrainBrush(field, tx, tz, terrain, r);
}

function frToTileX(fr, field) {
  return Math.max(0, Math.min(field.width - 1, Math.round((Number(fr) || 0) * (field.width - 1))));
}
function frToTileZ(fr, field) {
  return Math.max(0, Math.min(field.height - 1, Math.round((Number(fr) || 0) * (field.height - 1))));
}

/** Light background texture — a few scattered trees/rocks, not the main feature. */
function scatter(field, seed, { tree = 0.06, rock = 0.02, snow = false, mineral = false }) {
  const { width, height, terrainTypes } = field;
  for (let tz = 0; tz < height; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const i = tz * width + tx;
      if (terrainTypes[i] === TERRAIN.WATER) continue;
      if (terrainTypes[i] === TERRAIN.GRASS && sceneryTileHash(tx, tz, seed + 41) < tree) {
        paintSceneryBrush(field, tx, tz, SCENERY.TREE, 0, NO_REFRESH);
        continue;
      }
      if (sceneryTileHash(tx, tz, seed + 73) < rock) {
        const roll = sceneryTileHash(tx, tz, seed + 91);
        let kind;
        if (snow) kind = roll < 0.6 ? SCENERY.ROCK_SNOW : SCENERY.ROCK_MOSS;
        else if (mineral) kind = roll < 0.7 ? SCENERY.ROCK_PLAIN : SCENERY.ROCK_MOSS;
        else kind = roll < 0.4 ? SCENERY.ROCK_PLAIN : (roll < 0.75 ? SCENERY.ROCK_MOSS : SCENERY.ROCK_SNOW);
        paintSceneryBrush(field, tx, tz, kind, 0, NO_REFRESH);
      }
    }
  }
}

/** Dense scenery mass at a tile centre — a thicket ('tree') or a rocky mound ('rock'/'snow'). */
function clumpAt(field, seed, cx, cz, r, kind, density) {
  const { width, height, terrainTypes } = field;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      if (terrainTypes[z * width + x] === TERRAIN.WATER) continue;
      const dist = Math.hypot(dx, dz) / r;
      if (dist > 1) continue;
      if (sceneryTileHash(x, z, seed) > density * (1 - dist * 0.8)) continue;
      if (kind === 'tree') {
        paintSceneryBrush(field, x, z, SCENERY.TREE, 0, NO_REFRESH);
      } else {
        const roll = sceneryTileHash(x, z, seed + 5);
        const rk = kind === 'snow'
          ? (roll < 0.6 ? SCENERY.ROCK_SNOW : SCENERY.ROCK_MOSS)
          : (roll < 0.55 ? SCENERY.ROCK_PLAIN : (roll < 0.85 ? SCENERY.ROCK_MOSS : SCENERY.ROCK_SNOW));
        paintSceneryBrush(field, x, z, rk, 0, NO_REFRESH);
      }
    }
  }
}

/** Fractional-placed dense mass (thicket / mountain). */
function clump(field, seed, frx, frz, rFrac, kind, density = 0.72) {
  clumpAt(field, seed, frToTileX(frx, field), frToTileZ(frz, field), Math.max(2, Math.round(field.width * rFrac)), kind, density);
}

/** A ridge/wall of dense scenery between two fractional points — a mountain spine or hedgerow. */
function ridge(field, seed, x0, z0, x1, z1, rTiles, kind = 'rock', density = 0.82) {
  const ax = frToTileX(x0, field);
  const az = frToTileZ(z0, field);
  const bx = frToTileX(x1, field);
  const bz = frToTileZ(z1, field);
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / Math.max(2, rTiles)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    clumpAt(field, seed + s * 7, Math.round(ax + (bx - ax) * t), Math.round(az + (bz - az) * t), rTiles, kind, density);
  }
}

/** Terrain stroke between two fractional points (moat, stream, crevasse). */
function terrainLine(field, x0, z0, x1, z1, rTiles, terrain) {
  const ax = frToTileX(x0, field);
  const az = frToTileZ(z0, field);
  const bx = frToTileX(x1, field);
  const bz = frToTileZ(z1, field);
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
  const r = Math.max(1, rTiles | 0);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    paintTerrainBrush(
      field,
      Math.round(ax + (bx - ax) * t),
      Math.round(az + (bz - az) * t),
      terrain,
      r,
    );
  }
}

/**
 * Theme wash only — dirt stains and light scatter. Real barriers (water,
 * thick forest) and rubble are authored per chapter in dressSet. We do not
 * fake mountains with rock ridges; those live as giant off-board props in
 * carved chunk holes.
 */
function dressTheme(field, theme, seed) {
  switch (theme) {
    case 'siege':
      terrainBlob(field, 0.5, 0.52, 0.1, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.03, rock: 0.015 });
      break;
    case 'volcano':
      terrainBlob(field, 0.5, 0.48, 0.16, TERRAIN.DIRT);
      terrainBlob(field, 0.3, 0.32, 0.07, TERRAIN.DIRT);
      terrainBlob(field, 0.7, 0.58, 0.07, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.01, rock: 0.02, mineral: true });
      break;
    case 'ice':
      scatter(field, seed, { tree: 0.02, rock: 0.015, snow: true });
      break;
    case 'muster':
      terrainBlob(field, 0.5, 0.52, 0.07, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.04, rock: 0.012 });
      break;
    case 'cataclysm':
      terrainBlob(field, 0.5, 0.45, 0.14, TERRAIN.DIRT);
      terrainBlob(field, 0.22, 0.6, 0.06, TERRAIN.DIRT);
      terrainBlob(field, 0.78, 0.6, 0.06, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.012, rock: 0.018 });
      break;
    default:
      scatter(field, seed, { tree: 0.08, rock: 0.02 });
  }
}

/**
 * Chapter-authored set: water barriers, forest walls, light rubble.
 * clearPlay punches dirt roads through water (bridges) and tree lines (trails).
 */
function dressSet(field, def, seed) {
  for (const [fx, fz, r] of def.water || []) terrainBlob(field, fx, fz, r, TERRAIN.WATER);
  for (const [x0, z0, x1, z1, r] of def.channel || []) {
    terrainLine(field, x0, z0, x1, z1, r, TERRAIN.WATER);
  }
  for (const [fx, fz, r, density] of def.woods || []) {
    clump(field, seed + 101, fx, fz, r, 'tree', density ?? 0.84);
  }
  for (const [x0, z0, x1, z1, r] of def.hedge || []) {
    ridge(field, seed + 111, x0, z0, x1, z1, r, 'tree', 0.9);
  }
  for (const [fx, fz, r] of def.rubble || []) {
    clump(field, seed + 131, fx, fz, r, 'rock', 0.42);
  }
}

function buildHeroes(anchor, w, h) {
  return HEROES.map((hero) => ({
    owner: 0,
    type: hero.type,
    name: hero.name,
    tx: clampTile(anchor.tx + hero.dx, w),
    tz: clampTile(anchor.tz + hero.dz, h),
  }));
}

function objectivesFor(def) {
  return def.objectives || [];
}

/** A named, player-owned escort target (a wagon) per escort objective, at spawn. */
function buildEscortUnits(objectives, anchor, w, h) {
  const out = [];
  let n = 0;
  for (const o of objectives) {
    if (o.kind !== 'escort') continue;
    const name = (o.params && o.params.escort) || 'Escort';
    out.push({
      owner: 0,
      type: UNIT.WAGON,
      name,
      tx: clampTile(anchor.tx + 2 + n * 2, w),
      tz: clampTile(anchor.tz - 2, h),
    });
    n += 1;
  }
  return out;
}

function placeCamps(field, camps, w, h) {
  const units = [];
  const buildings = [];
  for (const c of camps || []) {
    const cx = tileFromFrac(c.fx, w);
    const cz = tileFromFrac(c.fz, h);
    paintTerrainBrush(field, cx, cz, TERRAIN.DIRT, 4);
    paintSceneryBrush(field, cx, cz, SCENERY.NONE, c.clear ?? 5, NO_REFRESH);
    if (c.building) {
      const { x, z } = tileCenterWorld(field, cx, cz);
      buildings.push({ owner: ENEMY_OWNER, type: c.building, x, z, yaw: 0 });
    }
    for (const [type, dx, dz] of c.units || []) {
      units.push({
        owner: ENEMY_OWNER,
        type,
        tx: clampTile(cx + dx, w),
        tz: clampTile(cz + dz, h),
        name: '',
      });
    }
  }
  return { units, buildings };
}

/** Set-dressing halls (towers, barracks, church…) — no garrison unless a camp sits there. */
function placeHalls(field, halls, w, h) {
  const buildings = [];
  for (const p of halls || []) {
    const tx = tileFromFrac(p.fx, w);
    const tz = tileFromFrac(p.fz, h);
    paintTerrainBrush(field, tx, tz, TERRAIN.DIRT, 3);
    paintSceneryBrush(field, tx, tz, SCENERY.NONE, 4, NO_REFRESH);
    const { x, z } = tileCenterWorld(field, tx, tz);
    buildings.push({
      owner: p.owner ?? ENEMY_OWNER,
      type: p.type,
      x,
      z,
      yaw: p.yaw ?? 0,
    });
  }
  return buildings;
}

function buildingNear(buildings, x, z, tiles = 8) {
  const lim = tiles * 4;
  return (buildings || []).some((b) => Math.hypot(b.x - x, b.z - z) < lim);
}

/** Give every `destroy` objective a killable structure (+ guards) inside its zone. */
function placeDestroyTargets(field, objectives, existing = []) {
  const units = [];
  const buildings = [];
  for (const o of objectives) {
    if (o.kind !== 'destroy') continue;
    const { x, z } = tileCenterWorld(field, o.tx, o.tz);
    if (buildingNear(existing, x, z) || buildingNear(buildings, x, z)) continue;
    paintTerrainBrush(field, o.tx, o.tz, TERRAIN.DIRT, 3);
    paintSceneryBrush(field, o.tx, o.tz, SCENERY.NONE, 3, NO_REFRESH);
    const type = o.params?.building || 'camp';
    buildings.push({ owner: ENEMY_OWNER, type, x, z, yaw: 0 });
    units.push({ owner: ENEMY_OWNER, type: UNIT.WARRIOR, tx: clampTile(o.tx - 2, field.width), tz: clampTile(o.tz + 2, field.height), name: '' });
    units.push({ owner: ENEMY_OWNER, type: UNIT.ARCHER, tx: clampTile(o.tx + 2, field.width), tz: clampTile(o.tz + 2, field.height), name: '' });
  }
  return { units, buildings };
}

const WAVE_KINDS = new Set(['survive', 'defend']);

function resolveObjectives(def, w, h, nextUrl) {
  const out = [];
  (def.objectives || []).forEach((o, i) => {
    const params = o.params ? { ...o.params } : null;
    const objective = {
      id: o.id || `${def.id}o${i}`,
      kind: o.kind,
      tx: tileFromFrac(o.fx, w),
      tz: tileFromFrac(o.fz, h),
      r: o.r ?? 5,
      label: o.label || '',
      message: o.message || '',
      next: o.next || '',
      terminal: o.terminal === true,
      params,
    };
    // Tag wave objectives with their episode so the spawner picks the era roster.
    if (WAVE_KINDS.has(objective.kind) && (params?.waves | 0) > 0) {
      objective.params = { ...params, era: def.episode | 0 };
    }
    if (isTerminalObjective(objective) && !objective.next && nextUrl) {
      objective.next = nextUrl;
    }
    out.push(objective);
  });
  // Allied reinforcement spawners ride on the first objective's params so the
  // sim spawner (which scans objectives) can raise them with no schema change.
  if (Array.isArray(def.allies) && def.allies.length && out.length) {
    out[0].params = { ...(out[0].params || {}), allies: def.allies };
  }
  return out;
}

/** Clear scenery along a line so terrain features never seal off a required route. */
function clearSceneryLine(field, x0, z0, x1, z1, r) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    paintSceneryBrush(field, Math.round(x0 + (x1 - x0) * t), Math.round(z0 + (z1 - z0) * t), SCENERY.NONE, r, NO_REFRESH);
  }
}

function clearPlay(field, anchor, heroes, objectives) {
  for (const u of heroes) {
    paintTerrainBrush(field, u.tx, u.tz, TERRAIN.GRASS, 3);
    paintSceneryBrush(field, u.tx, u.tz, SCENERY.NONE, 3, NO_REFRESH);
  }
  for (const o of objectives) {
    // Keep a walkable corridor from the party's start to every objective.
    clearSceneryLine(field, anchor.tx, anchor.tz, o.tx, o.tz, 2);
    paintSceneryBrush(field, o.tx, o.tz, SCENERY.NONE, Math.max(4, o.r | 0), NO_REFRESH);
    paintTerrainBrush(field, o.tx, o.tz, TERRAIN.DIRT, Math.max(2, (o.r | 0) - 1));
  }
  const terminal = objectives.find(isTerminalObjective) || objectives[objectives.length - 1];
  if (terminal) markChapterExit(field, anchor.tx, anchor.tz, terminal);
  else refreshTerrainDerived(field);
}

function resolveSteps(steps, w, h) {
  return (steps || []).map((s) => {
    if (s && s.kind === CLIP_CAMERA) {
      return { ...s, tx: tileFromFrac(s.fx, w), tz: tileFromFrac(s.fz, h) };
    }
    return s;
  });
}

/**
 * Build one chapter garden.
 * @param {object} def chapter definition from the manifest
 * @param {string} [nextUrl] garden url for the next chapter (chapter chaining)
 */
export function buildChapterGarden(def, nextUrl = '') {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    const w = tilesForOddChunks(def.chunksX ?? def.chunks ?? 7);
    const h = tilesForOddChunks(def.chunksZ ?? def.chunks ?? 7);
    const seed = def.seed >>> 0;
    const field = buildField(seed, { width: w, height: h });

    shapeTable(field, def);
    dressTheme(field, def.theme, seed);
    dressSet(field, def, seed);

    const anchor = {
      tx: tileFromFrac(def.spawn?.fx ?? 0.5, w),
      tz: tileFromFrac(def.spawn?.fz ?? 0.85, h),
    };
    const heroes = buildHeroes(anchor, w, h);
    const escorts = buildEscortUnits(objectivesFor(def), anchor, w, h);
    const camps = placeCamps(field, def.camps, w, h);
    const halls = placeHalls(field, def.halls, w, h);
    const objectives = resolveObjectives(def, w, h, nextUrl);
    const targets = placeDestroyTargets(field, objectives, [...camps.buildings, ...halls]);
    clearPlay(field, anchor, heroes, objectives);
    applyAuthoredScenery(field);

    // Cinematics share vision so hostile camps / wave spawns read on camera.
    // Default: reveal the enemy faction; chapters can override (e.g. 'all' or false).
    const revealIntro = def.reveal !== undefined ? def.reveal : [ENEMY_OWNER];
    const revealWin = def.revealWin !== undefined ? def.revealWin : [ENEMY_OWNER];
    const story = normalizeStory({
      reels: [
        reelFromSteps('intro', 'start', resolveSteps(def.intro, w, h), revealIntro),
        reelFromSteps('ending', 'win', resolveSteps(def.win, w, h), revealWin),
      ],
    });

    return encodeGarden(field, {
      name: def.name,
      authoredScenery: true,
      story,
      objectives,
      units: [...heroes, ...escorts, ...camps.units, ...targets.units],
      buildings: [...camps.buildings, ...halls, ...targets.buildings],
    });
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}

/** Build every chapter, resolving next-chapter chaining from manifest order. */
export function buildCampaign() {
  return CAMPAIGN_CHAPTERS.map((c) => ({
    id: c.id,
    url: c.url,
    episode: c.episode,
    name: c.name,
    garden: buildChapterGarden(c.def, c.nextUrl),
  }));
}

/** Convenience for tests / tooling. */
export function campaignChapterCount() {
  return EPISODES.reduce((n, ep) => n + ep.chapters.length, 0);
}
