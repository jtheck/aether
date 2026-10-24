// Villager gathering - harvest a resource node, haul the load to the nearest
// owned drop-off (agora / camp / mine / attached silo), deposit into the
// owner's bank, repeat. Farms are the exception: food is banked in place while
// the villager wanders the plot (no haul, no carry visual). Wood/rock harvest
// plays chop; carry (VAT + overhead prop) starts only on the walk back.
// An attached silo is a satellite drop-off and an extra gather circle one
// tile tighter than the source building's work radius.
//
// Modeled on repair.js: a per-tick system drives locomotion via queuePath and
// holds the unit in range while it works. All state lives on the world (SoA +
// resource banks) so it stays deterministic and checkpoints cleanly.

import * as fx from './fixed.js';
import { ORDER } from './world.js';
import { queuePath, clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { damageTree } from './trees.js';
import { tileCenterX, tileCenterY, snapToPassable, worldToTile, worldToTileZ, TILE_SIZE_F, isPassable } from './field.js';
import { RESOURCE_KINDS, RESOURCE_INDEX } from './resources.js';
import { addGatherIncome, siloIsAttached, silosAttachedTo } from './storage.js';
import { UNIT } from './unitTypes.js';
import { revertBrigand } from './brigand.js';
import { SCENERY, rockFootprintRadiusForStock, rockResourceKind, damageRock } from './scenery.js';
import { isHostile } from './teams.js';
import { BUILDING_FOOTPRINTS, buildingIsFinished } from './buildings.js';

const WOOD_CODE = RESOURCE_INDEX.wood + 1;
const FOOD_CODE = RESOURCE_INDEX.food + 1;

/** Node "class" a drop-off recruits for - keeps mines on rock and camps on wood. */
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
 * recruits nothing - it's only a deposit point.
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
 * farms are infinite food nodes worked in place (wander, no haul).
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
      foot: Math.max(0, rockFootprintRadiusForStock(kind, rockStock[tile] | 0)),
      tree: false,
      food: false,
    };
  }
  if (field.foodNode && field.foodNode[tile]) {
    // Never depletes - output is bounded by how many villagers work it.
    return { stock: GATHER_CARRY_CAP, code: FOOD_CODE, foot: 0, tree: false, food: true };
  }
  return null;
}

/** Reach to a node, widened by its footprint so villagers mine big rocks from the rim. */
function nodeRangeSq(foot) {
  const r = NODE_RANGE + fx.fromInt(foot * TILE_SIZE_F);
  return fx.mul(r, r);
}

/** Render/VAT pose: chop at the node, carry only while hauling the load back. */
export const GATHER_ACT = {
  NONE: 0,
  CHOP: 1,
  HAUL: 2,
};

/** Ticks between harvest bites. */
export const GATHER_INTERVAL = 15;
/** Wood removed per bite. Food bites use the same size. */
export const GATHER_BITE = 2;
/**
 * Ticks from one farmer bite to the next. The cooldown is set, then counted
 * down through zero, so the gap is one tick longer than GATHER_INTERVAL.
 */
const FARM_BITE_PERIOD = GATHER_INTERVAL + 1;
/**
 * Finished farm with no farmer: 10% of one farmer, paid as 1 food.
 * One farmer is GATHER_BITE per FARM_BITE_PERIOD ticks, so this is that
 * period times 10 divided by the bite.
 */
export const FARM_PASSIVE_INTERVAL = (FARM_BITE_PERIOD * 10) / GATHER_BITE;
/** Load a villager hauls before returning to a drop-off. */
export const GATHER_CARRY_CAP = 10;

const NODE_RANGE = fx.fromFloat(6);
/** Must reach the building itself - ~1 tile from center, on a camp/mine footprint. */
const DROP_RANGE = fx.fromFloat(4.5);
const DROP_RANGE_SQ = fx.mul(DROP_RANGE, DROP_RANGE);

/** How close a villager must get before it starts wandering a farm plot. */
const FARM_ENTER_RANGE = fx.fromFloat(13);
const FARM_ENTER_RANGE_SQ = fx.mul(FARM_ENTER_RANGE, FARM_ENTER_RANGE);
/** Wander around the 3×3 farm and a bit of the grass beyond it. */
const FARM_WANDER_HALF = fx.fromFloat(10);
const FARM_ARRIVE = fx.fromFloat(1.6);
const FARM_ARRIVE_SQ = fx.mul(FARM_ARRIVE, FARM_ARRIVE);
/** Ticks to stand after arriving before picking the next stroll dest. */
const FARM_PAUSE_TICKS = 36;
/** Cap while pottering on the plot - a walk, not the gather run. */
export const FARM_STROLL_SPEED = fx.fromFloat(0.80);

/** Buildings that recruit gatherers (and show a work-radius ring). Farms work
 *  food in place; they are not haul drop-offs. Attached silos inherit a
 *  satellite ring from these, but are not in the set themselves. */
export const DROP_OFF_TYPES = new Set(['camp', 'mine', 'farm']);
/** Buildings that accept a hauled load (agora is handled separately). Attached
 *  silos are checked via siloIsAttached, not this set. */
const DEPOSIT_TYPES = new Set(['camp', 'mine']);

