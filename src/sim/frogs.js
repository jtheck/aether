// Plague of Frogs — shaman ability hoppers.
// Organic cluster swarm: frogs hop independently in the cast's general
// direction, linger, wander, occasionally split, and stick around for many
// hops. Publish only on state changes; renderer lerps hop plans locally.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';
import { claimEngagement, clearEngagement } from './engagement.js';
import { attackStandPoint, clearPath, queuePath } from './path.js';
import { ORDER } from './world.js';
import { rngFrac, rngRange } from './rng.js';
import {
  TERRAIN,
  TILE,
  tileCenterX,
  tileCenterY,
  worldToTile,
} from './field.js';

/** Initial pool / thin-instance size; grows in FROG_CAPACITY_CHUNK steps. */
export const FROG_INITIAL_CAPACITY = 1024;
export const FROG_CAPACITY_CHUNK = 1024;
/** @deprecated Prefer FROG_INITIAL_CAPACITY — alias kept for older call sites. */
export const MAX_FROGS = FROG_INITIAL_CAPACITY;

export const FROG_PHASE = {
  WAIT: 0,
  OUT: 1,
  LINGER: 2,
  AWAY: 3,
  /** End-of-life dash into the nearest puddle / lake. */
  ESCAPE: 4,
};

/** Initial frogs per cast, packed into a few messy clusters. */
export const FROG_COUNT = 6;
/** Soft cluster count inside the cast cone. */
export const FROG_CLUSTERS = 3;
/** ~5s at 20Hz. */
export const FROG_PLAGUE_COOLDOWN = 100;
/** Base stagger between launches (ticks); each frog adds rng jitter. */
export const FROG_LAUNCH_STAGGER = 2;
/** Ground sit before the next independent hop. */
export const FROG_LINGER_MIN = 14;
export const FROG_LINGER_MAX = 34;
/** Distract duration on landing (~2s). */
export const FROG_DISTRACT_TICKS = 40;
/** Chance out of 256 a distracted foe turns on a nearby ally. */
export const FROG_CONFUSE_CHANCE_Q8 = 100;
/** How far they'll look for a buddy to whack. */
const CONFUSE_RADIUS = fx.fromFloat(10);
const CONFUSE_RADIUS2 = fx.mul(CONFUSE_RADIUS, CONFUSE_RADIUS);
/** Hop life budget range (each land consumes one). */
export const FROG_HOPS_MIN = 6;
export const FROG_HOPS_MAX = 11;
/** Chance out of 256 to birth one child while lingering. */
export const FROG_SPLIT_CHANCE_Q8 = 72;

const HOP_SPEED = fx.fromFloat(1.05);
/** Escape hops are quick but short — many of them, not one mega-leap. */
const ESCAPE_HOP_SPEED = fx.fromFloat(5.2);
const ESCAPE_HOP_DIST_MIN = fx.fromFloat(10.125);
const ESCAPE_HOP_DIST_MAX = fx.fromFloat(16.875);
/** Tiny pause between escape hops (ticks). */
const ESCAPE_PAUSE_MIN = 0;
const ESCAPE_PAUSE_MAX = 1;
/** Search radius in tiles (~360 world units; most of a fight zone). */
const WATER_SEARCH_TILES = 90;
/** Safety cap so a stranded frog can't hop forever. */
const ESCAPE_HOPS_MAX = 48;
const FIRST_HOP_NEAR = fx.fromFloat(6);
const FIRST_HOP_FAR = fx.fromFloat(16);
const CLUSTER_LATERAL = fx.fromFloat(9);
const WANDER_FORWARD_MIN = fx.fromFloat(3.5);
const WANDER_FORWARD_MAX = fx.fromFloat(9);
const WANDER_LATERAL = fx.fromFloat(6.5);
const DIR_WANDER = fx.fromFloat(0.22);
const SPLASH_RADIUS = fx.fromFloat(3.0);
const SPLASH_RADIUS2 = fx.mul(SPLASH_RADIUS, SPLASH_RADIUS);
const FRIENDLY_MUL = 0.12;
const DAMAGE_FALLOFF_Q8 = 220;

