// Deterministic pooled projectile simulation. Projectiles are not entities.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';
import { lineClear } from './field.js';
import { getProjectileDef } from './projectileTypes.js';
import { isHostile } from './teams.js';
import { applyTreeSplash } from './trees.js';
import { spawnFireZone } from './fireZones.js';
import { fireballBlastLob } from './monkKick.js';
import { rngFrac } from './rng.js';
import {
  queryCellBounds,
  rebuildSpatialGrid,
  spatialCellId,
} from './spatialGrid.js';
import {
  applyFrost,
  applyShadowDot,
  LOCUST_DISTRACT_TICKS,
} from './combatStatus.js';
import { applyDistract } from './frogs.js';

export const MAX_PROJECTILES = 32768;
/** Max unique entities a path-hit projectile can damage. */
export const MAX_PATH_HITS = 8;

export const PROJECTILE_DESPAWN = {
  NONE: 0,
  HIT: 1,
  MISS: 2,
  TERRAIN: 3,
};

export function createProjectileStore(capacity = MAX_PROJECTILES) {
  const freeStack = new Int32Array(capacity);
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;
  const pathHits = new Int32Array(capacity * MAX_PATH_HITS);
  pathHits.fill(-1);
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
    wanderOx: new Int32Array(capacity),
    wanderOy: new Int32Array(capacity),
    damage: new Int32Array(capacity),
    age: new Uint16Array(capacity),
    lifetime: new Uint16Array(capacity),
    hitCount: new Uint8Array(capacity),
    despawnReason: new Uint8Array(capacity),
    pathHits,
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
  const aimed = applyAimScatter(w, x, y, aimX, aimY, def.aimScatter);
  store.aimX[slot] = aimed.aimX;
  store.aimY[slot] = aimed.aimY;
  store.wanderOx[slot] = 0;
  store.wanderOy[slot] = 0;
  store.damage[slot] = damage;
  store.age[slot] = 0;
  store.hitCount[slot] = 0;
  store.despawnReason[slot] = PROJECTILE_DESPAWN.NONE;
  const hitBase = slot * MAX_PATH_HITS;
  for (let h = 0; h < MAX_PATH_HITS; h++) store.pathHits[hitBase + h] = -1;

  const dx = aimed.aimX - x;
  const dy = aimed.aimY - y;
  const dist = fx.len(dx, dy);
  setVelocity(store, slot, dx, dy, dist, def.speed);
  const travelTicks = dist > 0 ? Math.ceil(dist / Math.max(1, def.speed)) + 2 : 1;
  store.lifetime[slot] = Math.min(def.maxTicks, Math.max(1, travelTicks));
  store.activeCount++;
  w.metrics.projectileSpawned++;
  return slot;
}

/** Deterministic aim wander; max offset grows with throw distance. */
function applyAimScatter(w, x, y, aimX, aimY, scatter) {
  if (!scatter || scatter <= 0 || !w?.rng) return { aimX, aimY };
  const dist = fx.len(aimX - x, aimY - y);
  if (dist <= 0) return { aimX, aimY };
  let maxOffset = fx.mul(dist, scatter);
  const cap = fx.fromFloat(20);
  if (maxOffset > cap) maxOffset = cap;
  // Signed [-1, 1) from the sim RNG — farther shots use a larger maxOffset.
  const nx = (rngFrac(w.rng) - fx.HALF) * 2;
  const ny = (rngFrac(w.rng) - fx.HALF) * 2;
  return {
    aimX: aimX + fx.mul(maxOffset, nx),
    aimY: aimY + fx.mul(maxOffset, ny),
  };
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

function alreadyPathHit(store, slot, entity) {
  const base = slot * MAX_PATH_HITS;
  const n = store.hitCount[slot];
  for (let h = 0; h < n; h++) {
    if (store.pathHits[base + h] === entity) return true;
  }
  return false;
}

function recordPathHit(store, slot, entity) {
  const n = store.hitCount[slot];
  if (n >= MAX_PATH_HITS) return false;
  store.pathHits[slot * MAX_PATH_HITS + n] = entity;
  store.hitCount[slot] = n + 1;
  return true;
}

function applyHitEffects(w, def, entity, source) {
  if (def.appliesDot) applyShadowDot(w, entity, { source });
  if (def.appliesFrost) applyFrost(w, entity);
  if (def.appliesDistract) applyDistract(w, entity, LOCUST_DISTRACT_TICKS);
}

function hitEntity(w, store, slot, def, entity) {
  applyDamage(w, entity, store.damage[slot], store.source[slot]);
  applyHitEffects(w, def, entity, store.source[slot]);
}

/** Splash at impact point; hostiles take full damage, friendlies use multiplier. */
function applySplash(w, slot, impactX, impactY, def, field) {
  const store = w.projectiles;
  const radius = def.splashRadius;
  if (!radius || radius <= 0) return false;
  const radius2 = fx.mul(radius, radius);
  const baseDamage = store.damage[slot];
  const owner = store.owner[slot];
  const source = store.source[slot];
  const friendlyMul = def.friendlyFireMultiplier ?? 0;
  let hit = false;

  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (fx.dist2(impactX, impactY, w.px[i], w.py[i]) > radius2) continue;
    let dmg = baseDamage;
    if (!isHostile(owner, w.owner[i])) {
      if (friendlyMul <= 0) continue;
      dmg = Math.max(1, Math.round(baseDamage * friendlyMul));
    }
    if (applyDamage(w, i, dmg, source)) hit = true;
  }
  if (def.ignitesTrees && field && applyTreeSplash(field, impactX, impactY, radius)) {
    hit = true;
  }
  if (def.leavesGroundFire) {
    // Slightly tighter than splash so walking the rim isn't a free DoT.
    const zoneRadius = fx.mul(radius, fx.fromFloat(0.85));
    spawnFireZone(w, {
      x: impactX,
      y: impactY,
      radius: zoneRadius,
      owner,
      source,
      friendlyMul: friendlyMul,
    });
  }
  if (def.blastLob) {
    if (fireballBlastLob(w, field, impactX, impactY, radius) > 0) hit = true;
  }
  return hit;
}

