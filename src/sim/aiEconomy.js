// Rule-based economic AI — the foundation of match AI.
//
// Baseline (path `eco`) is the opening-skirmish partner: village, farm rings
// around the agora, camps / mines / silos. Gathering is facility-driven:
// finished camps/mines/farms recruit via campAutoAssignSystem; the AI only
// nudges idle villagers into reach (MOVE) and places drop-offs near nodes.
// Army and tech paths take that ladder first, then spend on barracks / lab.
// Difficulty decides whether a full bank is spent (train / research / another
// source) or left to take the 25% overflow hit. Same command objects a human
// would issue. Deterministic (index-order scans, no Math.random).

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { ORDER } from './world.js';
import { getUnitCost, UNIT } from './unitTypes.js';
import { canAffordBank, getResource, RESOURCE_KINDS } from './resources.js';
import { SCENERY } from './scenery.js';
import {
  worldToTile,
  worldToTileZ,
  tileCenterX,
  tileCenterY,
  TILE_SIZE_F,
} from './field.js';
import {
  canPlaceBuildingAt,
  snapBuildingWorld,
  getBuildingCost,
  BUILDING_FOOTPRINTS,
  BUILDING_MENUS,
  buildingIsFinished,
  ownerMeetsBuildingRequires,
} from './buildings.js';
import { getTechCost, ownerHasTech, TECH_BY_ID } from './tech.js';
import {
  CAMP_WORK_RADIUS_F,
  DROP_OFF_TYPES,
  dropOffCanRecruit,
  dropOffCrewRoom,
  dropOffHasNodes,
  dropOffNodeNear,
  villagerWithinAutoAssignReach,
  withinDropOffWorkReach,
} from './gather.js';
import { AI_DIFFICULTY, AI_PATH, captureIntent, resolveAiStrategy } from './aiStrategy.js';
import {
  MAX_RESOURCE_SLOTS,
  SILO_ATTACH_RANGE_F,
  SILO_SOURCE_TYPE,
  ownerOverflowCap,
  ownerResourceCap,
  ownerSlotCount,
  unpairedSiloSource,
  withinSiloAttach,
} from './storage.js';

/** How often (ticks) the economy AI re-plans. Phased per owner. */
const DECIDE_INTERVAL = 30;
/** Villagers per camp / mine before another of that type is worth placing. */
const CREW_PER_SITE = 6;
/** Food bank below which the AI treats food as urgent. */
const FOOD_LOW = 40;
/** Desired standing stock per resource — drives demand-based worker routing. */
const STOCK_TARGET = { wood: 160, food: 150, stone: 90, mineral: 40 };
/** Node search window around a villager / base (tiles). */
const SCAN_TILES = 44;
/** Ceilings on working (non-depleted) camps / mines; demand scales up to these. */
const CAMP_CAP = 6;
const MINE_CAP = 4;
/** Idle villagers that justify a new camp even when wood isn't short. */
const IDLE_CREW_FOR_CAMP = 3;
/** Hand-gatherers outside every camp / mine circle that call for another one. */
const HAND_CREW_FOR_SITE = 2;
/** Villagers before the first mine goes down (stone / mineral sink). */
const FIRST_MINE_AT = 5;
/** Surplus farms wait while this many plots (incl. sites) sit unstaffed. */
const FARM_UNSTAFFED_MAX = 2;
const FARM_PER_VILLAGERS = 5;
const CAMP_WORK_RADIUS = fx.fromFloat(CAMP_WORK_RADIUS_F);
const CAMP_WORK_RADIUS_SQ = fx.mul(CAMP_WORK_RADIUS, CAMP_WORK_RADIUS);
/** A new camp / mine sits this close to its target node (a tile inside reach). */
const GATHER_SITE_REACH = fx.fromFloat(CAMP_WORK_RADIUS_F - TILE_SIZE_F);
const GATHER_SITE_REACH_SQ = fx.mul(GATHER_SITE_REACH, GATHER_SITE_REACH);
/** Half-width (tiles) of the box scored around a candidate site — a tile inside reach. */
const DENSE_REACH_TILES = Math.floor(CAMP_WORK_RADIUS_F / TILE_SIZE_F) - 1;
/** Distance discount: score = stock * D / (D + tilesFromBase). */
const DENSE_DIST_DEN = 24;
/** Best-scored candidates tried for a legal footprint before falling back. */
const DENSE_MAX_TRIES = 400;
/** Legal candidates rescored against the true work circle. */
const DENSE_EXACT = 24;
const ECO_VILLAGE_CAP = 2;
const ECO_VILLAGE_AT = 8;
/** Don't flood 1vAI's opening army; skirmish (no troops) will train up to these. */
const TRAIN_CAP = { warrior: 6, archer: 4 };
const ARMY_FORWARD = 52;
const TECH_SIDE = 48;

/**
 * Emit this AI owner's economy commands for the current tick (possibly none).
 * @param {object} w world
 * @param {object} field
 * @param {{ owner: number, temperament?: string, economy?: boolean }} entry
 * @returns {import('./commands.js').Command[]}
 */
