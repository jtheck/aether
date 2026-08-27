// Building construction — placed buildings start as inert sites (built = 0) and
// are raised by villagers. Mirrors the gather loop: a per-tick driver walks
// builders to the site and holds them in reach; progress accrues at the number
// of on-site builders (capped at MAX_BUILDERS) so two workers build twice as
// fast. A separate assign pass recruits up to MAX_BUILDERS villagers per site —
// nearest first, idle preferred, but it will pull gatherers from anywhere so a
// site never stalls for lack of hands. All state lives on the building object /
// SoA, so it stays deterministic and checkpoints cleanly.

import * as fx from './fixed.js';
import { ORDER } from './world.js';
import { queuePath, clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { snapToPassable, TILE_SIZE_F } from './field.js';
import { UNIT } from './unitTypes.js';
import { isCarried } from './transport.js';
import { getBuildingFootprint, applyStructureOccupancyAt } from './buildings.js';

/** Most villagers that can work a single site (also the progress-per-tick cap). */
export const MAX_BUILDERS = 2;
/** Re-scan cadence for builder recruitment (deterministic on world.tick). */
const ASSIGN_INTERVAL = 20;
/** Extra reach past the footprint edge so builders don't fight for the exact rim. */
const BUILD_MARGIN_F = 6;

/** Presence tally per building index, reused across ticks (sim thread only). */
let _present = new Int32Array(0);

/** Fixed-point reach² a builder must be within to work a site (footprint-aware). */
function buildReachSq(b) {
  const fp = getBuildingFootprint(b.type);
  const halfTiles = Math.max(fp?.w ?? 2, fp?.h ?? 2) / 2;
  const reach = fx.fromFloat(halfTiles * TILE_SIZE_F + BUILD_MARGIN_F);
  return fx.mul(reach, reach);
}

/** Put a villager on a BUILD order for a building index. Keeps any carried load. */
export function beginBuild(w, i, bi) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  w.order[i] = ORDER.BUILD;
  w.buildTarget[i] = bi | 0;
  w.gatherTile[i] = -1;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  w.targetEntity[i] = -1;
  w.transportTarget[i] = -1;
  w.hasTarget[i] = 0;
  clearEngagement(w, i);
  clearPath(w, i);
  return true;
}

function endBuild(w, i) {
  w.order[i] = ORDER.IDLE;
  w.buildTarget[i] = -1;
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
}

/** Repath toward a target only when it changed or no path is active. */
function seekTo(w, i, tx, ty) {
  if (
    w.navDestX[i] !== tx ||
    w.navDestY[i] !== ty ||
    (w.navWpCount[i] === 0 && w.pathRequest[i] === 0)
  ) {
    clearPath(w, i);
    queuePath(w, i, tx, ty);
  }
}

/**
 * Per-tick construction driver — one phase in step(), alongside gather. Walks
 * builders to their site, holds them in reach, and advances build progress.
 * @param {object} w
 * @param {object} field
 */
export function constructionSystem(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  if (_present.length < buildings.length) _present = new Int32Array(buildings.length);
  else _present.fill(0, 0, buildings.length);

  // Drive each builder + tally who is on-site.
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.order[i] !== ORDER.BUILD) continue;
    const bi = w.buildTarget[i];
    const b = bi >= 0 && bi < buildings.length ? buildings[bi] : null;
    // Only explicit sites (built === 0) are under construction; undefined = done.
    if (!b || b.built !== 0 || w.type[i] !== UNIT.VILLAGER || w.owner[i] !== b.owner) {
      endBuild(w, i);
      continue;
    }
    if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= buildReachSq(b)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      _present[bi]++;
    } else {
      const spot = snapToPassable(field, b.x, b.z);
      seekTo(w, i, spot ? spot.x : b.x, spot ? spot.y : b.z);
    }
  }

  // Accrue progress (capped) and finish sites that reach their build time.
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.built !== 0) continue;
    const n = _present[bi];
    if (n <= 0) continue;
    b.buildProgress = (b.buildProgress | 0) + Math.min(n, MAX_BUILDERS);
    if (b.buildProgress >= (b.buildTime | 0)) {
      b.buildProgress = b.buildTime | 0;
      b.built = 1;
      // Turn on the finished building's live effects (e.g. farm food node).
      if (field) applyStructureOccupancyAt(field, b.type, b.x, b.z, /* built */ true);
      w.buildingsDirty = 1;
    }
  }
}

/** Rank key for a build candidate: idle beats gathering, then nearest, then id. */
function candidateEligible(w, i, owner) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER || w.owner[i] !== owner) return false;
  if (isCarried(w, i)) return false;
  const order = w.order[i];
  return order === ORDER.IDLE || order === ORDER.GATHER;
}

/**
 * Recruit up to MAX_BUILDERS villagers per unfinished site. Nearest first, idle
 * preferred; will pull gatherers when no idle hands are free so a site always
 * makes progress. Runs on a fixed cadence.
 * @param {object} w
 * @param {object} field
 */
export function constructionAssignSystem(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  if (w.tick % ASSIGN_INTERVAL !== 0) return;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.built !== 0) continue;
    const owner = b.owner;

    let builders = 0;
    for (let i = 0; i < w.count; i++) {
      if (w.alive[i] && w.order[i] === ORDER.BUILD && w.buildTarget[i] === bi) builders++;
    }

    for (let slot = builders; slot < MAX_BUILDERS; slot++) {
      // Pick the best remaining candidate (idle over gatherer, then nearest).
      let best = -1;
      let bestIdle = 2;
      let bestD = 0x7fffffffffff;
      for (let i = 0; i < w.count; i++) {
        if (!candidateEligible(w, i, owner)) continue;
        const idle = w.order[i] === ORDER.IDLE ? 0 : 1;
        const d = fx.dist2(w.px[i], w.py[i], b.x, b.z);
        if (idle < bestIdle || (idle === bestIdle && d < bestD)) {
          bestIdle = idle;
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break; // no free hands anywhere
      beginBuild(w, best, bi);
    }
  }
}
