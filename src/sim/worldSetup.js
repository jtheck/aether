// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn, STRESS_ENTITY_LIMIT } from './world.js';
import { UNIT, UNIT_DEFS, isFlyer, isMilitary, isTransport } from './unitTypes.js';
import { createKothMeta } from './kothMeta.js';
import { createAgoras } from './agora.js';
import {
  PLACEABLE_BUILDINGS,
  createBuilding,
  snapBuildingWorld,
} from './buildings.js';
import {
  WORLD_HALF_F,
  TINY_MAP_W,
  activeMapW,
  activeWorldHalfF,
  mapSizeForConfig,
  setActiveMapSize,
  worldHalfFFromMap,
} from './field.js';
import { setTeamAssignments } from './teams.js';
import { grantStartingResources } from './resources.js';
import * as fx from './fixed.js';

/** Staging AI cold start. */
const STAGING_AI_VILLAGERS = 5;
/** Skirmish match start — a few villagers per side, no army. */
const SKIRMISH_START_VILLAGERS = 3;
/** Army block sits this far toward map center from the agora. */
const ARMY_FORWARD = 36;
/** Compact camp ranks in front of a home agora (1vAI). */
const AGORA_VILLAGER_RING = 18;
const AGORA_ARMY_FORWARD = 32;
const AGORA_RANK_SPACING = 14;
const AGORA_FILE_SPACING = 11;
const AGORA_MAX_FILES = 8;
const AGORA_ENGINEER_BACK = 16;
const AGORA_ENGINEER_SIDE = 16;
const AGORA_PARK_BACK = 26;
const AGORA_PARK_SPACING = 22;
/** Packed `?army=` mixes stay on the old square grid past this count. */
const AGORA_CAMP_PACKED_ABOVE = 120;
/** Building showcase sits this far behind the agora (away from army). */
const BUILDING_BACK = 40;
const BUILDING_SPACING = 36;
const BUILDING_COLS = 5;

export const PLAYER = 0;
export const AI_OWNER = 1;

/** Stress FFA AI owners (player is always 0). */
export const STRESS_AI_OWNERS = [1, 2, 3, 4];
export const STRESS_ARMY_COUNT = 1 + STRESS_AI_OWNERS.length;

/**
 * Inset of the side-midline bases. Corner spawns sit at those two midlines'
 * intersection — not the map corner itself.
 */
export const SPAWN_BASE_INSET = 0.6;

/** Pentagonal spawn bases — scale with the active board half-extent. */
export function kothBases(worldHalfF = activeWorldHalfF()) {
  const H = worldHalfF;
  const m = H * SPAWN_BASE_INSET;
  return [
    [-m, 0],
    [m, 0],
    [0, -m],
    [0, m],
    [-H * 0.425, H * 0.425],
  ];
}

/** Team lanes — south pair (A), north pair (B). */
export function laneBases(worldHalfF = activeWorldHalfF()) {
  const m = worldHalfF * SPAWN_BASE_INSET;
  return [
    [-m, -m],
    [m, -m],
    [-m, m],
    [m, m],
  ];
}

/** Opposite corners first (1v1), then the remaining pair. Same inset as the sides. */
export function cornerBases(worldHalfF = activeWorldHalfF()) {
  const m = worldHalfF * SPAWN_BASE_INSET;
  return [
    [-m, -m],
    [m, m],
    [-m, m],
    [m, -m],
    [0, -m],
  ];
}

export function usesCornerSpawnBases(mapW) {
  return (mapW | 0) === TINY_MAP_W;
}

/** Match / Forge spawn points — corners on the 5-chunk board, sides otherwise. */
export function spawnBases(worldHalfF = activeWorldHalfF(), opts = {}) {
  if (opts.laneBases) return laneBases(worldHalfF);
  if (usesCornerSpawnBases(opts.mapW ?? activeMapW())) return cornerBases(worldHalfF);
  return kothBases(worldHalfF);
}

/** Default 1v1 agoras for a generated field (Forge + procedural matches). */
export function defaultMatchAgoras(worldHalfF, mapW, count = 2) {
  const bases = spawnBases(worldHalfF, { mapW });
  const n = Math.max(0, Math.min(count | 0, bases.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ owner: i, x: bases[i][0], z: bases[i][1] });
  }
  return out;
}

/** Default-map bases (tests / importers that expect a stable export). */
export const KOTH_BASES = kothBases(WORLD_HALF_F);