export function generateEconomyCommands(w, field, entry) {
  if (!field) return [];
  const strategy = resolveAiStrategy(entry);
  if (!strategy.economy || strategy.owner < 0) return [];
  const owner = strategy.owner;
  const phase = (owner * 11) % DECIDE_INTERVAL;
  if (w.tick % DECIDE_INTERVAL !== phase) return [];

  const bank = {
    wood: getResource(w, owner, 'wood'),
    stone: getResource(w, owner, 'stone'),
    mineral: getResource(w, owner, 'mineral'),
    food: getResource(w, owner, 'food'),
  };

  const base = ownerBase(w, owner);
  if (!base) return [];

  const inv = countBuildings(w, owner);
  const villagers = collectVillagers(w, owner);
  const capture = captureIntent(w, strategy);
  const pressure = bankPressure(w, owner, bank, strategy.difficulty);

  /** @type {import('./commands.js').Command[]} */
  const cmds = [];

  // Capture ringing — hotter seats cut the farm queue and train first.
  if (capture.urgent && strategy.heat >= 2) {
    const train = chooseTrain(w, owner, bank, strategy, capture, pressure);
    if (train) {
      cmds.push(train);
      return cmds;
    }
  }

  const order = demandOrder(bank, pressure);
  // No mine yet and short the stone to place one: hand-gather stone first.
  const mineStone = getBuildingCost('mine').stone | 0;
  const stoneForMine = inv.mine === 0 && villagers.total >= FIRST_MINE_AT && (bank.stone | 0) < mineStone;
  if (stoneForMine) {
    order.splice(order.indexOf('stone'), 1);
    order.unshift('stone');
  }

  // ── Step 1: idle hands — new-facility rally, else camp/mine, else gather direct
  const rallied = new Set();
  const room = new Map();
  rallyOpenGatherFacilities(w, field, owner, villagers.idle, cmds, rallied, room);
  routeIdleVillagers(w, field, owner, villagers.idle, order, cmds, rallied, room);
  if (order[0] === 'food') pullHaulersToOpenFarms(w, field, owner, cmds, rallied);
  if (stoneForMine) pullHandToStone(w, field, owner, base, cmds, rallied);

  // ── Step 2: place one building (eco ladder, then path) ───────────────────
  // Silo first: cap relief keeps placing sources until one gets paired.
  const siloAt = chooseSiloAnchor(w, owner, bank, order);
  const gather = gatherSiteState(w, field, owner, base, order);
  gather.idle = villagers.idle.length;
  const build = siloAt
    ? 'silo'
    : chooseBuild(w, owner, bank, inv, villagers.total, order, strategy, capture, pressure, gather);
  if (build) {
    const around = siloAt
      ? { x: siloAt.x, y: siloAt.z }
      : buildAnchor(field, build, base, gather);
    // Camps / mines go where the most uncovered stock sits; fall back to
    // hugging the nearest node (inside its reach).
    const gatherSite = build === 'camp' || build === 'mine';
    let spot = gatherSite ? findDenseGatherSpot(field, build, base, gather.sites, order) : null;
    if (!spot) {
      spot = build === 'silo'
        ? findSiloAttachSpot(field, around.x, around.y)
        : findBuildSpot(field, w, build, around.x, around.y, gatherSite ? GATHER_SITE_REACH_SQ : 0);
    }
    if (spot) {
      cmds.push({
        type: CMD.PLACE_BUILDING,
        playerId: owner,
        buildingType: build,
        tx: spot.x,
        ty: spot.y,
      });
      return cmds;
    }
  }

  // ── Step 3: research or train (eco path only when dumping a full bank) ───
  const spend = chooseSpend(w, owner, bank, strategy, capture, pressure);
  if (spend) {
    cmds.push(spend);
    return cmds;
  }
  // Nothing left to train or research: overflowing wood grows the farm ring.
  if (
    pressure.dump
    && pressure.overflowing.includes('wood')
    && !(capture?.urgent && strategy.heat >= 3)
    && surplusFarmOk(bank, inv, gather)
  ) {
    const spot = findBuildSpot(field, w, 'farm', base.x, base.y);
    if (spot) {
      cmds.push({ type: CMD.PLACE_BUILDING, playerId: owner, buildingType: 'farm', tx: spot.x, ty: spot.y });
    }
  }
  return cmds;
}

/** Owner's base point (agora first, else villager centroid). */
function ownerBase(w, owner) {
  const agoras = w.agoras;
  if (agoras) {
    for (let a = 0; a < agoras.length; a++) {
      if (agoras[a].owner === owner) return { x: agoras[a].x, y: agoras[a].z };
    }
  }
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    sx += w.px[i];
    sy += w.py[i];
    c++;
  }
  if (c === 0) return null;
  return { x: (sx / c) | 0, y: (sy / c) | 0 };
}

function countBuildings(w, owner) {
  const inv = {
    village: 0,
    farm: 0,
    camp: 0,
    mine: 0,
    barracks: 0,
    tavern: 0,
    lab: 0,
    moonwell: 0,
    /** Farms still under construction. */
    farmSites: 0,
  };
  const buildings = w.buildings;
  if (!buildings) return inv;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if (bd.owner !== owner) continue;
    if (bd.type in inv) inv[bd.type]++;
    if (bd.type === 'farm' && !buildingIsFinished(bd)) inv.farmSites++;
  }
  return inv;
}

function collectVillagers(w, owner) {
  const idle = [];
  let total = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    total++;
    if (w.order[i] === ORDER.IDLE && (w.carriedAmt[i] | 0) === 0) idle.push(i);
  }
  return { idle, total };
}

/** Camp / mine that recruits for each hauled kind. Food is farm-only (one farmer per plot). */
const GATHER_FACILITY = { wood: 'camp', stone: 'mine', mineral: 'mine' };
/** Idle villagers given an order per decision — one command each. */
const MAX_ASSIGN_PER_TICK = 4;

function moveOne(i, x, z) {
  return { type: CMD.MOVE, entities: [i], tx: [x], ty: [z] };
}

/**
 * Working (or waiting to work) for a camp / mine: gathering a node inside one
 * of the owner's camp / mine circles, or idle inside one. The planner leaves
 * these to the facility.
 */
function onFacilityCrew(w, field, owner, i) {
  const buildings = w.buildings;
  if (!buildings) return false;
  let px = w.px[i];
  let py = w.py[i];
  if (w.order[i] === ORDER.GATHER) {
    const tile = w.gatherTile[i] | 0;
    if (tile < 0) return false;
    px = tileCenterX(tile % field.width);
    py = tileCenterY((tile / field.width) | 0);
  } else if (w.order[i] !== ORDER.IDLE) {
    return false;
  }
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || (bd.type !== 'camp' && bd.type !== 'mine')) continue;
    if (withinDropOffWorkReach(w, field, bd, px, py)) return true;
  }
  return false;
}

/** First economy planner tick on or after `afterTick` (phased per owner). */
function firstEconomyTickAtOrAfter(afterTick, owner) {
  const interval = DECIDE_INTERVAL;
  const phase = (owner * 11) % interval;
  let t = afterTick | 0;
  for (let n = 0; n < interval; n++) {
    if (t % interval === phase) return t;
    t++;
  }
  return t;
}

/**
 * Villagers already headed for (MOVE ending inside) or idling inside the
 * facility's circle — crew it will recruit without another order.
 */
function pendingCrew(w, field, owner, bd) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    const o = w.order[i];
    if (o === ORDER.MOVE) {
      if (withinDropOffWorkReach(w, field, bd, w.tx[i], w.ty[i])) n++;
    } else if (o === ORDER.IDLE) {
      if (withinDropOffWorkReach(w, field, bd, w.px[i], w.py[i])) n++;
    }
  }
  return n;
}

/** Open crew slots per facility this decision (lazy; decremented as villagers are sent). */
function facilityRoom(w, field, owner, bd, room) {
  let r = room.get(bd);
  if (r === undefined) {
    r = dropOffCrewRoom(w, field, bd) - pendingCrew(w, field, owner, bd);
    room.set(bd, r);
  }
  return r;
}