export function createFrogStore(capacity = FROG_INITIAL_CAPACITY) {
  const freeStack = new Int32Array(capacity);
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;
  return {
    capacity,
    activeCount: 0,
    highWater: 0,
    allocatorHash: 0x811c9dc5 | 0,
    freeTop: capacity,
    freeStack,
    alive: new Uint8Array(capacity),
    generation: new Uint32Array(capacity),
    owner: new Uint8Array(capacity),
    source: new Int32Array(capacity),
    px: new Int32Array(capacity),
    py: new Int32Array(capacity),
    originX: new Int32Array(capacity),
    originY: new Int32Array(capacity),
    destX: new Int32Array(capacity),
    destY: new Int32Array(capacity),
    /** Personal heading (wanders each hop), biased by cast aim. */
    dirX: new Int32Array(capacity),
    dirY: new Int32Array(capacity),
    hopAge: new Uint16Array(capacity),
    hopDuration: new Uint16Array(capacity),
    phase: new Uint8Array(capacity),
    /** Hops remaining including the next one. */
    hopsLeft: new Uint8Array(capacity),
    /** Completed landings (0 = still on first outbound hop). */
    hopsDone: new Uint8Array(capacity),
    waitTicks: new Uint16Array(capacity),
    damage: new Uint16Array(capacity),
    landPulse: new Uint8Array(capacity),
    /** 1 while fleeing toward water. */
    escaping: new Uint8Array(capacity),
    /** Locked water target for the escape chain. */
    waterX: new Int32Array(capacity),
    waterY: new Int32Array(capacity),
    /** Escape hops taken (cap). */
    escapeHops: new Uint8Array(capacity),
    dirtyFlag: new Uint8Array(capacity),
    dirty: [],
  };
}

/**
 * Grow frog pool arrays in FROG_CAPACITY_CHUNK steps (new slots added to free list).
 * @param {ReturnType<typeof createFrogStore>} store
 * @param {number} minCapacity
 */
export function ensureFrogCapacity(store, minCapacity) {
  if (!store || minCapacity <= store.capacity) return;
  const oldCap = store.capacity;
  const newCap =
    Math.ceil(minCapacity / FROG_CAPACITY_CHUNK) * FROG_CAPACITY_CHUNK;

  const grow = (arr, TypedArray) => {
    const next = new TypedArray(newCap);
    next.set(arr);
    return next;
  };

  store.alive = grow(store.alive, Uint8Array);
  store.generation = grow(store.generation, Uint32Array);
  store.owner = grow(store.owner, Uint8Array);
  store.source = grow(store.source, Int32Array);
  store.px = grow(store.px, Int32Array);
  store.py = grow(store.py, Int32Array);
  store.originX = grow(store.originX, Int32Array);
  store.originY = grow(store.originY, Int32Array);
  store.destX = grow(store.destX, Int32Array);
  store.destY = grow(store.destY, Int32Array);
  store.dirX = grow(store.dirX, Int32Array);
  store.dirY = grow(store.dirY, Int32Array);
  store.hopAge = grow(store.hopAge, Uint16Array);
  store.hopDuration = grow(store.hopDuration, Uint16Array);
  store.phase = grow(store.phase, Uint8Array);
  store.hopsLeft = grow(store.hopsLeft, Uint8Array);
  store.hopsDone = grow(store.hopsDone, Uint8Array);
  store.waitTicks = grow(store.waitTicks, Uint16Array);
  store.damage = grow(store.damage, Uint16Array);
  store.landPulse = grow(store.landPulse, Uint8Array);
  store.escaping = grow(store.escaping, Uint8Array);
  store.waterX = grow(store.waterX, Int32Array);
  store.waterY = grow(store.waterY, Int32Array);
  store.escapeHops = grow(store.escapeHops, Uint8Array);
  store.dirtyFlag = grow(store.dirtyFlag, Uint8Array);

  const newFree = new Int32Array(newCap);
  newFree.set(store.freeStack.subarray(0, store.freeTop));
  let ft = store.freeTop;
  // Push high→low so the next alloc prefers the lowest new index (matches boot order).
  for (let i = newCap - 1; i >= oldCap; i--) newFree[ft++] = i;
  store.freeStack = newFree;
  store.freeTop = ft;
  store.capacity = newCap;
}

function markDirty(store, slot) {
  if (store.dirtyFlag[slot]) return;
  store.dirtyFlag[slot] = 1;
  store.dirty.push(slot);
}