// --- Auto-assign (camps/mines recruit idle villagers) -----------------------
// World-unit bases drive sim reach. The HUD ring is drawn a little inside
// that circle (see workRadiusRingWorld) so nodes just past the rim still work.
/** Uniform extra gather reach on every resource drop-off (half a tile). */
export const WORK_RADIUS_PAD_F = TILE_SIZE_F * 0.5;
/** Base gather reach of a camp/mine in world units (8 tiles + pad). */
export const CAMP_WORK_RADIUS_F = 8 * TILE_SIZE_F + WORK_RADIUS_PAD_F;
/** Farm plots only recruit from the 3×3 and a tile of grass around it. */
export const FARM_WORK_RADIUS_F = 5 * TILE_SIZE_F + WORK_RADIUS_PAD_F;
/** Advertised HUD ring sits this far inside the live gather circle. */
export const WORK_RADIUS_RING_INSET_F = 1.6;
/** Attached silo satellite circle is one tile tighter than the source. */
export const SILO_WORK_RADIUS_PENALTY_F = TILE_SIZE_F;
/** Reach added per engineer loitering near the drop-off (world units). */
export const ENGINEER_RADIUS_BONUS_F = 8;
/** How close an engineer must be to a drop-off to extend it (world units). */
export const ENGINEER_ASSIST_RANGE_F = 28;
/** Most engineers that can stack a reach bonus. */
export const ENGINEER_BONUS_CAP = 3;
/** Keep the last stacked bonus after engineers walk off (~6s at 20 Hz). */
export const ENGINEER_BONUS_LINGER_TICKS = 120;
/** Crew-size radius: every 4 villagers standing in the circle add this much reach. */
export const CREW_RADIUS_TIER = 4;
export const CREW_RADIUS_BONUS_F = 8;
/** Cap stacked crew-radius tiers (4 villagers → +8, 8 villagers → +16). */
export const CREW_RADIUS_TIER_CAP = 2;
/** Max villagers a single camp/mine will pull to work. */
export const CAMP_MAX_WORKERS = 8;
/** One farmer per plot - extra villagers pile up and the yield does not scale. */
export const FARM_MAX_WORKERS = 1;

/** Per-type worker cap so farms stay tiny while camps/mines field a full crew. */
export function maxWorkersFor(type) {
  return type === 'farm' ? FARM_MAX_WORKERS : CAMP_MAX_WORKERS;
}

// --- Defensive farming --------------------------------------------------------
// A villager that reaches a node via attack-move gathers "defensively": it swings
// while a hostile stays inside the short ring around the plot, then goes back to
// work. Leaving that ring drops the fight, so a villager never follows anyone off
// the node.
/** How close a hostile must be for a defensive gatherer to retaliate (world units). */
const DEFEND_RANGE = fx.fromFloat(11);
const DEFEND_RANGE_SQ = fx.mul(DEFEND_RANGE, DEFEND_RANGE);
/** Stagger threat scans across ticks (deterministic on entity id + world.tick). */
const DEFEND_PHASE = 6;

const CAMP_WORK_RADIUS = fx.fromFloat(CAMP_WORK_RADIUS_F);
const FARM_WORK_RADIUS = fx.fromFloat(FARM_WORK_RADIUS_F);
const SILO_WORK_RADIUS_PENALTY = fx.fromFloat(SILO_WORK_RADIUS_PENALTY_F);
const ENGINEER_RADIUS_BONUS = fx.fromFloat(ENGINEER_RADIUS_BONUS_F);
const CREW_RADIUS_BONUS = fx.fromFloat(CREW_RADIUS_BONUS_F);
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
  const node = tile >= 0 ? nodeAt(field, tile) : null;
  if (node?.food) {
    const already = w.order[i] === ORDER.GATHER && (w.gatherTile[i] | 0) === (tile | 0);
    if (!already && countFarmCrewOnTile(w, tile) >= FARM_MAX_WORKERS) return false;
  }
  if (w.rallyHopCount) w.rallyHopCount[i] = 0;
  if (w.manualHold) w.manualHold[i] = 0;
  w.order[i] = ORDER.GATHER;
  w.gatherTile[i] = tile | 0;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  w.transportTarget[i] = -1;
  w.hasTarget[i] = 0;
  w.gatherCd[i] = 0;
  if (w.gatherDefensive) w.gatherDefensive[i] = defensive ? 1 : 0;
  if (w.gatherAct) w.gatherAct[i] = GATHER_ACT.NONE;
  if (w.buildTarget) w.buildTarget[i] = -1;
  clearEngagement(w, i);
  clearPath(w, i);
  return true;
}

/** @param {object} w @param {object} field @param {number[]} ids @param {number} tile @param {number} [defensive] */
export function applyGather(w, field, ids, tile, defensive = 0) {
  if (!ids || ids.length === 0 || tile == null || tile < 0) return;
  for (let k = 0; k < ids.length; k++) {
    revertBrigand(w, ids[k]);
    beginGather(w, field, ids[k], tile, defensive);
  }
}

/** Auto-assign passes a parked villager must stand idle before camps may recruit it. */
export const MANUAL_HOLD_PASSES = 5;
/** gatherTile sentinel: haul to tx/ty (a clicked agora / camp / mine) and then stand. */
const DEPOSIT_TILE = -2;

/**
 * A move, attack, or stop drops the harvest job. The villager keeps any load
 * already in hand, and won't be recruited or sent hauling until it has stood
 * idle for MANUAL_HOLD_PASSES auto-assign passes after the order finishes.
 */
export function releaseGatherOrder(w, i) {
  if (w.gatherTile) w.gatherTile[i] = -1;
  if (w.gatherCd) w.gatherCd[i] = 0;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  if (w.manualHold) w.manualHold[i] = MANUAL_HOLD_PASSES;
  if (w.buildTarget) w.buildTarget[i] = -1;
}

/**
 * Walk a carried load to a specific drop-off and bank it. The villager stands
 * there afterward instead of resuming the node they were pulled off.
 * @param {object} w
 * @param {number} i
 * @param {number} x fixed-point drop-off center
 * @param {number} y fixed-point drop-off center
 */
export function beginDeposit(w, i, x, y) {
  if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) return false;
  if ((w.carriedAmt[i] | 0) <= 0) return false;
  if (w.rallyHopCount) w.rallyHopCount[i] = 0;
  if (w.manualHold) w.manualHold[i] = 0;
  w.order[i] = ORDER.GATHER;
  w.gatherTile[i] = DEPOSIT_TILE;
  w.tx[i] = x;
  w.ty[i] = y;
  w.targetEntity[i] = -1;
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  w.transportTarget[i] = -1;
  w.hasTarget[i] = 0;
  w.gatherCd[i] = 0;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  if (w.gatherAct) w.gatherAct[i] = GATHER_ACT.HAUL;
  // A build claim is restamped by construction when this haul is for a site.
  if (w.buildTarget) w.buildTarget[i] = -1;
  clearEngagement(w, i);
  clearPath(w, i);
  return true;
}

