// Rule-based economic AI — a passive, rule-bound player that only macros.
//
// Runs in the sim worker before step() and emits the SAME command objects a
// human would (GATHER / PLACE_BUILDING), so it pays every cost and
// obeys every rule. No military: this is the "as passive as possible" opponent.
//
// Determinism: pure functions of (world, field, tick) — index-order scans, no
// Math.random, no wall clock. Two peers running the same state emit the same
// commands.

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { getResource } from './resources.js';
import { SCENERY } from './scenery.js';
import {
  worldToTile,
  tileCenterX,
  tileCenterY,
  TILE_SIZE_F,
} from './field.js';
import {
  canPlaceBuildingAt,
  snapBuildingWorld,
  getBuildingCost,
  BUILDING_FOOTPRINTS,
} from './buildings.js';
import {
  MAX_RESOURCE_SLOTS,
  SILO_ATTACH_RANGE_F,
  SILO_SOURCE_TYPE,
  ownerResourceCap,
  ownerSlotCount,
  unpairedSiloSource,
  withinSiloAttach,
} from './storage.js';

/** How often (ticks) the economy AI re-plans. Phased per owner. */
const DECIDE_INTERVAL = 30;
/** Idle villagers dispatched to gather per decision tick (spreads path spam). */
const MAX_ASSIGN_PER_TICK = 4;
/** Food bank below which the AI treats food as urgent. */
const FOOD_LOW = 40;
/** Desired standing stock per resource — drives demand-based worker routing. */
const STOCK_TARGET = { wood: 120, food: 120, stone: 80, mineral: 30 };
/** Node search window around a villager / base (tiles). */
const SCAN_TILES = 44;
/** Soft caps on econ buildings for this first pass. */
const CAMP_CAP = 2;
const MINE_CAP = 2;
const FARM_PER_VILLAGERS = 6;

/** Enable the economy loop for passive AIs (or an explicit economy flag). */
function economyEnabled(entry) {
  return !!entry && (entry.economy === true || entry.temperament === 'passive');
}

/**
 * Emit this AI owner's economy commands for the current tick (possibly none).
 * @param {object} w world
 * @param {object} field
 * @param {{ owner: number, temperament?: string, economy?: boolean }} entry
 * @returns {import('./commands.js').Command[]}
 */