const PLAYER_ARMY = [
  { type: UNIT.VILLAGER, count: 5 },
  { type: UNIT.WARRIOR, count: 8 },
  { type: UNIT.ARCHER, count: 6 },
  { type: UNIT.WARLOCK, count: 3 },
  { type: UNIT.PRIEST, count: 2 },
  { type: UNIT.MYCO, count: 2 },
  { type: UNIT.SHAMAN, count: 2 },
  { type: UNIT.WIZARD, count: 2 },
  { type: UNIT.MONK, count: 3 },
  { type: UNIT.ENGINEER, count: 2 },
  { type: UNIT.WAGON, count: 1 },
  { type: UNIT.DIRIGIBLE, count: 1 },
  { type: UNIT.APC, count: 1 },
];

const ENEMY_ARMY = [
  { type: UNIT.VILLAGER, count: 5 },
  { type: UNIT.WARRIOR, count: 8 },
  { type: UNIT.ARCHER, count: 6 },
  { type: UNIT.WARLOCK, count: 3 },
  { type: UNIT.PRIEST, count: 2 },
  { type: UNIT.MYCO, count: 2 },
  { type: UNIT.SHAMAN, count: 2 },
  { type: UNIT.WIZARD, count: 2 },
  { type: UNIT.MONK, count: 3 },
  { type: UNIT.ENGINEER, count: 2 },
  { type: UNIT.WAGON, count: 1 },
  { type: UNIT.DIRIGIBLE, count: 1 },
  { type: UNIT.APC, count: 1 },
];

/** KOTH drop — combat only, plus a dirigible and APC on the flanks. */
const KOTH_ARMY = [
  { type: UNIT.WARRIOR, count: 8 },
  { type: UNIT.ARCHER, count: 6 },
  { type: UNIT.WARLOCK, count: 3 },
  { type: UNIT.PRIEST, count: 2 },
  { type: UNIT.MYCO, count: 2 },
  { type: UNIT.SHAMAN, count: 2 },
  { type: UNIT.WIZARD, count: 2 },
  { type: UNIT.MONK, count: 3 },
  { type: UNIT.DIRIGIBLE, count: 1 },
  { type: UNIT.APC, count: 1 },
];

const COL_SPACING = 22;
const ROW_SPACING = 16;
/** Compact KOTH ranks facing the hill. */
const KOTH_FILE_SPACING = 12;
const KOTH_RANK_SPACING = 16;
const KOTH_FRONT_FORWARD = 16;
const KOTH_FLANK_PAD = 26;

/** Relative combat mix for the pie-ring mass: baseline 10, casters 5. */
function stressTypeWeight(def) {
  if (def.primaryAbility) return 5;
  return 10;
}

/** Combat bag for the pie-ring mass — no monks, civilians, or vehicles. */
const STRESS_COMBAT_TYPES = [];
for (const def of UNIT_DEFS) {
  if (def.id === UNIT.MONK) continue;
  if (!isMilitary(def.id) || isTransport(def.id)) continue;
  const weight = stressTypeWeight(def);
  for (let i = 0; i < weight; i++) STRESS_COMBAT_TYPES.push(def.id);
}

/** One of each, parked just outside the combat ring. */
const STRESS_SUPPORT_TYPES = [
  UNIT.VILLAGER,
  UNIT.ENGINEER,
  UNIT.WAGON,
  UNIT.DIRIGIBLE,
  UNIT.APC,
];

/** Menu button / documented default (`?stress=1000`). */
export const STRESS_MENU_PER_SIDE = 1000;

/** Inner hole of the 5-slice pie — a good ways from origin. */
export const STRESS_RING_INNER_FRAC = 0.30;
/** Unused fraction of each 72° slice so neighboring ranks don't kiss. */
const STRESS_SLICE_GAP_FRAC = 0.16;
const STRESS_RING_SPACING_MAX = 10;
const STRESS_RING_SPACING_MIN = 5;
const STRESS_SUPPORT_BACK = 32;
const STRESS_SUPPORT_SPACING = 16;
const STRESS_MAX_RADIUS_FRAC = 0.90;

/** Soft cap on square packing (animStress / large `?army=`). */
const STRESS_SPACING_MAX = 14;
const STRESS_SPACING_MIN = 4;

export { PLAYER_ARMY, ENEMY_ARMY, KOTH_ARMY };

export const UNITS_PER_ARMY = PLAYER_ARMY.reduce((s, c) => s + c.count, 0);
export const KOTH_UNITS_PER_ARMY = KOTH_ARMY.reduce((s, c) => s + c.count, 0);
export const KOTH_MAX_SLOTS = 5;
export const KOTH_MAX_ENTITIES = UNITS_PER_ARMY * KOTH_MAX_SLOTS;

/** Active per-slot army size (0 = default PLAYER_ARMY layout). */
let _armyPerSide = 0;

export function setArmyPerSide(n) {
  _armyPerSide = Math.max(0, n | 0);
}

