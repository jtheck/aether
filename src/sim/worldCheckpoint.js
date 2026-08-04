// Deterministic world + mutable field checkpoint for mid-match catch-up.
// Serialize enough state that checksum(world, field) matches after import.

import { MAX_WAYPOINTS } from './path.js';
import { MAX_PATH_HITS } from './projectiles.js';
import { rebuildSpatialGrid } from './spatialGrid.js';
import { ensureTreeArrays } from './trees.js';
import { applyWorldStructureOccupancy } from './buildings.js';
import { ensureFrogCapacity } from './frogs.js';
import { ensureFireZoneCapacity } from './fireZones.js';
import { capacityFor } from './capacity.js';
import { SPORE_PENDING_INITIAL } from './sporeBloom.js';

export const CHECKPOINT_FORMAT = 1;

const ENTITY_I32 = [
  'px', 'py', 'vx', 'vy', 'tx', 'ty', 'speed', 'targetEntity', 'engagementTarget',
  'navDestX', 'navDestY', 'lastPx', 'lastPy', 'hp', 'carriedBy', 'transportTarget',
  'dotSource', 'lobFromX', 'lobFromY', 'lobToX', 'lobToY', 'squadId',
];
const ENTITY_I16 = [
  'engagementSlot', 'attackCd', 'abilityCd', 'distractCd', 'shieldHp', 'shieldTicks',
  'dotTicks', 'dotDamage', 'dotPeriod', 'dotAcc', 'frostTicks', 'lobTicks', 'lobDur', 'lobPeak',
];
const ENTITY_U16 = ['engagementMask', 'targetLoad'];
const ENTITY_U8 = [
  'hasTarget', 'order', 'navWpCount', 'navWpIndex', 'pathRequest', 'stuckTicks',
  'repathCount', 'lobTrail', 'type', 'owner', 'alive',
];

/**
 * @param {object} w
 * @param {object} field
 * @param {number} checksum
 */
export function exportWorldCheckpoint(w, field, checksum) {
  ensureTreeArrays(field);
  const n = w.count | 0;
  const entities = {
    count: n,
    nextSquadId: w.nextSquadId | 0,
    pathLosCursor: w.pathLosCursor | 0,
    pathAstarCursor: w.pathAstarCursor | 0,
    rng: w.rng.s >>> 0,
    kothMatchOver: w.kothMatchOver | 0,
    matchWinner: w.matchWinner ?? -1,
    arrays: {},
  };
  for (const key of ENTITY_I32) entities.arrays[key] = encodeTA(w[key], n);
  for (const key of ENTITY_I16) entities.arrays[key] = encodeTA(w[key], n);
  for (const key of ENTITY_U16) entities.arrays[key] = encodeTA(w[key], n);
  for (const key of ENTITY_U8) entities.arrays[key] = encodeTA(w[key], n);
  entities.arrays.navWx = encodeTA(w.navWx, n * MAX_WAYPOINTS);
  entities.arrays.navWy = encodeTA(w.navWy, n * MAX_WAYPOINTS);

  return {
    format: CHECKPOINT_FORMAT,
    tick: w.tick | 0,
    checksum: checksum >>> 0,
    entities,
    projectiles: exportPoolStore(w.projectiles, {
      u8: ['alive', 'type', 'owner', 'hitCount', 'despawnReason'],
      u16: ['age', 'lifetime'],
      u32: ['generation'],
      i32: [
        'source', 'target', 'px', 'py', 'vx', 'vy', 'aimX', 'aimY',
        'wanderOx', 'wanderOy', 'damage',
      ],
      pathHits: true,
    }),
    fireZones: exportPoolStore(w.fireZones, {
      u8: ['alive', 'owner', 'friendlyMulQ8'],
      u16: ['ttl', 'damage'],
      u32: ['generation'],
      i32: ['source', 'px', 'py', 'radius'],
    }),
    frogs: exportPoolStore(w.frogs, {
      u8: ['alive', 'owner', 'phase', 'hopsLeft', 'hopsDone', 'landPulse', 'escaping', 'escapeHops'],
      u16: ['hopAge', 'hopDuration', 'waitTicks', 'damage'],
      u32: ['generation'],
      i32: [
        'source', 'px', 'py', 'originX', 'originY', 'destX', 'destY',
        'dirX', 'dirY', 'waterX', 'waterY',
      ],
    }),
    treeGrowth: exportTreeGrowth(w.treeGrowth),
    koth: exportKoth(w.koth),
    agoras: exportAgoras(w.agoras),
    buildings: exportBuildings(w.buildings),
    field: exportFieldMutable(field),
  };
}