function refreshWander(w, store, slot, def) {
  const period = def.wanderPeriod | 0;
  if (!period || !def.wanderAmount) return;
  if (store.age[slot] % period !== 0) return;
  if (!w?.rng) return;
  const nx = (rngFrac(w.rng) - fx.HALF) * 2;
  const ny = (rngFrac(w.rng) - fx.HALF) * 2;
  store.wanderOx[slot] = fx.mul(def.wanderAmount, nx);
  store.wanderOy[slot] = fx.mul(def.wanderAmount, ny);
}

/** Damage hostiles near the projectile; skip already-hit entities. */
function applyPathHits(w, store, slot, def) {
  const grid = w.spatial;
  if (!grid) return false;
  const cx = store.px[slot];
  const cy = store.py[slot];
  const radius = def.hitRadius;
  const radius2 = fx.mul(radius, radius);
  const owner = store.owner[slot];
  const pierce = def.pierce || 1;
  const bounds = queryCellBounds(cx, cy, radius, grid);
  let any = false;

  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      let i = grid.head[spatialCellId(x, z, grid)];
      while (i >= 0) {
        if (
          w.alive[i] &&
          isHostile(owner, w.owner[i]) &&
          fx.dist2(cx, cy, w.px[i], w.py[i]) <= radius2 &&
          !alreadyPathHit(store, slot, i)
        ) {
          if (!recordPathHit(store, slot, i)) {
            i = grid.next[i];
            continue;
          }
          hitEntity(w, store, slot, def, i);
          any = true;
          if (store.hitCount[slot] >= pierce) return true;
        }
        i = grid.next[i];
      }
    }
  }
  return any;
}

export function projectileSystem(w, field) {
  const store = w.projectiles;
  let needPathGrid = false;
  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.alive[slot]) continue;
    if (getProjectileDef(store.type[slot]).pathHit) {
      needPathGrid = true;
      break;
    }
  }
  if (needPathGrid) rebuildSpatialGrid(w.spatial, w);

  for (let slot = 0; slot < store.capacity; slot++) {
    if (!store.alive[slot]) continue;
    const def = getProjectileDef(store.type[slot]);
    const target = store.target[slot];
    const targetAlive = target >= 0 && target < w.count && w.alive[target];

    if (targetAlive && def.homing) {
      store.aimX[slot] = w.px[target];
      store.aimY[slot] = w.py[target];
    }

    refreshWander(w, store, slot, def);
    const aimX = store.aimX[slot] + store.wanderOx[slot];
    const aimY = store.aimY[slot] + store.wanderOy[slot];

    const dx = aimX - store.px[slot];
    const dy = aimY - store.py[slot];
    const dist = fx.len(dx, dy);
    setVelocity(store, slot, dx, dy, dist, def.speed);
    const nextX = store.px[slot] + store.vx[slot];
    const nextY = store.py[slot] + store.vy[slot];

    if (
      def.blockedByTerrain &&
      !lineClear(field, store.px[slot], store.py[slot], nextX, nextY)
    ) {
      if (def.splashRadius > 0) {
        const hit = applySplash(w, slot, store.px[slot], store.py[slot], def, field);
        freeProjectile(w, slot, hit ? PROJECTILE_DESPAWN.HIT : PROJECTILE_DESPAWN.TERRAIN);
      } else {
        freeProjectile(w, slot, PROJECTILE_DESPAWN.TERRAIN);
      }
      continue;
    }

    store.px[slot] = nextX;
    store.py[slot] = nextY;
    store.age[slot]++;

    if (!(def.splashRadius > 0)) {
      if (def.pathHit) {
        applyPathHits(w, store, slot, def);
        if (store.hitCount[slot] >= (def.pierce || 1)) {
          freeProjectile(w, slot, PROJECTILE_DESPAWN.HIT);
          continue;
        }
      } else if (targetAlive) {
        const hitRadius2 = fx.mul(def.hitRadius, def.hitRadius);
        if (fx.dist2(nextX, nextY, w.px[target], w.py[target]) <= hitRadius2) {
          hitEntity(w, store, slot, def, target);
          store.hitCount[slot]++;
          if (store.hitCount[slot] >= def.pierce) {
            freeProjectile(w, slot, PROJECTILE_DESPAWN.HIT);
            continue;
          }
        }
      }
    }

    const reachedAim = dist <= def.speed;
    if (
      store.age[slot] >= store.lifetime[slot] ||
      (reachedAim && (!targetAlive || !def.homing || def.splashRadius > 0))
    ) {
      if (def.splashRadius > 0) {
        const ix = reachedAim ? store.aimX[slot] : nextX;
        const iy = reachedAim ? store.aimY[slot] : nextY;
        const hit = applySplash(w, slot, ix, iy, def, field);
        freeProjectile(w, slot, hit ? PROJECTILE_DESPAWN.HIT : PROJECTILE_DESPAWN.MISS);
      } else {
        const hadHit = store.hitCount[slot] > 0;
        freeProjectile(w, slot, hadHit ? PROJECTILE_DESPAWN.HIT : PROJECTILE_DESPAWN.MISS);
      }
    }
  }
  w.metrics.projectileActive = store.activeCount;
}