function freeFrog(store, slot) {
  if (!store.alive[slot]) return;
  store.alive[slot] = 0;
  store.hopAge[slot] = 0;
  store.hopDuration[slot] = 0;
  store.waitTicks[slot] = 0;
  store.hopsLeft[slot] = 0;
  store.hopsDone[slot] = 0;
  store.escaping[slot] = 0;
  store.escapeHops[slot] = 0;
  store.activeCount--;
  store.freeStack[store.freeTop++] = slot;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot) | 0,
    0x01000193,
  );
  markDirty(store, slot);
}

function setHop(store, slot, ox, oy, dx, dy, speed = HOP_SPEED) {
  store.originX[slot] = ox;
  store.originY[slot] = oy;
  store.destX[slot] = dx;
  store.destY[slot] = dy;
  store.px[slot] = ox;
  store.py[slot] = oy;
  store.hopAge[slot] = 0;
  const dist = fx.len(dx - ox, dy - oy);
  const ticks = dist > 0 ? Math.ceil(dist / Math.max(1, speed)) : 1;
  store.hopDuration[slot] = Math.max(speed === ESCAPE_HOP_SPEED ? 4 : 8, ticks);
}

/** Nearest TERRAIN.WATER tile center, or null if none within range. */
export function findNearestWater(field, wx, wy, maxTiles = WATER_SEARCH_TILES) {
  if (!field?.terrainTypes) return null;
  const tx0 = worldToTile(wx);
  const tz0 = worldToTile(wy);
  const w = field.width;
  const h = field.height;
  const types = field.terrainTypes;

  const at = (tx, tz) => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return false;
    return types[tz * w + tx] === TERRAIN.WATER;
  };

  if (at(tx0, tz0)) {
    return { x: tileCenterX(tx0), y: tileCenterY(tz0) };
  }

  // Expanding Chebyshev rings — deterministic scan order.
  for (let r = 1; r <= maxTiles; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx !== -r && dx !== r && dz !== -r && dz !== r) continue;
        const tx = tx0 + dx;
        const tz = tz0 + dz;
        if (!at(tx, tz)) continue;
        return { x: tileCenterX(tx), y: tileCenterY(tz) };
      }
    }
  }
  return null;
}

function allocFrog(store) {
  if (store.freeTop <= 0) ensureFrogCapacity(store, store.capacity + 1);
  if (store.freeTop <= 0) return -1;
  const slot = store.freeStack[--store.freeTop];
  store.alive[slot] = 1;
  store.generation[slot] = (store.generation[slot] + 1) >>> 0 || 1;
  store.landPulse[slot] = 0;
  store.waitTicks[slot] = 0;
  store.escaping[slot] = 0;
  store.escapeHops[slot] = 0;
  store.activeCount++;
  if (slot + 1 > store.highWater) store.highWater = slot + 1;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot ^ store.generation[slot]) | 0,
    0x01000193,
  );
  return slot;
}

/** Signed Q16.16 in roughly [-scale, +scale) from rng. */
function rngSigned(rng, scale) {
  return fx.mul(scale, (rngFrac(rng) - fx.HALF) * 2);
}

function rngBetween(rng, lo, hi) {
  const t = rngFrac(rng);
  return lo + fx.mul(hi - lo, t);
}

function normalizeDir(dx, dy) {
  const len = fx.len(dx, dy);
  if (len <= 0) return { x: fx.ONE, y: 0 };
  return { x: fx.div(dx, len), y: fx.div(dy, len) };
}

/** Nudge personal heading and pick a nearby hop landing. */
function planWanderHop(w, store, slot) {
  const rng = w.rng;
  let dirX = store.dirX[slot];
  let dirY = store.dirY[slot];
  // Drift heading a little each hop so they don't march in formation.
  const perpX = -dirY;
  const perpY = dirX;
  dirX = dirX + fx.mul(perpX, rngSigned(rng, DIR_WANDER));
  dirY = dirY + fx.mul(perpY, rngSigned(rng, DIR_WANDER));
  const nd = normalizeDir(dirX, dirY);
  store.dirX[slot] = nd.x;
  store.dirY[slot] = nd.y;

  const forward = rngBetween(rng, WANDER_FORWARD_MIN, WANDER_FORWARD_MAX);
  const lateral = rngSigned(rng, WANDER_LATERAL);
  const ox = store.px[slot];
  const oy = store.py[slot];
  const dx =
    ox + fx.mul(nd.x, forward) + fx.mul(-nd.y, lateral);
  const dy =
    oy + fx.mul(nd.y, forward) + fx.mul(nd.x, lateral);
  setHop(store, slot, ox, oy, dx, dy);
}

