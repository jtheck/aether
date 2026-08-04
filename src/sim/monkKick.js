// Unit lob / yeet — monk stick-bonk + fireball splash blast.
// Multi-tick air travel; render lifts Y + trails from published flights.

import * as fx from './fixed.js';
import { TILE_SIZE_F, snapToPassable } from './field.js';
import { UNIT, getUnitDef, isMechanical } from './unitTypes.js';
import { clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';
import { applyDistract } from './frogs.js';
import { applyDamage } from './damage.js';
import { isHostile } from './teams.js';
import { rngFrac } from './rng.js';
import { isCarried } from './transport.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  spatialCellId,
} from './spatialGrid.js';

/** Stick reach — close enough to whap with a staff. */
export const MONK_KICK_RADIUS = fx.fromFloat(TILE_SIZE_F * 0.75);
/** Hostile lob distance (~12 tiles). */
export const MONK_KICK_LOB_DIST = fx.fromFloat(TILE_SIZE_F * 12);
/** Ally lob — a firm shove, not a map clear (~5 tiles). */
export const MONK_KICK_ALLY_LOB_DIST = fx.fromFloat(TILE_SIZE_F * 5);
/** Air time (~1.35s at 20Hz). */
export const MONK_KICK_FLIGHT_TICKS = 27;
/** Monk cooldown between bonks (~1.4s). */
export const MONK_KICK_COOLDOWN = 28;
/** Ground stun after landing — get up, you clown. */
export const MONK_KICK_STUN_TICKS = 36;
/** Render-only peak loft (world units). */
export const MONK_KICK_PEAK_HEIGHT = 14;
/** Stick slap damage as a fraction of monk attack. */
export const MONK_KICK_DAMAGE_MUL = 0.85;

/** Fireball splash yeet — shorter hop (~4 tiles mid). */
export const FIREBALL_BLAST_LOB_DIST = fx.fromFloat(TILE_SIZE_F * 4);
export const FIREBALL_BLAST_FLIGHT_TICKS = 18;
export const FIREBALL_BLAST_STUN_TICKS = 22;
export const FIREBALL_BLAST_PEAK_HEIGHT = 8;

/** Published trail kind for the renderer. */
export const LOB_TRAIL = {
  DUST: 0,
  FIRE: 1,
};

const RADIUS2 = fx.mul(MONK_KICK_RADIUS, MONK_KICK_RADIUS);

/** Distance roll span for monk sticks (fraction of base). */
const MONK_DIST_MIN = fx.fromFloat(0.55);
const MONK_DIST_MAX = fx.fromFloat(1.08);
/** Fireball blast — wider variance, still shorter than a full kick. */
const BLAST_DIST_MIN = fx.fromFloat(0.4);
const BLAST_DIST_MAX = fx.fromFloat(1.2);

const FALLBACK_DIRS = [
  [fx.ONE, 0],
  [fx.ONE, fx.ONE],
  [0, fx.ONE],
  [-fx.ONE, fx.ONE],
  [-fx.ONE, 0],
  [-fx.ONE, -fx.ONE],
  [0, -fx.ONE],
  [fx.ONE, -fx.ONE],
];

export function createMonkKickFxStore() {
  return {
    // Sparse flight snapshot rebuilt each take (render Y + trail).
    count: 0,
    entity: [],
    progress: [],
    peak: [],
    trail: [],
    // One-shot land impacts drained each publish.
    landCount: 0,
    landX: [],
    landY: [],
    landTrail: [],
  };
}

export function isLobbing(w, i) {
  return !!(w.lobTicks && w.lobTicks[i] > 0);
}

/** Parabolic loft height for progress in [0, 1]. */
export function lobHeightAt(progress, peak = MONK_KICK_PEAK_HEIGHT) {
  const t = Math.min(1, Math.max(0, progress));
  return peak * (1 - (2 * t - 1) * (2 * t - 1));
}

export function canBeLobbbed(w, i) {
  if (i < 0 || i >= w.count || !w.alive[i]) return false;
  if (w.type[i] === UNIT.MONK) return false;
  if (isMechanical(w.type[i])) return false;
  if (isLobbing(w, i)) return false;
  if (isCarried(w, i)) return false;
  return true;
}

/** Deterministic distance jitter in [minFrac, maxFrac) × base. */
function rollLobDist(w, base, minFrac, maxFrac) {
  const t = rngFrac(w.rng);
  const frac = minFrac + fx.mul(maxFrac - minFrac, t);
  return fx.mul(base, frac);
}

function pushLandFx(w, x, y, trail) {
  const store = w.monkKickFx;
  if (!store) return;
  store.landX.push(fx.toFloat(x));
  store.landY.push(fx.toFloat(y));
  store.landTrail.push(trail | 0);
  store.landCount++;
}

/**
 * Snapshot airborne victims + drain land impacts for the renderer.
 * Always returns a patch so the renderer can clear grounded units.
 */