/**
 * When a gather facility just finished, walk the nearest idle villagers not
 * already in its circle over — one MOVE each, up to its open crew (once, on
 * the next economy tick). The facility recruits them on arrival.
 * @param {Set<number>} rallied entity ids already given an order this decision
 * @param {Map<object, number>} room open crew per facility this decision
 */
function rallyOpenGatherFacilities(w, field, owner, idleIds, cmds, rallied, room) {
  const buildings = w.buildings;
  if (!buildings?.length || !idleIds.length) return;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner) continue;
    if (!DROP_OFF_TYPES.has(bd.type)) continue;
    if (!buildingIsFinished(bd)) continue;
    const at = bd.gatherRallyAt | 0;
    if (at <= 0) continue;
    if ((w.tick | 0) !== firstEconomyTickAtOrAfter(at, owner)) continue;
    const free = idleIds.filter(
      (i) => !rallied.has(i) && !withinDropOffWorkReach(w, field, bd, w.px[i], w.py[i]),
    );
    free.sort((a, c) => fx.dist2(w.px[a], w.py[a], bd.x, bd.z) - fx.dist2(w.px[c], w.py[c], bd.x, bd.z) || a - c);
    let open = facilityRoom(w, field, owner, bd, room);
    for (let k = 0; k < free.length && open > 0; k++) {
      cmds.push(moveOne(free[k], bd.x, bd.z));
      rallied.add(free[k]);
      open--;
    }
    room.set(bd, open);
  }
}

/** Nearest camp / mine for `kind` with an open crew slot, or null. */
function nearestFacilityWithRoom(w, field, owner, kind, fromX, fromY, room) {
  const type = GATHER_FACILITY[kind];
  if (!type) return null;
  const buildings = w.buildings;
  if (!buildings) return null;
  let best = null;
  let bestD = 0x7fffffffffff;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || bd.type !== type) continue;
    if (!buildingIsFinished(bd)) continue;
    const d = fx.dist2(fromX, fromY, bd.x, bd.z);
    if (d >= bestD) continue;
    if (facilityRoom(w, field, owner, bd, room) <= 0) continue;
    bestD = d;
    best = bd;
  }
  return best;
}

/**
 * One order for villager i: walk to a camp / mine with room; else work a node
 * inside a full one's circle (hauls home to it, stays local); else gather the
 * nearest node out in the open.
 */
function assignOne(w, field, owner, i, kind, cmds, room) {
  const site = nearestFacilityWithRoom(w, field, owner, kind, w.px[i], w.py[i], room);
  if (site) {
    cmds.push(moveOne(i, site.x, site.z));
    room.set(site, room.get(site) - 1);
    return true;
  }
  let tile = nearestFacilityNode(w, field, owner, kind, w.px[i], w.py[i]);
  if (tile < 0) tile = nearestNode(field, kind, w.px[i], w.py[i]);
  if (tile < 0) return false;
  cmds.push({ type: CMD.GATHER, entities: [i], tile });
  return true;
}

/** Nearest `kind` node inside any of the owner's camp / mine circles, or -1. */
function nearestFacilityNode(w, field, owner, kind, fromX, fromY) {
  const type = GATHER_FACILITY[kind];
  const buildings = w.buildings;
  if (!type || !buildings) return -1;
  const width = field.width | 0;
  let best = -1;
  let bestD = 0x7fffffffffff;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || bd.type !== type) continue;
    const tile = dropOffNodeNear(w, field, bd, fromX, fromY);
    if (tile < 0 || !nodeMatches(field, kind, tile)) continue;
    const d = fx.dist2(fromX, fromY, tileCenterX(tile % width), tileCenterY((tile / width) | 0));
    if (d < bestD) {
      bestD = d;
      best = tile;
    }
  }
  return best;
}

/**
 * Idle villagers outside any recruiting work circle: first one farmer to each
 * unstaffed farm (unless food is the least-needed kind), then up to
 * MAX_ASSIGN_PER_TICK individual orders from each villager's own spot,
 * alternating the two neediest hauled kinds — walk to a camp / mine with open
 * crew (preferred), else gather the nearest node of that kind by hand.
 */
function routeIdleVillagers(w, field, owner, idleIds, order, cmds, rallied, room) {
  let ids = [];
  for (let k = 0; k < idleIds.length; k++) {
    const i = idleIds[k];
    if (rallied.has(i)) continue;
    if (villagerWithinAutoAssignReach(w, field, owner, w.px[i], w.py[i])) continue;
    ids.push(i);
  }
  if (!ids.length) return;
  if (order.indexOf('food') < order.length - 1) {
    ids = staffOpenFarms(w, field, owner, ids, cmds, rallied);
    if (!ids.length) return;
  }
  const hauled = order.filter((k) => GATHER_FACILITY[k]);
  const lead = hauled.slice(0, 2);
  let sent = 0;
  for (let k = 0; k < ids.length && sent < MAX_ASSIGN_PER_TICK; k++) {
    const i = ids[k];
    const first = lead[sent % lead.length];
    let ok = assignOne(w, field, owner, i, first, cmds, room);
    for (let o = 0; !ok && o < hauled.length; o++) {
      if (hauled[o] !== first) ok = assignOne(w, field, owner, i, hauled[o], cmds, room);
    }
    if (!ok) continue;
    rallied.add(i);
    sent++;
  }
}

/** Farms reassigned from wood / rock per decision when food is the top need. */
const MAX_FARM_PULLS = 2;

/**
 * Food is the neediest kind but farms sit unstaffed with no idle hands: walk
 * the nearest hand-gatherer of wood / rock over (empty-handed ones first).
 * Camp / mine crews are left to their facility.
 */
function pullHaulersToOpenFarms(w, field, owner, cmds, rallied) {
  const buildings = w.buildings;
  if (!buildings) return;
  let pulls = 0;
  for (let b = 0; b < buildings.length && pulls < MAX_FARM_PULLS; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || bd.type !== 'farm') continue;
    if (!dropOffCanRecruit(w, field, bd)) continue;
    if (farmHandWaiting(w, field, owner, bd)) continue;
    let pick = -1;
    let bestD = 0;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
      if (w.order[i] !== ORDER.GATHER || rallied.has(i)) continue;
      const tile = w.gatherTile[i] | 0;
      if (tile >= 0 && field.foodNode?.[tile]) continue;
      if (onFacilityCrew(w, field, owner, i)) continue;
      // Loaded haulers count as farther so a fresh hand is picked first.
      let d = fx.dist2(w.px[i], w.py[i], bd.x, bd.z);
      if ((w.carriedAmt[i] | 0) > 0) d += 0x3fffffff;
      if (pick < 0 || d < bestD) {
        pick = i;
        bestD = d;
      }
    }
    if (pick < 0) return;
    cmds.push(moveOne(pick, bd.x, bd.z));
    rallied.add(pick);
    pulls++;
  }
}

