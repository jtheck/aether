// Villager gathering — harvest a resource node, haul the load to the nearest
// owned drop-off (agora / camp / mine), deposit into the owner's bank, repeat.
//
// Modeled on repair.js: a per-tick system drives locomotion via queuePath and
// holds the unit in range while it works. All state lives on the world (SoA +
// resource banks) so it stays deterministic and checkpoints cleanly.

import * as fx from './fixed.js';
import { ORDER } from './world.js';
import { queuePath, clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { damageTree } from './trees.js';
import { tileCenterX, tileCenterY, snapToPassable, worldToTile, TILE_SIZE_F } from './field.js';
import { addResource, RESOURCE_KINDS, RESOURCE_INDEX } from './resources.js';
import { UNIT } from './unitTypes.js';
import { SCENERY, rockFootprintRadius, rockResourceKind, damageRock } from './scenery.js';

const WOOD_CODE = RESOURCE_INDEX.wood + 1;
const FOOD_CODE = RESOURCE_INDEX.food + 1;

/**
 * What (if anything) is harvestable at a tile. Trees carry stock on their own
 * tile; rocks carry stock on the CENTER tile (footprint tiles are blockers);
 * farms are infinite food nodes worked in place.
 * @returns {{ stock: number, code: number, foot: number, tree: boolean, food: boolean } | null}
 */
function nodeAt(field, tile) {
  if (tile < 0) return null;
  const treeStock = field.treeStock;
  if (treeStock && (treeStock[tile] | 0) > 0) {
    return { stock: treeStock[tile] | 0, code: WOOD_CODE, foot: 0, tree: true, food: false };
  }
  const kind = field.sceneryType?.[tile] ?? 0;
  const rockStock = field.rockStock;
  if (kind >= SCENERY.ROCK_PLAIN && rockStock && (rockStock[tile] | 0) > 0) {
    const res = rockResourceKind(kind);
    return {
      stock: rockStock[tile] | 0,
      code: RESOURCE_INDEX[res] + 1,
      foot: rockFootprintRadius(kind),
      tree: false,
      food: false,
    };
  }
  if (field.foodNode && field.foodNode[tile]) {
    // Never depletes — output is bounded by how many villagers work it.
    return { stock: GATHER_CARRY_CAP, code: FOOD_CODE, foot: 0, tree: false, food: true };
  }
  return null;
}

/** Reach to a node, widened by its footprint so villagers mine big rocks from the rim. */
function nodeRangeSq(foot) {
  const r = NODE_RANGE + fx.fromInt(foot * TILE_SIZE_F);
  return fx.mul(r, r);
}

/** Ticks between harvest bites. */
export const GATHER_INTERVAL = 15;
/** Wood removed per bite. */
export const GATHER_BITE = 2;
/** Load a villager hauls before returning to a drop-off. */
export const GATHER_CARRY_CAP = 10;

const NODE_RANGE = fx.fromFloat(6);
const DROP_RANGE = fx.fromFloat(16);
const DROP_RANGE_SQ = fx.mul(DROP_RANGE, DROP_RANGE);

/** Building types that accept resource drop-offs (agora handled separately).
 *  Farms are included so in-place food workers bank at the farm itself. */
const DROP_OFF_TYPES = new Set(['camp', 'mine', 'farm']);

// --- Auto-assign (camps/mines recruit idle villagers) -----------------------
// World-unit bases are exported so the HUD ring can mirror the sim reach exactly.
/** Base gather reach of a camp/mine in world units (≈7 tiles, matching legacy). */
export const CAMP_WORK_RADIUS_F = 28;
/** Reach added per engineer loitering near the drop-off (world units). */
export const ENGINEER_RADIUS_BONUS_F = 8;
/** How close an engineer must be to a drop-off to extend it (world units). */
export const ENGINEER_ASSIST_RANGE_F = 28;
/** Most engineers that can stack a reach bonus. */
export const ENGINEER_BONUS_CAP = 3;
/** Max villagers a single drop-off will pull to work. */
export const CAMP_MAX_WORKERS = 8;

const CAMP_WORK_RADIUS = fx.fromFloat(CAMP_WORK_RADIUS_F);
const ENGINEER_RADIUS_BONUS = fx.fromFloat(ENGINEER_RADIUS_BONUS_F);
const ENGINEER_ASSIST_RANGE = fx.fromFloat(ENGINEER_ASSIST_RANGE_F);
const ENGINEER_ASSIST_RANGE_SQ = fx.mul(ENGINEER_ASSIST_RANGE, ENGINEER_ASSIST_RANGE);
/** Re-scan cadence for auto-assign (deterministic on world.tick). */
const AUTO_ASSIGN_INTERVAL = 20;

/**
 * Put a villager on a gather order for a resource tile.
 * @param {object} w
 * @param {object} field
 * @param {number} i entity id
 * @param {number} tile tile index of the node
 */
export function beginGather(w, field, i, tile) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  w.order[i] = ORDER.GATHER;
  w.gatherTile[i] = tile | 0;
  w.targetEntity[i] = -1;
  w.transportTarget[i] = -1;
  w.hasTarget[i] = 0;
  w.gatherCd[i] = 0;
  clearEngagement(w, i);
  clearPath(w, i);
  return true;
}