export function activeArmyPerSide() {
  return _armyPerSide > 0 ? _armyPerSide : UNITS_PER_ARMY;
}

/** Max entities for current army size across all KOTH slots. */
export function kothMaxEntities(armyPerSide = _armyPerSide) {
  const per = armyPerSide > 0 ? armyPerSide : UNITS_PER_ARMY;
  return per * KOTH_MAX_SLOTS;
}

/** Max thin-instance slots for a unit type across all KOTH slots. */
export function kothMaxUnitsOfType(typeId) {
  const entry = PLAYER_ARMY.find((u) => u.type === typeId);
  if (!entry) return 0;
  const army = activeArmyPerSide();
  const perArmy = Math.max(1, Math.ceil((entry.count * army) / UNITS_PER_ARMY));
  return perArmy * KOTH_MAX_SLOTS;
}

function scaledLayoutFrom(source, sourceTotal, n) {
  const target = Math.max(1, n | 0);
  if (target === sourceTotal) {
    return source.map((c) => ({ type: c.type, count: c.count }));
  }
  const layout = source.map((c) => ({
    type: c.type,
    count: Math.floor((c.count * target) / sourceTotal),
  }));
  let sum = layout.reduce((s, c) => s + c.count, 0);
  let i = 0;
  while (sum < target) {
    layout[i % layout.length].count++;
    sum++;
    i++;
  }
  return layout.filter((c) => c.count > 0);
}

/** Scale the default mix so counts sum to `n` (deterministic). */
export function scaledArmyLayout(n) {
  return scaledLayoutFrom(PLAYER_ARMY, UNITS_PER_ARMY, n);
}

function scaledKothArmyLayout(n) {
  return scaledLayoutFrom(KOTH_ARMY, KOTH_UNITS_PER_ARMY, n);
}

/** Spawn one army — default layout, or packed scaled mix when armyPerSide > 0. */
function spawnConfiguredArmy(w, owner, baseX, baseZ) {
  if (_armyPerSide > 0) {
    spawnArmyPacked(w, scaledArmyLayout(_armyPerSide), owner, baseX, baseZ);
  } else {
    spawnArmy(w, PLAYER_ARMY, owner, baseX, baseZ);
  }
}

function spawnConfiguredKothArmy(w, owner, baseX, baseZ) {
  const layout = _armyPerSide > 0 ? scaledKothArmyLayout(_armyPerSide) : KOTH_ARMY;
  const total = layout.reduce((s, c) => s + c.count, 0);
  if (total > AGORA_CAMP_PACKED_ABOVE) {
    spawnArmyPacked(w, layout, owner, baseX, baseZ);
    return;
  }
  spawnKothFormation(w, owner, baseX, baseZ, layout);
}

function activeArmyLayout() {
  return _armyPerSide > 0 ? scaledArmyLayout(_armyPerSide) : PLAYER_ARMY;
}

/** Home agora + the usual mix parked as a camp facing map center. */
function spawnConfiguredArmyAtAgora(w, owner, baseX, baseZ) {
  const layout = activeArmyLayout();
  const total = layout.reduce((s, c) => s + c.count, 0);
  if (total > AGORA_CAMP_PACKED_ABOVE) {
    spawnArmyOriented(w, layout, owner, baseX, baseZ, ARMY_FORWARD);
    return;
  }
  spawnArmyAroundAgora(w, layout, owner, baseX, baseZ);
}

/** Spawn one KOTH army at a slot base (mid-game join). */
export function spawnKothSlot(w, slot) {
  const half = w.worldHalfF ?? activeWorldHalfF();
  const bases = spawnBases(half, { mapW: w.mapW });
  const base = bestKothSpawnPoint(w, slot, bases);
  spawnConfiguredKothArmy(w, slot, base[0], base[1]);
}

export function stressPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('stress') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, (STRESS_ENTITY_LIMIT / STRESS_ARMY_COUNT) | 0);
}

/** Per-player army size for KOTH/legacy (`?army=2000`). 0 = default 76-unit mix. */
export function armyPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('army') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, (STRESS_ENTITY_LIMIT / KOTH_MAX_SLOTS) | 0);
}

/** Per-side skinned villagers for render stress (`?animStress=32` → 64 total). */
export function animStressPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('animStress') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Two-army VAT path — GPU/skinning will die long before the entity ceiling.
  return Math.min(n, STRESS_ENTITY_LIMIT >> 1);
}

function spawnArmy(w, layout, owner, baseX, baseZ) {
  spawnArmyOriented(w, layout, owner, baseX, baseZ, 0);
}

/**
 * Grid facing map center: columns = types (lateral), rows = depth toward enemy.
 * @param {number} forward0 — offset from agora toward center for the first row
 */