/** Break combat focus — units gawk at the frogs instead of fighting. */
export function applyDistract(w, i, ticks = FROG_DISTRACT_TICKS) {
  if (i < 0 || i >= w.count || !w.alive[i]) return;
  if (!w.distractCd) return;
  if (w.distractCd[i] < ticks) w.distractCd[i] = ticks;
  if (w.order[i] === ORDER.ATTACK || w.targetEntity[i] >= 0) {
    w.targetEntity[i] = -1;
    clearEngagement(w, i);
    clearPath(w, i);
    if (w.hasTarget[i]) {
      w.order[i] = ORDER.ATTACK_MOVE;
      queuePath(w, i, w.tx[i], w.ty[i]);
    } else {
      w.order[i] = ORDER.IDLE;
      w.vx[i] = 0;
      w.vy[i] = 0;
    }
  }
}

/** Sometimes force a confused unit to attack the nearest ally. */
export function maybeConfuseAlly(w, i) {
  if (i < 0 || i >= w.count || !w.alive[i] || !w.rng) return false;
  if ((rngRange(w.rng, 0, 256) & 0xff) >= FROG_CONFUSE_CHANCE_Q8) return false;
  const def = getUnitDef(w.type[i]);
  if (def.category !== 'military' || def.attackDamage <= 0) return false;

  let best = -1;
  let bestD2 = CONFUSE_RADIUS2 + 1;
  for (let j = 0; j < w.count; j++) {
    if (j === i || !w.alive[j]) continue;
    if (w.owner[j] !== w.owner[i]) continue;
    const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
    if (d2 > CONFUSE_RADIUS2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || j < best))) {
      bestD2 = d2;
      best = j;
    }
  }
  if (best < 0) return false;

  w.targetEntity[i] = best;
  w.order[i] = ORDER.ATTACK;
  claimEngagement(w, i, best);
  const stand = attackStandPoint(w, i, best);
  queuePath(w, i, stand.x, stand.y);
  return true;
}

function splashAndDistract(w, impactX, impactY, owner, source, damage) {
  let hit = false;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (fx.dist2(impactX, impactY, w.px[i], w.py[i]) > SPLASH_RADIUS2) continue;
    if (isHostile(owner, w.owner[i])) {
      if (damage > 0 && applyDamage(w, i, damage, source)) hit = true;
      if (w.alive[i]) {
        applyDistract(w, i, FROG_DISTRACT_TICKS);
        maybeConfuseAlly(w, i);
      }
    } else if (FRIENDLY_MUL > 0 && damage > 0) {
      const dmg = Math.max(1, Math.round(damage * FRIENDLY_MUL));
      if (applyDamage(w, i, dmg, source)) hit = true;
    }
  }
  return hit;
}

function beginLinger(w, store, slot) {
  store.phase[slot] = FROG_PHASE.LINGER;
  store.hopAge[slot] = 0;
  store.hopDuration[slot] = 0;
  store.waitTicks[slot] = rngRange(w.rng, FROG_LINGER_MIN, FROG_LINGER_MAX + 1);
  store.originX[slot] = store.px[slot];
  store.originY[slot] = store.py[slot];
  store.destX[slot] = store.px[slot];
  store.destY[slot] = store.py[slot];
  markDirty(store, slot);
}

function tryBirthChild(w, store, parentSlot) {
  if ((rngU8(w.rng) & 0xff) >= FROG_SPLIT_CHANCE_Q8) return -1;

  const slot = allocFrog(store);
  if (slot < 0) return -1;

  store.owner[slot] = store.owner[parentSlot];
  store.source[slot] = store.source[parentSlot];
  store.dirX[slot] = store.dirX[parentSlot];
  store.dirY[slot] = store.dirY[parentSlot];
  store.px[slot] = store.px[parentSlot];
  store.py[slot] = store.py[parentSlot];
  store.hopsLeft[slot] = Math.max(
    2,
    Math.min(store.hopsLeft[parentSlot], rngRange(w.rng, 3, 7)),
  );
  store.hopsDone[slot] = 1; // children are already "in the field"
  store.damage[slot] = Math.max(
    1,
    Math.round((store.damage[parentSlot] * DAMAGE_FALLOFF_Q8) / 256),
  );
  store.phase[slot] = FROG_PHASE.WAIT;
  store.waitTicks[slot] = rngRange(w.rng, 2, 10);
  planWanderHop(w, store, slot);
  store.phase[slot] = FROG_PHASE.WAIT;
  markDirty(store, slot);
  return slot;
}