function footprintReach(fp) {
  const hx = fx.fromFloat(fp.w * TILE_SIZE_F * 0.5 + TILE_SIZE_F);
  const hz = fx.fromFloat(fp.h * TILE_SIZE_F * 0.5 + TILE_SIZE_F);
  return { hx, hz };
}

function pointOnFootprint(cx, cz, fp, x, y) {
  const { hx, hz } = footprintReach(fp);
  const dx = x - cx;
  const dz = y - cz;
  return (dx < 0 ? -dx : dx) <= hx && (dz < 0 ? -dz : dz) <= hz;
}

/**
 * Friendly agora / camp / mine / attached silo whose footprint covers this
 * click, or null. The center is where a carried load gets handed in.
 * @returns {{ x: number, y: number } | null}
 */
export function depositDropOffAt(w, owner, x, y) {
  let bestX = 0;
  let bestY = 0;
  let bestD = 0x7fffffffffff;
  let found = false;
  const take = (cx, cz, fp) => {
    if (!pointOnFootprint(cx, cz, fp, x, y)) return;
    const d = fx.dist2(x, y, cx, cz);
    if (d < bestD) {
      bestD = d;
      bestX = cx;
      bestY = cz;
      found = true;
    }
  };
  const agoras = w.agoras;
  if (agoras) {
    const fp = BUILDING_FOOTPRINTS.agora;
    for (let a = 0; a < agoras.length; a++) {
      const ag = agoras[a];
      if ((ag.owner | 0) !== (owner | 0)) continue;
      if (ag.hp != null && (ag.hp | 0) <= 0) continue;
      take(ag.x, ag.z, fp);
    }
  }
  const buildings = w.buildings;
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if ((bd.owner | 0) !== (owner | 0)) continue;
      if (!buildingIsFinished(bd)) continue;
      if (bd.hp != null && (bd.hp | 0) <= 0) continue;
      if (DEPOSIT_TYPES.has(bd.type)) take(bd.x, bd.z, BUILDING_FOOTPRINTS[bd.type]);
      else if (bd.type === 'silo' && siloIsAttached(buildings, bd, 'fixed')) {
        take(bd.x, bd.z, BUILDING_FOOTPRINTS.silo);
      }
    }
  }
  return found ? { x: bestX, y: bestY } : null;
}

/** Idle parked villagers count down their hold, one pass per auto-assign tick. */
function tickManualHolds(w) {
  const hold = w.manualHold;
  if (!hold) return;
  for (let i = 0; i < w.count; i++) {
    if (hold[i] && w.alive[i] && w.order[i] === ORDER.IDLE) hold[i]--;
  }
}

function endGather(w, i) {
  w.order[i] = ORDER.IDLE;
  w.gatherTile[i] = -1;
  w.gatherCd[i] = 0;
  w.hasTarget[i] = 0;
  if (w.gatherDefensive) w.gatherDefensive[i] = 0;
  if (w.gatherAct) {
    w.gatherAct[i] = (w.carriedAmt[i] | 0) > 0 ? GATHER_ACT.HAUL : GATHER_ACT.NONE;
  }
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
}

function setGatherAct(w, i, act) {
  if (w.gatherAct) w.gatherAct[i] = act;
}

/** Deterministic wander point on the farm plot (hash of id + cycle, no rng). */
function farmWanderTarget(field, cx, cy, entityId, cycle) {
  const h = (
    Math.imul((entityId + 1) | 0, 2654435761) ^
    Math.imul((cycle + 1) | 0, 1597334677)
  ) >>> 0;
  const ox = (h & 0xff) - 128;
  const oy = ((h >>> 8) & 0xff) - 128;
  const x = cx + ((ox * FARM_WANDER_HALF) / 128) | 0;
  const y = cy + ((oy * FARM_WANDER_HALF) / 128) | 0;
  const snapped = snapToPassable(field, x, y);
  return snapped ? snapped : { x, y };
}

/** True while a villager is pottering a farm plot (not commuting to it). */
export function isFarmStroll(w, field, i) {
  if (!field || w.order[i] !== ORDER.GATHER) return false;
  const tile = w.gatherTile[i];
  if (tile < 0) return false;
  const node = nodeAt(field, tile);
  if (!node?.food) return false;
  const width = field.width | 0;
  const cx = tileCenterX(tile % width);
  const cy = tileCenterY((tile / width) | 0);
  return fx.dist2(w.px[i], w.py[i], cx, cy) <= FARM_ENTER_RANGE_SQ;
}

/**
 * Bank farm food on the gather cadence and stroll place-to-place.
 * Carry stays empty so render never shows a hauled resource.
 */
function workFarm(w, field, i, tile, width) {
  const tx = tile % width;
  const tz = (tile / width) | 0;
  const cx = tileCenterX(tx);
  const cy = tileCenterY(tz);

  if (fx.dist2(w.px[i], w.py[i], cx, cy) > FARM_ENTER_RANGE_SQ) {
    const snapped = snapToPassable(field, cx, cy);
    seekTo(w, i, snapped ? snapped.x : cx, snapped ? snapped.y : cy);
    return;
  }

  if (w.gatherCd[i] > 0) {
    w.gatherCd[i]--;
  } else {
    addGatherIncome(w, w.owner[i], 'food', GATHER_BITE);
    w.gatherCd[i] = GATHER_INTERVAL;
  }

  const destX = w.navDestX[i];
  const destY = w.navDestY[i];
  const walking = (w.navWpCount[i] | 0) > 0 || (w.pathRequest[i] | 0) !== 0;
  const arrived = fx.dist2(w.px[i], w.py[i], destX, destY) <= FARM_ARRIVE_SQ;

  if (walking && !arrived) return;

  if (arrived) {
    w.vx[i] = 0;
    w.vy[i] = 0;
    clearPath(w, i);
    // Stand a beat, then pick a new spot. Phase is per-villager so crews don't sync.
    if ((w.tick + i * 13) % FARM_PAUSE_TICKS !== 0) return;
  }
  const dest = farmWanderTarget(field, cx, cy, i, w.tick + i);
  if (fx.dist2(w.px[i], w.py[i], dest.x, dest.y) <= FARM_ARRIVE_SQ) return;
  seekTo(w, i, dest.x, dest.y);
}

