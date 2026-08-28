// Building construction — placed buildings start as inert sites (built = 0) and
// are raised by villagers and engineers. Mirrors the gather loop: a per-tick
// driver walks builders to the site and holds them in reach; progress accrues
// from on-site workers (capped at MAX_BUILDERS slots). A villager is one
// builder-tick; an engineer is half. A separate assign pass fills those slots —
// nearest first, idle preferred, pulling gatherers / repairing engineers when
// no idle hand is free. All state lives on the building object / SoA.

import * as fx from './fixed.js';
import { ORDER } from './world.js';
import { queuePath, clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { snapToPassable, TILE_SIZE_F } from './field.js';
import { UNIT } from './unitTypes.js';
import { isCarried } from './transport.js';
import { getBuildingFootprint, applyStructureOccupancyAt } from './buildings.js';

/** Most workers that can claim a single site. */
export const MAX_BUILDERS = 2;
/** Half-ticks of work a villager contributes each tick on-site. */
const VILLAGER_BUILD_HALVES = 2;
/** Engineers take a slot but add half a villager's speed. */
const ENGINEER_BUILD_HALVES = 1;
const MAX_BUILD_HALVES = MAX_BUILDERS * VILLAGER_BUILD_HALVES;
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

function canBuild(type) {
  return type === UNIT.VILLAGER || type === UNIT.ENGINEER;
}

function buildHalvesFor(type) {
  return type === UNIT.ENGINEER ? ENGINEER_BUILD_HALVES : VILLAGER_BUILD_HALVES;
}

/** Put a villager or engineer on a BUILD order for a building index. */
export function beginBuild(w, i, bi) {
  if (!w.alive[i] || !canBuild(w.type[i])) return false;
  w.order[i] = ORDER.BUILD;
  w.buildTarget[i] = bi | 0;
  w.gatherTile[i] = -1;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
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
    if (!b || (b.hp != null && (b.hp | 0) <= 0) || b.built !== 0 || !canBuild(w.type[i]) || w.owner[i] !== b.owner) {
      endBuild(w, i);
      continue;
    }
    if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= buildReachSq(b)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      _present[bi] += buildHalvesFor(w.type[i]);
    } else {
      const spot = snapToPassable(field, b.x, b.z);
      seekTo(w, i, spot ? spot.x : b.x, spot ? spot.y : b.z);
    }
  }

  // Accrue progress (capped) and finish sites that reach their build time.
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.built !== 0 || (b.hp != null && (b.hp | 0) <= 0)) continue;
    const halves = _present[bi];
    if (halves <= 0) continue;
    const total = (b.buildHalfAcc | 0) + Math.min(halves, MAX_BUILD_HALVES);
    b.buildProgress = (b.buildProgress | 0) + (total >> 1);
    b.buildHalfAcc = total & 1;
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
  if (!w.alive[i] || !canBuild(w.type[i]) || w.owner[i] !== owner) return false;
  if (isCarried(w, i)) return false;
  const order = w.order[i];
  if (order === ORDER.IDLE) return true;
  if (w.type[i] === UNIT.VILLAGER && order === ORDER.GATHER) return true;
  if (w.type[i] === UNIT.ENGINEER && order === ORDER.REPAIR) return true;
  return false;
}

/**
 * Recruit up to MAX_BUILDERS villagers/engineers per unfinished site. Nearest
 * first, idle preferred; will pull gatherers or repairing engineers when no idle
 * hands are free. Runs on a fixed cadence.
 * @param {object} w
 * @param {object} field
 */
export function constructionAssignSystem(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  if (w.tick % ASSIGN_INTERVAL !== 0) return;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.built !== 0 || (b.hp != null && (b.hp | 0) <= 0)) continue;
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