function spawnArmyOriented(w, layout, owner, baseX, baseZ, forward0) {
  const len = Math.hypot(baseX, baseZ) || 1;
  const fX = -baseX / len;
  const fZ = -baseZ / len;
  const rX = -fZ;
  const rZ = fX;

  const cols = layout.length;
  const maxRows = Math.max(1, ...layout.map((c) => c.count));
  const halfLat = ((cols - 1) * COL_SPACING) / 2;

  for (let c = 0; c < layout.length; c++) {
    const col = layout[c];
    const lat = c * COL_SPACING - halfLat;
    for (let r = 0; r < col.count; r++) {
      const forward = forward0 + r * ROW_SPACING;
      const wx = baseX + rX * lat + fX * forward;
      const wz = baseZ + rZ * lat + fZ * forward;
      spawn(w, {
        x: fx.fromFloat(wx),
        y: fx.fromFloat(wz),
        type: col.type,
        owner,
      });
    }
  }
}

/** Ring of villagers around the agora (AI cold start). */
function spawnVillagersAround(w, owner, baseX, baseZ, count) {
  spawnRing(w, owner, UNIT.VILLAGER, baseX, baseZ, 16, count);
}

function spawnRing(w, owner, type, baseX, baseZ, radius, count, angle0 = 0.35) {
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 2 + angle0;
    spawn(w, {
      x: fx.fromFloat(baseX + Math.cos(a) * radius),
      y: fx.fromFloat(baseZ + Math.sin(a) * radius),
      type,
      owner,
    });
  }
}

function facingCenter(baseX, baseZ) {
  const len = Math.hypot(baseX, baseZ) || 1;
  return {
    fX: -baseX / len,
    fZ: -baseZ / len,
    rX: baseZ / len,
    rZ: -baseX / len,
  };
}

function typesMatching(layout, pred) {
  const out = [];
  for (const col of layout) {
    if (!pred(col.type)) continue;
    for (let i = 0; i < col.count; i++) out.push(col.type);
  }
  return out;
}

function spawnOffset(w, owner, type, baseX, baseZ, fX, fZ, rX, rZ, forward, lat) {
  spawn(w, {
    x: fx.fromFloat(baseX + rX * lat + fX * forward),
    y: fx.fromFloat(baseZ + rZ * lat + fZ * forward),
    type,
    owner,
  });
}