function rngU8(rng) {
  return rngRange(rng, 0, 256);
}

function startHop(store, slot, phase, speed = HOP_SPEED) {
  store.phase[slot] = phase;
  store.hopAge[slot] = 0;
  store.waitTicks[slot] = 0;
  const ox = store.originX[slot];
  const oy = store.originY[slot];
  const dx = store.destX[slot];
  const dy = store.destY[slot];
  setHop(store, slot, ox, oy, dx, dy, speed);
  markDirty(store, slot);
}

function nearWater(store, slot) {
  return (
    fx.dist2(
      store.px[slot],
      store.py[slot],
      store.waterX[slot],
      store.waterY[slot],
    ) < fx.mul(TILE, TILE)
  );
}

/** One short hop toward the locked water target. */
function planEscapeHop(w, store, slot) {
  const ox = store.px[slot];
  const oy = store.py[slot];
  const wx = store.waterX[slot];
  const wy = store.waterY[slot];
  let dx = wx - ox;
  let dy = wy - oy;
  let dist = fx.len(dx, dy);
  if (dist <= 0) {
    store.landPulse[slot] = 1;
    freeFrog(store, slot);
    return false;
  }
  const nd = normalizeDir(dx, dy);
  // Last hop: cover the remaining distance if it's short enough.
  let step = rngBetween(w.rng, ESCAPE_HOP_DIST_MIN, ESCAPE_HOP_DIST_MAX);
  if (step > dist) step = dist;
  // Tiny sideways jitter so the dash isn't a laser line.
  const jitter = rngSigned(w.rng, fx.fromFloat(0.9));
  const destX = ox + fx.mul(nd.x, step) + fx.mul(-nd.y, jitter);
  const destY = oy + fx.mul(nd.y, step) + fx.mul(nd.x, jitter);
  setHop(store, slot, ox, oy, destX, destY, ESCAPE_HOP_SPEED);
  store.phase[slot] = FROG_PHASE.ESCAPE;
  store.waitTicks[slot] = 0;
  store.escapeHops[slot] = Math.min(255, store.escapeHops[slot] + 1);
  markDirty(store, slot);
  return true;
}

/** After CC linger, start a chain of small fast hops toward water. */
function beginEscapeToWater(w, field, store, slot) {
  const water = findNearestWater(field, store.px[slot], store.py[slot]);
  if (!water) {
    freeFrog(store, slot);
    return false;
  }
  store.waterX[slot] = water.x;
  store.waterY[slot] = water.y;
  store.escaping[slot] = 1;
  store.escapeHops[slot] = 0;
  if (nearWater(store, slot)) {
    store.landPulse[slot] = 1;
    freeFrog(store, slot);
    return true;
  }
  return planEscapeHop(w, store, slot);
}

/**
 * Spawn messy clusters of frogs that will wander toward aim.
 * @returns {number} frogs spawned
 */