/**
 * Restore into an already-initialized worker world/field (same seed/map).
 * Rebuilds spatial grid; clears render-only FX queues.
 * @returns {number} checkpoint tick
 */
export function importWorldCheckpoint(w, field, checkpoint) {
  if (!checkpoint || checkpoint.format !== CHECKPOINT_FORMAT) {
    throw new Error(`unsupported checkpoint format ${checkpoint?.format}`);
  }
  ensureTreeArrays(field);
  const ent = checkpoint.entities;
  const n = ent.count | 0;
  w.tick = checkpoint.tick | 0;
  w.count = n;
  w.nextSquadId = ent.nextSquadId | 0;
  w.pathLosCursor = ent.pathLosCursor | 0;
  w.pathAstarCursor = ent.pathAstarCursor | 0;
  w.rng.s = ent.rng >>> 0;
  w.kothMatchOver = ent.kothMatchOver | 0;
  w.matchWinner = ent.matchWinner ?? -1;

  for (const key of Object.keys(ent.arrays)) {
    decodeTAInto(w[key], ent.arrays[key]);
  }

  importPoolStore(w.projectiles, checkpoint.projectiles, {
    u8: ['alive', 'type', 'owner', 'hitCount', 'despawnReason'],
    u16: ['age', 'lifetime'],
    u32: ['generation'],
    i32: [
      'source', 'target', 'px', 'py', 'vx', 'vy', 'aimX', 'aimY',
      'wanderOx', 'wanderOy', 'damage',
    ],
    pathHits: true,
  });
  if (w.fireZones && checkpoint.fireZones) {
    const need = Math.max(
      checkpoint.fireZones.highWater | 0,
      checkpoint.fireZones.freeStack?.n | 0,
    );
    ensureFireZoneCapacity(w.fireZones, need);
  }
  importPoolStore(w.fireZones, checkpoint.fireZones, {
    u8: ['alive', 'owner', 'friendlyMulQ8'],
    u16: ['ttl', 'damage'],
    u32: ['generation'],
    i32: ['source', 'px', 'py', 'radius'],
  });
  if (w.fireZones) w.fireZones.dirty = [];
  if (w.frogs && checkpoint.frogs) {
    const need = Math.max(
      checkpoint.frogs.highWater | 0,
      checkpoint.frogs.freeStack?.n | 0,
    );
    ensureFrogCapacity(w.frogs, need);
  }
  importPoolStore(w.frogs, checkpoint.frogs, {
    u8: ['alive', 'owner', 'phase', 'hopsLeft', 'hopsDone', 'landPulse', 'escaping', 'escapeHops'],
    u16: ['hopAge', 'hopDuration', 'waitTicks', 'damage'],
    u32: ['generation'],
    i32: [
      'source', 'px', 'py', 'originX', 'originY', 'destX', 'destY',
      'dirX', 'dirY', 'waterX', 'waterY',
    ],
  });
  if (w.frogs) {
    w.frogs.dirty = [];
    if (w.frogs.dirtyFlag) w.frogs.dirtyFlag.fill(0);
  }
  importTreeGrowth(w.treeGrowth, checkpoint.treeGrowth);
  importKoth(w, checkpoint.koth);
  importAgoras(w, checkpoint.agoras);
  importBuildings(w, checkpoint.buildings);
  importFieldMutable(field, checkpoint.field);
  // pass is not checkpointed; re-stamp building/agora footprints (rocks stay from init).
  applyWorldStructureOccupancy(field, w);

  // Render-only queues — empty after restore.
  clearFxStore(w.lightningFx);
  clearFxStore(w.holyArmorFx);
  clearSporeFx(w.sporeBloomFx);
  clearMonkFx(w.monkKickFx);

  rebuildSpatialGrid(w.spatial, w);
  return w.tick;
}