export function generateEconomyCommands(w, field, entry) {
  if (!field || !economyEnabled(entry)) return [];
  const owner = entry.owner | 0;
  if (owner < 0) return [];
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

  /** @type {import('./commands.js').Command[]} */
  const cmds = [];

  // ── Step 1: keep idle villagers working (demand-driven) ──────────────────
  const order = demandOrder(bank);
  let assigned = 0;
  for (let k = 0; k < villagers.idle.length && assigned < MAX_ASSIGN_PER_TICK; k++) {
    const i = villagers.idle[k];
    const tile = pickNodeForDemand(field, order, w.px[i], w.py[i]);
    if (tile >= 0) {
      cmds.push({ type: CMD.GATHER, entities: [i], tile });
      assigned++;
    }
  }

  // ── Step 2: build one thing on the priority ladder ───────────────────────
  const siloAt = chooseSiloAnchor(w, owner, bank, order);
  const build = siloAt ? 'silo' : chooseBuild(bank, inv, villagers.total, order);
  if (build) {
    const around = siloAt
      ? { x: siloAt.x, y: siloAt.z }
      : buildAnchor(field, build, base, w.px, w.py, villagers);
    const spot = build === 'silo'
      ? findSiloAttachSpot(field, around.x, around.y)
      : findBuildSpot(field, w, build, around.x, around.y);
    if (spot) {
      cmds.push({
        type: CMD.PLACE_BUILDING,
        playerId: owner,
        buildingType: build,
        tx: spot.x,
        ty: spot.y,
      });
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
  const inv = { village: 0, farm: 0, camp: 0, mine: 0 };
  const buildings = w.buildings;
  if (!buildings) return inv;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if (bd.owner !== owner) continue;
    if (bd.type === 'village') inv.village++;
    else if (bd.type === 'farm') inv.farm++;
    else if (bd.type === 'camp') inv.camp++;
    else if (bd.type === 'mine') inv.mine++;
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

/** Resource kinds sorted by biggest deficit vs target (most-needed first). */
function demandOrder(bank) {
  const kinds = ['wood', 'food', 'stone', 'mineral'];
  return kinds
    .map((k) => ({ k, d: (STOCK_TARGET[k] | 0) - (bank[k] | 0) }))
    .sort((a, b) => b.d - a.d)
    .map((e) => e.k);
}

/** Nearest reachable node for the neediest kind that actually has one. */
function pickNodeForDemand(field, order, px, py) {
  for (let o = 0; o < order.length; o++) {
    const tile = nearestNode(field, order[o], px, py);
    if (tile >= 0) return tile;
  }
  // Fall back to anything harvestable so a villager never sits idle.
  for (const k of ['wood', 'mineral', 'stone', 'food']) {
    const tile = nearestNode(field, k, px, py);
    if (tile >= 0) return tile;
  }
  return -1;
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
  const ctz = worldToTile(py);
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
    const cap = ownerResourceCap(buildings, owner, kind);
    if ((bank[kind] | 0) < cap) continue;
    if (ownerSlotCount(buildings, owner, kind) >= MAX_RESOURCE_SLOTS) continue;
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

/** Priority ladder → which building to place this tick (or null). */
function chooseBuild(bank, inv, villagerCount, order) {
  const need = order[0];
  // 1) A village first — the population engine.
  if (inv.village === 0 && affordable(bank, getBuildingCost('village'))) return 'village';
  // 2) Farm when food is scarce or population outgrows food capacity.
  const farmTarget = Math.floor(villagerCount / FARM_PER_VILLAGERS) + 1;
  if ((bank.food < FOOD_LOW || inv.farm < farmTarget) &&
      affordable(bank, getBuildingCost('farm'))) {
    return 'farm';
  }
  // 3) Camp near wood when wood is the pressing need.
  if (need === 'wood' && inv.camp < CAMP_CAP && affordable(bank, getBuildingCost('camp'))) {
    return 'camp';
  }
  // 4) Mine near rock when stone/mineral is the pressing need.
  if ((need === 'stone' || need === 'mineral') && inv.mine < MINE_CAP &&
      affordable(bank, getBuildingCost('mine'))) {
    return 'mine';
  }
  // 5) Surplus → another farm to push more villagers.
  if (affordable(bank, getBuildingCost('farm')) && bank.wood > STOCK_TARGET.wood) return 'farm';
  return null;
}

function affordable(bank, cost) {
  if (!cost) return true;
  for (const k in cost) if ((bank[k] | 0) < (cost[k] | 0)) return false;
  return true;
}

/** Where to anchor placement: camps/mines hug the target node, else the base. */
function buildAnchor(field, type, base, px, py, villagers) {
  if (type === 'camp' || type === 'mine') {
    const kind = type === 'camp' ? 'wood' : 'stone';
    const from = villagers.idle.length ? villagers.idle[0] : -1;
    const fx0 = from >= 0 ? px[from] : base.x;
    const fy0 = from >= 0 ? py[from] : base.y;
    const tile = nearestNode(field, kind, fx0, fy0) >= 0
      ? nearestNode(field, kind, fx0, fy0)
      : (type === 'mine' ? nearestNode(field, 'mineral', fx0, fy0) : -1);
    if (tile >= 0) {
      const w = field.width | 0;
      return { x: tileCenterX(tile % w), y: tileCenterY((tile / w) | 0) };
    }
  }
  return { x: base.x, y: base.y };
}

/** Deterministic outward search for a legal placement near (aroundX, aroundY). */
function findBuildSpot(field, w, type, aroundX, aroundY) {
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
      if (canPlaceBuildingAt(field, type, snapped.x, snapped.z)) {
        return { x: snapped.x, y: snapped.z };
      }
    }
  }
  return null;
}
