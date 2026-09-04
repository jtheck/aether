// Stressful Situation garden — 31-chunk table, pie-ring FFA, authored camera corral.
// Write with: node --input-type=module -e "import { writeFileSync } from 'fs'; import { buildStressGarden } from './sim/stressGarden.js'; const j=JSON.stringify(buildStressGarden()); writeFileSync('../maps/stress.garden', j); writeFileSync('maps/stress.garden', j);"

import {
  STRESS_CAMERA_HALF_F,
  STRESS_MAP_H,
  STRESS_MAP_W,
  activeMapH,
  activeMapW,
  createField,
  setActiveMapSize,
  worldToTile,
} from './field.js';
import { applyTableSilhouette } from './tableShape.js';
import { encodeGarden } from './garden.js';
import {
  STRESS_ARMY_COUNT,
  STRESS_MENU_PER_SIDE,
  buildWorldFromConfig,
} from './worldSetup.js';
import * as fx from './fixed.js';

export const STRESS_GARDEN_NAME = 'stressful situation';
export const STRESS_GARDEN_URL = '/maps/stress.garden';
export const STRESS_GARDEN_SEED = 0x57e55;

/**
 * Authored snapshot of the menu Stressful Situation board (v4 garden JSON).
 * Terrain is omitted so load regenerates from seed; units keep world coords.
 * @returns {ReturnType<typeof encodeGarden>}
 */
export function buildStressGarden() {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    return buildStressGardenInner();
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}

function buildStressGardenInner() {
  const field = createField(STRESS_GARDEN_SEED, { width: STRESS_MAP_W, height: STRESS_MAP_H });
  applyTableSilhouette(field);
  field.cameraHalfF = STRESS_CAMERA_HALF_F;

  const world = buildWorldFromConfig({
    seed: STRESS_GARDEN_SEED,
    stressPerSide: STRESS_MENU_PER_SIDE,
    mapW: STRESS_MAP_W,
    mapH: STRESS_MAP_H,
  });

  /** @type {{ owner: number, type: number, tx: number, tz: number, x: number, z: number }[]} */
  const units = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    const x = fx.toFloat(world.px[i]);
    const z = fx.toFloat(world.py[i]);
    units.push({
      owner: world.owner[i] | 0,
      type: world.type[i] | 0,
      tx: worldToTile(world.px[i]),
      tz: worldToTile(world.py[i]),
      x,
      z,
    });
  }

  return encodeGarden(field, {
    name: STRESS_GARDEN_NAME,
    cameraHalfF: STRESS_CAMERA_HALF_F,
    omitTerrain: true,
    units,
  });
}

export { STRESS_ARMY_COUNT, STRESS_MENU_PER_SIDE };
