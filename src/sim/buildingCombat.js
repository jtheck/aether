// Attack / ruin placeable buildings. Units keep targetBuilding as an index
// into world.buildings (stable; ruined entries stay with hp = 0).

import * as fx from './fixed.js';
import { TILE_SIZE_F, snapToPassable } from './field.js';
import { getUnitDef } from './unitTypes.js';
import {
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
  if (field) {
    clearStructureOccupancyAt(field, b.type, b.x, b.z, {
      buildings: w.buildings,
      exceptIndex: bi,
    });
  }
  w.buildingsDirty = 1;
}

export function applyDamageBuilding(w, field, bi, amount) {
  const b = w.buildings?.[bi];
  if (!isBuildingAlive(b) || amount <= 0) return 0;
  const next = Math.max(0, (b.hp | 0) - (amount | 0));
  const dealt = (b.hp | 0) - next;
  b.hp = next;
  w.buildingsDirty = 1;
  if (next <= 0) ruinBuilding(w, field, bi);
  return dealt;
}

/** Crops rot, burn, and get eaten — farms take extra from spore, fire, and locusts. */
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
export function damageBuildingsInBloom(w, field, _owner, cx, cy, radius, amount = SPORE_BLOOM_DAMAGE) {
  const buildings = w.buildings;
  if (!buildings?.length || !radius || radius <= 0) return 0;
  let hit = 0;
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (!isBuildingAlive(b)) continue;
    const reach = radius + buildingFootprintHalf(b.type);
    if (fx.dist2(cx, cy, b.x, b.z) > fx.mul(reach, reach)) continue;
    const dmg = scaleFarmHazardDamage(b.type, amount, FARM_SPORE_DAMAGE_MUL);
    if (applyDamageBuilding(w, field, bi, dmg) <= 0) continue;
    hit++;
    if (b.type === 'farm') pushFarmInkDrips(w, b);
  }
  return hit;
}

setBloomBuildingDamage(damageBuildingsInBloom);

/** Ground-fire pulses — farms cook faster than other buildings. */
export function pulseFireZoneBuildings(w, field) {
  if (!field) return;
  const store = w.fireZones;
  if (!store || store.activeCount === 0) return;
  const buildings = w.buildings;
  if (!buildings?.length) return;

  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.alive[slot]) continue;
    if (store.ttl[slot] % FIRE_ZONE_DAMAGE_INTERVAL !== 0) continue;
    const cx = store.px[slot];
    const cy = store.py[slot];
    const radius = store.radius[slot];
    const baseDamage = store.damage[slot];
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
      );
    }
  }
}
