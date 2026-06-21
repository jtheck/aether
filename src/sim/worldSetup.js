// Demo spawn layouts — used by the sim worker at init.

import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import * as fx from './fixed.js';

export const PLAYER = 0;
export const AI_OWNER = 1;

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

export function buildWorldFromConfig({ seed, stressPerSide }) {
  const w = createWorld(seed);
  if (stressPerSide > 0) {
    spawnStressSide(w, PLAYER, -175, -50, stressPerSide);
    spawnStressSide(w, AI_OWNER, 175, 50, stressPerSide);
  } else {
    spawnArmy(w, PLAYER_ARMY, PLAYER, -120, 0);
    spawnArmy(w, ENEMY_ARMY, AI_OWNER, 120, 0);
  }
  return w;
}
