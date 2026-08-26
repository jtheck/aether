// Local tile window + occupancy class for the placement ghost overlay.
// Render-only math — sim still owns canPlaceBuildingAt.

import { buildingFootprintBounds } from '../sim/buildings.js';

/** Tiles of context around the claim. */
export const PLACEMENT_GRID_PAD = 2;

/**
 * Inclusive-exclusive tile window around a snapped placement.
 * @param {string} typeId
 * @param {number} xFixed
 * @param {number} zFixed
 * @param {number} [pad]
 * @returns {{
 *   x0: number, z0: number, x1: number, z1: number,
 *   claimX0: number, claimZ0: number, claimX1: number, claimZ1: number,
 * } | null}
 */
export function placementGridWindow(typeId, xFixed, zFixed, pad = PLACEMENT_GRID_PAD) {
  const b = buildingFootprintBounds(typeId, xFixed, zFixed);
  if (!b) return null;
  const p = Math.max(0, pad | 0);
  return {
    x0: b.x0 - p,
    z0: b.z0 - p,
    x1: b.x0 + b.w + p,
    z1: b.z0 + b.h + p,
    claimX0: b.x0,
    claimZ0: b.z0,
    claimX1: b.x0 + b.w,
    claimZ1: b.z0 + b.h,
  };
}

/**
 * G-grid occupancy class for one tile.
 * @param {object} field
 * @param {number} tx
 * @param {number} tz
 * @returns {'blocked' | 'structure' | 'slow' | 'clear' | null}
 */
export function classifyGridTile(field, tx, tz) {
  const w = field?.width | 0;
  const h = field?.height | 0;
  if (!field?.pass || tx < 0 || tz < 0 || tx >= w || tz >= h) return null;
  const i = tz * w + tx;
  if (field.activeMask && field.activeMask[i] === 0) return null;
  if (field.pass[i] === 0) return 'blocked';
  if (field.structureSlowMask?.[i]) return 'structure';
  if (field.slowMask?.[i]) return 'slow';
  return 'clear';
}

/**
 * Overlay fill. The claim follows the ghost silhouette: all green or all red.
 * Open pad tiles stay edges-only; pad blockers keep occupancy ink.
 * @param {'blocked' | 'structure' | 'slow' | 'clear' | null} kind
 * @param {number} tx
 * @param {number} tz
 * @param {{ claimX0: number, claimZ0: number, claimX1: number, claimZ1: number, valid?: boolean }} win
 * @returns {'blocked' | 'structure' | 'slow' | 'clear' | null}
 */
export function placementFillKind(kind, tx, tz, win) {
  if (!kind || !win) return null;
  if (tx >= win.claimX0 && tx < win.claimX1 && tz >= win.claimZ0 && tz < win.claimZ1) {
    return win.valid === false ? 'blocked' : 'clear';
  }
  if (kind === 'blocked' || kind === 'structure') return kind;
  return kind === 'slow' ? 'slow' : null;
}
