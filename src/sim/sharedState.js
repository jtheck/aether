// SharedArrayBuffer layout for main-thread render/input ↔ worker sim sync.
// Worker writes after each step; main copies out on stepDone (no torn reads).

import { MAX_ENTITIES } from './world.js';
import { MAX_PROJECTILES } from './projectiles.js';

export const SHARED_LAYOUT_VERSION = 6;
const HEADER_I32 = 6; // version, unitCount, tick, projectileActive, publishSeq, projectileHighWater

export function simSharedByteSize() {
  return (
    HEADER_I32 * 4 +
    MAX_ENTITIES * 4 + // px
    MAX_ENTITIES * 4 + // py
    MAX_ENTITIES * 4 + // hp
    MAX_ENTITIES * 2 + // shieldHp (absorb remaining)
    MAX_ENTITIES * 2 + // frostTicks
    MAX_ENTITIES * 2 + // dotTicks
    MAX_ENTITIES + // alive
    MAX_ENTITIES + // owner
    MAX_ENTITIES + // type (written once at init)
    MAX_ENTITIES + // order (IDLE / MOVE / ATTACK / ATTACK_MOVE / REPAIR)
    MAX_ENTITIES * 4 + // carriedBy (−1 = free)
    MAX_PROJECTILES * 4 * 4 + // projectile px, py, vx, vy
    MAX_PROJECTILES * 4 + // projectile generation
    MAX_PROJECTILES * 2 * 2 + // projectile age, lifetime
    MAX_PROJECTILES * 4 // projectile alive, type, owner, despawn reason
  );
}

export function mapSharedState(sab) {
  let o = 0;
  const header = new Int32Array(sab, o, HEADER_I32);
  o += HEADER_I32 * 4;
  const px = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const py = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const hp = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;
  const shieldHp = new Int16Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 2;
  const frostTicks = new Int16Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 2;
  const dotTicks = new Int16Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 2;
  const alive = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const owner = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const type = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const order = new Uint8Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES;
  const carriedBy = new Int32Array(sab, o, MAX_ENTITIES);
  o += MAX_ENTITIES * 4;

  const projectilePx = new Int32Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 4;
  const projectilePy = new Int32Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 4;
  const projectileVx = new Int32Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 4;
  const projectileVy = new Int32Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 4;
  const projectileGeneration = new Uint32Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 4;
  const projectileAge = new Uint16Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 2;
  const projectileLifetime = new Uint16Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES * 2;
  const projectileAlive = new Uint8Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES;
  const projectileType = new Uint8Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES;
  const projectileOwner = new Uint8Array(sab, o, MAX_PROJECTILES);
  o += MAX_PROJECTILES;
  const projectileDespawnReason = new Uint8Array(sab, o, MAX_PROJECTILES);

  header[0] = SHARED_LAYOUT_VERSION;
  carriedBy.fill(-1);
  return {
    header,
    px,
    py,
    hp,
    shieldHp,
    frostTicks,
    dotTicks,
    alive,
    owner,
    type,
    order,
    carriedBy,
    projectiles: {
      px: projectilePx,
      py: projectilePy,
      vx: projectileVx,
      vy: projectileVy,
      generation: projectileGeneration,
      age: projectileAge,
      lifetime: projectileLifetime,
      alive: projectileAlive,
      type: projectileType,
      owner: projectileOwner,
      despawnReason: projectileDespawnReason,
    },
  };
}

export function publishType(w, s, start = 0) {
  if (start >= w.count) return;
  s.type.set(w.type.subarray(start, w.count), start);
}

export function publishWorld(w, s) {
  const n = w.count;
  s.header[0] = SHARED_LAYOUT_VERSION;
  s.header[1] = n;
  s.header[2] = w.tick;
  s.px.set(w.px.subarray(0, n));
  s.py.set(w.py.subarray(0, n));
  s.hp.set(w.hp.subarray(0, n));
  s.shieldHp.set(w.shieldHp.subarray(0, n));
  if (s.frostTicks && w.frostTicks) s.frostTicks.set(w.frostTicks.subarray(0, n));
  if (s.dotTicks && w.dotTicks) s.dotTicks.set(w.dotTicks.subarray(0, n));
  s.alive.set(w.alive.subarray(0, n));
  s.owner.set(w.owner.subarray(0, n));
  s.order.set(w.order.subarray(0, n));
  if (w.carriedBy && s.carriedBy) {
    s.carriedBy.set(w.carriedBy.subarray(0, n));
  }
}

export function publishProjectiles(w, s) {
  const p = w.projectiles;
  const n = p.highWater;
  s.header[3] = p.activeCount;
  s.header[5] = n;
  s.projectiles.px.set(p.px.subarray(0, n));
  s.projectiles.py.set(p.py.subarray(0, n));
  s.projectiles.vx.set(p.vx.subarray(0, n));
  s.projectiles.vy.set(p.vy.subarray(0, n));
  s.projectiles.generation.set(p.generation.subarray(0, n));
  s.projectiles.age.set(p.age.subarray(0, n));
  s.projectiles.lifetime.set(p.lifetime.subarray(0, n));
  s.projectiles.alive.set(p.alive.subarray(0, n));
  s.projectiles.type.set(p.type.subarray(0, n));
  s.projectiles.owner.set(p.owner.subarray(0, n));
  s.projectiles.despawnReason.set(p.despawnReason.subarray(0, n));
}

export function beginSharedPublish(s) {
  Atomics.add(s.header, 4, 1);
}

export function endSharedPublish(s) {
  Atomics.add(s.header, 4, 1);
}

/** Read-only facade matching the fields input/render expect from world. */
export function simViewFacade(s) {
  return {
    get count() {
      return s.header[1];
    },
    get tick() {
      return s.header[2];
    },
    px: s.px,
    py: s.py,
    hp: s.hp,
    shieldHp: s.shieldHp,
    frostTicks: s.frostTicks,
    dotTicks: s.dotTicks,
    alive: s.alive,
    owner: s.owner,
    type: s.type,
    order: s.order,
    carriedBy: s.carriedBy,
    projectiles: {
      get activeCount() {
        return s.header[3];
      },
      get highWater() {
        return s.header[5];
      },
      px: s.projectiles.px,
      py: s.projectiles.py,
      vx: s.projectiles.vx,
      vy: s.projectiles.vy,
      generation: s.projectiles.generation,
      age: s.projectiles.age,
      lifetime: s.projectiles.lifetime,
      alive: s.projectiles.alive,
      type: s.projectiles.type,
      owner: s.projectiles.owner,
      despawnReason: s.projectiles.despawnReason,
    },
  };
}