function spawnRank(w, owner, types, baseX, baseZ, fX, fZ, rX, rZ, forward, spacing) {
  const n = types.length;
  if (!n) return;
  const half = ((n - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) {
    spawnOffset(w, owner, types[i], baseX, baseZ, fX, fZ, rX, rZ, forward, i * spacing - half);
  }
}

function spawnRanks(w, owner, types, baseX, baseZ, fX, fZ, rX, rZ, forward0) {
  let row = 0;
  for (let i = 0; i < types.length; i += AGORA_MAX_FILES) {
    spawnRank(
      w,
      owner,
      types.slice(i, i + AGORA_MAX_FILES),
      baseX,
      baseZ,
      fX,
      fZ,
      rX,
      rZ,
      forward0 + row * AGORA_RANK_SPACING,
      AGORA_FILE_SPACING,
    );
    row++;
  }
  return row;
}

/** Melee up front, missile middle, casters behind — villagers ring the agora. */
function agoraCampRole(type) {
  if (type === UNIT.VILLAGER) return 'villager';
  if (type === UNIT.ENGINEER) return 'engineer';
  if (isTransport(type) || isFlyer(type)) return 'park';
  if (type === UNIT.WARRIOR || type === UNIT.MONK) return 'front';
  if (type === UNIT.ARCHER || type === UNIT.MYCO) return 'mid';
  return 'rear';
}

/**
 * Camp facing map center: workers on the agora, army in compact ranks toward
 * the enemy, transports parked behind.
 */
function spawnArmyAroundAgora(w, layout, owner, baseX, baseZ) {
  const { fX, fZ, rX, rZ } = facingCenter(baseX, baseZ);
  const villagers = typesMatching(layout, (t) => agoraCampRole(t) === 'villager');
  spawnRing(w, owner, UNIT.VILLAGER, baseX, baseZ, AGORA_VILLAGER_RING, villagers.length);

  const engineers = typesMatching(layout, (t) => agoraCampRole(t) === 'engineer');
  const engHalf = ((engineers.length - 1) * AGORA_ENGINEER_SIDE) / 2;
  for (let i = 0; i < engineers.length; i++) {
    const lat = engineers.length === 1 ? 0 : i * AGORA_ENGINEER_SIDE - engHalf;
    spawnOffset(w, owner, engineers[i], baseX, baseZ, fX, fZ, rX, rZ, -AGORA_ENGINEER_BACK, lat);
  }

  const park = typesMatching(layout, (t) => agoraCampRole(t) === 'park');
  const parkHalf = ((park.length - 1) * AGORA_PARK_SPACING) / 2;
  for (let i = 0; i < park.length; i++) {
    const lat = park.length === 1 ? 0 : i * AGORA_PARK_SPACING - parkHalf;
    spawnOffset(w, owner, park[i], baseX, baseZ, fX, fZ, rX, rZ, -AGORA_PARK_BACK, lat);
  }

  let forward = AGORA_ARMY_FORWARD;
  for (const role of ['front', 'mid', 'rear']) {
    const types = typesMatching(layout, (t) => agoraCampRole(t) === role);
    const rows = spawnRanks(w, owner, types, baseX, baseZ, fX, fZ, rX, rZ, forward);
    if (rows) forward += rows * AGORA_RANK_SPACING;
  }
}

function kothInfantryRole(type) {
  if (type === UNIT.WARRIOR || type === UNIT.MONK) return 'front';
  if (type === UNIT.ARCHER || type === UNIT.MYCO) return 'mid';
  if (type === UNIT.DIRIGIBLE || type === UNIT.APC) return 'flank';
  return 'rear';
}

function peelTypes(types, pred) {
  const keep = [];
  const take = [];
  for (const t of types) (pred(t) ? take : keep).push(t);
  return { keep, take };
}

/** Place `extras` evenly along `core`, pinning the first/last extra to the ends. */
function sprinkleEnds(core, extras) {
  if (!extras.length) return core.slice();
  if (!core.length) return extras.slice();
  const total = core.length + extras.length;
  const extraAt = new Set();
  if (extras.length === 1) extraAt.add((total / 2) | 0);
  else {
    for (let i = 0; i < extras.length; i++) {
      extraAt.add(Math.round((i * (total - 1)) / (extras.length - 1)));
    }
  }
  const out = [];
  let e = 0;
  let c = 0;
  for (let i = 0; i < total; i++) {
    if (extraAt.has(i) && e < extras.length) out.push(extras[e++]);
    else if (c < core.length) out.push(core[c++]);
    else if (e < extras.length) out.push(extras[e++]);
  }
  return out;
}

function nestCenter(wings, center) {
  if (!center.length) return wings.slice();
  if (!wings.length) return center.slice();
  const left = wings.slice(0, Math.ceil(wings.length / 2));
  return [...left, ...center, ...wings.slice(left.length)];
}

function arrangeKothFront(types) {
  const { keep, take } = peelTypes(types, (t) => t === UNIT.MONK);
  return sprinkleEnds(keep, take);
}

function arrangeKothMid(types) {
  const { keep, take } = peelTypes(types, (t) => t === UNIT.MYCO);
  return sprinkleEnds(keep, take);
}

function arrangeKothRear(types) {
  const { keep, take } = peelTypes(types, (t) => t === UNIT.PRIEST);
  return nestCenter(keep, take);
}

/**
 * Combat ranks facing the hill: melee screen, missile line, casters behind,
 * dirigible on the left flank and APC on the right.
 */
function spawnKothFormation(w, owner, baseX, baseZ, layout) {
  const { fX, fZ, rX, rZ } = facingCenter(baseX, baseZ);
  const front = arrangeKothFront(typesMatching(layout, (t) => kothInfantryRole(t) === 'front'));
  const mid = arrangeKothMid(typesMatching(layout, (t) => kothInfantryRole(t) === 'mid'));
  const rear = arrangeKothRear(typesMatching(layout, (t) => kothInfantryRole(t) === 'rear'));
  // Closest to the spawn first, so melee ends nearest the hill.
  const ranks = [rear, mid, front].filter((rank) => rank.length);

  let forward = KOTH_FRONT_FORWARD;
  let maxHalf = 0;
  for (const rank of ranks) {
    spawnRank(w, owner, rank, baseX, baseZ, fX, fZ, rX, rZ, forward, KOTH_FILE_SPACING);
    maxHalf = Math.max(maxHalf, ((rank.length - 1) * KOTH_FILE_SPACING) / 2);
    forward += KOTH_RANK_SPACING;
  }

  const dirigibles = typesMatching(layout, (t) => t === UNIT.DIRIGIBLE);
  const apcs = typesMatching(layout, (t) => t === UNIT.APC);
  const midRank = ranks.length > 2 ? 1 : 0;
  const flankFwd = KOTH_FRONT_FORWARD + KOTH_RANK_SPACING * midRank;
  const flankLat = maxHalf + KOTH_FLANK_PAD;
  for (let i = 0; i < dirigibles.length; i++) {
    spawnOffset(
      w, owner, dirigibles[i], baseX, baseZ, fX, fZ, rX, rZ,
      flankFwd, -(flankLat + i * KOTH_FLANK_PAD),
    );
  }
  for (let i = 0; i < apcs.length; i++) {
    spawnOffset(
      w, owner, apcs[i], baseX, baseZ, fX, fZ, rX, rZ,
      flankFwd, flankLat + i * KOTH_FLANK_PAD,
    );
  }
}

/** One of every placeable building behind the agora (staging showcase). */
function spawnStagingBuildings(w, owner, baseX, baseZ) {
  if (!w.buildings) w.buildings = [];
  const len = Math.hypot(baseX, baseZ) || 1;
  const fX = -baseX / len;
  const fZ = -baseZ / len;
  const rX = -fZ;
  const rZ = fX;
  const halfLat = ((BUILDING_COLS - 1) * BUILDING_SPACING) / 2;

  for (let i = 0; i < PLACEABLE_BUILDINGS.length; i++) {
    const type = PLACEABLE_BUILDINGS[i].id;
    const c = i % BUILDING_COLS;
    const r = (i / BUILDING_COLS) | 0;
    const lat = c * BUILDING_SPACING - halfLat;
    const back = BUILDING_BACK + r * BUILDING_SPACING;
    const wx = baseX + rX * lat - fX * back;
    const wz = baseZ + rZ * lat - fZ * back;
    const snapped = snapBuildingWorld(type, fx.fromFloat(wx), fx.fromFloat(wz));
    w.buildings.push(
      createBuilding({
        owner: owner | 0,
        type,
        x: fx.toFloat(snapped.x),
        z: fx.toFloat(snapped.z),
        yaw: 0,
      }),
    );
  }
  w.buildingsDirty = 1;
}

/** Pack a typed layout in a square grid (large `?army=` counts). */
function spawnArmyPacked(w, layout, owner, baseX, baseZ) {
  const total = layout.reduce((s, c) => s + c.count, 0);
  const types = [];
  for (const col of layout) {
    for (let i = 0; i < col.count; i++) types.push(col.type);
  }
  spawnStressSide(w, owner, baseX, baseZ, total, (k) => types[k]);
}

function bestKothSpawnPoint(w, slot, bases) {
  const fallback = bases[slot] ?? bases[0];
  const candidates = [];
  for (const base of bases) candidates.push(base);
  const half = activeWorldHalfF();
  const radius = half * 0.875;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    candidates.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }

  let best = fallback;
  let bestScore = -1;
  for (const c of candidates) {
    const score = spawnClearanceScore(w, c[0], c[1], slot, bases);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function spawnClearanceScore(w, x, z, owner, bases) {
  let nearest = 0x7fffffff;
  for (const base of bases) {
    const dx = x - base[0];
    const dz = z - base[1];
    nearest = Math.min(nearest, dx * dx + dz * dz);
  }
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] === owner) continue;
    const ux = fx.toFloat(w.px[i]);
    const uz = fx.toFloat(w.py[i]);
    const dx = x - ux;
    const dz = z - uz;
    nearest = Math.min(nearest, dx * dx + dz * dz);
  }
  return nearest;
}

