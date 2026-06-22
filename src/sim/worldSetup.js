// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { createKothMeta } from './kothMeta.js';
import * as fx from './fixed.js';

export const PLAYER = 0;
export const AI_OWNER = 1;

/** Pentagonal spawn bases for KOTH slots 0–4 (world units). */
export const KOTH_BASES = [
  [-120, 0],
  [120, 0],
  [0, -120],
  [0, 120],
  [-85, 85],
];

const PLAYER_ARMY = [
  { type: UNIT.WARRIOR, count: 10 },
  { type: UNIT.ARCHER, count: 8 },
  { type: UNIT.SPEARMAN, count: 6 },
  { type: UNIT.SCOUT, count: 4 },
  { type: UNIT.CAVALRY, count: 4 },
];

const ENEMY_ARMY = [
  { type: UNIT.WARRIOR, count: 10 },
  { type: UNIT.ARCHER, count: 8 },
  { type: UNIT.SPEARMAN, count: 6 },
  { type: UNIT.CAVALRY, count: 4 },
];

const COL_SPACING = 22;
const ROW_SPACING = 16;
const STRESS_TYPES = [UNIT.WARRIOR, UNIT.ARCHER, UNIT.SPEARMAN, UNIT.SCOUT, UNIT.CAVALRY];

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
  const base = KOTH_BASES[slot] ?? KOTH_BASES[0];
  spawnArmy(w, ENEMY_ARMY, slot, base[0], base[1]);
}

export function stressPerSideFromSearch(search = '') {
  const n = parseInt(new URLSearchParams(search).get('stress') || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 4000);
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

function spawnStressSide(w, owner, baseX, baseZ, count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacing = 5;
  for (let k = 0; k < count; k++) {
    const col = k % cols;
    const row = (k / cols) | 0;
    spawn(w, {
      x: fx.fromFloat(baseX + (col - (cols - 1) / 2) * spacing),
      y: fx.fromFloat(baseZ + (row - (rows - 1) / 2) * spacing),
      type: STRESS_TYPES[k % STRESS_TYPES.length],
      owner,
    });
  }
}

/**
 * @param {{ seed: number, stressPerSide?: number, mode?: 'legacy' | 'sandbox' | 'koth', activeSlots?: number[] }} config
 */
export function buildWorldFromConfig({ seed, stressPerSide, mode = 'legacy', activeSlots }) {
  const w = createWorld(seed);
  w.kothMatchOver = 0;

  if (stressPerSide > 0) {
    spawnStressSide(w, PLAYER, -175, -50, stressPerSide);
    spawnStressSide(w, AI_OWNER, 175, 50, stressPerSide);
    return w;
  }

  if (mode === 'sandbox') {
    const [bx, bz] = KOTH_BASES[0];
    spawnArmy(w, PLAYER_ARMY, PLAYER, bx, bz);
    return w;
  }

  if (mode === 'koth') {
    const slots = activeSlots?.length ? activeSlots : [PLAYER, AI_OWNER];
    for (const slot of slots) {
      const base = KOTH_BASES[slot] ?? KOTH_BASES[0];
      const army = slot === PLAYER ? PLAYER_ARMY : ENEMY_ARMY;
      spawnArmy(w, army, slot, base[0], base[1]);
    }
    w.koth = createKothMeta(slots);
    return w;
  }

  spawnArmy(w, PLAYER_ARMY, PLAYER, -120, 0);
  spawnArmy(w, ENEMY_ARMY, AI_OWNER, 120, 0);
  return w;
}
