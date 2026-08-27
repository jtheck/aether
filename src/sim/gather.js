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
import { isHostile } from './teams.js';

const WOOD_CODE = RESOURCE_INDEX.wood + 1;
const FOOD_CODE = RESOURCE_INDEX.food + 1;

/** Node "class" a drop-off recruits for — keeps mines on rock and camps on wood. */
const NODE_WOOD = 0;
const NODE_ROCK = 1;
const NODE_FOOD = 2;

/** Which node class a harvestable tile belongs to (see nodeAt). */
function nodeClass(node) {
  if (!node) return -1;
  if (node.tree) return NODE_WOOD;
  if (node.food) return NODE_FOOD;
  return NODE_ROCK;
}

/**
 * Which node class a drop-off building recruits villagers for. Camps work wood,
 * mines work stone/mineral, farms work their own food node. Anything else (agora)
 * recruits nothing — it's only a deposit point.
 */
function dropOffNodeClass(type) {
  if (type === 'camp') return NODE_WOOD;
  if (type === 'mine') return NODE_ROCK;
  if (type === 'farm') return NODE_FOOD;
  return -1;
}

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
/** Farms are small plots — keep them to a 1–2 person crew so workers spread out. */
export const FARM_MAX_WORKERS = 2;

/** Per-type worker cap so farms stay tiny while camps/mines field a full crew. */
function maxWorkersFor(type) {
  return type === 'farm' ? FARM_MAX_WORKERS : CAMP_MAX_WORKERS;
}

// --- Defensive farming --------------------------------------------------------
// A villager that reaches a node via attack-move gathers "defensively": it swings
// at any hostile that wanders into arm's reach, then goes back to work. Kept short
// so villagers never chase — they only defend the plot they're standing on.
/** How close a hostile must be for a defensive gatherer to retaliate (world units). */
const DEFEND_RANGE = fx.fromFloat(11);
const DEFEND_RANGE_SQ = fx.mul(DEFEND_RANGE, DEFEND_RANGE);
/** Stagger threat scans across ticks (deterministic on entity id + world.tick). */
const DEFEND_PHASE = 6;

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
 * @param {number} [defensive] 1 = fight back if a hostile closes in, then resume
 */
export function beginGather(w, field, i, tile, defensive = 0) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  w.order[i] = ORDER.GATHER;
  w.gatherTile[i] = tile | 0;
  w.targetEntity[i] = -1;
  w.transportTarget[i] = -1;
  w.hasTarget[i] = 0;
  w.gatherCd[i] = 0;
  if (w.gatherDefensive) w.gatherDefensive[i] = defensive ? 1 : 0;
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
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
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
      if (bd.built === 0) continue; // sites can't accept drop-offs yet
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

/**
 * Nearest node of the drop-off's own class within reach, closest to (fromX, fromY).
 * `wantClass` keeps mines on rock and camps on wood; -1 accepts any node.
 */
function nearestNodeWithinRadius(field, b, radius, fromX, fromY, wantClass) {
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
      const node = nodeAt(field, tile);
      if (!node) continue;
      if (wantClass >= 0 && nodeClass(node) !== wantClass) continue;
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
    if (b.built === 0) continue; // a site can't recruit gatherers yet
    if (!DROP_OFF_TYPES.has(b.type)) continue;
    const wantClass = dropOffNodeClass(b.type);
    if (wantClass < 0) continue; // agora-like: deposit only, never recruits
    const owner = b.owner;
    const radius = campWorkRadius(w, b);
    const radiusSq = fx.mul(radius, radius);
    const cap = maxWorkersFor(b.type);

    // Only count crew already working THIS drop-off's resource class, so a wood
    // chopper passing a farm doesn't count against the farm's tiny food crew.
    let workers = 0;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.order[i] !== ORDER.GATHER) continue;
      if (nodeClass(nodeAt(field, w.gatherTile[i])) !== wantClass) continue;
      if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= radiusSq) workers++;
    }
    if (workers >= cap) continue;

    for (let i = 0; i < w.count && workers < cap; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.order[i] !== ORDER.IDLE) continue;
      if (fx.dist2(w.px[i], w.py[i], b.x, b.z) > radiusSq) continue;
      const tile = nearestNodeWithinRadius(field, b, radius, w.px[i], w.py[i], wantClass);
      if (tile < 0) break; // no matching nodes in reach — nothing to recruit for
      beginGather(w, field, i, tile);
      workers++;
    }
  }
}