/**
 * Stand on the near-side rim of a blocked node (rocks). Prefers a passable
 * tile still inside harvest range and closest to the villager so a crew does
 * not all path to the same far corner.
 */
function snapToHarvestStand(field, cx, cy, fromX, fromY, rangeSq) {
  const ctx = worldToTile(cx);
  const ctz = worldToTileZ(cy);
  let bestX = 0;
  let bestY = 0;
  let bestFrom = 0x7fffffffffff;
  let found = false;
  for (let dz = -6; dz <= 6; dz++) {
    for (let dx = -6; dx <= 6; dx++) {
      const tx = ctx + dx;
      const tz = ctz + dz;
      if (!isPassable(field, tx, tz)) continue;
      const x = tileCenterX(tx);
      const y = tileCenterY(tz);
      if (fx.dist2(x, y, cx, cy) > rangeSq) continue;
      const d = fx.dist2(fromX, fromY, x, y);
      if (!found || d < bestFrom) {
        found = true;
        bestFrom = d;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (found) return { x: bestX, y: bestY };
  return snapToPassable(field, cx, cy);
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
 * Nearest owned drop-off (agora, camp, mine, or attached silo).
 * Returns fixed-point xz or null.
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
      if (bd.hp != null && (bd.hp | 0) <= 0) continue;
      if (bd.owner !== owner) continue;
      if (DEPOSIT_TYPES.has(bd.type)) consider(bd.x, bd.z);
      else if (bd.type === 'silo' && siloIsAttached(buildings, bd, 'fixed')) consider(bd.x, bd.z);
    }
  }
  return found ? { x: bestX, y: bestY } : null;
}

/**
 * Per-tick gather driver - one phase in step(), after repair, before movement.
 * @param {object} w
 * @param {object} field
 */
/** True when this owner already has a villager tasked to the farm's food tile. */
function farmHasWorker(w, owner, tile) {
  if (tile < 0 || !w.gatherTile) return false;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.GATHER) continue;
    if ((w.gatherTile[i] | 0) === tile) return true;
  }
  return false;
}

/**
 * Unstaffed finished farms trickle food. A farmer on the plot replaces this
 * with the full bite in workFarm, so the two do not stack.
 */
function tickFarmPassive(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const interval = FARM_PASSIVE_INTERVAL | 0;
  if (interval <= 0) return;
  const tick = w.tick | 0;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (b.type !== 'farm' || !buildingIsFinished(b)) continue;
    if (b.hp != null && (b.hp | 0) <= 0) continue;
    if ((tick + bi) % interval !== 0) continue;
    const tile = buildingCenterTile(field, b);
    if (farmHasWorker(w, b.owner, tile)) continue;
    addGatherIncome(w, b.owner | 0, 'food', 1);
  }
}

export function gatherSystem(w, field) {
  if (!field) return;
  tickFarmPassive(w, field);
  const width = field.width | 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) {
      setGatherAct(w, i, GATHER_ACT.NONE);
      continue;
    }
    if (w.order[i] !== ORDER.GATHER) {
      setGatherAct(w, i, (w.carriedAmt[i] | 0) > 0 ? GATHER_ACT.HAUL : GATHER_ACT.NONE);
      continue;
    }

    const tile = w.gatherTile[i];
    const node = nodeAt(field, tile);
    const nodeStock = node ? node.stock : 0;
    const carrying = w.carriedAmt[i] | 0;

    // Farms: bank in place and potter around the plot. No haul, no carry / chop.
    if (node && node.food && carrying <= 0) {
      setGatherAct(w, i, GATHER_ACT.NONE);
      workFarm(w, field, i, tile, width);
      continue;
    }

    // Return-and-deposit when full, when the node is spent, or when the
    // player clicked a drop-off (gatherTile DEPOSIT_TILE, aim stored in tx/ty).
    const targeted = (tile | 0) === DEPOSIT_TILE;
    if (targeted || carrying >= GATHER_CARRY_CAP || nodeStock <= 0) {
      if (carrying <= 0) {
        endGather(w, i);
        continue;
      }
      setGatherAct(w, i, GATHER_ACT.HAUL);
      const drop = targeted
        ? { x: w.tx[i], y: w.ty[i] }
        : nearestDropOff(w, w.owner[i], w.px[i], w.py[i]);
      if (!drop) {
        // Nowhere to deposit - idle holding the load until re-tasked.
        w.order[i] = ORDER.IDLE;
        w.gatherTile[i] = -1;
        w.vx[i] = 0;
        w.vy[i] = 0;
        clearPath(w, i);
        continue;
      }
      if (fx.dist2(w.px[i], w.py[i], drop.x, drop.y) <= DROP_RANGE_SQ) {
        const kind = RESOURCE_KINDS[(w.carriedKind[i] | 0) - 1] ?? 'wood';
        addGatherIncome(w, w.owner[i], kind, carrying, true);
        w.carriedAmt[i] = 0;
        w.carriedKind[i] = 0;
        setGatherAct(w, i, GATHER_ACT.NONE);
        w.vx[i] = 0;
        w.vy[i] = 0;
        clearPath(w, i);
        if (nodeStock <= 0 || targeted) {
          endGather(w, i);
          // A clicked drop-off is a place to stand, not a new gather job.
          if (targeted && w.manualHold) w.manualHold[i] = MANUAL_HOLD_PASSES;
        }
        continue;
      }
      const snapped = snapToPassable(field, drop.x, drop.y);
      seekTo(w, i, snapped ? snapped.x : drop.x, snapped ? snapped.y : drop.y);
      continue;
    }

    // Harvest phase - hold within reach of the node and take bites on cadence.
    const tx = tile % width;
    const tz = (tile / width) | 0;
    const cx = tileCenterX(tx);
    const cy = tileCenterY(tz);
    if (fx.dist2(w.px[i], w.py[i], cx, cy) <= nodeRangeSq(node.foot)) {
      setGatherAct(w, i, GATHER_ACT.CHOP);
      w.vx[i] = 0;
      w.vy[i] = 0;
      clearPath(w, i);
      if (w.gatherCd[i] > 0) {
        w.gatherCd[i]--;
      } else {
        const want = Math.min(GATHER_BITE, GATHER_CARRY_CAP - carrying);
        const removed = node.food
          ? want // farm food is infinite - no field stock to decrement
          : (node.tree ? damageTree(field, tile, want) : damageRock(field, tile, want)) | 0;
        if (removed > 0) {
          w.carriedAmt[i] = carrying + removed;
          w.carriedKind[i] = node.code;
        }
        w.gatherCd[i] = GATHER_INTERVAL;
      }
    } else {
      // Rock centers are blocked - stand on a near-side passable rim tile.
      setGatherAct(w, i, GATHER_ACT.NONE);
      const snapped = node.tree
        ? null
        : snapToHarvestStand(field, cx, cy, w.px[i], w.py[i], nodeRangeSq(node.foot));
      seekTo(w, i, snapped ? snapped.x : cx, snapped ? snapped.y : cy);
    }
  }
}

