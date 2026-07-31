// Deterministic pooled projectile simulation. Projectiles are not entities.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';
import { lineClear } from './field.js';
import { getProjectileDef } from './projectileTypes.js';

export const MAX_PROJECTILES = 32768;

export const PROJECTILE_DESPAWN = {
  NONE: 0,
  HIT: 1,
  MISS: 2,
  TERRAIN: 3,
};

export function createProjectileStore(capacity = MAX_PROJECTILES) {
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
    type: new Uint8Array(capacity),
    owner: new Uint8Array(capacity),
    generation: new Uint32Array(capacity),
    source: new Int32Array(capacity),
    target: new Int32Array(capacity),
    px: new Int32Array(capacity),
    py: new Int32Array(capacity),
    vx: new Int32Array(capacity),
    vy: new Int32Array(capacity),
    aimX: new Int32Array(capacity),
    aimY: new Int32Array(capacity),
    damage: new Int32Array(capacity),
    age: new Uint16Array(capacity),
    lifetime: new Uint16Array(capacity),
    hitCount: new Uint8Array(capacity),
    despawnReason: new Uint8Array(capacity),
  };
}

export function spawnProjectile(w, {
  type,
  owner,
  source,
  target,
  x,
  y,
  aimX,
  aimY,
  damage,
}) {
  const store = w.projectiles;
  if (store.freeTop <= 0) {
    w.metrics.projectileOverflow++;
    return -1;
  }
  const slot = store.freeStack[--store.freeTop];
  const def = getProjectileDef(type);
  store.generation[slot] = (store.generation[slot] + 1) >>> 0 || 1;
  if (slot + 1 > store.highWater) store.highWater = slot + 1;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot ^ store.generation[slot]) | 0,
    0x01000193,
  );
  store.alive[slot] = 1;
  store.type[slot] = type;
  store.owner[slot] = owner;
  store.source[slot] = source;
  store.target[slot] = target;
  store.px[slot] = x;
  store.py[slot] = y;
  store.aimX[slot] = aimX;
  store.aimY[slot] = aimY;
  store.damage[slot] = damage;
  store.age[slot] = 0;
  store.hitCount[slot] = 0;
  store.despawnReason[slot] = PROJECTILE_DESPAWN.NONE;

  const dx = aimX - x;
  const dy = aimY - y;
  const dist = fx.len(dx, dy);
  setVelocity(store, slot, dx, dy, dist, def.speed);
  const travelTicks = dist > 0 ? Math.ceil(dist / Math.max(1, def.speed)) + 2 : 1;
  store.lifetime[slot] = Math.min(def.maxTicks, Math.max(1, travelTicks));
  store.activeCount++;
  w.metrics.projectileSpawned++;
  return slot;
}

function setVelocity(store, slot, dx, dy, dist, speed) {
  if (dist <= 0) {
    store.vx[slot] = 0;
    store.vy[slot] = 0;
    return;
  }
  const step = dist < speed ? dist : speed;
  store.vx[slot] = fx.mul(fx.div(dx, dist), step);
  store.vy[slot] = fx.mul(fx.div(dy, dist), step);
}

function freeProjectile(w, slot, reason) {
  const store = w.projectiles;
  if (!store.alive[slot]) return;
  store.alive[slot] = 0;
  store.despawnReason[slot] = reason;
  store.activeCount--;
  store.freeStack[store.freeTop++] = slot;
  store.allocatorHash = Math.imul(
    (store.allocatorHash ^ slot ^ (reason << 24)) | 0,
    0x01000193,
  );
  if (reason === PROJECTILE_DESPAWN.HIT) w.metrics.projectileHits++;
  else w.metrics.projectileMisses++;
}

export function projectileSystem(w, field) {
  const store = w.projectiles;
  for (let slot = 0; slot < store.capacity; slot++) {
    if (!store.alive[slot]) continue;
    const def = getProjectileDef(store.type[slot]);
    const target = store.target[slot];
    const targetAlive = target >= 0 && target < w.count && w.alive[target];

    if (targetAlive && def.homing) {
      store.aimX[slot] = w.px[target];
      store.aimY[slot] = w.py[target];
    }

    const dx = store.aimX[slot] - store.px[slot];
    const dy = store.aimY[slot] - store.py[slot];
    const dist = fx.len(dx, dy);
    setVelocity(store, slot, dx, dy, dist, def.speed);
    const nextX = store.px[slot] + store.vx[slot];
    const nextY = store.py[slot] + store.vy[slot];

    if (
      def.blockedByTerrain &&
      !lineClear(field, store.px[slot], store.py[slot], nextX, nextY)
    ) {
      freeProjectile(w, slot, PROJECTILE_DESPAWN.TERRAIN);
      continue;
    }

    store.px[slot] = nextX;
    store.py[slot] = nextY;
    store.age[slot]++;

    if (targetAlive) {
      const hitRadius2 = fx.mul(def.hitRadius, def.hitRadius);
      if (fx.dist2(nextX, nextY, w.px[target], w.py[target]) <= hitRadius2) {
        applyDamage(w, target, store.damage[slot], store.source[slot]);
        store.hitCount[slot]++;
        if (store.hitCount[slot] >= def.pierce) {
          freeProjectile(w, slot, PROJECTILE_DESPAWN.HIT);
          continue;
        }
      }
    }

    const reachedAim = dist <= def.speed;
    if (
      store.age[slot] >= store.lifetime[slot] ||
      (reachedAim && (!targetAlive || !def.homing))
    ) {
      freeProjectile(w, slot, PROJECTILE_DESPAWN.MISS);
    }
  }
  w.metrics.projectileActive = store.activeCount;
}