/**
 * Resolve a world position to a harvestable node tile at or beside it. A click /
 * arrival can land on a rock footprint or just off a farm center, so we sweep a
 * small window and take the nearest node. Returns -1 if nothing is harvestable.
 * @returns {number} tile index or -1
 */
export function gatherNodeNear(field, px, py) {
  if (!field) return -1;
  const width = field.width | 0;
  const height = field.height | 0;
  const cxTile = worldToTile(px);
  const czTile = worldToTile(py);
  const center = czTile * width + cxTile;
  if (nodeAt(field, center)) return center;
  // Rocks are up to a 2-tile footprint; farms/trees are on their own tile.
  let best = -1;
  let bestD = 0x7fffffffffff;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = cxTile + dx;
      const tz = czTile + dz;
      if (tx < 0 || tz < 0 || tx >= width || tz >= height) continue;
      const tile = tz * width + tx;
      if (!nodeAt(field, tile)) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = tile;
      }
    }
  }
  return best;
}

/** Nearest living hostile to entity i within rangeSq, or -1. */
function nearestHostile(w, i, rangeSq) {
  const owner = w.owner[i];
  let best = -1;
  let bestD = rangeSq;
  for (let j = 0; j < w.count; j++) {
    if (j === i || !w.alive[j]) continue;
    if (w.carriedBy && w.carriedBy[j] >= 0) continue;
    if (!isHostile(owner, w.owner[j])) continue;
    const d2 = fx.dist2(w.px[i], w.py[i], w.px[j], w.py[j]);
    if (d2 <= bestD) {
      if (d2 < bestD || (best < 0 || j < best)) {
        bestD = d2;
        best = j;
      }
    }
  }
  return best;
}

/**
 * Defensive farming — villagers that reached a node via attack-move hold their
 * ground: if a hostile closes in they drop the tool, swing, then return to work.
 * Runs before combat so the retaliation resolves the same tick; runs before the
 * gather phase so a resumed order is driven immediately. Deterministic (phased on
 * entity id + world.tick, no allocations).
 * @param {object} w
 * @param {object} field
 */
export function gatherDefenseSystem(w, field) {
  if (!field || !w.gatherDefensive) return;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER || !w.gatherDefensive[i]) continue;
    const order = w.order[i];
    if (order === ORDER.GATHER) {
      // Threat check on this entity's phase so cost stays bounded and stable.
      if (i % DEFEND_PHASE !== w.tick % DEFEND_PHASE) continue;
      const foe = nearestHostile(w, i, DEFEND_RANGE_SQ);
      if (foe >= 0) {
        // Interrupt to fight; keep gatherTile as the resume marker (see below).
        w.targetEntity[i] = foe;
        w.order[i] = ORDER.ATTACK;
        w.hasTarget[i] = 0;
        clearPath(w, i);
        queuePath(w, i, w.px[foe], w.py[foe]);
      }
    } else if (order === ORDER.IDLE) {
      // Combat ended (endAttack -> IDLE) — resume the plot if it still stands,
      // otherwise drop the defensive tag so the villager truly idles.
      const tile = w.gatherTile[i];
      if (tile >= 0 && nodeAt(field, tile)) {
        beginGather(w, field, i, tile, 1);
      } else {
        w.gatherDefensive[i] = 0;
        w.gatherTile[i] = -1;
      }
    }
    // ORDER.ATTACK: leave the swing to combat; it flips back to IDLE when done.
  }
}