/** @param {object} w @param {object} field @param {number[]} ids @param {number} tile */
export function applyGather(w, field, ids, tile) {
  if (!ids || ids.length === 0 || tile == null || tile < 0) return;
  for (let k = 0; k < ids.length; k++) beginGather(w, field, ids[k], tile);
}

function endGather(w, i) {
  w.order[i] = ORDER.IDLE;
  w.gatherTile[i] = -1;
  w.gatherCd[i] = 0;
  w.hasTarget[i] = 0;
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
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
 * Nearest owned drop-off (agora, camp, or mine). Returns fixed-point xz or null.
 * @returns {{ x: number, y: number } | null}
 */
export function nearestDropOff(w, owner, px, py) {
  let bestX = 0;
  let bestY = 0;
  let bestD2 = 0x7fffffffffff;
  let found = false;
  const consider = (x, z) => {
    const d2 = fx.dist2(px, py, x, z);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = x;
      bestY = z;
      found = true;
    }
  };
  const agoras = w.agoras;
  if (agoras) {
    for (let a = 0; a < agoras.length; a++) {
      if (agoras[a].owner === owner) consider(agoras[a].x, agoras[a].z);
    }
  }
  const buildings = w.buildings;
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if (bd.owner === owner && DROP_OFF_TYPES.has(bd.type)) consider(bd.x, bd.z);
    }
  }
  return found ? { x: bestX, y: bestY } : null;
}

/**
 * Per-tick gather driver — one phase in step(), after repair, before movement.
 * @param {object} w
 * @param {object} field
 */
export function gatherSystem(w, field) {
  if (!field) return;
  const width = field.width | 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.order[i] !== ORDER.GATHER) continue;

    const tile = w.gatherTile[i];
    const node = nodeAt(field, tile);
    const nodeStock = node ? node.stock : 0;
    const carrying = w.carriedAmt[i] | 0;

    // Return-and-deposit when full, or when the node is spent.
    if (carrying >= GATHER_CARRY_CAP || nodeStock <= 0) {
      if (carrying <= 0) {
        endGather(w, i);
        continue;
      }
      const drop = nearestDropOff(w, w.owner[i], w.px[i], w.py[i]);
      if (!drop) {
        // Nowhere to deposit — idle holding the load until re-tasked.
        w.order[i] = ORDER.IDLE;
        w.gatherTile[i] = -1;
        w.vx[i] = 0;
        w.vy[i] = 0;
        clearPath(w, i);
        continue;
      }
      if (fx.dist2(w.px[i], w.py[i], drop.x, drop.y) <= DROP_RANGE_SQ) {
        const kind = RESOURCE_KINDS[(w.carriedKind[i] | 0) - 1] ?? 'wood';
        addResource(w, w.owner[i], kind, carrying);
        w.carriedAmt[i] = 0;
        w.carriedKind[i] = 0;
        w.vx[i] = 0;
        w.vy[i] = 0;
        clearPath(w, i);
        if (nodeStock <= 0) endGather(w, i);
        continue;
      }
      const snapped = snapToPassable(field, drop.x, drop.y);
      seekTo(w, i, snapped ? snapped.x : drop.x, snapped ? snapped.y : drop.y);
      continue;
    }

    // Harvest phase — hold within reach of the node and take bites on cadence.
    const tx = tile % width;
    const tz = (tile / width) | 0;
    const cx = tileCenterX(tx);
    const cy = tileCenterY(tz);
    if (fx.dist2(w.px[i], w.py[i], cx, cy) <= nodeRangeSq(node.foot)) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      if (w.gatherCd[i] > 0) {
        w.gatherCd[i]--;
      } else {
        const want = Math.min(GATHER_BITE, GATHER_CARRY_CAP - carrying);
        const removed = node.food
          ? want // farm food is infinite — no field stock to decrement
          : (node.tree ? damageTree(field, tile, want) : damageRock(field, tile, want)) | 0;
        if (removed > 0) {
          w.carriedAmt[i] = carrying + removed;
          w.carriedKind[i] = node.code;
        }
        w.gatherCd[i] = GATHER_INTERVAL;
      }
    } else {
      // Rock centers are blocked — stand on the nearest passable rim tile.
      const snapped = node.tree ? null : snapToPassable(field, cx, cy);
      seekTo(w, i, snapped ? snapped.x : cx, snapped ? snapped.y : cy);
    }
  }
}