/**
 * No mine and too little stone to place one: unless someone is already on
 * stone, send the nearest hand-gatherer of wood (empty-handed first) to the
 * nearest rock. Camp crews are left to their camp.
 */
function pullHandToStone(w, field, owner, base, cmds, rallied) {
  const tile = nearestNode(field, 'stone', base.x, base.y);
  if (tile < 0) return;
  for (let c = 0; c < cmds.length; c++) {
    const cm = cmds[c];
    if (cm.type === CMD.GATHER && nodeMatches(field, 'stone', cm.tile)) return;
  }
  let pick = -1;
  let bestD = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.GATHER || rallied.has(i)) continue;
    const at = w.gatherTile[i] | 0;
    if (at < 0) continue;
    if (nodeMatches(field, 'stone', at)) return;
    if (!nodeMatches(field, 'wood', at)) continue;
    if (onFacilityCrew(w, field, owner, i)) continue;
    let d = fx.dist2(w.px[i], w.py[i], tileCenterX(tile % field.width), tileCenterY((tile / field.width) | 0));
    if ((w.carriedAmt[i] | 0) > 0) d += 0x3fffffff;
    if (pick < 0 || d < bestD) {
      pick = i;
      bestD = d;
    }
  }
  if (pick < 0) return;
  cmds.push({ type: CMD.GATHER, entities: [pick], tile });
  rallied.add(pick);
}

/**
 * An idle, empty-handed villager already stands in the farm's circle — the
 * farm will recruit it once any move park wears off.
 */
function farmHandWaiting(w, field, owner, bd) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.IDLE || (w.carriedAmt[i] | 0) > 0) continue;
    if (withinDropOffWorkReach(w, field, bd, w.px[i], w.py[i])) return true;
  }
  return false;
}

/** Nearest free hand to each farm still missing its farmer. Returns the leftovers. */
function staffOpenFarms(w, field, owner, ids, cmds, rallied) {
  const buildings = w.buildings;
  if (!buildings) return ids;
  let left = ids;
  for (let b = 0; b < buildings.length && left.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || bd.type !== 'farm') continue;
    if (!dropOffCanRecruit(w, field, bd)) continue;
    if (farmHandWaiting(w, field, owner, bd)) continue;
    let pick = 0;
    let bestD = fx.dist2(w.px[left[0]], w.py[left[0]], bd.x, bd.z);
    for (let k = 1; k < left.length; k++) {
      const d = fx.dist2(w.px[left[k]], w.py[left[k]], bd.x, bd.z);
      if (d < bestD) {
        bestD = d;
        pick = k;
      }
    }
    const i = left[pick];
    cmds.push(moveOne(i, bd.x, bd.z));
    rallied.add(i);
    left = left.filter((_, k) => k !== pick);
  }
  return left;
}

/**
 * How full each bank is vs the overflow-tax line. At 1.0 incoming yields
 * are cut to 25% (Scribes doubles that line). Higher difficulty starts
 * spending before they kiss the cap.
 */
export function bankPressure(w, owner, bank, difficulty) {
  const d = difficulty | 0;
  // Stay above opening stock (food 100 / wood 90 on a 120 cap) so expert
  // doesn't dump-spend the starting bank.
  const start = d >= AI_DIFFICULTY.EXPERT ? 0.90 : d >= AI_DIFFICULTY.HARD ? 0.95 : 1;
  /** @type {string[]} */
  const overflowing = [];
  /** @type {string[]} */
  const pressured = [];
  const buildings = w.buildings;
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const k = RESOURCE_KINDS[i];
    const cap = ownerOverflowCap(w, owner, k);
    if (cap <= 0) continue;
    const amt = bank[k] | 0;
    if (amt >= cap) overflowing.push(k);
    if (amt >= cap * start) pressured.push(k);
  }
  return {
    overflowing,
    pressured,
    dump: d >= AI_DIFFICULTY.NORMAL && pressured.length > 0,
  };
}

function kindSet(list) {
  const s = Object.create(null);
  if (!list) return s;
  for (let i = 0; i < list.length; i++) s[list[i]] = true;
  return s;
}

/** Resource kinds sorted by biggest deficit vs target (most-needed first). */
function demandOrder(bank, pressure) {
  const kinds = ['wood', 'food', 'stone', 'mineral'];
  const avoid = pressure?.dump ? kindSet(pressure.overflowing) : null;
  return kinds
    .map((k) => {
      let d = (STOCK_TARGET[k] | 0) - (bank[k] | 0);
      if (avoid?.[k]) d = -0x3fffffff;
      return { k, d };
    })
    .sort((a, b) => b.d - a.d)
    .map((e) => e.k);
}

function nodeMatches(field, kind, tile) {
  if (kind === 'wood') return (field.treeStock?.[tile] | 0) > 0;
  if (kind === 'food') return !!field.foodNode?.[tile];
  const st = field.sceneryType?.[tile] | 0;
  if ((field.rockStock?.[tile] | 0) <= 0) return false;
  if (kind === 'mineral') return st === SCENERY.ROCK_PLAIN;
  if (kind === 'stone') return st === SCENERY.ROCK_MOSS || st === SCENERY.ROCK_SNOW;
  return false;
}

/** Nearest tile of `kind` within SCAN_TILES of (px,py). -1 if none. */
function nearestNode(field, kind, px, py) {
  const width = field.width | 0;
  const height = field.height | 0;
  const ctx = worldToTile(px);
  const ctz = worldToTileZ(py);
  let best = -1;
  let bestD = 0x7fffffffffff;
  const z0 = Math.max(0, ctz - SCAN_TILES);
  const z1 = Math.min(height - 1, ctz + SCAN_TILES);
  const x0 = Math.max(0, ctx - SCAN_TILES);
  const x1 = Math.min(width - 1, ctx + SCAN_TILES);
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tile = tz * width + tx;
      if (!nodeMatches(field, kind, tile)) continue;
      const d = fx.dist2(px, py, tileCenterX(tx), tileCenterY(tz));
      if (d < bestD) {
        bestD = d;
        best = tile;
      }
    }
  }
  return best;
}