function buildingCenterTile(field, b) {
  if (!field) return -1;
  const tx = worldToTile(b.x);
  const tz = worldToTileZ(b.z);
  if (tx < 0 || tz < 0 || tx >= field.width || tz >= field.height) return -1;
  return tz * (field.width | 0) + tx;
}

/** Villagers already tasked to this farm's food tile (commuting or pottering). */
function countFarmCrewOnTile(w, tile) {
  if (tile < 0 || !w.gatherTile) return 0;
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.GATHER) continue;
    if ((w.gatherTile[i] | 0) === (tile | 0)) n++;
  }
  return n;
}

function dropOffFinished(b) {
  if (!buildingIsFinished(b)) return false;
  if (b.hp != null && (b.hp | 0) <= 0) return false;
  return true;
}

/** True when `b` is this owner's closest finished building of the same type. */
function isNearestSameType(w, b, px, py) {
  let bestD = fx.dist2(px, py, b.x, b.z);
  const buildings = w.buildings;
  if (!buildings) return true;
  for (let i = 0; i < buildings.length; i++) {
    const o = buildings[i];
    if (o === b) continue;
    if (!dropOffFinished(o)) continue;
    if (o.owner !== b.owner || o.type !== b.type) continue;
    if (fx.dist2(px, py, o.x, o.z) < bestD) return false;
  }
  return true;
}

function baseWorkRadiusFx(w, b) {
  const live = nearbyEngineerCount(w, b);
  const linger = lingeringEngineerBonus(w, b);
  const eng = live > linger ? live : linger;
  const base = b.type === 'farm' ? FARM_WORK_RADIUS : CAMP_WORK_RADIUS;
  return base + eng * ENGINEER_RADIUS_BONUS;
}

function baseWorkRadiusWorld(w, b) {
  const live = nearbyEngineerCountWorld(w, b);
  const linger = lingeringEngineerBonus(w, b);
  const eng = live > linger ? live : linger;
  const base = b.type === 'farm' ? FARM_WORK_RADIUS_F : CAMP_WORK_RADIUS_F;
  return base + eng * ENGINEER_RADIUS_BONUS_F;
}

function inDropOffReachWorld(buildings, b, x, z, radius) {
  const dx = x - b.x;
  const dz = z - b.z;
  if (dx * dx + dz * dz <= radius * radius) return true;
  const silos = silosAttachedTo(buildings, b, 'world');
  if (!silos.length) return false;
  const siloR = siloWorkRadiusWorld(radius);
  const siloR2 = siloR * siloR;
  for (let i = 0; i < silos.length; i++) {
    const sx = x - silos[i].x;
    const sz = z - silos[i].z;
    if (sx * sx + sz * sz <= siloR2) return true;
  }
  return false;
}

/** Owned villagers standing in this drop-off's circle (or an attached silo copy). */
function countVillagersInReach(w, b, radius) {
  const buildings = w.buildings;
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (inDropOffReach(buildings, b, w.px[i], w.py[i], radius)) n++;
  }
  return n;
}

function countVillagersInReachWorld(w, b, buildings, radius) {
  const list = buildings ?? w.buildings;
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.VILLAGER) continue;
    const x = fx.toFloat(w.px[i]);
    const z = fx.toFloat(w.py[i]);
    if (inDropOffReachWorld(list, b, x, z, radius)) n++;
  }
  return n;
}

/**
 * Crew tiers from villagers inside the circle. Starts at the base reach so a
 * crowd standing outside cannot inflate it, then rechecks the widened circle
 * so a staffed camp can count villagers in the bonus band.
 */
function crewTiersForReach(countInside, baseReach, bonus) {
  let reach = baseReach;
  let tiers = 0;
  for (let step = 0; step <= CREW_RADIUS_TIER_CAP; step++) {
    const next = crewRadiusTiers(countInside(reach));
    if (next <= tiers) break;
    tiers = next;
    reach = baseReach + tiers * bonus;
  }
  return tiers;
}

/**
 * Crew that belongs to this drop-off: same resource class, nearest same type.
 * Farms count by their food tile so two plots never share a slot.
 */
function countAssignedCrew(w, field, b) {
  const wantClass = dropOffNodeClass(b.type);
  if (wantClass < 0) return 0;
  if (wantClass === NODE_FOOD) {
    return countFarmCrewOnTile(w, buildingCenterTile(field, b));
  }
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.GATHER) continue;
    if (field && w.gatherTile) {
      if (nodeClass(nodeAt(field, w.gatherTile[i])) !== wantClass) continue;
    }
    if (!isNearestSameType(w, b, w.px[i], w.py[i])) continue;
    n++;
  }
  return n;
}

