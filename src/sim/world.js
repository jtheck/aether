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
import { createFireZoneStore } from './fireZones.js';
import { createFrogStore } from './frogs.js';
import { createLightningFxStore, createPendingLightningStore } from './lightning.js';
import { createHolyArmorFxStore } from './holyArmor.js';
import {
  createSporeBloomFxStore,
  createSporeGrowthStore,
} from './sporeBloom.js';
import { createMonkKickFxStore } from './monkKick.js';
import { MAX_RESOURCE_OWNERS, RESOURCE_COUNT } from './resources.js';

// Storage headroom is intentionally above the supported 50k stress target.
// Keep this centralized: world state and the SharedArrayBuffer derive from it.
export const MAX_ENTITIES = 65536;
export const STRESS_ENTITY_LIMIT = 50000;

export const ORDER = {
  IDLE: 0,
  MOVE: 1,
  ATTACK: 2,
  ATTACK_MOVE: 3,
  /** Engineer repairing a mechanical ally (or future building). */
  REPAIR: 4,
  /** Villager harvesting a resource node + hauling to a drop-off. */
  GATHER: 5,
  /** Villager or engineer raising a building under construction (see construction.js). */
  BUILD: 6,
  /** Idle amble — path-follows like MOVE, but at stroll speed. */
  WANDER: 7,
};

/** Drop unit / building attack focus (move, stop, gather, death, …). */
export function clearAttackFocus(w, i) {
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  if (w.attackFocus) w.attackFocus[i] = 0;
}

/** Mark a CMD.ATTACK so combat will not steal the clicked target. */
export function lockAttackFocus(w, i) {
  if (w.attackFocus) w.attackFocus[i] = 1;
}