/** Mid-angle of pie slice `i` — player 0 faces west, then CCW. */
export function stressSliceMidAngle(slice) {
  return Math.PI + (slice | 0) * ((Math.PI * 2) / STRESS_ARMY_COUNT);
}

function stressUsableAngle() {
  return ((Math.PI * 2) / STRESS_ARMY_COUNT) * (1 - STRESS_SLICE_GAP_FRAC);
}

function stressRankCount(radius, usableAngle, spacing) {
  const arc = Math.max(0, radius) * usableAngle;
  return Math.max(1, Math.floor(arc / spacing) + 1);
}

function stressCombatFits(count, innerR, maxR, usable, spacing) {
  const supportN = Math.min(STRESS_SUPPORT_TYPES.length, count);
  const monks = Math.min(
    stressRankCount(innerR, usable, spacing),
    Math.max(0, count - supportN),
  );
  let left = count - supportN - monks;
  let r = innerR + spacing;
  while (left > 0) {
    if (r > maxR + 1e-6) return false;
    const n = Math.min(left, stressRankCount(r, usable, spacing));
    left -= n;
    r += spacing;
  }
  return true;
}

function stressRingSpacing(count, half) {
  const innerR = half * STRESS_RING_INNER_FRAC;
  const maxR = half * STRESS_MAX_RADIUS_FRAC - STRESS_SUPPORT_BACK;
  const usable = stressUsableAngle();
  for (let spacing = STRESS_RING_SPACING_MAX; spacing >= STRESS_RING_SPACING_MIN; spacing--) {
    if (stressCombatFits(count, innerR, maxR, usable, spacing)) return spacing;
  }
  return STRESS_RING_SPACING_MIN;
}