function crewRadiusTiers(crew) {
  const n = crew | 0;
  if (n < CREW_RADIUS_TIER) return 0;
  const tiers = (n / CREW_RADIUS_TIER) | 0;
  return tiers > CREW_RADIUS_TIER_CAP ? CREW_RADIUS_TIER_CAP : tiers;
}

function nearbyEngineerCount(w, b) {
  let eng = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.ENGINEER) continue;
    if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= ENGINEER_ASSIST_RANGE_SQ) {
      if (++eng >= ENGINEER_BONUS_CAP) break;
    }
  }
  return eng;
}

function nearbyEngineerCountWorld(w, b) {
  let eng = 0;
  const rangeSq = ENGINEER_ASSIST_RANGE_F * ENGINEER_ASSIST_RANGE_F;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.ENGINEER) continue;
    const dx = fx.toFloat(w.px[i]) - b.x;
    const dz = fx.toFloat(w.py[i]) - b.z;
    if (dx * dx + dz * dz <= rangeSq && ++eng >= ENGINEER_BONUS_CAP) break;
  }
  return eng;
}

function lingeringEngineerBonus(w, b) {
  return (b.engBonusUntil | 0) > (w.tick | 0) ? (b.engBonus | 0) : 0;
}

/**
 * Refresh per-drop-off engineer stacks so the extra reach lingers after they leave.
 */
export function refreshEngineerAssists(w) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  const tick = w.tick | 0;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.built | 0) === 0 || !DROP_OFF_TYPES.has(b.type)) continue;
    const live = nearbyEngineerCount(w, b);
    if (live > 0) {
      b.engBonus = live;
      b.engBonusUntil = tick + ENGINEER_BONUS_LINGER_TICKS;
    }
  }
}

/**
 * Effective work radius of a drop-off - farm plots stay tight; camps/mines add
 * engineer assist plus a crew-size bonus (4 / 8 villagers standing in the circle).
 * HUD draws a slightly smaller ring via workRadiusRingWorld.
 * @returns {number} fixed-point radius
 */
export function campWorkRadius(w, b, field) {
  const reach = baseWorkRadiusFx(w, b);
  if (b.type === 'farm') return reach;
  const tiers = crewTiersForReach(
    (radius) => countVillagersInReach(w, b, radius),
    reach,
    CREW_RADIUS_BONUS,
  );
  return reach + tiers * CREW_RADIUS_BONUS;
}

/**
 * Gather reach in world units for a serialized (float xyz) drop-off.
 * Same engineer + crew bonus as campWorkRadius; used by the HUD ring.
 * @param {object} w
 * @param {{ x: number, z: number, owner: number, type?: string, engBonus?: number, engBonusUntil?: number }} b
 * @param {object[] | null} [buildings] serialized building list (HUD has no w.buildings)
 * @param {object | null} [field] live field, so the ring counts the same nodes as the sim
 */
export function campWorkRadiusWorld(w, b, buildings, field) {
  const reach = baseWorkRadiusWorld(w, b);
  if (b.type === 'farm') return reach;
  const tiers = crewTiersForReach(
    (radius) => countVillagersInReachWorld(w, b, buildings, radius),
    reach,
    CREW_RADIUS_BONUS_F,
  );
  return reach + tiers * CREW_RADIUS_BONUS_F;
}

/** Satellite gather reach for an attached silo (world units). */
export function siloWorkRadiusWorld(sourceRadius) {
  const r = sourceRadius - SILO_WORK_RADIUS_PENALTY_F;
  return r > 0 ? r : 0;
}

/** HUD / ghost ring radius - slightly inside the live gather circle. */
export function workRadiusRingWorld(actual) {
  const r = actual - WORK_RADIUS_RING_INSET_F;
  return r > 0 ? r : 0;
}

function siloWorkRadiusFx(sourceRadius) {
  const r = sourceRadius - SILO_WORK_RADIUS_PENALTY;
  return r > 0 ? r : 0;
}

/**
 * True when (px, py) sits inside the drop-off's work circle or any attached
 * silo's copy of that circle.
 */
function inDropOffReach(buildings, b, px, py, radius) {
  const radiusSq = fx.mul(radius, radius);
  if (fx.dist2(px, py, b.x, b.z) <= radiusSq) return true;
  const silos = silosAttachedTo(buildings, b, 'fixed');
  if (!silos.length) return false;
  const siloR = siloWorkRadiusFx(radius);
  const siloR2 = fx.mul(siloR, siloR);
  for (let i = 0; i < silos.length; i++) {
    if (fx.dist2(px, py, silos[i].x, silos[i].z) <= siloR2) return true;
  }
  return false;
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
  const bzTile = worldToTileZ(b.z);
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
 * Best matching node in the drop-off circle, or (for wood/rock) any attached
 * silo's circle. Farms keep searching from the plot only so a silo does not
 * steal a neighbor farm's food tile.
 */
function nearestNodeForDropOff(field, buildings, b, radius, fromX, fromY, wantClass) {
  const own = nearestNodeWithinRadius(field, b, radius, fromX, fromY, wantClass);
  if (wantClass === NODE_FOOD) return own;
  const silos = silosAttachedTo(buildings, b, 'fixed');
  if (!silos.length) return own;
  const width = field.width | 0;
  let best = own;
  let bestD = 0x7fffffffffff;
  if (own >= 0) {
    bestD = fx.dist2(fromX, fromY, tileCenterX(own % width), tileCenterY((own / width) | 0));
  }
  for (let i = 0; i < silos.length; i++) {
    const tile = nearestNodeWithinRadius(field, silos[i], siloWorkRadiusFx(radius), fromX, fromY, wantClass);
    if (tile < 0) continue;
    const d = fx.dist2(fromX, fromY, tileCenterX(tile % width), tileCenterY((tile / width) | 0));
    if (d < bestD) {
      bestD = d;
      best = tile;
    }
  }
  return best;
}

/**
 * Idle villagers holding a load walk it to the nearest agora / camp / mine /
 * attached silo. Called from the same cadence as worker recruitment so a
 * drop-off appearing (or a villager wandering into range) doesn't leave them
 * carrying forever.
 */
function sendIdleCarriersHome(w, field) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.manualHold?.[i]) continue;
    if (w.order[i] !== ORDER.IDLE) continue;
    if ((w.carriedAmt[i] | 0) <= 0) continue;
    if (!nearestDropOff(w, w.owner[i], w.px[i], w.py[i])) continue;
    // gatherTile -1: gatherSystem treats a spent/missing node as "haul then idle".
    beginGather(w, field, i, -1);
  }
}