export function createWorld(seed) {
  const engagementTarget = new Int32Array(MAX_ENTITIES);
  const engagementSlot = new Int16Array(MAX_ENTITIES);
  engagementTarget.fill(-1);
  engagementSlot.fill(-1);
  const gatherTile = new Int32Array(MAX_ENTITIES);
  gatherTile.fill(-1);
  const buildTarget = new Int32Array(MAX_ENTITIES);
  buildTarget.fill(-1);
  return {
    tick: 0,
    count: 0,
    pathLosCursor: 0,
    pathAstarCursor: 0,
    rng: makeRng(seed),
    ORDER,
    spatial: createSpatialGrid(MAX_ENTITIES),
    projectiles: createProjectileStore(),
    fireZones: createFireZoneStore(),
    frogs: createFrogStore(),
    lightningFx: createLightningFxStore(),
    pendingLightning: createPendingLightningStore(),
    holyArmorFx: createHolyArmorFxStore(),
    sporeBloomFx: createSporeBloomFxStore(),
    treeGrowth: createSporeGrowthStore(),
    monkKickFx: createMonkKickFxStore(),
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
      /** Diagnostic ms per phase — never feeds sim decisions. */
      timing: null,
    },
    /** When true, step() fills metrics.timing via performance.now (diag only). */
    profileSim: false,

    // transform
    px: new Int32Array(MAX_ENTITIES),
    py: new Int32Array(MAX_ENTITIES),
    vx: new Int32Array(MAX_ENTITIES),
    vy: new Int32Array(MAX_ENTITIES),
    /** Persisted facing (unit vector) — steer blends from this even when idle vx=0. */
    faceX: new Int32Array(MAX_ENTITIES),
    faceY: new Int32Array(MAX_ENTITIES),

    // movement order (legacy direct-seek; path system drives actual motion)
    tx: new Int32Array(MAX_ENTITIES),
    ty: new Int32Array(MAX_ENTITIES),
    hasTarget: new Uint8Array(MAX_ENTITIES),
    speed: new Int32Array(MAX_ENTITIES),

    // orders
    order: new Uint8Array(MAX_ENTITIES),
    targetEntity: new Int32Array(MAX_ENTITIES), // -1 = none
    /** Placeable building index, or -1. Mutually exclusive with targetEntity. */
    targetBuilding: new Int32Array(MAX_ENTITIES).fill(-1),
    /** 1 = CMD.ATTACK focus — acquireTargets must not rebalance off this target. */
    attackFocus: new Uint8Array(MAX_ENTITIES),
    buildings: [],
    buildingsDirty: 0,
    engagementTarget,
    engagementSlot,
    engagementMask: new Uint16Array(MAX_ENTITIES),
    targetLoad: new Uint16Array(MAX_ENTITIES),

    // villager gathering (see gather.js) — tile being harvested + carried load
    gatherTile,
    /** 0 = empty; otherwise (resource kind index + 1), see resources.js RESOURCE_KINDS. */
    carriedKind: new Uint8Array(MAX_ENTITIES),
    carriedAmt: new Int32Array(MAX_ENTITIES),
    /** Ticks until the next harvest bite. */
    gatherCd: new Int16Array(MAX_ENTITIES),
    /** 1 = gather defensively (retaliate on a nearby hostile, then resume). */
    gatherDefensive: new Uint8Array(MAX_ENTITIES),
    /** 0 none / 1 chop at node / 2 haul load back (see gather.js GATHER_ACT). */
    gatherAct: new Uint8Array(MAX_ENTITIES),
    /** Building index this villager is constructing (ORDER.BUILD), or -1. */
    buildTarget,

    // pathfinding
    navDestX: new Int32Array(MAX_ENTITIES),
    navDestY: new Int32Array(MAX_ENTITIES),
    navWpCount: new Uint8Array(MAX_ENTITIES),
    navWpIndex: new Uint8Array(MAX_ENTITIES),
    pathRequest: new Uint8Array(MAX_ENTITIES),
    /** PATH_STYLE: 0 geometric, 1 slow-aware (rally / Drayage / monk / engineer), 2 tree-seek (myco wander). */
    pathSlowAware: new Uint8Array(MAX_ENTITIES),
    /** Remaining extra rally hops after the current dest (trained units). */
    rallyHopCount: new Uint8Array(MAX_ENTITIES),
    rallyHop1X: new Int32Array(MAX_ENTITIES),
    rallyHop1Y: new Int32Array(MAX_ENTITIES),
    rallyHop1Order: new Uint8Array(MAX_ENTITIES),
    rallyHop2X: new Int32Array(MAX_ENTITIES),
    rallyHop2Y: new Int32Array(MAX_ENTITIES),
    rallyHop2Order: new Uint8Array(MAX_ENTITIES),
    navWx: new Int32Array(MAX_ENTITIES * MAX_WAYPOINTS),
    navWy: new Int32Array(MAX_ENTITIES * MAX_WAYPOINTS),
    stuckTicks: new Uint8Array(MAX_ENTITIES),
    repathCount: new Uint8Array(MAX_ENTITIES),
    /** Owner-wide researched tech bitmasks (see tech.js MAX_TECH_OWNERS). */
    tech: new Uint32Array(16),
    /** Set when tech bits change; worker publishes then clears. */
    techDirty: 0,
    /** Per-owner resource banks — wood/stone/mineral/food (see resources.js). */
    resources: new Int32Array(MAX_RESOURCE_OWNERS * RESOURCE_COUNT),
    /** Set when a bank changes; worker publishes then clears. */
    resourcesDirty: 0,
    lastPx: new Int32Array(MAX_ENTITIES),
    lastPy: new Int32Array(MAX_ENTITIES),

    // combat
    attackCd: new Int16Array(MAX_ENTITIES),
    abilityCd: new Int16Array(MAX_ENTITIES),
    /** Ticks remaining of frog-plague confusion (no acquire / no attack). */
    distractCd: new Int16Array(MAX_ENTITIES),
    /** Absorb HP remaining from Holy Armor (and future absorb buffs). */
    shieldHp: new Int16Array(MAX_ENTITIES),
    /** Ticks remaining before shieldHp clears. */
    shieldTicks: new Int16Array(MAX_ENTITIES),
    /** Warlock shadow DoT remaining ticks. */
    dotTicks: new Int16Array(MAX_ENTITIES),
    dotDamage: new Int16Array(MAX_ENTITIES),
    dotPeriod: new Int16Array(MAX_ENTITIES),
    dotAcc: new Int16Array(MAX_ENTITIES),
    dotSource: new Int32Array(MAX_ENTITIES),
    /** Stacking shaman locust chew. */
    locustTicks: new Int16Array(MAX_ENTITIES),
    locustStacks: new Int16Array(MAX_ENTITIES),
    locustAcc: new Int16Array(MAX_ENTITIES),
    locustHops: new Int16Array(MAX_ENTITIES),
    locustSource: new Int32Array(MAX_ENTITIES).fill(-1),
    /** Wizard frost slow remaining ticks. */
    frostTicks: new Int16Array(MAX_ENTITIES),
    /** Monk stick-bonk lob: ticks remaining in air (0 = grounded). */
    lobTicks: new Int16Array(MAX_ENTITIES),
    lobDur: new Int16Array(MAX_ENTITIES),
    lobFromX: new Int32Array(MAX_ENTITIES),
    lobFromY: new Int32Array(MAX_ENTITIES),
    lobToX: new Int32Array(MAX_ENTITIES),
    lobToY: new Int32Array(MAX_ENTITIES),
    /** Render loft peak (world units, integer). */
    lobPeak: new Int16Array(MAX_ENTITIES),
    /** Trail style: 0 dust, 1 fire (see LOB_TRAIL). */
    lobTrail: new Uint8Array(MAX_ENTITIES),
    /**
     * Shared control-group id (selection / multi-unit order).
     * Monks skip bonking same-owner units with the same non-zero squadId.
     */
    squadId: new Int32Array(MAX_ENTITIES),
    nextSquadId: 1,

    // transport — carriedBy / transportTarget are −1 when unset
    carriedBy: new Int32Array(MAX_ENTITIES).fill(-1),
    transportTarget: new Int32Array(MAX_ENTITIES).fill(-1),

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
  // Default face +Y (matches common spawn look); first move eases from here.
  w.faceX[i] = 0;
  w.faceY[i] = 1 << 16; // fx.ONE without importing fixed here
  w.tx[i] = x;
  w.ty[i] = y;
  w.hasTarget[i] = 0;
  w.speed[i] = speed ?? def.speed;
  w.order[i] = ORDER.IDLE;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  if (w.attackFocus) w.attackFocus[i] = 0;
  w.engagementTarget[i] = -1;
  w.engagementSlot[i] = -1;
  w.engagementMask[i] = 0;
  w.targetLoad[i] = 0;
  w.gatherTile[i] = -1;
  w.carriedKind[i] = 0;
  w.carriedAmt[i] = 0;
  w.gatherCd[i] = 0;
  w.gatherDefensive[i] = 0;
  if (w.gatherAct) w.gatherAct[i] = 0;
  w.buildTarget[i] = -1;
  w.navWpCount[i] = 0;
  w.navWpIndex[i] = 0;
  w.pathRequest[i] = 0;
  if (w.pathSlowAware) w.pathSlowAware[i] = 0;
  if (w.rallyHopCount) w.rallyHopCount[i] = 0;
  w.navDestX[i] = x;
  w.navDestY[i] = y;
  w.stuckTicks[i] = 0;
  w.repathCount[i] = 0;
  w.lastPx[i] = x;
  w.lastPy[i] = y;
  w.attackCd[i] = 0;
  w.abilityCd[i] = 0;
  w.distractCd[i] = 0;
  w.shieldHp[i] = 0;
  w.shieldTicks[i] = 0;
  w.dotTicks[i] = 0;
  w.dotDamage[i] = 0;
  w.dotPeriod[i] = 0;
  w.dotAcc[i] = 0;
  w.dotSource[i] = -1;
  if (w.locustTicks) {
    w.locustTicks[i] = 0;
    w.locustStacks[i] = 0;
    w.locustAcc[i] = 0;
    w.locustHops[i] = 0;
    w.locustSource[i] = -1;
  }
  w.frostTicks[i] = 0;
  w.lobTicks[i] = 0;
  w.lobDur[i] = 0;
  w.lobFromX[i] = x;
  w.lobFromY[i] = y;
  w.lobToX[i] = x;
  w.lobToY[i] = y;
  w.lobPeak[i] = 0;
  w.lobTrail[i] = 0;
  w.squadId[i] = 0;
  w.carriedBy[i] = -1;
  w.transportTarget[i] = -1;
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

