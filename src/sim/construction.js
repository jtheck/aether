// Building construction - placed buildings start as inert sites (built = 0) and
// are raised by villagers and engineers. Mirrors the gather loop: a per-tick
// driver walks builders to the site and holds them in reach; progress accrues
// from on-site workers (capped at the site's builder slots; farms take one).
// A villager is one builder-tick; an engineer is half. Unattended villages still trickle at
// IDLE_VILLAGE_DEN (0.1× one villager) so a site can finish with no hands.
// A separate assign pass fills those slots - nearest first, idle preferred,
// pulling gatherers / repairing engineers when no idle hand is free. A
// villager still holding a load walks it to a drop-off before taking a slot.
// All state lives on the building object / SoA.

import * as fx from './fixed.js';
import { ORDER } from './world.js';
import { queuePath, clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { snapToPassable, TILE_SIZE_F } from './field.js';
import { UNIT } from './unitTypes.js';
import { revertBrigand } from './brigand.js';
import { isCarried } from './transport.js';
import { getBuildingFootprint, applyStructureOccupancyAt } from './buildings.js';
import { createAgora } from './agora.js';
import { DROP_OFF_TYPES, beginDeposit, nearestDropOff } from './gather.js';
import { noteMatchBuilding } from './matchSnapshot.js';

/** Most workers that can claim a single site. */
export const MAX_BUILDERS = 2;
/** Farms are a one-hand raise; the assign pass must not call a second worker. */
const FARM_BUILDERS = 1;

function maxBuildersFor(type) {
  return type === 'farm' ? FARM_BUILDERS : MAX_BUILDERS;
}
/** Half-ticks of work a villager contributes each tick on-site. */
const VILLAGER_BUILD_HALVES = 2;
/** Engineers take a slot but add half a villager's speed. */
const ENGINEER_BUILD_HALVES = 1;
/** Idle village trickle: one villager-tick every N ticks with no on-site builders. */
export const IDLE_VILLAGE_DEN = 10;
/** Re-scan cadence for builder recruitment (deterministic on world.tick). */
const ASSIGN_INTERVAL = 20;
/** Extra reach past the footprint edge so builders don't fight for the exact rim. */
const BUILD_MARGIN_F = 6;
/** Late construction scale bump at 2/3 progress (integer compare: p * den >= time * num). */
export const CONSTRUCT_NEAR_NUM = 2;
export const CONSTRUCT_NEAR_DEN = 3;

/**
 * Visual growth stage for an unfinished site.
 * 0 = foundation (no work yet), 1 = first work, 2 = near-done.
 * @param {number} progress
 * @param {number} buildTime
 */
export function constructionVisualStage(progress, buildTime) {
  const p = progress | 0;
  if (p <= 0) return 0;
  const time = Math.max(1, buildTime | 0);
  if (p * CONSTRUCT_NEAR_DEN >= time * CONSTRUCT_NEAR_NUM) return 2;
  return 1;
}

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

/** Assign combo / selected crew to a site, capped at that building's builder slots. */
export function assignBuildersToSite(w, bi, ids) {
  if (bi < 0 || !ids?.length) return 0;
  const cap = maxBuildersFor(w.buildings?.[bi]?.type);
  let n = 0;
  for (let k = 0; k < ids.length && n < cap; k++) {
    if (beginBuild(w, ids[k], bi)) n++;
  }
  return n;
}

/** Put a villager or engineer on a BUILD order for a building index. */
export function beginBuild(w, i, bi) {
  revertBrigand(w, i);
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

/** Paper (1 hp) with nobody on-site; harden to maxHp when a builder is present. */
function syncPaperSiteHp(w, b, onSite) {
  if (b.hp == null) return;
  const hp = b.hp | 0;
  if (hp <= 0) return;
  const maxHp = (b.maxHp != null ? b.maxHp : hp) | 0;
  if (onSite) {
    if (hp <= 1 && maxHp > 1) {
      b.hp = maxHp;
      w.buildingsDirty = 1;
    }
    return;
  }
  if (hp > 1) {
    b.hp = 1;
    w.buildingsDirty = 1;
  }
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
 * Per-tick construction driver - one phase in step(), alongside gather. Walks
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
    // A build order issued while a load is in hand walks that load home first.
    if ((bi | 0) >= 0 && holdingReturnableLoad(w, i) && sendLoadHomeThenBuild(w, i, bi)) continue;
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
    syncPaperSiteHp(w, b, halves > 0);
    const prevProg = b.buildProgress | 0;
    const time = b.buildTime | 0;
    if (halves > 0) {
      const capHalves = maxBuildersFor(b.type) * VILLAGER_BUILD_HALVES;
      const total = (b.buildHalfAcc | 0) + Math.min(halves, capHalves);
      b.buildProgress = prevProg + (total >> 1);
      b.buildHalfAcc = total & 1;
    } else if (b.type === 'village') {
      // 0.1× one villager while no one is on-site. Remainder stays on the
      // building so a worker arriving mid-cycle doesn't drop the trickle.
      const acc = (b.buildIdleAcc | 0) + 1;
      if (acc < IDLE_VILLAGE_DEN) {
        b.buildIdleAcc = acc;
        continue;
      }
      b.buildIdleAcc = 0;
      b.buildProgress = prevProg + 1;
    } else {
      continue;
    }
    if (b.buildProgress >= time) {
      b.buildProgress = time;
      b.built = 1;
      noteMatchBuilding(w, b.owner, b.type);
      if ((b.hp | 0) > 0 && (b.maxHp | 0) > 0) b.hp = b.maxHp | 0;
      // Turn on the finished building's live effects (e.g. farm food node).
      if (field) applyStructureOccupancyAt(field, b.type, b.x, b.z, /* built */ true);
      if (b.type === 'agora') {
        if (!w.agoras) w.agoras = [];
        w.agoras.push(createAgora(b.owner, fx.toFloat(b.x), fx.toFloat(b.z)));
        b.hp = 0;
      }
      if (DROP_OFF_TYPES.has(b.type)) {
        b.gatherRallyAt = w.tick | 0;
      }
      w.buildingsDirty = 1;
    } else if (
      constructionVisualStage(prevProg, time) !==
      constructionVisualStage(b.buildProgress, time)
    ) {
      // Renderer grows the mesh on stage crossings - not every work tick.
      w.buildingsDirty = 1;
    }
  }
}

/**
 * Lower is taken first. Idle, then wood/rock gatherers and repairing
 * engineers. A farmer is last, and only when the site has nobody else -
 * filling a second slot must not empty a farm.
 */
function candidateRank(w, field, i) {
  if (w.order[i] === ORDER.IDLE) return 0;
  if (w.type[i] === UNIT.VILLAGER && w.order[i] === ORDER.GATHER) {
    const tile = w.gatherTile?.[i] | 0;
    if (tile >= 0 && field?.foodNode?.[tile]) return 2;
  }
  return 1;
}

/** True when this villager is holding a load and has somewhere to bank it. */
function holdingReturnableLoad(w, i) {
  if ((w.carriedAmt?.[i] | 0) <= 0) return false;
  return nearestDropOff(w, w.owner[i], w.px[i], w.py[i]) != null;
}

/** Rank key for a build candidate: idle beats gathering, then nearest, then id. */
function candidateEligible(w, i, owner) {
  if (!w.alive[i] || !canBuild(w.type[i]) || w.owner[i] !== owner) return false;
  if (isCarried(w, i)) return false;
  // Hands full: finish the drop-off before walking onto a site.
  if (holdingReturnableLoad(w, i)) return false;
  const order = w.order[i];
  if (order === ORDER.IDLE) return true;
  if (w.type[i] === UNIT.VILLAGER && order === ORDER.GATHER) return true;
  if (w.type[i] === UNIT.ENGINEER && order === ORDER.REPAIR) return true;
  return false;
}

/**
 * Gatherer or idle villager who would have been pulled to build, except they
 * still have a load. Not already claimed by a site, and not player-parked.
 */
function returnCandidate(w, i, owner) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER || w.owner[i] !== owner) return false;
  if (isCarried(w, i) || w.manualHold?.[i]) return false;
  if ((w.buildTarget[i] | 0) >= 0) return false;
  if (!holdingReturnableLoad(w, i)) return false;
  const order = w.order[i];
  return order === ORDER.IDLE || order === ORDER.GATHER;
}