function exportPoolStore(store, spec) {
  if (!store) return null;
  const hw = store.highWater | 0;
  const out = {
    activeCount: store.activeCount | 0,
    highWater: hw,
    allocatorHash: store.allocatorHash | 0,
    freeTop: store.freeTop | 0,
    freeStack: encodeTA(store.freeStack, store.capacity),
    arrays: {},
  };
  for (const key of spec.u8 ?? []) out.arrays[key] = encodeTA(store[key], hw);
  for (const key of spec.u16 ?? []) out.arrays[key] = encodeTA(store[key], hw);
  for (const key of spec.u32 ?? []) out.arrays[key] = encodeTA(store[key], hw);
  for (const key of spec.i32 ?? []) out.arrays[key] = encodeTA(store[key], hw);
  if (spec.pathHits) {
    out.arrays.pathHits = encodeTA(store.pathHits, hw * MAX_PATH_HITS);
  }
  return out;
}

function importPoolStore(store, data, spec) {
  if (!store || !data) return;
  store.activeCount = data.activeCount | 0;
  store.highWater = data.highWater | 0;
  store.allocatorHash = data.allocatorHash | 0;
  store.freeTop = data.freeTop | 0;
  decodeTAInto(store.freeStack, data.freeStack);
  // Clear beyond highWater so stale slots don't linger.
  for (const key of [...(spec.u8 ?? []), ...(spec.u16 ?? []), ...(spec.u32 ?? []), ...(spec.i32 ?? [])]) {
    store[key].fill(0);
  }
  if (spec.pathHits) store.pathHits.fill(-1);
  for (const key of Object.keys(data.arrays ?? {})) {
    decodeTAInto(store[key], data.arrays[key]);
  }
}

function exportTreeGrowth(store) {
  if (!store) return null;
  const n = store.count | 0;
  return {
    count: n,
    tile: encodeTA(store.tile, n),
    growAtTick: encodeTA(store.growAtTick, n),
    stock: encodeTA(store.stock, n),
  };
}

function importTreeGrowth(store, data) {
  if (!store || !data) return;
  const n = data.count | 0;
  if (n > store.capacity) {
    const newCap = capacityFor(n, { initial: SPORE_PENDING_INITIAL });
    store.tile = new Int32Array(newCap);
    store.growAtTick = new Int32Array(newCap);
    store.stock = new Uint8Array(newCap);
    store.capacity = newCap;
  }
  store.count = n;
  store.tile.fill(0);
  store.growAtTick.fill(0);
  store.stock.fill(0);
  decodeTAInto(store.tile, data.tile);
  decodeTAInto(store.growAtTick, data.growAtTick);
  decodeTAInto(store.stock, data.stock);
}

function exportKoth(k) {
  if (!k) return null;
  return {
    kingOwner: k.kingOwner | 0,
    active: encodeTA(k.active, k.active.length),
    eliminated: encodeTA(k.eliminated, k.eliminated.length),
    joinedAtTick: encodeTA(k.joinedAtTick, k.joinedAtTick.length),
    scores: encodeTA(k.scores, k.scores.length),
  };
}

function importKoth(w, data) {
  if (!data) {
    w.koth = null;
    return;
  }
  if (!w.koth) {
    w.koth = {
      kingOwner: 0,
      active: new Uint8Array(data.active?.n ?? 5),
      eliminated: new Uint8Array(data.eliminated?.n ?? 5),
      joinedAtTick: new Int32Array(data.joinedAtTick?.n ?? 5),
      scores: new Int32Array(data.scores?.n ?? 5),
    };
  }
  w.koth.kingOwner = data.kingOwner | 0;
  decodeTAInto(w.koth.active, data.active);
  decodeTAInto(w.koth.eliminated, data.eliminated);
  decodeTAInto(w.koth.joinedAtTick, data.joinedAtTick);
  decodeTAInto(w.koth.scores, data.scores);
}