/**
 * When a bank is at its unlocked cap, plant a silo beside an unpaired source
 * so the next three icons unlock. Pending sites already next to that source
 * wait — no spam.
 */
function chooseSiloAnchor(w, owner, bank, order) {
  if (!affordable(bank, getBuildingCost('silo'))) return null;
  const buildings = w.buildings;
  const kinds = order?.length ? order : ['wood', 'food', 'stone', 'mineral'];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const cap = ownerResourceCap(buildings, owner, kind, 'fixed', w);
    if ((bank[kind] | 0) < cap) continue;
    if (ownerSlotCount(buildings, owner, kind, 'fixed', w) >= MAX_RESOURCE_SLOTS) continue;
    const sourceType = SILO_SOURCE_TYPE[kind];
    const source = unpairedSiloSource(buildings, owner, sourceType);
    if (!source) continue;
    if (pendingSiloBeside(buildings, owner, source)) continue;
    return source;
  }
  return null;
}

function pendingSiloBeside(buildings, owner, source) {
  if (!buildings) return false;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== (owner | 0) || b.type !== 'silo') continue;
    if (b.hp != null && (b.hp | 0) <= 0) continue;
    if (withinSiloAttach(b, source, 'fixed')) return true;
  }
  return false;
}

/** Dense ring search that stays inside silo attach range of (aroundX, aroundY). */
function findSiloAttachSpot(field, aroundX, aroundY) {
  const type = 'silo';
  const maxRing = (SILO_ATTACH_RANGE_F / TILE_SIZE_F) | 0;
  for (let ring = 2; ring <= maxRing; ring++) {
    const r = ring * TILE_SIZE_F;
    const offsets = [
      [0, -r], [r, 0], [0, r], [-r, 0],
      [r, -r], [r, r], [-r, r], [-r, -r],
    ];
    for (let o = 0; o < offsets.length; o++) {
      const cx = aroundX + fx.fromInt(offsets[o][0] | 0);
      const cy = aroundY + fx.fromInt(offsets[o][1] | 0);
      const snapped = snapBuildingWorld(type, cx, cy);
      if (!canPlaceBuildingAt(field, type, snapped.x, snapped.z)) continue;
      if (!withinSiloAttach({ x: snapped.x, z: snapped.z }, { x: aroundX, z: aroundY }, 'fixed')) {
        continue;
      }
      return { x: snapped.x, y: snapped.z };
    }
  }
  return null;
}

function ecoBaselineReady(inv) {
  return inv.village >= 1 && inv.farm >= 1;
}

/**
 * Camps / mines still pulling their weight (sites, or finished with nodes in
 * reach), plus the nearest node of each class no camp / mine already covers.
 */
function gatherSiteState(w, field, owner, base, order) {
  /** Sites, or finished with nodes in reach. */
  const live = { camp: 0, mine: 0 };
  /** Under construction. */
  const pending = { camp: 0, mine: 0 };
  /** Finished and would still take a worker. */
  const open = { camp: 0, mine: 0, farm: 0 };
  const sites = [];
  const buildings = w.buildings;
  if (buildings) {
    for (let b = 0; b < buildings.length; b++) {
      const bd = buildings[b];
      if ((bd.owner | 0) !== owner) continue;
      if (bd.type === 'farm') {
        if (dropOffCanRecruit(w, field, bd)) open.farm++;
        continue;
      }
      if (bd.type !== 'camp' && bd.type !== 'mine') continue;
      if (bd.hp != null && (bd.hp | 0) <= 0 && buildingIsFinished(bd)) continue;
      sites.push(bd);
      if (!buildingIsFinished(bd)) {
        pending[bd.type]++;
        live[bd.type]++;
      } else if (dropOffHasNodes(w, field, bd)) {
        live[bd.type]++;
        if (dropOffCanRecruit(w, field, bd)) open[bd.type]++;
      }
    }
  }
  // Hand-gatherers working outside every same-type circle (sites included).
  const hand = { camp: 0, mine: 0 };
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.owner[i] !== owner || w.type[i] !== UNIT.VILLAGER) continue;
    if (w.order[i] !== ORDER.GATHER) continue;
    const tile = w.gatherTile[i] | 0;
    if (tile < 0) continue;
    const type = nodeMatches(field, 'wood', tile)
      ? 'camp'
      : (nodeMatches(field, 'stone', tile) || nodeMatches(field, 'mineral', tile) ? 'mine' : null);
    if (!type) continue;
    const x = tileCenterX(tile % field.width);
    const y = tileCenterY((tile / field.width) | 0);
    if (!nodeCovered(sites, type, x, y)) hand[type]++;
  }
  // One site of a type at a time — wait for it before planning the next.
  let campTile = -1;
  if (pending.camp === 0) campTile = nearestUncoveredNode(field, 'wood', base.x, base.y, sites, 'camp');
  let mineTile = -1;
  if (pending.mine === 0) {
    const rockFirst = order.indexOf('mineral') < order.indexOf('stone') ? 'mineral' : 'stone';
    const rockNext = rockFirst === 'stone' ? 'mineral' : 'stone';
    mineTile = nearestUncoveredNode(field, rockFirst, base.x, base.y, sites, 'mine');
    if (mineTile < 0) mineTile = nearestUncoveredNode(field, rockNext, base.x, base.y, sites, 'mine');
  }
  return {
    live,
    open,
    hand,
    sites,
    campTile,
    mineTile,
    unpairedCamp: !!unpairedSiloSource(buildings, owner, 'camp'),
    unpairedMine: !!unpairedSiloSource(buildings, owner, 'mine'),
  };
}

/**
 * Placeable camp / mine spot whose work circle holds the most uncovered stock,
 * mildly discounted by distance from base. Box-sum over a summed-area table
 * of the scan window; integer scores so lockstep peers agree.
 * @returns {{ x: number, y: number } | null}
 */
