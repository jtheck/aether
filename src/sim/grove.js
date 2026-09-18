// Finished groves slowly fatten living trees in a wide disc.
// Closer trees grow past the natural size/stock cap; the bonus fades at the rim
// so the stand reads as a mound. Existing trees only — no new plantings.

import { worldToTile } from './field.js';
import { buildingIsFinished, isBuildingAlive } from './buildings.js';
import {
  TREE_STOCK_GROVE_MAX,
  TREE_STOCK_NATURAL_MAX,
  addTreeStock,
} from './trees.js';

/** Tile radius from the grove center (~72 world units). */
export const GROVE_GROW_RADIUS_TILES = 18;
/** Ticks between +1 wood at the grove (~2s at 20Hz). */
export const GROVE_GROW_INTERVAL_NEAR = 40;
/** Ticks between +1 wood at the rim (~8s). */
export const GROVE_GROW_INTERVAL_FAR = 160;

const RADIUS = GROVE_GROW_RADIUS_TILES;
const RADIUS2 = RADIUS * RADIUS;

/**
 * Distance-faded stock cap. Center can reach grove giants; the rim stays at
 * the natural populate max. Integer (r² − d²) / r² so the sim stays deterministic.
 * @param {number} dist2 Chebyshev-free squared tile distance
 */
export function groveGrowCapForDist2(dist2) {
  const d2 = dist2 | 0;
  if (d2 > RADIUS2) return 0;
  const remain = RADIUS2 - d2;
  return TREE_STOCK_NATURAL_MAX
    + (((TREE_STOCK_GROVE_MAX - TREE_STOCK_NATURAL_MAX) * remain / RADIUS2) | 0);
}

/** Slower bites farther from the grove. */
export function groveGrowIntervalForDist2(dist2) {
  const d2 = Math.max(0, Math.min(RADIUS2, dist2 | 0));
  return Math.max(
    1,
    GROVE_GROW_INTERVAL_NEAR
      + (((GROVE_GROW_INTERVAL_FAR - GROVE_GROW_INTERVAL_NEAR) * d2 / RADIUS2) | 0),
  );
}

/**
 * Feed living trees around finished groves. Skips empty tiles and burning trees.
 * @param {object} w
 * @param {object} field
 */
export function groveGrowthSystem(w, field) {
  const buildings = w?.buildings;
  if (!buildings?.length || !field?.treeStock) return;

  const width = field.width | 0;
  const height = field.height | 0;
  const tick = w.tick | 0;
  const burn = field.treeBurn;

  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.type !== 'grove' || !buildingIsFinished(b) || !isBuildingAlive(b)) continue;
    const gx = worldToTile(b.x);
    const gz = worldToTile(b.z);

    for (let tz = gz - RADIUS; tz <= gz + RADIUS; tz++) {
      if (tz < 0 || tz >= height) continue;
      const row = tz * width;
      const dz = tz - gz;
      const dz2 = dz * dz;
      for (let tx = gx - RADIUS; tx <= gx + RADIUS; tx++) {
        if (tx < 0 || tx >= width) continue;
        const dx = tx - gx;
        const d2 = dx * dx + dz2;
        if (d2 > RADIUS2) continue;
        const ti = row + tx;
        if ((field.treeStock[ti] | 0) <= 0) continue;
        if (burn && (burn[ti] | 0) > 0) continue;
        const cap = groveGrowCapForDist2(d2);
        if (cap <= 0) continue;
        const interval = groveGrowIntervalForDist2(d2);
        if (((tick + ti) % interval) !== 0) continue;
        addTreeStock(field, ti, 1, cap);
      }
    }
  }
}