export function spawnFrogPlague(w, {
  owner,
  source,
  x,
  y,
  aimX,
  aimY,
  damage,
  count = FROG_COUNT,
}) {
  const store = w.frogs;
  if (!store) return 0;
  const rng = w.rng;

  let adx = aimX - x;
  let ady = aimY - y;
  let adist = fx.len(adx, ady);
  if (adist <= 0) {
    adx = fx.ONE;
    ady = 0;
    adist = fx.ONE;
  }
  const base = normalizeDir(adx, ady);
  const perpX = -base.y;
  const perpY = base.x;

  // A few soft cluster attractors scattered in the cast cone.
  const clusterN = FROG_CLUSTERS;
  const clusterX = new Int32Array(clusterN);
  const clusterY = new Int32Array(clusterN);
  for (let c = 0; c < clusterN; c++) {
    const depthT = (c + 1) / (clusterN + 1);
    const depth = FIRST_HOP_NEAR + fx.mul(FIRST_HOP_FAR - FIRST_HOP_NEAR, fx.fromFloat(depthT));
    const lateral = rngSigned(rng, CLUSTER_LATERAL);
    clusterX[c] = x + fx.mul(base.x, depth) + fx.mul(perpX, lateral);
    clusterY[c] = y + fx.mul(base.y, depth) + fx.mul(perpY, lateral);
  }

  let spawned = 0;
  const n = Math.max(1, count | 0);
  for (let i = 0; i < n; i++) {
    const slot = allocFrog(store);
    if (slot < 0) break;

    const cluster = i % clusterN;
    // Personal heading: cast dir with a bit of uniqueness.
    const heading = normalizeDir(
      base.x + fx.mul(perpX, rngSigned(rng, fx.fromFloat(0.35))),
      base.y + fx.mul(perpY, rngSigned(rng, fx.fromFloat(0.35))),
    );
    store.dirX[slot] = heading.x;
    store.dirY[slot] = heading.y;

    // First landing: near cluster center, not on a neat arc.
    const jitterX = rngSigned(rng, fx.fromFloat(4.5));
    const jitterY = rngSigned(rng, fx.fromFloat(4.5));
    const destX = clusterX[cluster] + jitterX;
    const destY = clusterY[cluster] + jitterY;

    // Staggered pop out from slightly different spots around the caster.
    const spawnJitter = fx.fromFloat(1.8);
    const sx = x + rngSigned(rng, spawnJitter);
    const sy = y + rngSigned(rng, spawnJitter);

    store.owner[slot] = owner & 0xff;
    store.source[slot] = source ?? -1;
    store.hopsLeft[slot] = rngRange(rng, FROG_HOPS_MIN, FROG_HOPS_MAX + 1);
    store.hopsDone[slot] = 0;
    store.damage[slot] = Math.max(1, damage | 0);
    setHop(store, slot, sx, sy, destX, destY);
    store.phase[slot] = FROG_PHASE.WAIT;
    store.waitTicks[slot] =
      i * FROG_LAUNCH_STAGGER + rngRange(rng, 0, FROG_LAUNCH_STAGGER + 3);
    markDirty(store, slot);
    spawned++;
  }
  return spawned;
}

/** Advance hoppers; publish only on phase changes. */
export function frogSystem(w, field = null) {
  const store = w.frogs;
  if (!store || store.activeCount === 0) return;

  const end = store.highWater;
  for (let slot = 0; slot < end; slot++) {
    if (!store.alive[slot]) continue;
    store.landPulse[slot] = 0;

    const phase = store.phase[slot];

    if (phase === FROG_PHASE.WAIT) {
      if (store.waitTicks[slot] > 0) {
        store.waitTicks[slot]--;
        continue;
      }
      if (store.escaping[slot]) {
        if (nearWater(store, slot) || store.escapeHops[slot] >= ESCAPE_HOPS_MAX) {
          store.landPulse[slot] = 1;
          freeFrog(store, slot);
        } else {
          planEscapeHop(w, store, slot);
        }
      } else {
        startHop(
          store,
          slot,
          store.hopsDone[slot] === 0 ? FROG_PHASE.OUT : FROG_PHASE.AWAY,
        );
      }
      continue;
    }

    if (phase === FROG_PHASE.LINGER) {
      if (store.waitTicks[slot] > 0) {
        store.waitTicks[slot]--;
        if (store.waitTicks[slot] > 0) continue;
      }

      // Maybe birth a buddy while hanging out.
      if (store.hopsLeft[slot] > 0) tryBirthChild(w, store, slot);

      if (store.hopsLeft[slot] <= 0) {
        // CC sit finished — scoot into water if there's any nearby.
        beginEscapeToWater(w, field, store, slot);
        continue;
      }

      // Own next hop — wander with cast-biased heading.
      planWanderHop(w, store, slot);
      store.phase[slot] = FROG_PHASE.WAIT;
      store.waitTicks[slot] = rngRange(w.rng, 0, 6);
      markDirty(store, slot);
      continue;
    }

    // HOPPING (OUT / AWAY / ESCAPE)
    const dur = store.hopDuration[slot];
    let age = store.hopAge[slot] + 1;
    if (age > dur) age = dur;
    store.hopAge[slot] = age;

    const t = fx.div(fx.fromInt(age), fx.fromInt(dur));
    const ox = store.originX[slot];
    const oy = store.originY[slot];
    store.px[slot] = ox + fx.mul(store.destX[slot] - ox, t);
    store.py[slot] = oy + fx.mul(store.destY[slot] - oy, t);

    if (age < dur) continue;

    const ix = store.destX[slot];
    const iy = store.destY[slot];
    store.px[slot] = ix;
    store.py[slot] = iy;

    if (store.escaping[slot] || phase === FROG_PHASE.ESCAPE) {
      store.landPulse[slot] = 1;
      // Made it / close enough / hop budget spent.
      if (
        nearWater(store, slot) ||
        store.escapeHops[slot] >= ESCAPE_HOPS_MAX
      ) {
        freeFrog(store, slot);
        continue;
      }
      // Brief pause, then another small hop toward water.
      store.phase[slot] = FROG_PHASE.WAIT;
      store.waitTicks[slot] = rngRange(w.rng, ESCAPE_PAUSE_MIN, ESCAPE_PAUSE_MAX + 1);
      store.originX[slot] = store.px[slot];
      store.originY[slot] = store.py[slot];
      store.destX[slot] = store.px[slot];
      store.destY[slot] = store.py[slot];
      markDirty(store, slot);
      continue;
    }

    splashAndDistract(
      w,
      ix,
      iy,
      store.owner[slot],
      store.source[slot],
      store.damage[slot],
    );
    store.landPulse[slot] = 1;
    if (store.hopsLeft[slot] > 0) store.hopsLeft[slot]--;
    store.hopsDone[slot] = Math.min(255, store.hopsDone[slot] + 1);
    beginLinger(w, store, slot);
  }
}

