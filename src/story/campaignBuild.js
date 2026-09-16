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

  let carve = def.disable;
  if (!carve) {
    if (kind === 'notched') carve = [[0, 0], [lastX, lastZ]];
    else if (kind === 'wedge') carve = [[lastX, 0]];
    else carve = [];
  }
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

function scatter(field, seed, { tree = 0.14, rock = 0.03, snow = false, mineral = false }) {
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

/** Broad-stroke backdrop dressing per episode theme. */
function dressTheme(field, theme, seed) {
  switch (theme) {
    case 'siege':
      terrainBlob(field, 0.5, 0.06, 0.06, TERRAIN.WATER); // moat along the top wall
      terrainBlob(field, 0.5, 0.5, 0.1, TERRAIN.DIRT); // trampled courtyard
      scatter(field, seed, { tree: 0.13, rock: 0.03 });
      break;
    case 'volcano':
      terrainBlob(field, 0.5, 0.45, 0.16, TERRAIN.DIRT);
      terrainBlob(field, 0.35, 0.35, 0.07, TERRAIN.DIRT);
      terrainBlob(field, 0.65, 0.55, 0.07, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.03, rock: 0.055, mineral: true });
      break;
    case 'ice':
      terrainBlob(field, 0.3, 0.35, 0.06, TERRAIN.WATER);
      terrainBlob(field, 0.7, 0.6, 0.05, TERRAIN.WATER);
      scatter(field, seed, { tree: 0.05, rock: 0.055, snow: true });
      break;
    case 'muster':
      terrainBlob(field, 0.5, 0.5, 0.05, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.26, rock: 0.03 });
      break;
    case 'cataclysm':
      terrainBlob(field, 0.5, 0.42, 0.12, TERRAIN.DIRT);
      terrainBlob(field, 0.25, 0.6, 0.06, TERRAIN.DIRT);
      terrainBlob(field, 0.75, 0.6, 0.06, TERRAIN.DIRT);
      scatter(field, seed, { tree: 0.03, rock: 0.045 });
      break;
    default:
      scatter(field, seed, { tree: 0.12, rock: 0.03 });
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

/** Give every `destroy` objective a killable structure (+ guards) inside its zone. */
function placeDestroyTargets(field, objectives) {
  const units = [];
  const buildings = [];
  for (const o of objectives) {
    if (o.kind !== 'destroy') continue;
    const { x, z } = tileCenterWorld(field, o.tx, o.tz);
    paintTerrainBrush(field, o.tx, o.tz, TERRAIN.DIRT, 3);
    paintSceneryBrush(field, o.tx, o.tz, SCENERY.NONE, 3, NO_REFRESH);
    buildings.push({ owner: ENEMY_OWNER, type: 'camp', x, z, yaw: 0 });
    units.push({ owner: ENEMY_OWNER, type: UNIT.WARRIOR, tx: clampTile(o.tx - 2, field.width), tz: clampTile(o.tz + 2, field.height), name: '' });
    units.push({ owner: ENEMY_OWNER, type: UNIT.ARCHER, tx: clampTile(o.tx + 2, field.width), tz: clampTile(o.tz + 2, field.height), name: '' });
  }
  return { units, buildings };
}

function resolveObjectives(def, w, h, nextUrl) {
  const out = [];
  let chained = false;
  (def.objectives || []).forEach((o, i) => {
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
      params: o.params || null,
    };
    if (isTerminalObjective(objective) && !objective.next && nextUrl && !chained) {
      objective.next = nextUrl;
      chained = true;
    }
    out.push(objective);
  });
  return out;
}

function clearPlay(field, anchor, heroes, objectives) {
  for (const u of heroes) {
    paintTerrainBrush(field, u.tx, u.tz, TERRAIN.GRASS, 3);
    paintSceneryBrush(field, u.tx, u.tz, SCENERY.NONE, 3, NO_REFRESH);
  }
  for (const o of objectives) {
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

    const anchor = {
      tx: tileFromFrac(def.spawn?.fx ?? 0.5, w),
      tz: tileFromFrac(def.spawn?.fz ?? 0.85, h),
    };
    const heroes = buildHeroes(anchor, w, h);
    const camps = placeCamps(field, def.camps, w, h);
    const objectives = resolveObjectives(def, w, h, nextUrl);
    const targets = placeDestroyTargets(field, objectives);
    clearPlay(field, anchor, heroes, objectives);
    applyAuthoredScenery(field);

    const story = normalizeStory({
      reels: [
        reelFromSteps('intro', 'start', resolveSteps(def.intro, w, h)),
        reelFromSteps('ending', 'win', resolveSteps(def.win, w, h)),
      ],
    });

    return encodeGarden(field, {
      name: def.name,
      authoredScenery: true,
      story,
      objectives,
      units: [...heroes, ...camps.units, ...targets.units],
      buildings: [...camps.buildings, ...targets.buildings],
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