function spawnAlongArc(w, owner, midAngle, usable, radius, n, typeAt) {
  if (n <= 0) return;
  const halfSpan = usable / 2;
  const lim = activeWorldHalfF() * 0.96;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = midAngle - halfSpan + t * usable;
    const wx = Math.max(-lim, Math.min(lim, Math.cos(a) * radius));
    const wz = Math.max(-lim, Math.min(lim, Math.sin(a) * radius));
    spawn(w, {
      x: fx.fromFloat(wx),
      y: fx.fromFloat(wz),
      type: typeAt(i),
      owner,
    });
  }
}

/**
 * One 72° pie slice: inner monk rank, combat mass outward, support parked behind.
 */
function spawnStressPieSlice(w, owner, slice, count) {
  const half = activeWorldHalfF();
  const innerR = half * STRESS_RING_INNER_FRAC;
  const usable = stressUsableAngle();
  const mid = stressSliceMidAngle(slice);
  const spacing = stressRingSpacing(count, half);
  const supportN = Math.min(STRESS_SUPPORT_TYPES.length, count);
  const monks = Math.min(stressRankCount(innerR, usable, spacing), count - supportN);
  const combat = count - supportN - monks;

  spawnAlongArc(w, owner, mid, usable, innerR, monks, () => UNIT.MONK);

  let r = innerR + spacing;
  let placed = 0;
  let combatK = 0;
  while (placed < combat) {
    const n = Math.min(combat - placed, stressRankCount(r, usable, spacing));
    const base = combatK;
    spawnAlongArc(w, owner, mid, usable, r, n, (i) => (
      STRESS_COMBAT_TYPES[(base + i) % STRESS_COMBAT_TYPES.length]
    ));
    combatK += n;
    placed += n;
    r += spacing;
  }

  const supportR = (combat > 0 || monks > 0 ? r - spacing : innerR) + STRESS_SUPPORT_BACK;
  const supportSpan = supportN <= 1
    ? 0
    : (supportN - 1) * STRESS_SUPPORT_SPACING / Math.max(supportR, 1);
  spawnAlongArc(w, owner, mid, supportSpan, supportR, supportN, (i) => STRESS_SUPPORT_TYPES[i]);
}

