// Structure-of-Arrays entity store. Data-oriented for two reasons at once:
//   1) cache-friendly iteration in the hot tick loop, and
//   2) it maps straight onto Babylon Lite thin-instance buffers in render/.
//
// Entities are plain integer indices. Components are parallel typed arrays.
// Position/velocity/target are Q16.16 fixed-point stored in Int32Array (which
// also enforces the int32 range constraint from fixed.js for free).

import { makeRng } from './rng.js';
import { getUnitDef } from './unitTypes.js';
import { MAX_WAYPOINTS } from './path.js';
import { createSpatialGrid } from './spatialGrid.js';
import { createProjectileStore } from './projectiles.js';

// Storage headroom is intentionally above the supported 50k stress target.
// Keep this centralized: world state and the SharedArrayBuffer derive from it.
export const MAX_ENTITIES = 65536;
export const STRESS_ENTITY_LIMIT = 50000;

export const ORDER = {
  IDLE: 0,
  MOVE: 1,
  ATTACK: 2,
  ATTACK_MOVE: 3,
};

export function createWorld(seed) {
  const engagementTarget = new Int32Array(MAX_ENTITIES);
  const engagementSlot = new Int16Array(MAX_ENTITIES);
  engagementTarget.fill(-1);
  engagementSlot.fill(-1);
  return {
    tick: 0,
    count: 0,
    pathLosCursor: 0,
    pathAstarCursor: 0,
    rng: makeRng(seed),
    ORDER,
    spatial: createSpatialGrid(MAX_ENTITIES),
    projectiles: createProjectileStore(),
    metrics: {
      combatCandidates: 0,
      separationPairs: 0,
      movingAvoidancePairs: 0,
      losAttempts: 0,
      astarSearches: 0,
      projectileSpawned: 0,
      projectileHits: 0,
      projectileMisses: 0,
      projectileOverflow: 0,
      projectileActive: 0,
    },

    // transform
    px: new Int32Array(MAX_ENTITIES),
    py: new Int32Array(MAX_ENTITIES),
    vx: new Int32Array(MAX_ENTITIES),
    vy: new Int32Array(MAX_ENTITIES),

    // movement order (legacy direct-seek; path system drives actual motion)
    tx: new Int32Array(MAX_ENTITIES),
    ty: new Int32Array(MAX_ENTITIES),
    hasTarget: new Uint8Array(MAX_ENTITIES),
    speed: new Int32Array(MAX_ENTITIES),

    // orders
    order: new Uint8Array(MAX_ENTITIES),
    targetEntity: new Int32Array(MAX_ENTITIES), // -1 = none
    engagementTarget,
    engagementSlot,
    engagementMask: new Uint16Array(MAX_ENTITIES),
    targetLoad: new Uint16Array(MAX_ENTITIES),

    // pathfinding
    navDestX: new Int32Array(MAX_ENTITIES),
    navDestY: new Int32Array(MAX_ENTITIES),
    navWpCount: new Uint8Array(MAX_ENTITIES),
    navWpIndex: new Uint8Array(MAX_ENTITIES),
    pathRequest: new Uint8Array(MAX_ENTITIES),
    navWx: new Int32Array(MAX_ENTITIES * MAX_WAYPOINTS),
    navWy: new Int32Array(MAX_ENTITIES * MAX_WAYPOINTS),
    stuckTicks: new Uint8Array(MAX_ENTITIES),
    repathCount: new Uint8Array(MAX_ENTITIES),
    lastPx: new Int32Array(MAX_ENTITIES),
    lastPy: new Int32Array(MAX_ENTITIES),

    // combat
    attackCd: new Int16Array(MAX_ENTITIES),
    abilityCd: new Int16Array(MAX_ENTITIES),

    // gameplay
    hp: new Int32Array(MAX_ENTITIES),
    type: new Uint8Array(MAX_ENTITIES),
    owner: new Uint8Array(MAX_ENTITIES),
    alive: new Uint8Array(MAX_ENTITIES),
  };
}

export function spawn(w, { x = 0, y = 0, type = 0, owner = 0, hp, speed } = {}) {
  if (w.count >= MAX_ENTITIES) {
    throw new RangeError(`entity capacity exceeded (${MAX_ENTITIES})`);
  }
  const def = getUnitDef(type);
  const i = w.count++;
  w.px[i] = x;
  w.py[i] = y;
  w.vx[i] = 0;
  w.vy[i] = 0;
  w.tx[i] = x;
  w.ty[i] = y;
  w.hasTarget[i] = 0;
  w.speed[i] = speed ?? def.speed;
  w.order[i] = ORDER.IDLE;
  w.targetEntity[i] = -1;
  w.engagementTarget[i] = -1;
  w.engagementSlot[i] = -1;
  w.engagementMask[i] = 0;
  w.targetLoad[i] = 0;
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = 0;
  w.navDestX[i] = x;
  w.navDestY[i] = y;
  w.stuckTicks[i] = 0;
  w.repathCount[i] = 0;
  w.lastPx[i] = x;
  w.lastPy[i] = y;
  w.attackCd[i] = 0;
  w.abilityCd[i] = 0;
  w.hp[i] = hp ?? def.hp;
  w.type[i] = type;
  w.owner[i] = owner;
  w.alive[i] = 1;
  return i;
}

export function livingCount(w) {
  let n = 0;
  for (let i = 0; i < w.count; i++) if (w.alive[i]) n++;
  return n;
}

export function livingByOwner(w, owner) {
  let n = 0;
  for (let i = 0; i < w.count; i++) if (w.alive[i] && w.owner[i] === owner) n++;
  return n;
}