/**
 * True when a villager stands inside a finished camp / mine / farm work circle
 * (including attached silo satellites) and can be recruited by campAutoAssignSystem.
 */
/** True when (px, py) is inside one drop-off's gather circle (incl. silo ring). */
export function withinDropOffWorkReach(w, field, b, px, py) {
  if (!buildingIsFinished(b)) return false;
  if (!DROP_OFF_TYPES.has(b.type)) return false;
  if (dropOffNodeClass(b.type) < 0) return false;
  const buildings = w.buildings;
  if (!buildings) return false;
  const radius = campWorkRadius(w, b, field);
  return inDropOffReach(buildings, b, px, py, radius);
}

/**
 * True when a finished camp / mine / farm still has crew room and a matching
 * node inside its work circle - i.e. campAutoAssignSystem would recruit for it.
 */
export function dropOffCanRecruit(w, field, b) {
  if (!dropOffHasNodes(w, field, b)) return false;
  return countAssignedCrew(w, field, b) < maxWorkersFor(b.type);
}

/** Matching node inside the drop-off's circle nearest (fromX, fromY), or -1 - ignores the crew cap. */
export function dropOffNodeNear(w, field, b, fromX, fromY) {
  if (!field || !buildingIsFinished(b)) return -1;
  if (b.hp != null && (b.hp | 0) <= 0) return -1;
  const wantClass = dropOffNodeClass(b.type);
  if (wantClass < 0 || wantClass === NODE_FOOD) return -1;
  const radius = campWorkRadius(w, b, field);
  return nearestNodeForDropOff(field, w.buildings, b, radius, fromX, fromY, wantClass);
}

/** Crew slots a recruiting camp / mine / farm still has open (0 when it can't recruit). */
export function dropOffCrewRoom(w, field, b) {
  if (!dropOffHasNodes(w, field, b)) return 0;
  const room = maxWorkersFor(b.type) - countAssignedCrew(w, field, b);
  return room > 0 ? room : 0;
}

/** True when a finished camp / mine / farm still has a matching node in reach. */
export function dropOffHasNodes(w, field, b) {
  if (!field || !buildingIsFinished(b)) return false;
  if (b.hp != null && (b.hp | 0) <= 0) return false;
  if (!DROP_OFF_TYPES.has(b.type)) return false;
  const wantClass = dropOffNodeClass(b.type);
  if (wantClass < 0) return false;
  const radius = campWorkRadius(w, b, field);
  return nearestNodeForDropOff(field, w.buildings, b, radius, b.x, b.z, wantClass) >= 0;
}

/** True when (px, py) is inside the reach of a drop-off that would recruit. */
export function villagerWithinAutoAssignReach(w, field, owner, px, py) {
  const buildings = w.buildings;
  if (!buildings?.length) return false;
  for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
    const b = buildings[bIdx];
    if ((b.owner | 0) !== (owner | 0)) continue;
    if (!dropOffCanRecruit(w, field, b)) continue;
    const radius = campWorkRadius(w, b, field);
    if (inDropOffReach(buildings, b, px, py, radius)) return true;
  }
  return false;
}

/** True when this finished farm still has its one farmer slot open. */
function farmStillWantsWorker(w, field, b) {
  if (b.type !== 'farm' || b.built === 0) return false;
  if (b.hp != null && (b.hp | 0) <= 0) return false;
  const tile = buildingCenterTile(field, b);
  if (tile < 0 || !field.foodNode?.[tile]) return false;
  return countAssignedCrew(w, field, b) < FARM_MAX_WORKERS;
}

/**
 * Idle villager standing where a camp or mine with crew room would recruit.
 * Farms claim these before that camp or mine does.
 */
function idleInsideOpenCampOrMine(w, field, owner, px, py) {
  const buildings = w.buildings;
  if (!buildings) return false;
  for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
    const b = buildings[bIdx];
    if ((b.owner | 0) !== (owner | 0)) continue;
    if (b.type !== 'camp' && b.type !== 'mine') continue;
    if (!dropOffCanRecruit(w, field, b)) continue;
    const radius = campWorkRadius(w, b, field);
    if (inDropOffReach(buildings, b, px, py, radius)) return true;
  }
  return false;
}

/**
 * Wood / rock gatherer whose node sits in an owned camp or mine circle.
 * Hand-gathering outside those circles is left alone.
 */
function gatheringForCampOrMine(w, field, i) {
  if (w.order[i] !== ORDER.GATHER) return false;
  const tile = w.gatherTile[i] | 0;
  if (tile < 0 || field.foodNode?.[tile]) return false;
  const width = field.width | 0;
  const px = tileCenterX(tile % width);
  const py = tileCenterY((tile / width) | 0);
  const owner = w.owner[i] | 0;
  const buildings = w.buildings;
  if (!buildings) return false;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner) continue;
    if (bd.type !== 'camp' && bd.type !== 'mine') continue;
    if (withinDropOffWorkReach(w, field, bd, px, py)) return true;
  }
  return false;
}

/**
 * Someone an open farm may take: an idle villager in its own circle or in a
 * camp/mine that still has room, or a camp/mine crew member. Parked orders
 * (manualHold) and idle villagers still carrying a load are left alone.
 */
