// Short-lived ground fire patches left by fireball splash.
// Authoritative sim store; render sustains FX from dirty publish patches.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';
import { isHostile } from './teams.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  spatialCellId,
} from './spatialGrid.js';

export const MAX_FIRE_ZONES = 256;
/** ~2.5s at 20Hz. */
export const FIRE_ZONE_TTL = 50;
/** Damage pulse cadence (~0.25s). */
export const FIRE_ZONE_DAMAGE_INTERVAL = 5;
/** HP per pulse while standing in the patch. */
export const FIRE_ZONE_DAMAGE = 2;

export function createFireZoneStore(capacity = MAX_FIRE_ZONES) {
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
    radius: new Int32Array(capacity),
    ttl: new Uint16Array(capacity),
    damage: new Uint16Array(capacity),
    /** Q8: friendly multiplier × 256 (e.g. 64 = 0.25). */
    friendlyMulQ8: new Uint8Array(capacity),
    dirty: [],
  };
}

function markDirty(store, slot) {
  const dirty = store.dirty;
  for (let i = 0; i < dirty.length; i++) {
    if (dirty[i] === slot) return;
  }
  dirty.push(slot);
}

function freeFireZone(store, slot) {
  if (!store.alive[slot]) return;
  store.alive[slot] = 0;
  store.ttl[slot] = 0;
  store.activeCount--;
  store.freeStack[store.freeTop++] = slot;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot) | 0,
    0x01000193,
  );
  markDirty(store, slot);
}

/**
 * @param {object} w
 * @param {{
 *   x: number, y: number, radius: number,
 *   owner: number, source?: number,
 *   damage?: number, friendlyMul?: number, ttl?: number,
 * }} opts
 */
export function spawnFireZone(w, opts) {
  const store = w.fireZones;
  if (!store || store.freeTop <= 0) return -1;
  const slot = store.freeStack[--store.freeTop];
  store.alive[slot] = 1;
  store.generation[slot] = (store.generation[slot] + 1) >>> 0 || 1;
  store.owner[slot] = opts.owner & 0xff;
  store.source[slot] = opts.source ?? -1;
  store.px[slot] = opts.x;
  store.py[slot] = opts.y;
  store.radius[slot] = opts.radius;
  store.ttl[slot] = opts.ttl ?? FIRE_ZONE_TTL;
  store.damage[slot] = opts.damage ?? FIRE_ZONE_DAMAGE;
  const mul = opts.friendlyMul ?? 0.25;
  store.friendlyMulQ8[slot] = Math.max(0, Math.min(255, Math.round(mul * 256)));
  store.activeCount++;
  if (slot + 1 > store.highWater) store.highWater = slot + 1;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot ^ store.generation[slot]) | 0,
    0x01000193,
  );
  markDirty(store, slot);
  return slot;
}

function damageUnitsInZone(w, slot) {
  const store = w.fireZones;
  const grid = w.spatial;
  const cx = store.px[slot];
  const cy = store.py[slot];
  const radius = store.radius[slot];
  const radius2 = fx.mul(radius, radius);
  const owner = store.owner[slot];
  const source = store.source[slot];
  const baseDamage = store.damage[slot];
  const friendlyMulQ8 = store.friendlyMulQ8[slot];
  const bounds = queryCellBounds(cx, cy, radius, grid);

  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      let i = grid.head[spatialCellId(x, z, grid)];
      while (i >= 0) {
        if (w.alive[i] && fx.dist2(cx, cy, w.px[i], w.py[i]) <= radius2) {
          let dmg = baseDamage;
          if (!isHostile(owner, w.owner[i])) {
            if (friendlyMulQ8 <= 0) {
              i = grid.next[i];
              continue;
            }
            dmg = Math.max(1, Math.round((baseDamage * friendlyMulQ8) / 256));
          }
          applyDamage(w, i, dmg, source);
        }
        i = grid.next[i];
      }
    }
  }
}

/** Tick after movement so "walk through" uses post-move positions. */
export function fireZoneSystem(w) {
  const store = w.fireZones;
  if (!store || store.activeCount === 0) return;

  rebuildSpatialGrid(w.spatial, w);

  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.alive[slot]) continue;
    let ttl = store.ttl[slot] - 1;
    store.ttl[slot] = ttl;
    if (ttl <= 0) {
      freeFireZone(store, slot);
      continue;
    }
    // Pulse on interval boundaries (including just after spawn: ttl === FIRE_ZONE_TTL-1
    // won't hit; first pulse at ttl % INTERVAL === 0).
    if (ttl % FIRE_ZONE_DAMAGE_INTERVAL === 0) {
      damageUnitsInZone(w, slot);
    }
  }
}

/** Drain dirty slots for worker → main publish. */
export function takeFireZoneUpdates(w) {
  const store = w.fireZones;
  if (!store) return null;
  const dirty = store.dirty;
  if (dirty.length === 0) return null;
  const n = dirty.length;
  const slots = new Uint16Array(n);
  const alive = new Uint8Array(n);
  const generation = new Uint32Array(n);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const radius = new Float32Array(n);
  const ttl = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const slot = dirty[i];
    slots[i] = slot;
    alive[i] = store.alive[slot];
    generation[i] = store.generation[slot];
    px[i] = fx.toFloat(store.px[slot]);
    py[i] = fx.toFloat(store.py[slot]);
    radius[i] = fx.toFloat(store.radius[slot]);
    ttl[i] = store.ttl[slot];
  }
  store.dirty = [];
  return { slots, alive, generation, px, py, radius, ttl };
}

export function mixFireZoneChecksum(mix, w) {
  const store = w.fireZones;
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
    mix(store.radius[i]);
    mix(store.ttl[i]);
    mix(store.damage[i]);
    mix(store.friendlyMulQ8[i]);
  }
}
