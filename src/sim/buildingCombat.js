// Attack / ruin placeable buildings. Units keep targetBuilding as an index
// into world.buildings (stable; ruined entries stay with hp = 0).

import * as fx from './fixed.js';
import { TILE_SIZE_F, snapToPassable } from './field.js';
import { getUnitDef } from './unitTypes.js';
import {
  buildingIsFinished,
  clearStructureOccupancyAt,
  getBuildingFootprint,
  isBuildingAlive,
} from './buildings.js';
import {
  SPORE_BLOOM_DAMAGE,
  pushSporeDripFx,
  setBloomBuildingDamage,
} from './sporeBloom.js';
import { FIRE_ZONE_DAMAGE_INTERVAL } from './fireZones.js';
import { damageDoorsInRadius } from './doorCombat.js';
import { isHostile } from './teams.js';
import { noteBuildingLost, noteOwnerRaze } from './ownerStats.js';

/** Gather / storage buildings - smash these last, and don't peel off a march for them. */
const ECONOMY_BUILDING_TYPES = new Set(['camp', 'mine', 'farm', 'silo']);

export function isEconomyCombatBuilding(typeId) {
  return ECONOMY_BUILDING_TYPES.has(typeId);
}

export function buildingFootprintHalf(typeId) {
  const fp = getBuildingFootprint(typeId);
  const tiles = Math.max(fp?.w ?? 2, fp?.h ?? 2);
  return fx.fromFloat(tiles * TILE_SIZE_F * 0.5);
}

export function buildingAttackRange(w, attacker, b) {
  const def = getUnitDef(w.type[attacker]);
  return def.attackRange + buildingFootprintHalf(b.type);
}

export function attackBuildingInRange(w, i, b) {
  if (!isBuildingAlive(b)) return false;
  const def = getUnitDef(w.type[i]);
  const reach = buildingAttackRange(w, i, b);
  const d2 = fx.dist2(w.px[i], w.py[i], b.x, b.z);
  if (d2 > fx.mul(reach, reach)) return false;
  if (def.minRange > 0) {
    const min2 = fx.mul(def.minRange, def.minRange);
    if (d2 < min2) return false;
  }
  return true;
}

export function attackBuildingStandPoint(w, i, b) {
  const def = getUnitDef(w.type[i]);
  const half = buildingFootprintHalf(b.type);
  const stand = half + fx.mul(def.attackRange, fx.fromFloat(0.62));
  const dx = w.px[i] - b.x;
  const dy = w.py[i] - b.z;
  const dist = fx.len(dx, dy);
  const nx = dist > 0 ? fx.div(dx, dist) : fx.ONE;
  const ny = dist > 0 ? fx.div(dy, dist) : 0;
  return {
    x: b.x + fx.mul(nx, stand),
    y: b.z + fx.mul(ny, stand),
  };
}

export function attackBuildingStandPointOnField(w, field, i, b) {
  const raw = attackBuildingStandPoint(w, i, b);
  const snapped = field ? snapToPassable(field, raw.x, raw.y) : null;
  return snapped ? { x: snapped.x, y: snapped.y } : raw;
}

export function ruinBuilding(w, field, bi) {
  const b = w.buildings?.[bi];
  if (!b) return;
  b.hp = 0;
  b.fireTicks = 0;
  if (field) {
    clearStructureOccupancyAt(field, b.type, b.x, b.z, {
      buildings: w.buildings,
      exceptIndex: bi,
    });
  }
  w.buildingsDirty = 1;
}

/** world.ORDER.BUILD - numeric to stay off the world → path → buildingCombat cycle. */
const ORDER_BUILD = 6;
/** Same slack as construction.js BUILD_MARGIN_F - on-site workers harden a foundation. */
const BUILD_SITE_MARGIN_F = 6;

/** True when a villager/engineer is in reach on a BUILD order for this site. */
export function constructionSiteHasWorkers(w, bi) {
  const b = w?.buildings?.[bi];
  if (!b || b.built !== 0) return false;
  const reach = buildingFootprintHalf(b.type) + fx.fromFloat(BUILD_SITE_MARGIN_F);
  const reachSq = fx.mul(reach, reach);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.order[i] !== ORDER_BUILD) continue;
    if ((w.buildTarget[i] | 0) !== (bi | 0)) continue;
    if (fx.dist2(w.px[i], w.py[i], b.x, b.z) <= reachSq) return true;
  }
  return false;
}

function creditRaze(w, b, attackerOwner) {
  if (!buildingIsFinished(b) || b.type === 'agora') return;
  const attacker = attackerOwner | 0;
  const victim = b.owner | 0;
  noteBuildingLost(w, victim);
  if (attacker < 0 || attacker === victim || !isHostile(attacker, victim)) return;
  noteOwnerRaze(w, attacker);
}

export function applyDamageBuilding(w, field, bi, amount, attackerOwner = -1) {
  const b = w.buildings?.[bi];
  if (!isBuildingAlive(b) || amount <= 0) return 0;
  // Empty foundations are paper - any hit ruins them. On-site builders harden.
  if (b.built === 0 && !constructionSiteHasWorkers(w, bi)) {
    const dealt = Math.max(1, b.hp | 0);
    ruinBuilding(w, field, bi);
    return dealt;
  }
  const next = Math.max(0, (b.hp | 0) - (amount | 0));
  const dealt = (b.hp | 0) - next;
  b.hp = next;
  w.buildingsDirty = 1;
  if (next <= 0) {
    creditRaze(w, b, attackerOwner);
    ruinBuilding(w, field, bi);
  }
  return dealt;
}