function findDenseGatherSpot(field, type, base, sites, order) {
  const width = field.width | 0;
  const height = field.height | 0;
  const ctx = worldToTile(base.x);
  const ctz = worldToTileZ(base.y);
  const x0 = Math.max(0, ctx - SCAN_TILES);
  const x1 = Math.min(width - 1, ctx + SCAN_TILES);
  const z0 = Math.max(0, ctz - SCAN_TILES);
  const z1 = Math.min(height - 1, ctz + SCAN_TILES);
  const ww = x1 - x0 + 1;
  const wh = z1 - z0 + 1;
  if (ww <= 0 || wh <= 0) return null;

  // Rock kinds: weight the neediest one double.
  const rockPref = order.indexOf('mineral') < order.indexOf('stone') ? 'mineral' : 'stone';
  const stockAt = (tx, tz) => {
    const tile = tz * width + tx;
    let v = 0;
    if (type === 'camp') {
      if (nodeMatches(field, 'wood', tile)) v = field.treeStock[tile] | 0;
    } else if (nodeMatches(field, 'stone', tile) || nodeMatches(field, 'mineral', tile)) {
      v = field.rockStock[tile] | 0;
      if (nodeMatches(field, rockPref, tile)) v *= 2;
    }
    if (v > 0 && nodeCovered(sites, type, tileCenterX(tx), tileCenterY(tz))) v = 0;
    return v;
  };
  const sat = new Int32Array((ww + 1) * (wh + 1));
  let any = false;
  for (let tz = z0; tz <= z1; tz++) {
    let row = 0;
    for (let tx = x0; tx <= x1; tx++) {
      const v = stockAt(tx, tz);
      if (v > 0) any = true;
      row += v;
      const i = (tz - z0 + 1) * (ww + 1) + (tx - x0 + 1);
      sat[i] = sat[i - (ww + 1)] + row;
    }
  }
  if (!any) return null;

  const r = DENSE_REACH_TILES;
  const boxSum = (cx, cz) => {
    const ax = Math.max(0, cx - x0 - r);
    const az = Math.max(0, cz - z0 - r);
    const bx = Math.min(ww, cx - x0 + r + 1);
    const bz = Math.min(wh, cz - z0 + r + 1);
    return sat[bz * (ww + 1) + bx] - sat[az * (ww + 1) + bx]
      - sat[bz * (ww + 1) + ax] + sat[az * (ww + 1) + ax];
  };

  /** @type {number[]} packed [score, tile] pairs */
  const cands = [];
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      const sum = boxSum(tx, tz);
      if (sum <= 0) continue;
      const dist = Math.max(Math.abs(tx - ctx), Math.abs(tz - ctz));
      const score = Math.floor((sum * DENSE_DIST_DEN) / (DENSE_DIST_DEN + dist));
      cands.push(score, tz * width + tx);
    }
  }
  const order2 = [];
  for (let k = 0; k < cands.length; k += 2) order2.push(k);
  order2.sort((a, b) => (cands[b] - cands[a]) || (cands[a + 1] - cands[b + 1]));
  // Box sums shortlist; the first few legal footprints are rescored against
  // the real work circle from the snapped building center.
  const reachTiles = Math.ceil(CAMP_WORK_RADIUS_F / TILE_SIZE_F);
  const tries = Math.min(order2.length, DENSE_MAX_TRIES);
  let best = null;
  let bestScore = 0;
  let exact = 0;
  for (let k = 0; k < tries && exact < DENSE_EXACT; k++) {
    const tile = cands[order2[k] + 1];
    const snapped = snapBuildingWorld(type, tileCenterX(tile % width), tileCenterY((tile / width) | 0));
    if (!canPlaceBuildingAt(field, type, snapped.x, snapped.z)) continue;
    exact++;
    const btx = worldToTile(snapped.x);
    const btz = worldToTileZ(snapped.z);
    let sum = 0;
    for (let tz = Math.max(z0, btz - reachTiles); tz <= Math.min(z1, btz + reachTiles); tz++) {
      for (let tx = Math.max(x0, btx - reachTiles); tx <= Math.min(x1, btx + reachTiles); tx++) {
        if (fx.dist2(snapped.x, snapped.z, tileCenterX(tx), tileCenterY(tz)) > CAMP_WORK_RADIUS_SQ) continue;
        sum += stockAt(tx, tz);
      }
    }
    if (sum <= 0) continue;
    const dist = Math.max(Math.abs(btx - ctx), Math.abs(btz - ctz));
    const score = Math.floor((sum * DENSE_DIST_DEN) / (DENSE_DIST_DEN + dist));
    if (score > bestScore) {
      bestScore = score;
      best = { x: snapped.x, y: snapped.z };
    }
  }
  return best;
}

/** True when a same-type camp / mine already reaches this world point. */
function nodeCovered(sites, type, x, y) {
  for (let s = 0; s < sites.length; s++) {
    const b = sites[s];
    if (b.type !== type) continue;
    if (fx.dist2(b.x, b.z, x, y) <= CAMP_WORK_RADIUS_SQ) return true;
  }
  return false;
}

/** Nearest `kind` node outside every same-type camp / mine work circle. */
function nearestUncoveredNode(field, kind, px, py, sites, type) {
  const width = field.width | 0;
  const height = field.height | 0;
  const ctx = worldToTile(px);
  const ctz = worldToTileZ(py);
  let best = -1;
  let bestD = 0x7fffffffffff;
  const z0 = Math.max(0, ctz - SCAN_TILES);
  const z1 = Math.min(height - 1, ctz + SCAN_TILES);
  const x0 = Math.max(0, ctx - SCAN_TILES);
  const x1 = Math.min(width - 1, ctx + SCAN_TILES);
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tile = tz * width + tx;
      if (!nodeMatches(field, kind, tile)) continue;
      const cx = tileCenterX(tx);
      const cy = tileCenterY(tz);
      const d = fx.dist2(px, py, cx, cy);
      if (d >= bestD) continue;
      let covered = false;
      for (let s = 0; s < sites.length; s++) {
        const b = sites[s];
        if (b.type !== type) continue;
        if (fx.dist2(b.x, b.z, cx, cy) <= CAMP_WORK_RADIUS_SQ) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      bestD = d;
      best = tile;
    }
  }
  return best;
}

