// Rule-based economic AI — the foundation of match AI.
//
// Baseline (path `eco`) is the opening-skirmish partner: village, farm rings
// around the agora, camps / mines / silos. Army and tech paths take that
// ladder first, then spend on barracks / lab. Difficulty decides whether a
// full bank is spent (train / research / another source) or left to take
// the 25% overflow hit. Same command objects a human would issue.
// Deterministic (index-order scans, no Math.random).

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { ORDER } from './world.js';
import { getUnitCost, UNIT } from './unitTypes.js';
import { canAffordBank, getResource, RESOURCE_KINDS } from './resources.js';
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
  BUILDING_MENUS,
  buildingIsFinished,
  ownerMeetsBuildingRequires,
} from './buildings.js';
import { getTechCost, ownerHasTech, TECH_BY_ID } from './tech.js';
import { AI_DIFFICULTY, AI_PATH, captureIntent, resolveAiStrategy } from './aiStrategy.js';
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
const STOCK_TARGET = { wood: 160, food: 150, stone: 90, mineral: 40 };
/** Node search window around a villager / base (tiles). */
const SCAN_TILES = 44;
/** Soft caps on econ buildings for this first pass. */
const CAMP_CAP = 3;
const MINE_CAP = 2;
const FARM_PER_VILLAGERS = 5;
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

  // ── Step 1: keep idle villagers working (demand-driven) ──────────────────
  const order = demandOrder(bank, pressure);
  let assigned = 0;
  for (let k = 0; k < villagers.idle.length && assigned < MAX_ASSIGN_PER_TICK; k++) {
    const i = villagers.idle[k];
    const tile = pickNodeForDemand(field, order, w.px[i], w.py[i]);
    if (tile >= 0) {
      cmds.push({ type: CMD.GATHER, entities: [i], tile });
      assigned++;
    }
  }

  // ── Step 2: place one building (eco ladder, then path) ───────────────────
  const siloAt = chooseSiloAnchor(w, owner, bank, order);
  const build = siloAt ? 'silo' : chooseBuild(w, owner, bank, inv, villagers.total, order, strategy, capture, pressure);
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
      return cmds;
    }
  }

  // ── Step 3: research or train (eco path only when dumping a full bank) ───
  const spend = chooseSpend(w, owner, bank, strategy, capture, pressure);
  if (spend) cmds.push(spend);
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
  };
  const buildings = w.buildings;
  if (!buildings) return inv;
  for (let b = 0; b < buildings.length; b++) {
    const bd = buildings[b];
    if (bd.owner !== owner) continue;
    if (bd.type in inv) inv[bd.type]++;
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

/**
 * How full each bank is vs the unlocked cap. At 1.0 incoming yields are cut
 * to 25%. Higher difficulty starts spending before they kiss the cap.
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
    const cap = ownerResourceCap(buildings, owner, k);
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

function ecoBaselineReady(inv) {
  return inv.village >= 1 && inv.farm >= 1;
}

/** Priority ladder → which building to place this tick (or null). */
function chooseBuild(w, owner, bank, inv, villagerCount, order, strategy, capture, pressure) {
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
  // 5) Path spend — only after the farm-ring partner has a village + a farm.
  if (ecoBaselineReady(inv) && strategy.path !== AI_PATH.ECO) {
    const next = choosePathBuilding(w, owner, bank, inv, strategy.path);
    if (next) return next;
  }
  // Full bank, no silo pair left — another source so a silo can attach.
  if (dump) {
    const relief = chooseCapRelief(w, owner, inv, full, bank);
    if (relief) return relief;
  }
  // 6) Surplus → another farm to push more villagers.
  // Dump seats skip this so the bank burn (train / research) can run.
  if (capture?.urgent && strategy.heat >= 3) return null;
  if (
    !dump
    && affordable(bank, getBuildingCost('farm'))
    && bank.wood > STOCK_TARGET.wood
  ) {
    return 'farm';
  }
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

function canUnlockKind(w, owner, kind) {
  return ownerSlotCount(w.buildings, owner, kind) < MAX_RESOURCE_SLOTS;
}

function chooseCapRelief(w, owner, inv, full, bank) {
  if (
    full.wood
    && inv.camp < CAMP_CAP
    && canUnlockKind(w, owner, 'wood')
    && affordable(bank, getBuildingCost('camp'))
  ) {
    return 'camp';
  }
  if (full.food && canUnlockKind(w, owner, 'food') && affordable(bank, getBuildingCost('farm'))) {
    return 'farm';
  }
  if (
    (full.stone || full.mineral)
    && inv.mine < MINE_CAP
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