export function takeMonkKickUpdates(w) {
  const empty = {
    count: 0,
    entity: [],
    progress: [],
    peak: [],
    trail: [],
    landCount: 0,
    landX: [],
    landY: [],
    landTrail: [],
  };
  if (!w.lobTicks) return empty;
  const store = w.monkKickFx;
  if (!store) return empty;
  store.entity.length = 0;
  store.progress.length = 0;
  store.peak.length = 0;
  store.trail.length = 0;
  store.count = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.lobTicks[i] <= 0) continue;
    const dur = w.lobDur[i] || MONK_KICK_FLIGHT_TICKS;
    const remaining = w.lobTicks[i];
    // progress 0 at launch … 1 at landing
    const progress = 1 - remaining / dur;
    store.entity.push(i);
    store.progress.push(progress);
    store.peak.push(w.lobPeak[i] || MONK_KICK_PEAK_HEIGHT);
    store.trail.push(w.lobTrail[i] | 0);
    store.count++;
  }
  const landCount = store.landCount | 0;
  const landX = store.landX.slice(0, landCount);
  const landY = store.landY.slice(0, landCount);
  const landTrail = store.landTrail.slice(0, landCount);
  store.landX.length = 0;
  store.landY.length = 0;
  store.landTrail.length = 0;
  store.landCount = 0;
  return {
    count: store.count,
    entity: store.entity.slice(),
    progress: store.progress.slice(),
    peak: store.peak.slice(),
    trail: store.trail.slice(),
    landCount,
    landX,
    landY,
    landTrail,
  };
}

function resolveLanding(field, x, y) {
  if (!field) return { x, y };
  const snapped = snapToPassable(field, x, y);
  return snapped || { x, y };
}

function lobDestination(w, field, victim, ox, oy, dist) {
  let dx = w.px[victim] - ox;
  let dy = w.py[victim] - oy;
  let len = fx.len(dx, dy);
  if (len <= 0) {
    const dir = FALLBACK_DIRS[victim & 7];
    dx = dir[0];
    dy = dir[1];
    len = fx.len(dx, dy);
  }
  const nx = fx.div(dx, len);
  const ny = fx.div(dy, len);
  const rawX = w.px[victim] + fx.mul(nx, dist);
  const rawY = w.py[victim] + fx.mul(ny, dist);
  return resolveLanding(field, rawX, rawY);
}

/**
 * Launch one victim on a multi-tick lob away from (ox, oy).
 * @returns {boolean}
 */
export function startUnitLob(w, field, victim, ox, oy, opts = {}) {
  if (!canBeLobbbed(w, victim)) return false;

  const dist = opts.dist ?? MONK_KICK_LOB_DIST;
  const flightTicks = opts.flightTicks ?? MONK_KICK_FLIGHT_TICKS;
  const stunTicks = opts.stunTicks ?? MONK_KICK_STUN_TICKS;
  const peak = opts.peak ?? MONK_KICK_PEAK_HEIGHT;
  const trail = opts.trail ?? LOB_TRAIL.DUST;

  const dest = lobDestination(w, field, victim, ox, oy, dist);
  w.lobFromX[victim] = w.px[victim];
  w.lobFromY[victim] = w.py[victim];
  w.lobToX[victim] = dest.x;
  w.lobToY[victim] = dest.y;
  w.lobDur[victim] = flightTicks;
  w.lobTicks[victim] = flightTicks;
  w.lobPeak[victim] = peak;
  w.lobTrail[victim] = trail;

  w.vx[victim] = 0;
  w.vy[victim] = 0;
  clearPath(w, victim);
  clearEngagement(w, victim);
  w.targetEntity[victim] = -1;
  w.hasTarget[victim] = 0;
  w.order[victim] = ORDER.IDLE;
  applyDistract(w, victim, flightTicks + stunTicks);
  return true;
}

/**
 * Launch one victim on a multi-tick lob away from the monk.
 * @returns {boolean}
 */
export function startMonkLob(w, field, monk, victim) {
  if (monk < 0 || monk >= w.count || !w.alive[monk]) return false;
  if (!canBeLobbbed(w, victim)) return false;

  const base = isHostile(w.owner[monk], w.owner[victim])
    ? MONK_KICK_LOB_DIST
    : MONK_KICK_ALLY_LOB_DIST;
  const dist = rollLobDist(w, base, MONK_DIST_MIN, MONK_DIST_MAX);
  if (!startUnitLob(w, field, victim, w.px[monk], w.py[monk], {
    dist,
    flightTicks: MONK_KICK_FLIGHT_TICKS,
    stunTicks: MONK_KICK_STUN_TICKS,
    peak: MONK_KICK_PEAK_HEIGHT,
    trail: LOB_TRAIL.DUST,
  })) {
    return false;
  }

  const def = getUnitDef(UNIT.MONK);
  const dmg = Math.max(1, Math.round(def.attackDamage * MONK_KICK_DAMAGE_MUL));
  applyDamage(w, victim, dmg, monk);

  w.abilityCd[monk] = MONK_KICK_COOLDOWN;
  return true;
}