/**
 * Effective work radius of a drop-off — base reach plus a bonus for each engineer
 * loitering nearby (capped). Exposed so the HUD can draw the same ring.
 * @returns {number} fixed-point radius
 */
export function campWorkRadius(w, b) {
  let eng = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.ENGINEER) continue;
    if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= ENGINEER_ASSIST_RANGE_SQ) {
      if (++eng >= ENGINEER_BONUS_CAP) break;
    }
  }
  return CAMP_WORK_RADIUS + eng * ENGINEER_RADIUS_BONUS;
}

/** Nearest harvestable node (tree or rock) within a drop-off's reach, closest to (fromX, fromY). */
function nearestNodeWithinRadius(field, b, radius, fromX, fromY) {
  const width = field.width | 0;
  const height = field.height | 0;
  const radiusSq = fx.mul(radius, radius);
  const rt = Math.ceil(fx.toFloat(radius) / TILE_SIZE_F);
  const bxTile = worldToTile(b.x);
  const bzTile = worldToTile(b.z);
  let best = -1;
  let bestD = 0x7fffffffffff;
  const z0 = Math.max(0, bzTile - rt);
  const z1 = Math.min(height - 1, bzTile + rt);
  const x0 = Math.max(0, bxTile - rt);
  const x1 = Math.min(width - 1, bxTile + rt);
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tile = tz * width + tx;
      if (!nodeAt(field, tile)) continue;
      const cx = tileCenterX(tx);
      const cy = tileCenterY(tz);
      if (fx.dist2(b.x, b.z, cx, cy) > radiusSq) continue;
      const d = fx.dist2(fromX, fromY, cx, cy);
      if (d < bestD) {
        bestD = d;
        best = tile;
      }
    }
  }
  return best;
}

/**
 * Camps/mines pull nearby idle villagers to harvest nodes in reach. Runs on a
 * fixed cadence; only recruits IDLE villagers so player/manual orders are safe.
 * @param {object} w
 * @param {object} field
 */
export function campAutoAssignSystem(w, field) {
  if (!field || !w.buildings) return;
  if (w.tick % AUTO_ASSIGN_INTERVAL !== 0) return;
  for (let bIdx = 0; bIdx < w.buildings.length; bIdx++) {
    const b = w.buildings[bIdx];
    if (!DROP_OFF_TYPES.has(b.type)) continue;
    const owner = b.owner;
    const radius = campWorkRadius(w, b);
    const radiusSq = fx.mul(radius, radius);

    let workers = 0;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.order[i] !== ORDER.GATHER) continue;
      if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= radiusSq) workers++;
    }
    if (workers >= CAMP_MAX_WORKERS) continue;

    for (let i = 0; i < w.count && workers < CAMP_MAX_WORKERS; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.order[i] !== ORDER.IDLE) continue;
      if (fx.dist2(w.px[i], w.py[i], b.x, b.z) > radiusSq) continue;
      const tile = nearestNodeWithinRadius(field, b, radius, w.px[i], w.py[i]);
      if (tile < 0) break; // no nodes in reach — nothing to recruit for
      beginGather(w, field, i, tile);
      workers++;
    }
  }
}