/** Builders on the site, plus haulers sent home to free a slot for it. */
function siteCrew(w, bi) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || (w.buildTarget[i] | 0) !== bi) continue;
    if (w.order[i] === ORDER.BUILD) n++;
    else if (w.order[i] === ORDER.GATHER && (w.carriedAmt[i] | 0) > 0) n++;
  }
  return n;
}

function bestCandidate(w, field, b, owner, crew, mode) {
  let best = -1;
  let bestRank = 3;
  let bestD = 0x7fffffffffff;
  for (let i = 0; i < w.count; i++) {
    if (mode === 'build') {
      if (!candidateEligible(w, i, owner)) continue;
    } else if (!returnCandidate(w, i, owner)) continue;
    const rank = candidateRank(w, field, i);
    if (rank >= 2 && crew > 0) continue;
    const d = fx.dist2(w.px[i], w.py[i], b.x, b.z);
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      bestRank = rank;
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Bank the load, then stand so the next pass can put them on the site. */
function sendLoadHomeThenBuild(w, i, bi) {
  const drop = nearestDropOff(w, w.owner[i], w.px[i], w.py[i]);
  if (!drop || !beginDeposit(w, i, drop.x, drop.y)) return false;
  w.buildTarget[i] = bi | 0;
  return true;
}

/**
 * Recruit up to the site's builder cap (one for a farm, MAX_BUILDERS otherwise).
 * Nearest first, idle preferred; will pull wood/rock gatherers or repairing
 * engineers when no idle hand is free. A farmer is pulled only when the site
 * would otherwise get nobody. A villager holding wood or stone is sent to bank
 * it first and keeps the slot until their hands are empty. Runs on a fixed cadence.
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

    let crew = siteCrew(w, bi);
    const cap = maxBuildersFor(b.type);
    for (let slot = crew; slot < cap; slot++) {
      // Idle, then other workers, nearest within a rank. Farmers only if the
      // site still has nobody - a second slot must not strip the farm.
      const best = bestCandidate(w, field, b, owner, crew, 'build');
      if (best >= 0) {
        beginBuild(w, best, bi);
        crew++;
        continue;
      }
      // Nobody empty-handed. The nearest loaded villager banks first.
      const haul = bestCandidate(w, field, b, owner, crew, 'return');
      if (haul < 0 || !sendLoadHomeThenBuild(w, haul, bi)) break;
      crew++;
    }
  }
}