/** Drain dirty slots for worker → main publish (state changes only). */
export function takeFrogUpdates(w) {
  const store = w.frogs;
  if (!store) return null;
  const dirty = store.dirty;
  if (dirty.length === 0) return null;
  const n = dirty.length;
  const slots = new Uint16Array(n);
  const alive = new Uint8Array(n);
  const generation = new Uint32Array(n);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const originX = new Float32Array(n);
  const originY = new Float32Array(n);
  const destX = new Float32Array(n);
  const destY = new Float32Array(n);
  const hopProgress = new Float32Array(n);
  const hopDuration = new Uint16Array(n);
  const phase = new Uint8Array(n);
  const landPulse = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const slot = dirty[i];
    store.dirtyFlag[slot] = 0;
    slots[i] = slot;
    alive[i] = store.alive[slot];
    generation[i] = store.generation[slot];
    px[i] = fx.toFloat(store.px[slot]);
    py[i] = fx.toFloat(store.py[slot]);
    originX[i] = fx.toFloat(store.originX[slot]);
    originY[i] = fx.toFloat(store.originY[slot]);
    destX[i] = fx.toFloat(store.destX[slot]);
    destY[i] = fx.toFloat(store.destY[slot]);
    const dur = store.hopDuration[slot];
    hopDuration[i] = dur;
    hopProgress[i] = dur > 0 ? store.hopAge[slot] / dur : 0;
    phase[i] = store.phase[slot];
    landPulse[i] = store.landPulse[slot];
    store.landPulse[slot] = 0;
  }
  store.dirty = [];
  return {
    slots,
    alive,
    generation,
    px,
    py,
    originX,
    originY,
    destX,
    destY,
    hopProgress,
    hopDuration,
    phase,
    landPulse,
  };
}

export function mixFrogChecksum(mix, w) {
  const store = w.frogs;
  if (!store) return;
  mix(store.activeCount);
  mix(store.freeTop);
  mix(store.highWater);
  mix(store.allocatorHash);
  for (let i = 0; i < store.highWater; i++) {
    mix(store.generation[i]);
    mix(store.alive[i]);
    if (!store.alive[i]) continue;
    mix(store.owner[i]);
    mix(store.source[i]);
    mix(store.px[i]);
    mix(store.py[i]);
    mix(store.originX[i]);
    mix(store.originY[i]);
    mix(store.destX[i]);
    mix(store.destY[i]);
    mix(store.dirX[i]);
    mix(store.dirY[i]);
    mix(store.hopAge[i]);
    mix(store.hopDuration[i]);
    mix(store.phase[i]);
    mix(store.hopsLeft[i]);
    mix(store.hopsDone[i]);
    mix(store.waitTicks[i]);
    mix(store.escaping[i]);
    mix(store.waterX[i]);
    mix(store.waterY[i]);
    mix(store.escapeHops[i]);
    mix(store.damage[i]);
  }
}
