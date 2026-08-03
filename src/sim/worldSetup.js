// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn, STRESS_ENTITY_LIMIT } from './world.js';
import { UNIT, UNIT_DEFS, isTransport } from './unitTypes.js';
import { createKothMeta } from './kothMeta.js';
import {
  WORLD_HALF_F,
  activeWorldHalfF,
  mapSizeForConfig,
  setActiveMapSize,
  worldHalfFFromMap,
} from './field.js';
import * as fx from './fixed.js';

export const PLAYER = 0;
export const AI_OWNER = 1;

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

/** Max thin-instance slots for a unit type across all KOTH slots. */
export function kothMaxUnitsOfType(typeId) {
  const entry = PLAYER_ARMY.find((u) => u.type === typeId);
  return entry ? entry.count * KOTH_MAX_SLOTS : 0;
}

/** Spawn one KOTH army at a slot base (mid-game join). */
export function spawnKothSlot(w, slot) {
  const bases = kothBases(w.worldHalfF ?? activeWorldHalfF());
  const base = bestKothSpawnPoint(w, slot, bases);
  spawnArmy(w, PLAYER_ARMY, slot, base[0], base[1]);
}

export function stressPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('stress') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, STRESS_ENTITY_LIMIT >> 1);
}

/** Per-side skinned villagers for render stress (`?animStress=32` → 64 total). */
export function animStressPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('animStress') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Same entity ceiling as ?stress= — GPU/skinning will die long before this.
  return Math.min(n, STRESS_ENTITY_LIMIT >> 1);
}

function spawnArmy(w, layout, owner, baseX, baseZ) {
  const cols = layout.length;
  const maxRows = Math.max(...layout.map((c) => c.count));
  const halfX = ((cols - 1) * COL_SPACING) / 2;
  const halfZ = ((maxRows - 1) * ROW_SPACING) / 2;

  for (let c = 0; c < layout.length; c++) {
    const col = layout[c];
    for (let r = 0; r < col.count; r++) {
      spawn(w, {
        x: fx.fromFloat(baseX + c * COL_SPACING - halfX),
        y: fx.fromFloat(baseZ + r * ROW_SPACING - halfZ),
        type: col.type,
        owner,
      });
    }
  }
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
 * @param {{ seed: number, stressPerSide?: number, animStressPerSide?: number, mode?: 'legacy' | 'sandbox' | 'koth', activeSlots?: number[], mapW?: number, mapH?: number }} config
 */
export function buildWorldFromConfig({
  seed,
  stressPerSide,
  animStressPerSide,
  mode = 'legacy',
  activeSlots,
  mapW,
  mapH,
}) {
  const size = mapSizeForConfig({ stressPerSide, animStressPerSide, mapW, mapH });
  setActiveMapSize(size.mapW, size.mapH);
  const half = worldHalfFFromMap(size.mapW);
  const bases = kothBases(half);

  const w = createWorld(seed);
  w.kothMatchOver = 0;
  w.mapW = size.mapW;
  w.mapH = size.mapH;
  w.worldHalfF = half;

  if (animStressPerSide > 0) {
    const count = Math.min(Math.floor(animStressPerSide), STRESS_ENTITY_LIMIT >> 1);
    const bx = half * 0.35;
    spawnStressSide(w, PLAYER, -bx, 0, count, () => UNIT.VILLAGER);
    spawnStressSide(w, AI_OWNER, bx, 0, count, () => UNIT.VILLAGER);
    return w;
  }

  if (stressPerSide > 0) {
    const count = Math.min(Math.floor(stressPerSide), STRESS_ENTITY_LIMIT >> 1);
    // Two facing blocks near the usual west/east bases — not sprayed across the map.
    const bx = half * 0.35;
    spawnStressSide(w, PLAYER, -bx, 0, count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
    spawnStressSide(w, AI_OWNER, bx, 0, count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
    return w;
  }

  if (mode === 'sandbox') {
    if (activeSlots && activeSlots.length === 0) return w;
    const [bx, bz] = bases[0];
    spawnArmy(w, PLAYER_ARMY, PLAYER, bx, bz);
    return w;
  }

  if (mode === 'koth') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    for (const slot of slots) {
      const base = bases[slot] ?? bases[0];
      spawnArmy(w, PLAYER_ARMY, slot, base[0], base[1]);
    }
    w.koth = createKothMeta(slots);
    return w;
  }

  spawnArmy(w, PLAYER_ARMY, PLAYER, bases[0][0], bases[0][1]);
  spawnArmy(w, ENEMY_ARMY, AI_OWNER, bases[1][0], bases[1][1]);
  return w;
}