function farmClaimCandidate(w, field, b, i) {
  if (!w.alive[i] || w.owner[i] !== b.owner || w.type[i] !== UNIT.VILLAGER) return false;
  if (w.manualHold?.[i]) return false;
  if (w.order[i] === ORDER.IDLE) {
    if ((w.carriedAmt[i] | 0) > 0) return false;
    const radius = campWorkRadius(w, b, field);
    if (inDropOffReach(w.buildings, b, w.px[i], w.py[i], radius)) return true;
    return idleInsideOpenCampOrMine(w, field, b.owner, w.px[i], w.py[i]);
  }
  return gatheringForCampOrMine(w, field, i);
}

/**
 * Fill open farms before camps and mines. Each pass gives the closest open
 * farm its closest claimable villager, one farmer per plot.
 */
function staffFarms(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  for (let guard = buildings.length; guard > 0; guard--) {
    let bestB = -1;
    let bestI = -1;
    let bestD = 0;
    for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
      const b = buildings[bIdx];
      if (!farmStillWantsWorker(w, field, b)) continue;
      for (let i = 0; i < w.count; i++) {
        if (!farmClaimCandidate(w, field, b, i)) continue;
        const d = fx.dist2(w.px[i], w.py[i], b.x, b.z);
        if (
          bestI < 0 ||
          d < bestD ||
          (d === bestD && (bIdx < bestB || (bIdx === bestB && i < bestI)))
        ) {
          bestD = d;
          bestB = bIdx;
          bestI = i;
        }
      }
    }
    if (bestI < 0) return;
    const b = buildings[bestB];
    const tile = buildingCenterTile(field, b);
    // A mid-haul wood/rock load is banked so the switch does not mix it into food.
    const amt = w.carriedAmt[bestI] | 0;
    if (amt > 0) {
      const kind = RESOURCE_KINDS[(w.carriedKind[bestI] | 0) - 1];
      if (kind) addGatherIncome(w, w.owner[bestI], kind, amt, true);
      w.carriedAmt[bestI] = 0;
      w.carriedKind[bestI] = 0;
    }
    if (!beginGather(w, field, bestI, tile)) return;
  }
}

/**
 * Farms staff first (their circle, plus anyone a camp or mine would take).
 * Camps and mines then pull nearby idle villagers onto nodes in reach. Runs
 * on a fixed cadence. A villager still under a player order is skipped, and
 * so is one a move / attack / stop parked (manualHold) until it has idled out
 * the hold - arriving at a click must not walk them straight back onto the
 * node. Idle carriers are sent home first (including to an agora-only base),
 * unless that same park is holding them.
 * @param {object} w
 * @param {object} field
 */
export function campAutoAssignSystem(w, field) {
  if (!field) return;
  if (w.tick % AUTO_ASSIGN_INTERVAL !== 0) return;
  tickManualHolds(w);
  sendIdleCarriersHome(w, field);
  if (!w.buildings?.length) return;
  staffFarms(w, field);
  for (let bIdx = 0; bIdx < w.buildings.length; bIdx++) {
    const b = w.buildings[bIdx];
    if (b.type === 'farm') continue; // staffFarms owns farms
    if (b.built === 0) continue; // a site can't recruit gatherers yet
    if (b.hp != null && (b.hp | 0) <= 0) continue;
    if (!DROP_OFF_TYPES.has(b.type)) continue;
    const wantClass = dropOffNodeClass(b.type);
    if (wantClass < 0) continue; // agora-like: deposit only, never recruits
    const owner = b.owner;
    const radius = campWorkRadius(w, b, field);
    const cap = maxWorkersFor(b.type);

    // Crew is per-building (farm tile / nearest camp or mine), not "anyone
    // gathering this class inside the ring" - two farms no longer share a cap.
    let workers = countAssignedCrew(w, field, b);
    if (workers >= cap) continue;

    for (let i = 0; i < w.count && workers < cap; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.manualHold?.[i]) continue;
      if (w.order[i] !== ORDER.IDLE) continue;
      if ((w.carriedAmt[i] | 0) > 0) continue; // sendIdleCarriersHome owns these
      if (!inDropOffReach(w.buildings, b, w.px[i], w.py[i], radius)) continue;
      const tile = nearestNodeForDropOff(field, w.buildings, b, radius, w.px[i], w.py[i], wantClass);
      if (tile < 0) break; // no matching nodes in reach - nothing to recruit for
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
  const czTile = worldToTileZ(py);
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
 * Defensive farming - villagers that reached a node via attack-move hold their
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
        if (w.targetBuilding) w.targetBuilding[i] = -1;
        w.order[i] = ORDER.ATTACK;
        w.hasTarget[i] = 0;
        clearPath(w, i);
        queuePath(w, i, w.px[foe], w.py[foe]);
      }
    } else if (order === ORDER.IDLE) {
      // Combat ended (endAttack -> IDLE) - resume the plot if it still stands,
      // otherwise drop the defensive tag so the villager truly idles.
      const tile = w.gatherTile[i];
      if (tile >= 0 && nodeAt(field, tile)) {
        beginGather(w, field, i, tile, 1);
      } else {
        w.gatherDefensive[i] = 0;
        w.gatherTile[i] = -1;
      }
    } else if (order === ORDER.ATTACK) {
      // Hostile left the plot ring - drop the swing and resume the node now,
      // before combat keeps pathing after them.
      const foe = w.targetEntity[i];
      if (foe < 0 || !w.alive[foe] || (w.carriedBy?.[foe] >= 0)) continue;
      const tile = w.gatherTile[i] | 0;
      if (!nodeAt(field, tile)) continue;
      const width = field.width | 0;
      const cx = tileCenterX(tile % width);
      const cy = tileCenterY((tile / width) | 0);
      if (fx.dist2(cx, cy, w.px[foe], w.py[foe]) > DEFEND_RANGE_SQ) {
        beginGather(w, field, i, tile, 1);
      }
    }
  }
}