/** Priority ladder → which building to place this tick (or null). */
function chooseBuild(w, owner, bank, inv, villagerCount, order, strategy, capture, pressure, gather) {
  const need = order[0];
  const dump = !!pressure?.dump;
  const full = kindSet(pressure?.overflowing);
  // 1) A village first — the population engine.
  if (inv.village === 0 && affordable(bank, getBuildingCost('village'))) return 'village';
  // Eco path: a second village once the first one has grown the pop.
  if (
    strategy.path === AI_PATH.ECO
    && inv.village < ECO_VILLAGE_CAP
    && villagerCount >= ECO_VILLAGE_AT
    && affordable(bank, getBuildingCost('village'))
  ) {
    return 'village';
  }
  const farmTarget = Math.floor(villagerCount / FARM_PER_VILLAGERS) + 1;
  const live = gather.live;
  const canCamp = gather.campTile >= 0;
  const canMine = gather.mineTile >= 0;
  // 2) A working camp — preferred over hand-gathering. Save for it unless food
  // is failing. Hand-gathered wood fills the small opening cap fast, so a full
  // bank only skips this once a camp has ever stood.
  const firstCamp = inv.camp === 0;
  if (live.camp === 0 && canCamp && (!full.wood || firstCamp)) {
    if (affordable(bank, getBuildingCost('camp'))) return 'camp';
    if (bank.food < FOOD_LOW && affordable(bank, getBuildingCost('farm'))) return 'farm';
    return null;
  }
  // 3) Farm when food is scarce or population outgrows food capacity.
  // One farmer per plot: past the target, only add a plot once every farm is
  // staffed and no site is still going up.
  const farmsFull = gather.open.farm === 0 && inv.farmSites === 0;
  if (
    (inv.farm < farmTarget || (bank.food < FOOD_LOW && farmsFull))
    && affordable(bank, getBuildingCost('farm'))
  ) {
    return 'farm';
  }
  // 4) Expand camps / mines with the crew (depleted ones don't count).
  // Neediest kind first; a missing mine is placed even when stone isn't top.
  const rockNeed = order.indexOf('stone') < 2 || order.indexOf('mineral') < 2;
  // Another camp / mine only once every working one is full (or dry) and the
  // crew could staff it — or as soon as hands are already gathering that
  // kind out in the open, so they get a facility instead of lumberjacking on.
  const open = gather.open;
  const hand = gather.hand;
  const wantCamp = canCamp
    && live.camp < CAMP_CAP
    && open.camp === 0
    && (
      hand.camp >= HAND_CREW_FOR_SITE
      || (
        (!full.wood || firstCamp)
        && villagerCount >= live.camp * CREW_PER_SITE
        && (need === 'wood' || order.indexOf('wood') < 2 || gather.idle >= IDLE_CREW_FOR_CAMP)
      )
    );
  const wantMine = canMine
    && live.mine < MINE_CAP
    && open.mine === 0
    && (live.mine === 0
      ? villagerCount >= FIRST_MINE_AT
      : hand.mine >= HAND_CREW_FOR_SITE || (rockNeed && villagerCount >= live.mine * CREW_PER_SITE));
  const campFirst = order.indexOf('wood') < Math.min(order.indexOf('stone'), order.indexOf('mineral'));
  const expand = campFirst ? ['camp', 'mine'] : ['mine', 'camp'];
  for (let e = 0; e < expand.length; e++) {
    const type = expand[e];
    if (type === 'camp' && !wantCamp) continue;
    if (type === 'mine' && !wantMine) continue;
    if (affordable(bank, getBuildingCost(type))) return type;
  }
  // 6) Path spend — only after the farm-ring partner has a village + a farm.
  if (ecoBaselineReady(inv) && strategy.path !== AI_PATH.ECO) {
    const next = choosePathBuilding(w, owner, bank, inv, strategy.path);
    if (next) return next;
  }
  // Full bank, no silo pair left — another source so a silo can attach.
  if (dump) {
    const relief = chooseCapRelief(w, owner, inv, full, bank, gather);
    if (relief) return relief;
  }
  // 7) Surplus → another farm to push more villagers.
  // Dump seats skip this so the bank burn (train / research) can run.
  if (capture?.urgent && strategy.heat >= 3) return null;
  if (!dump && surplusFarmOk(bank, inv, gather)) return 'farm';
  // Eco seats with no army sink: burn overflowing wood into the farm ring.
  if (
    dump
    && full.wood
    && strategy.path === AI_PATH.ECO
    && affordable(bank, getBuildingCost('farm'))
    && inv.farm < farmTarget + 2 + (strategy.difficulty | 0)
  ) {
    return 'farm';
  }
  return null;
}

/**
 * Spare wood → another farm. No ceiling — the ring keeps growing out along
 * the compass spokes — but only a couple of plots may stand unstaffed at once.
 */
function surplusFarmOk(bank, inv, gather) {
  return gather.open.farm + inv.farmSites < FARM_UNSTAFFED_MAX
    && affordable(bank, getBuildingCost('farm'))
    && bank.wood > STOCK_TARGET.wood;
}

function canUnlockKind(w, owner, kind) {
  return ownerSlotCount(w.buildings, owner, kind, 'fixed', w) < MAX_RESOURCE_SLOTS;
}

/** A new source for a silo pair — only when every existing one is already paired. */
function chooseCapRelief(w, owner, inv, full, bank, gather) {
  if (
    full.wood
    && !gather.unpairedCamp
    && gather.campTile >= 0
    && gather.live.camp < CAMP_CAP
    && canUnlockKind(w, owner, 'wood')
    && affordable(bank, getBuildingCost('camp'))
  ) {
    return 'camp';
  }
  if (
    full.food
    && inv.farmSites === 0
    && !unpairedSiloSource(w.buildings, owner, 'farm')
    && canUnlockKind(w, owner, 'food')
    && affordable(bank, getBuildingCost('farm'))
  ) {
    return 'farm';
  }
  if (
    (full.stone || full.mineral)
    && !gather.unpairedMine
    && gather.mineTile >= 0
    && gather.live.mine < MINE_CAP
    && canUnlockKind(w, owner, 'stone')
    && affordable(bank, getBuildingCost('mine'))
  ) {
    return 'mine';
  }
  return null;
}

function choosePathBuilding(w, owner, bank, inv, path) {
  const want = path === AI_PATH.TECH
    ? ['lab', 'moonwell']
    : ['barracks', 'tavern'];
  for (let i = 0; i < want.length; i++) {
    const type = want[i];
    if ((inv[type] | 0) > 0) continue;
    if (!ownerMeetsBuildingRequires(w.buildings, owner, type)) continue;
    if (!affordable(bank, getBuildingCost(type))) continue;
    return type;
  }
  return null;
}

function affordable(bank, cost) {
  if (!cost) return true;
  for (const k in cost) if ((bank[k] | 0) < (cost[k] | 0)) return false;
  return true;
}

/** Where to anchor placement: camps/mines hug an uncovered node, else the base. */
function buildAnchor(field, type, base, gather) {
  if (type === 'camp' || type === 'mine') {
    const tile = type === 'camp' ? gather.campTile : gather.mineTile;
    if (tile >= 0) {
      const w = field.width | 0;
      return { x: tileCenterX(tile % w), y: tileCenterY((tile / w) | 0) };
    }
  }
  if (type === 'barracks' || type === 'tavern' || type === 'lab' || type === 'moonwell') {
    return pathBuildAnchor(base, type);
  }
  return { x: base.x, y: base.y };
}

