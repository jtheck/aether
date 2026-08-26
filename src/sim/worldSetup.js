// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn, STRESS_ENTITY_LIMIT } from './world.js';
import { UNIT, UNIT_DEFS, isTransport } from './unitTypes.js';
import { createKothMeta } from './kothMeta.js';
import { createAgoras } from './agora.js';
import {
  PLACEABLE_BUILDINGS,
  createBuilding,
  snapBuildingWorld,
} from './buildings.js';
import {
  WORLD_HALF_F,
  activeWorldHalfF,
  mapSizeForConfig,
  setActiveMapSize,
  worldHalfFFromMap,
} from './field.js';
import { setTeamAssignments } from './teams.js';
import * as fx from './fixed.js';

/** Staging AI cold start. */
const STAGING_AI_VILLAGERS = 5;
/** Army block sits this far toward map center from the agora. */
const ARMY_FORWARD = 36;
/** Building showcase sits this far behind the agora (away from army). */
const BUILDING_BACK = 40;
const BUILDING_SPACING = 36;
const BUILDING_COLS = 5;

export const PLAYER = 0;
export const AI_OWNER = 1;

/** Stress FFA AI owners (player is always 0). */
export const STRESS_AI_OWNERS = [1, 2, 3, 4];
export const STRESS_ARMY_COUNT = 1 + STRESS_AI_OWNERS.length;

/** Pentagonal spawn bases — scale with the active board half-extent. */
export function kothBases(worldHalfF = activeWorldHalfF()) {
  const H = worldHalfF;
  return [
    [-H * 0.6, 0],
    [H * 0.6, 0],
    [0, -H * 0.6],
    [0, H * 0.6],
    [-H * 0.425, H * 0.425],
  ];
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

const COL_SPACING = 22;
const ROW_SPACING = 16;

/** Relative stress mix: baseline 10, casters 5, transports/vehicles 1. */
function stressTypeWeight(def) {
  if (isTransport(def.id)) return 1;
  if (def.primaryAbility) return 5;
  return 10;
}

/** Weighted bag cycled under `?stress=N`. VAT villagers: `?animStress=N`. */
const STRESS_TYPES = [];
for (const def of UNIT_DEFS) {
  const weight = stressTypeWeight(def);
  for (let i = 0; i < weight; i++) STRESS_TYPES.push(def.id);
}

/** Soft cap on stress packing; shrinks automatically so both armies fit the board. */
const STRESS_SPACING_MAX = 14;
const STRESS_SPACING_MIN = 4;

export { PLAYER_ARMY, ENEMY_ARMY };

export const UNITS_PER_ARMY = PLAYER_ARMY.reduce((s, c) => s + c.count, 0);
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

/** Scale the default mix so counts sum to `n` (deterministic). */
export function scaledArmyLayout(n) {
  const target = Math.max(1, n | 0);
  if (target === UNITS_PER_ARMY) {
    return PLAYER_ARMY.map((c) => ({ type: c.type, count: c.count }));
  }
  const layout = PLAYER_ARMY.map((c) => ({
    type: c.type,
    count: Math.floor((c.count * target) / UNITS_PER_ARMY),
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

/** Spawn one army — default layout, or packed scaled mix when armyPerSide > 0. */
function spawnConfiguredArmy(w, owner, baseX, baseZ) {
  if (_armyPerSide > 0) {
    spawnArmyPacked(w, scaledArmyLayout(_armyPerSide), owner, baseX, baseZ);
  } else {
    spawnArmy(w, PLAYER_ARMY, owner, baseX, baseZ);
  }
}

/** Spawn one KOTH army at a slot base (mid-game join). */
export function spawnKothSlot(w, slot) {
  const bases = kothBases(w.worldHalfF ?? activeWorldHalfF());
  const base = bestKothSpawnPoint(w, slot, bases);
  spawnConfiguredArmy(w, slot, base[0], base[1]);
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
  const radius = 16;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 2 + 0.35;
    spawn(w, {
      x: fx.fromFloat(baseX + Math.cos(a) * radius),
      y: fx.fromFloat(baseZ + Math.sin(a) * radius),
      type: UNIT.VILLAGER,
      owner,
    });
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
 * @param {{ seed: number, stressPerSide?: number, animStressPerSide?: number, armyPerSide?: number, mode?: 'legacy' | 'staging' | 'sandbox' | 'koth', activeSlots?: number[], mapW?: number, mapH?: number, skipDefaultSpawns?: boolean }} config
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
}) {
  setArmyPerSide(armyPerSide);
  const size = mapSizeForConfig({ stressPerSide, animStressPerSide, armyPerSide, mapW, mapH });
  setActiveMapSize(size.mapW, size.mapH);
  const half = worldHalfFFromMap(size.mapW);
  const bases = kothBases(half);

  const w = createWorld(seed);
  w.kothMatchOver = 0;
  w.matchWinner = -1;
  w.agoras = [];
  w.buildings = [];
  w.buildingsDirty = 0;
  w.mapW = size.mapW;
  w.mapH = size.mapH;
  w.worldHalfF = half;
  w.armyPerSide = _armyPerSide;

  // Default FFA until a mode opts into alliances via setTeamAssignments.
  setTeamAssignments(null);

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
    // Player + 4 AIs at pentagon bases — FFA stress load.
    spawnStressSide(w, PLAYER, bases[0][0], bases[0][1], count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
    for (let s = 0; s < STRESS_AI_OWNERS.length; s++) {
      const owner = STRESS_AI_OWNERS[s];
      const base = bases[owner] ?? bases[1];
      spawnStressSide(w, owner, base[0], base[1], count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
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
    return w;
  }

  if (mode === 'koth') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    for (const slot of slots) {
      const base = bases[slot] ?? bases[0];
      spawnConfiguredArmy(w, slot, base[0], base[1]);
    }
    w.koth = createKothMeta(slots);
    return w;
  }

  spawnConfiguredArmy(w, PLAYER, bases[0][0], bases[0][1]);
  if (_armyPerSide > 0) {
    spawnConfiguredArmy(w, AI_OWNER, bases[1][0], bases[1][1]);
  } else {
    spawnArmy(w, ENEMY_ARMY, AI_OWNER, bases[1][0], bases[1][1]);
  }
  return w;
}