/** Points covering the hollow center so scenery stays out of the arena. */
export function stressReservedPoints(worldHalfF = activeWorldHalfF()) {
  const innerR = worldHalfF * STRESS_RING_INNER_FRAC;
  const step = 20;
  const points = [[0, 0]];
  for (let r = step; r <= innerR + 8; r += step) {
    const n = Math.max(6, Math.ceil((Math.PI * 2 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return points;
}

/** Pack `count` units in a square grid centered on (baseX, baseZ). */
function spawnStressSide(w, owner, baseX, baseZ, count, typePicker) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  // Fit each army block inside ~42% of board half so two facing sides + gap stay in-bounds.
  const maxExtent = activeWorldHalfF() * 0.42;
  const spacing = Math.max(
    STRESS_SPACING_MIN,
    Math.min(STRESS_SPACING_MAX, (maxExtent * 2) / Math.max(1, cols - 1)),
  );
  const halfX = ((cols - 1) * spacing) / 2;
  const halfZ = ((rows - 1) * spacing) / 2;
  for (let k = 0; k < count; k++) {
    const col = k % cols;
    const row = (k / cols) | 0;
    spawn(w, {
      x: fx.fromFloat(baseX + col * spacing - halfX),
      y: fx.fromFloat(baseZ + row * spacing - halfZ),
      type: typePicker(k),
      owner,
    });
  }
}

/**
 * @param {{ seed: number, stressPerSide?: number, animStressPerSide?: number, armyPerSide?: number, mode?: 'legacy' | 'staging' | 'sandbox' | 'koth' | 'skirmish', activeSlots?: number[], mapW?: number, mapH?: number, skipDefaultSpawns?: boolean, teamByOwner?: ArrayLike<number> | null, laneBases?: boolean, agoraOccupyEndsMatch?: number, homeAgoras?: boolean }} config
 */
export function buildWorldFromConfig({
  seed,
  stressPerSide,
  animStressPerSide,
  armyPerSide = 0,
  mode = 'legacy',
  activeSlots,
  mapW,
  mapH,
  skipDefaultSpawns = false,
  teamByOwner = null,
  laneBases: useLaneBases = false,
  agoraOccupyEndsMatch,
  homeAgoras = false,
}) {
  setArmyPerSide(armyPerSide);
  const size = mapSizeForConfig({ stressPerSide, animStressPerSide, armyPerSide, mapW, mapH });
  setActiveMapSize(size.mapW, size.mapH);
  const half = worldHalfFFromMap(size.mapW);
  const bases = spawnBases(half, { laneBases: useLaneBases, mapW: size.mapW });

  const w = createWorld(seed);
  w.kothMatchOver = 0;
  w.matchWinner = -1;
  w.agoraOccupyEndsMatch = agoraOccupyEndsMatch != null
    ? agoraOccupyEndsMatch | 0
    : (mode === 'koth' ? 0 : 1);
  w.agoras = [];
  w.buildings = [];
  w.buildingsDirty = 0;
  w.mapW = size.mapW;
  w.mapH = size.mapH;
  w.worldHalfF = half;
  w.armyPerSide = _armyPerSide;

  // Default FFA until a mode opts into alliances via setTeamAssignments.
  setTeamAssignments(teamByOwner);

  if (skipDefaultSpawns) {
    if (mode === 'koth') {
      const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
      w.koth = createKothMeta(slots);
    }
    return w;
  }

  if (animStressPerSide > 0) {
    const count = Math.min(Math.floor(animStressPerSide), STRESS_ENTITY_LIMIT >> 1);
    const bx = half * 0.35;
    spawnStressSide(w, PLAYER, -bx, 0, count, () => UNIT.VILLAGER);
    spawnStressSide(w, AI_OWNER, bx, 0, count, () => UNIT.VILLAGER);
    return w;
  }

  if (stressPerSide > 0) {
    const perArmyCap = (STRESS_ENTITY_LIMIT / STRESS_ARMY_COUNT) | 0;
    const count = Math.min(Math.floor(stressPerSide), perArmyCap);
    // Player + 4 AIs in a 5-slice pie ring around the center.
    for (let slice = 0; slice < STRESS_ARMY_COUNT; slice++) {
      spawnStressPieSlice(w, slice, slice, count);
    }
    return w;
  }

  // Private boot field (renamed from sandbox).
  if (mode === 'staging' || mode === 'sandbox') {
    if (activeSlots && activeSlots.length === 0) return w;
    const [px, pz] = bases[0];
    const [ax, az] = bases[1];
    w.agoras = createAgoras([
      { owner: PLAYER, x: px, z: pz },
      { owner: AI_OWNER, x: ax, z: az },
    ]);
    spawnStagingBuildings(w, PLAYER, px, pz);
    if (_armyPerSide > 0) {
      spawnArmyOriented(w, scaledArmyLayout(_armyPerSide), PLAYER, px, pz, ARMY_FORWARD);
    } else {
      spawnArmyOriented(w, PLAYER_ARMY, PLAYER, px, pz, ARMY_FORWARD);
    }
    spawnVillagersAround(w, AI_OWNER, ax, az, STAGING_AI_VILLAGERS);
    grantStartingResources(w, PLAYER);
    grantStartingResources(w, AI_OWNER);
    return w;
  }

  // Skirmish — a real 1v1 opening: each side gets an agora and a few villagers,
  // no army, no building showcase, and no KOTH center plinth / scoring.
  if (mode === 'skirmish') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    const agoraSpecs = [];
    for (const slot of slots) {
      const [bx, bz] = bases[slot] ?? bases[0];
      agoraSpecs.push({ owner: slot, x: bx, z: bz });
      spawnVillagersAround(w, slot, bx, bz, SKIRMISH_START_VILLAGERS);
      grantStartingResources(w, slot);
    }
    w.agoras = createAgoras(agoraSpecs);
    return w;
  }

  if (mode === 'koth') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    const agoraSpecs = [];
    for (const slot of slots) {
      const base = bases[slot] ?? bases[0];
      if (homeAgoras) {
        agoraSpecs.push({ owner: slot, x: base[0], z: base[1] });
        spawnConfiguredArmyAtAgora(w, slot, base[0], base[1]);
      } else {
        spawnConfiguredKothArmy(w, slot, base[0], base[1]);
      }
      grantStartingResources(w, slot);
    }
    if (homeAgoras) w.agoras = createAgoras(agoraSpecs);
    w.koth = createKothMeta(slots);
    return w;
  }

  spawnConfiguredArmy(w, PLAYER, bases[0][0], bases[0][1]);
  if (_armyPerSide > 0) {
    spawnConfiguredArmy(w, AI_OWNER, bases[1][0], bases[1][1]);
  } else {
    spawnArmy(w, ENEMY_ARMY, AI_OWNER, bases[1][0], bases[1][1]);
  }
  grantStartingResources(w, PLAYER);
  grantStartingResources(w, AI_OWNER);
  return w;
}
