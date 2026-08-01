// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn, STRESS_ENTITY_LIMIT } from './world.js';
import { UNIT } from './unitTypes.js';
import { createKothMeta } from './kothMeta.js';
import { WORLD_HALF_F } from './field.js';
import * as fx from './fixed.js';

export const PLAYER = 0;
export const AI_OWNER = 1;

/** Pentagonal spawn bases for KOTH slots 0–4 (world units; scale with board). */
const H = WORLD_HALF_F;
export const KOTH_BASES = [
  [-H * 0.6, 0],
  [H * 0.6, 0],
  [0, -H * 0.6],
  [0, H * 0.6],
  [-H * 0.425, H * 0.425],
];

const PLAYER_ARMY = [
  { type: UNIT.VILLAGER, count: 5 },
  { type: UNIT.WARRIOR, count: 8 },
  { type: UNIT.ARCHER, count: 6 },
  { type: UNIT.WARLOCK, count: 3 },
  { type: UNIT.PRIEST, count: 2 },
  { type: UNIT.MYCO, count: 2 },
  { type: UNIT.SHAMAN, count: 2 },
];

const ENEMY_ARMY = [
  { type: UNIT.VILLAGER, count: 5 },
  { type: UNIT.WARRIOR, count: 8 },
  { type: UNIT.ARCHER, count: 6 },
  { type: UNIT.WARLOCK, count: 3 },
  { type: UNIT.PRIEST, count: 2 },
  { type: UNIT.MYCO, count: 2 },
  { type: UNIT.SHAMAN, count: 2 },
];

const COL_SPACING = 22;
const ROW_SPACING = 16;
/** Stress uses military types only (thin-instanced). Animated villagers: ?animStress=N. */
const STRESS_TYPES = [UNIT.WARRIOR, UNIT.ARCHER, UNIT.WARLOCK];
const STRESS_SPACING = 10;

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
  const base = bestKothSpawnPoint(w, slot);
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

function bestKothSpawnPoint(w, slot) {
  const fallback = KOTH_BASES[slot] ?? KOTH_BASES[0];
  const candidates = [];
  for (const base of KOTH_BASES) candidates.push(base);
  const radius = WORLD_HALF_F * 0.875;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    candidates.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }

  let best = fallback;
  let bestScore = -1;
  for (const c of candidates) {
    const score = spawnClearanceScore(w, c[0], c[1], slot);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function spawnClearanceScore(w, x, z, owner) {
  let nearest = 0x7fffffff;
  for (const base of KOTH_BASES) {
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
  const halfX = ((cols - 1) * STRESS_SPACING) / 2;
  const halfZ = ((rows - 1) * STRESS_SPACING) / 2;
  for (let k = 0; k < count; k++) {
    const col = k % cols;
    const row = (k / cols) | 0;
    spawn(w, {
      x: fx.fromFloat(baseX + col * STRESS_SPACING - halfX),
      y: fx.fromFloat(baseZ + row * STRESS_SPACING - halfZ),
      type: typePicker(k),
      owner,
    });
  }
}

/**
 * @param {{ seed: number, stressPerSide?: number, animStressPerSide?: number, mode?: 'legacy' | 'sandbox' | 'koth', activeSlots?: number[] }} config
 */
export function buildWorldFromConfig({ seed, stressPerSide, animStressPerSide, mode = 'legacy', activeSlots }) {
  const w = createWorld(seed);
  w.kothMatchOver = 0;

  if (animStressPerSide > 0) {
    const count = Math.min(Math.floor(animStressPerSide), STRESS_ENTITY_LIMIT >> 1);
    const bx = WORLD_HALF_F * 0.3;
    spawnStressSide(w, PLAYER, -bx, 0, count, () => UNIT.VILLAGER);
    spawnStressSide(w, AI_OWNER, bx, 0, count, () => UNIT.VILLAGER);
    return w;
  }

  if (stressPerSide > 0) {
    const count = Math.min(Math.floor(stressPerSide), STRESS_ENTITY_LIMIT >> 1);
    // Two facing blocks near the usual west/east bases — not sprayed across the map.
    const bx = WORLD_HALF_F * 0.3;
    spawnStressSide(w, PLAYER, -bx, 0, count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
    spawnStressSide(w, AI_OWNER, bx, 0, count, (k) => STRESS_TYPES[k % STRESS_TYPES.length]);
    return w;
  }

  if (mode === 'sandbox') {
    if (activeSlots && activeSlots.length === 0) return w;
    const [bx, bz] = KOTH_BASES[0];
    spawnArmy(w, PLAYER_ARMY, PLAYER, bx, bz);
    return w;
  }

  if (mode === 'koth') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    for (const slot of slots) {
      const base = KOTH_BASES[slot] ?? KOTH_BASES[0];
      spawnArmy(w, PLAYER_ARMY, slot, base[0], base[1]);
    }
    w.koth = createKothMeta(slots);
    return w;
  }

  spawnArmy(w, PLAYER_ARMY, PLAYER, KOTH_BASES[0][0], KOTH_BASES[0][1]);
  spawnArmy(w, ENEMY_ARMY, AI_OWNER, KOTH_BASES[1][0], KOTH_BASES[1][1]);
  return w;
}