/**
 * Yeet every eligible unit in splash radius away from the impact point.
 * Fire trail, shorter hop, randomized distance.
 */
export function fireballBlastLob(w, field, impactX, impactY, radius) {
  if (!radius || radius <= 0) return 0;
  const radius2 = fx.mul(radius, radius);
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!canBeLobbbed(w, i)) continue;
    if (fx.dist2(impactX, impactY, w.px[i], w.py[i]) > radius2) continue;
    const dist = rollLobDist(w, FIREBALL_BLAST_LOB_DIST, BLAST_DIST_MIN, BLAST_DIST_MAX);
    if (startUnitLob(w, field, i, impactX, impactY, {
      dist,
      flightTicks: FIREBALL_BLAST_FLIGHT_TICKS,
      stunTicks: FIREBALL_BLAST_STUN_TICKS,
      peak: FIREBALL_BLAST_PEAK_HEIGHT,
      trail: LOB_TRAIL.FIRE,
    })) {
      n++;
    }
  }
  return n;
}

/** Advance in-flight victims; land when ticks hit 0. */
export function tickMonkLobs(w) {
  if (!w.lobTicks) return;
  for (let i = 0; i < w.count; i++) {
    if (w.lobTicks[i] <= 0) continue;
    if (!w.alive[i]) {
      w.lobTicks[i] = 0;
      continue;
    }
    const dur = w.lobDur[i] || MONK_KICK_FLIGHT_TICKS;
    const trail = w.lobTrail[i] | 0;
    w.lobTicks[i]--;
    const remaining = w.lobTicks[i];
    const progress = fx.div(fx.fromInt(dur - remaining), fx.fromInt(dur));
    w.px[i] = w.lobFromX[i] + fx.mul(w.lobToX[i] - w.lobFromX[i], progress);
    w.py[i] = w.lobFromY[i] + fx.mul(w.lobToY[i] - w.lobFromY[i], progress);
    w.vx[i] = 0;
    w.vy[i] = 0;

    if (remaining <= 0) {
      w.px[i] = w.lobToX[i];
      w.py[i] = w.lobToY[i];
      w.lobTicks[i] = 0;
      w.order[i] = ORDER.IDLE;
      w.targetEntity[i] = -1;
      w.hasTarget[i] = 0;
      pushLandFx(w, w.px[i], w.py[i], trail);
    }
  }
}

/**
 * Pick the closest living non-monk in stick range (entity-index tiebreak).
 * Expects `w.spatial` rebuilt for current positions.
 * @returns {number} entity index or -1
 */
export function findStickTarget(w, monk) {
  const ox = w.px[monk];
  const oy = w.py[monk];
  const grid = w.spatial;
  let best = -1;
  let bestD2 = RADIUS2 + 1;

  const consider = (i) => {
    if (i === monk || !canBeLobbbed(w, i)) return;
    // Don't whap units sharing this monk's selection / multi-unit order.
    if (
      w.squadId &&
      w.squadId[monk] !== 0 &&
      w.owner[i] === w.owner[monk] &&
      w.squadId[i] === w.squadId[monk]
    ) {
      return;
    }
    const d2 = fx.dist2(ox, oy, w.px[i], w.py[i]);
    if (d2 > RADIUS2) return;
    if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || i < best))) {
      bestD2 = d2;
      best = i;
    }
  };

  const bounds = queryCellBounds(ox, oy, MONK_KICK_RADIUS, grid);
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      let j = grid.head[spatialCellId(x, z, grid)];
      while (j >= 0) {
        consider(j);
        j = grid.next[j];
      }
    }
  }
  return best;
}

/**
 * Passive stick system: advance lobs, then let ready monks bonk one neighbor.
 * Idle monks still swing — wander into stick range at your own risk.
 */
export function monkKickSystem(w, field) {
  tickMonkLobs(w);
  // Stick seek is local — full-N scan was the stress hot path.
  rebuildSpatialGrid(w.spatial, w);

  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.type[i] !== UNIT.MONK) continue;
    if (w.abilityCd[i] > 0) continue;
    if (isLobbing(w, i)) continue;

    const target = findStickTarget(w, i);
    if (target < 0) continue;
    startMonkLob(w, field, i, target);
  }
}

export function mixMonkLobChecksum(mix, w) {
  if (!w.lobTicks) return;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] && w.lobTicks[i] <= 0) continue;
    mix(w.lobTicks[i]);
    if (w.lobTicks[i] <= 0) continue;
    mix(w.lobDur[i]);
    mix(w.lobFromX[i]);
    mix(w.lobFromY[i]);
    mix(w.lobToX[i]);
    mix(w.lobToY[i]);
    mix(w.lobPeak[i]);
    mix(w.lobTrail[i]);
  }
}