/** Crops rot, burn, and get eaten - farms take extra from spore, fire, and locusts. */
export const FARM_SPORE_DAMAGE_MUL = 5;
export const FARM_FIRE_DAMAGE_MUL = 5;
export const FARM_LOCUST_DAMAGE_MUL = 5;

export function scaleFarmHazardDamage(type, amount, mul) {
  const base = amount | 0;
  if (base <= 0) return 0;
  if (type === 'farm' && mul > 1) return Math.max(1, base * (mul | 0));
  return base;
}

const FARM_DRIP_OFFSETS = [
  [0, 0],
  [0.55, 0.55],
  [-0.55, 0.55],
  [0.55, -0.55],
  [-0.55, -0.55],
];

function pushFarmInkDrips(w, b) {
  const half = buildingFootprintHalf(b.type);
  for (let i = 0; i < FARM_DRIP_OFFSETS.length; i++) {
    const ox = fx.mul(half, fx.fromFloat(FARM_DRIP_OFFSETS[i][0]));
    const oy = fx.mul(half, fx.fromFloat(FARM_DRIP_OFFSETS[i][1]));
    pushSporeDripFx(w, b.x + ox, b.z + oy);
  }
}

/** Buildings in the bloom (friendly fire); farms take extra and drip ink. */
export function damageBuildingsInBloom(w, field, owner, cx, cy, radius, amount = SPORE_BLOOM_DAMAGE) {
  const buildings = w.buildings;
  if (!radius || radius <= 0) return 0;
  let hit = 0;
  for (let bi = 0; bi < (buildings?.length ?? 0); bi++) {
    const b = buildings[bi];
    if (!isBuildingAlive(b)) continue;
    const reach = radius + buildingFootprintHalf(b.type);
    if (fx.dist2(cx, cy, b.x, b.z) > fx.mul(reach, reach)) continue;
    const dmg = scaleFarmHazardDamage(b.type, amount, FARM_SPORE_DAMAGE_MUL);
    if (applyDamageBuilding(w, field, bi, dmg, owner | 0) <= 0) continue;
    hit++;
    if (b.type === 'farm') pushFarmInkDrips(w, b);
  }
  if (damageDoorsInRadius(w, field, cx, cy, radius, amount) > 0) hit++;
  return hit;
}

setBloomBuildingDamage(damageBuildingsInBloom);

/** Lightning burn length (~8s at 20Hz). Re-strike refreshes the timer. */
export const LIGHTNING_BUILDING_BURN_TICKS = 160;
/** Damage cadence while a building is on fire (~0.5s at 20Hz). */
export const LIGHTNING_BUILDING_BURN_INTERVAL = 10;
/** HP lost per burn pulse. Farms use FARM_FIRE_DAMAGE_MUL. */
export const LIGHTNING_BUILDING_BURN_DAMAGE = 3;

/** Light a finished building. Refreshes an existing burn. */
export function igniteBuilding(w, bi) {
  const b = w.buildings?.[bi];
  if (!isBuildingAlive(b) || !buildingIsFinished(b)) return false;
  b.fireTicks = LIGHTNING_BUILDING_BURN_TICKS;
  w.buildingsDirty = 1;
  return true;
}

/** Advance lightning burns and pulse fire damage. */
export function tickBuildingFires(w, field) {
  const buildings = w.buildings;
  if (!buildings?.length) return;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if ((b.fireTicks | 0) <= 0) continue;
    if (!isBuildingAlive(b)) {
      b.fireTicks = 0;
      continue;
    }
    b.fireTicks = (b.fireTicks | 0) - 1;
    if (b.fireTicks > 0 && b.fireTicks % LIGHTNING_BUILDING_BURN_INTERVAL === 0) {
      applyDamageBuilding(
        w,
        field,
        bi,
        scaleFarmHazardDamage(b.type, LIGHTNING_BUILDING_BURN_DAMAGE, FARM_FIRE_DAMAGE_MUL),
      );
    }
    if (!isBuildingAlive(b) || (b.fireTicks | 0) <= 0) b.fireTicks = 0;
  }
}

/** Ground-fire pulses - farms cook faster than other buildings. */
export function pulseFireZoneBuildings(w, field) {
  if (!field) return;
  const store = w.fireZones;
  if (!store || store.activeCount === 0) return;
  const buildings = w.buildings;

  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.alive[slot]) continue;
    if (store.ttl[slot] % FIRE_ZONE_DAMAGE_INTERVAL !== 0) continue;
    const cx = store.px[slot];
    const cy = store.py[slot];
    const radius = store.radius[slot];
    const baseDamage = store.damage[slot];
    damageDoorsInRadius(w, field, cx, cy, radius, baseDamage);
    if (!buildings?.length) continue;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (!isBuildingAlive(b)) continue;
      const reach = radius + buildingFootprintHalf(b.type);
      if (fx.dist2(cx, cy, b.x, b.z) > fx.mul(reach, reach)) continue;
      applyDamageBuilding(
        w,
        field,
        bi,
        scaleFarmHazardDamage(b.type, baseDamage, FARM_FIRE_DAMAGE_MUL),
        store.owner[slot] | 0,
      );
    }
  }
}