/** Keep army / tech halls off the farm ring — forward or beside the agora. */
function pathBuildAnchor(base, type) {
  const bx = fx.toFloat(base.x);
  const bz = fx.toFloat(base.y);
  const len = Math.hypot(bx, bz) || 1;
  const fX = -bx / len;
  const fZ = -bz / len;
  const rX = -fZ;
  const rZ = fX;
  if (type === 'lab' || type === 'moonwell') {
    return { x: fx.fromFloat(bx + rX * TECH_SIDE), y: fx.fromFloat(bz + rZ * TECH_SIDE) };
  }
  return { x: fx.fromFloat(bx + fX * ARMY_FORWARD), y: fx.fromFloat(bz + fZ * ARMY_FORWARD) };
}

function chooseSpend(w, owner, bank, strategy, capture, pressure) {
  const dump = !!pressure?.dump;
  if (strategy.path === AI_PATH.ECO && !dump) return null;
  if (!(capture?.urgent && strategy.heat >= 3)) {
    const research = chooseResearch(w, owner, bank, strategy.path, dump);
    if (research) return research;
  }
  if (strategy.path === AI_PATH.ARMY || dump || (capture?.urgent && strategy.heat >= 2)) {
    return chooseTrain(w, owner, bank, strategy, capture, pressure);
  }
  return null;
}

const DUMP_TECH = [
  'drayage',
  'stewardship',
  'artillery',
  'armor',
  'patronage',
  'prospecting',
  'scribes',
];

function chooseResearch(w, owner, bank, path, dump) {
  const ids = dump
    ? DUMP_TECH
    : path === AI_PATH.TECH ? ['artillery', 'stewardship'] : ['drayage'];
  const techId = pickTech(w, owner, ids);
  if (!techId) return null;
  if (ownerHasTech(w, owner, TECH_BY_ID[techId])) return null;
  if (!canAffordBank(bank, getTechCost(techId))) return null;
  const bi = finishedBuildingWithUpgrade(w, owner, techId);
  if (bi < 0) return null;
  return { type: CMD.RESEARCH, playerId: owner, buildingIndex: bi, techId };
}

function pickTech(w, owner, ids) {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!TECH_BY_ID[id]) continue;
    if (ownerHasTech(w, owner, TECH_BY_ID[id])) continue;
    if (finishedBuildingWithUpgrade(w, owner, id) < 0) continue;
    return id;
  }
  return null;
}

function finishedBuildingWithUpgrade(w, owner, techId) {
  const buildings = w.buildings;
  if (!buildings) return -1;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== owner || !buildingIsFinished(b)) continue;
    if (!BUILDING_MENUS[b.type]?.upgrades?.includes(techId)) continue;
    if (hasUpgradeTrack(b, techId)) continue;
    return i;
  }
  return -1;
}

function hasUpgradeTrack(b, techId) {
  const tracks = b.tracks;
  if (!tracks) return false;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.kind === 'upgrade' && t.id === techId && (t.count | 0) > 0) return true;
  }
  return false;
}

function chooseTrain(w, owner, bank, strategy, capture, pressure) {
  const keys = ['warrior', 'archer'];
  const bonus = capture?.urgent
    ? Math.max((strategy.heat | 0) * 2, (capture.shown | 0) * (strategy.heat | 0))
    : 0;
  const overflowBonus = pressure?.dump
    ? 2 + (strategy.difficulty | 0) * 3
    : 0;
  for (let k = 0; k < keys.length; k++) {
    const unitKey = keys[k];
    const cap = (TRAIN_CAP[unitKey] | 0) + bonus + overflowBonus;
    if (livingAndQueued(w, owner, unitKey) >= cap) continue;
    const unitType = unitKey === 'warrior' ? UNIT.WARRIOR : UNIT.ARCHER;
    if (!canAffordBank(bank, getUnitCost(unitType))) continue;
    const bi = finishedBuildingWithUnit(w, owner, unitKey);
    if (bi < 0) continue;
    return { type: CMD.QUEUE_TRAIN, playerId: owner, buildingIndex: bi, unitKey };
  }
  return null;
}

function finishedBuildingWithUnit(w, owner, unitKey) {
  const buildings = w.buildings;
  if (!buildings) return -1;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if ((b.owner | 0) !== owner || !buildingIsFinished(b)) continue;
    if (BUILDING_MENUS[b.type]?.units?.includes(unitKey)) return i;
  }
  return -1;
}

function livingAndQueued(w, owner, unitKey) {
  const unitType = unitKey === 'warrior' ? UNIT.WARRIOR : UNIT.ARCHER;
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.owner[i] === owner && w.type[i] === unitType) n++;
  }
  const buildings = w.buildings;
  if (!buildings) return n;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if ((bd.owner | 0) !== owner || !bd.tracks) continue;
    for (let t = 0; t < bd.tracks.length; t++) {
      const tr = bd.tracks[t];
      if (tr.kind === 'unit' && tr.id === unitKey) n += tr.count | 0;
    }
  }
  return n;
}

/** Deterministic outward search for a legal placement near (aroundX, aroundY). */
function findBuildSpot(field, w, type, aroundX, aroundY, maxDistSq = 0) {
  const fp = BUILDING_FOOTPRINTS[type];
  const stepTiles = Math.max(1, (fp?.w ?? 2));
  const step = stepTiles * TILE_SIZE_F;
  for (let ring = 0; ring <= 8; ring++) {
    const r = ring * step;
    // Ring of candidate centers (8 compass points; center at ring 0).
    const offsets = ring === 0
      ? [[0, 0]]
      : [[0, -r], [r, 0], [0, r], [-r, 0], [r, -r], [r, r], [-r, r], [-r, -r]];
    for (let o = 0; o < offsets.length; o++) {
      const cx = aroundX + fx.fromInt(offsets[o][0] | 0);
      const cy = aroundY + fx.fromInt(offsets[o][1] | 0);
      const snapped = snapBuildingWorld(type, cx, cy);
      if (maxDistSq > 0 && fx.dist2(snapped.x, snapped.z, aroundX, aroundY) > maxDistSq) continue;
      if (canPlaceBuildingAt(field, type, snapped.x, snapped.z)) {
        return { x: snapped.x, y: snapped.z };
      }
    }
  }
  return null;
}