function exportAgoras(agoras) {
  if (!agoras?.length) return [];
  return agoras.map((a) => ({
    owner: a.owner | 0,
    x: a.x | 0,
    z: a.z | 0,
    progress: a.progress | 0,
    capturer: a.capturer | 0,
    contested: a.contested | 0,
    captured: a.captured | 0,
  }));
}

function importAgoras(w, data) {
  if (!data?.length) {
    w.agoras = [];
    return;
  }
  w.agoras = data.map((a) => ({
    owner: a.owner | 0,
    x: a.x | 0,
    z: a.z | 0,
    progress: a.progress | 0,
    capturer: a.capturer | 0,
    contested: a.contested | 0,
    captured: a.captured | 0,
  }));
}

function exportBuildings(buildings) {
  if (!buildings?.length) return [];
  return buildings.map((b) => ({
    owner: b.owner | 0,
    type: b.type,
    x: b.x | 0,
    z: b.z | 0,
    yaw: b.yaw | 0,
  }));
}

function importBuildings(w, data) {
  if (!data?.length) {
    w.buildings = [];
    return;
  }
  w.buildings = data.map((b) => ({
    owner: b.owner | 0,
    type: String(b.type),
    x: b.x | 0,
    z: b.z | 0,
    yaw: b.yaw | 0,
  }));
}

function exportFieldMutable(field) {
  const n = field.width * field.height;
  return {
    width: field.width,
    height: field.height,
    treeStockHash: field.treeStockHash | 0,
    treeStock: encodeTA(field.treeStock, n),
    treeBurn: encodeTA(field.treeBurn, n),
    sceneryType: encodeTA(field.sceneryType, n),
    slowMask: encodeTA(field.slowMask, n),
    burningTrees: Array.from(field.burningTrees ?? []),
  };
}

function importFieldMutable(field, data) {
  if (!data) return;
  if (data.width !== field.width || data.height !== field.height) {
    throw new Error('checkpoint field size mismatch');
  }
  decodeTAInto(field.treeStock, data.treeStock);
  decodeTAInto(field.treeBurn, data.treeBurn);
  decodeTAInto(field.sceneryType, data.sceneryType);
  decodeTAInto(field.slowMask, data.slowMask);
  field.treeStockHash = data.treeStockHash | 0;
  field.burningTrees = Array.from(data.burningTrees ?? []);
  if (Array.isArray(field.treeDirty)) field.treeDirty.length = 0;
}

function clearFxStore(store) {
  if (!store) return;
  store.count = 0;
  if (store.x) store.x.length = 0;
  if (store.y) store.y.length = 0;
  if (store.kind) store.kind.length = 0;
  if (store.radius) store.radius.length = 0;
}

function clearSporeFx(store) {
  if (!store) return;
  store.dripCount = 0;
  store.seedCount = 0;
  store.dripX.length = 0;
  store.dripY.length = 0;
  store.seedX.length = 0;
  store.seedY.length = 0;
  store.seedGrowAt.length = 0;
}

function clearMonkFx(store) {
  if (!store) return;
  store.count = 0;
  store.landCount = 0;
  store.entity.length = 0;
  store.progress.length = 0;
  store.peak.length = 0;
  store.trail.length = 0;
  store.landX.length = 0;
  store.landY.length = 0;
  store.landTrail.length = 0;
}

/** Encode first `count` elements of a TypedArray as base64. */
export function encodeTA(ta, count = ta.length) {
  const n = Math.max(0, Math.min(count | 0, ta.length));
  const bytes = new Uint8Array(ta.buffer, ta.byteOffset, n * ta.BYTES_PER_ELEMENT);
  return { t: ta.constructor.name, n, b: bytesToBase64(bytes) };
}

export function decodeTAInto(dest, encoded) {
  if (!encoded || !dest) return;
  const src = base64ToBytes(encoded.b);
  const view = new dest.constructor(src.buffer, src.byteOffset, encoded.n | 0);
  dest.set(view.subarray(0, Math.min(view.length, dest.length)));
}

function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Split a JSON string into ~chunkSize character pieces for wire transfer. */
export function chunkJson(json, chunkSize = 48_000) {
  const chunks = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.slice(i, i + chunkSize));
  }
  return chunks;
}
