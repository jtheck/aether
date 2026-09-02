// Lightweight combat statuses: warlock DoT + wizard frost slow + locust chew.
// Not a full buff framework — mirror holy armor / fire-zone patterns.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';
import {
  applyDamageBuilding,
  buildingFootprintHalf,
  FARM_LOCUST_DAMAGE_MUL,
  scaleFarmHazardDamage,
} from './buildingCombat.js';
import { isBuildingAlive } from './buildings.js';
import { isHostile } from './teams.js';

/** ~1s of shadow DoT at 20Hz (2 damage pulses). */
export const SHADOW_DOT_DURATION = 10;
export const SHADOW_DOT_PERIOD = 5;
export const SHADOW_DOT_DAMAGE = 2;

/** ~2s frost slow. */
export const FROST_DURATION = 40;
/** Movement scale while frosted (stacks with terrain / distract). */
export const FROST_MOVE_MUL = fx.fromFloat(0.5);

/** Short locust AA distract (~1s). */
export const LOCUST_DISTRACT_TICKS = 20;

/** ~5s locust chew at 20Hz. Hits refresh duration and stack up to 3. */
export const LOCUST_DOT_DURATION = 100;
export const LOCUST_DOT_PERIOD = 5;
export const LOCUST_DOT_DAMAGE = 1;
export const LOCUST_DOT_MAX_STACKS = 3;
/** Extra circling hops onto nearby hostiles when a new swarm lands. */
export const LOCUST_HOP_COUNT = 2;
export const LOCUST_HOP_RANGE = fx.fromFloat(22);
/** Stay at full chew for this many hop generations, then fade. */
export const LOCUST_FRESH_HOPS = 2;
export const LOCUST_FADE_TICKS = 28;

/** Apply / refresh warlock shadow DoT on a living unit. */
export function applyShadowDot(w, i, {
  damage = SHADOW_DOT_DAMAGE,
  duration = SHADOW_DOT_DURATION,
  period = SHADOW_DOT_PERIOD,
  source = -1,
} = {}) {
  if (!w.alive[i] || !w.dotTicks) return;
  w.dotTicks[i] = duration;
  w.dotDamage[i] = damage;
  w.dotPeriod[i] = period;
  w.dotAcc[i] = 0;
  w.dotSource[i] = source;
}

/** Apply / refresh wizard frost slow. */
export function applyFrost(w, i, duration = FROST_DURATION) {
  if (!w.alive[i] || !w.frostTicks) return;
  if (w.frostTicks[i] < duration) w.frostTicks[i] = duration;
}

/** Stack / refresh shaman locust chew on a living unit. */
export function applyLocustDot(w, i, { source = -1 } = {}) {
  if (!w.alive[i] || !w.locustTicks) return;
  const next = Math.min(LOCUST_DOT_MAX_STACKS, (w.locustStacks[i] | 0) + 1);
  w.locustStacks[i] = next;
  w.locustTicks[i] = LOCUST_DOT_DURATION;
  w.locustSource[i] = source;
  if (w.locustHops) w.locustHops[i] = 0;
}

/** Stack / refresh locust chew on a living building (farms take extra per pulse). */
export function applyLocustDotBuilding(b, { source = -1 } = {}) {
  if (!isBuildingAlive(b)) return;
  const next = Math.min(LOCUST_DOT_MAX_STACKS, (b.locustStacks | 0) + 1);
  b.locustStacks = next;
  b.locustTicks = LOCUST_DOT_DURATION;
  b.locustSource = source;
  b.locustHops = 0;
}

function ageLocustEntity(w, i) {
  if ((w.locustTicks[i] | 0) <= 0) return;
  const hops = (w.locustHops?.[i] | 0) + 1;
  if (w.locustHops) w.locustHops[i] = hops;
  if (hops >= LOCUST_FRESH_HOPS && w.locustTicks[i] > LOCUST_FADE_TICKS) {
    w.locustTicks[i] = LOCUST_FADE_TICKS;
  }
}

function ageLocustBuilding(b) {
  if ((b.locustTicks | 0) <= 0) return;
  const hops = (b.locustHops | 0) + 1;
  b.locustHops = hops;
  if (hops >= LOCUST_FRESH_HOPS && (b.locustTicks | 0) > LOCUST_FADE_TICKS) {
    b.locustTicks = LOCUST_FADE_TICKS;
  }
}

function hopBetter(a, b) {
  if (a.infected !== b.infected) return a.infected < b.infected;
  if (a.hops !== b.hops) return a.hops > b.hops;
  if (a.dist2 !== b.dist2) return a.dist2 < b.dist2;
  if (a.kind !== b.kind) return a.kind < b.kind;
  return a.id < b.id;
}

function considerHop(best, cand) {
  for (let i = 0; i < best.length; i++) {
    if (!hopBetter(cand, best[i])) continue;
    best.splice(i, 0, cand);
    if (best.length > LOCUST_HOP_COUNT) best.length = LOCUST_HOP_COUNT;
    return;
  }
  if (best.length < LOCUST_HOP_COUNT) best.push(cand);
}

/**
 * Impact stays on the hit target; extra circles hop to nearby hostiles.
 * Older hop sites fade after {@link LOCUST_FRESH_HOPS} generations.
 */
export function spreadLocust(w, {
  owner,
  source = -1,
  x,
  y,
  unit = -1,
  building = -1,
} = {}) {
  if (!w.locustTicks) return;
  const ageRange2 = fx.mul(LOCUST_HOP_RANGE, LOCUST_HOP_RANGE);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || (w.locustTicks[i] | 0) <= 0) continue;
    if (fx.dist2(x, y, w.px[i], w.py[i]) > ageRange2) continue;
    ageLocustEntity(w, i);
  }
  const buildings = w.buildings;
  if (buildings) {
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (!isBuildingAlive(b) || (b.locustTicks | 0) <= 0) continue;
      const reach = LOCUST_HOP_RANGE + buildingFootprintHalf(b.type);
      if (fx.dist2(x, y, b.x, b.z) > fx.mul(reach, reach)) continue;
      ageLocustBuilding(b);
    }
  }

  if (unit >= 0) applyLocustDot(w, unit, { source });
  if (building >= 0) applyLocustDotBuilding(buildings?.[building], { source });

  const range2 = fx.mul(LOCUST_HOP_RANGE, LOCUST_HOP_RANGE);
  const best = [];
  for (let i = 0; i < w.count; i++) {
    if (i === unit || !w.alive[i]) continue;
    if (w.carriedBy?.[i] >= 0) continue;
    if (!isHostile(owner, w.owner[i])) continue;
    const hops = w.locustHops?.[i] | 0;
    const infected = (w.locustTicks[i] | 0) > 0;
    if (infected) continue;
    const dist2 = fx.dist2(x, y, w.px[i], w.py[i]);
    if (dist2 > range2) continue;
    considerHop(best, { kind: 0, id: i, dist2, hops, infected: infected ? 1 : 0 });
  }
  if (buildings) {
    for (let bi = 0; bi < buildings.length; bi++) {
      if (bi === building) continue;
      const b = buildings[bi];
      if (!isBuildingAlive(b) || !isHostile(owner, b.owner)) continue;
      const hops = b.locustHops | 0;
      const infected = (b.locustTicks | 0) > 0;
      if (infected) continue;
      const reach = LOCUST_HOP_RANGE + buildingFootprintHalf(b.type);
      const dist2 = fx.dist2(x, y, b.x, b.z);
      if (dist2 > fx.mul(reach, reach)) continue;
      considerHop(best, { kind: 1, id: bi, dist2, hops, infected: infected ? 1 : 0 });
    }
  }
  for (let i = 0; i < best.length; i++) {
    const hop = best[i];
    if (hop.kind === 0) applyLocustDot(w, hop.id, { source });
    else applyLocustDotBuilding(buildings[hop.id], { source });
  }
}

function clearLocust(w, i) {
  w.locustTicks[i] = 0;
  w.locustStacks[i] = 0;
  w.locustAcc[i] = 0;
  w.locustSource[i] = -1;
  if (w.locustHops) w.locustHops[i] = 0;
}

function tickLocustOnEntity(w, i) {
  if (w.locustTicks[i] <= 0) return;
  w.locustTicks[i]--;
  w.locustAcc[i]++;
  if (w.locustAcc[i] >= LOCUST_DOT_PERIOD) {
    w.locustAcc[i] = 0;
    const stacks = Math.max(1, w.locustStacks[i] | 0);
    applyDamage(w, i, LOCUST_DOT_DAMAGE * stacks, w.locustSource[i]);
  }
  if (w.locustTicks[i] <= 0) clearLocust(w, i);
}

function tickLocustOnBuilding(w, field, bi, b) {
  if ((b.locustTicks | 0) <= 0) return;
  b.locustTicks = (b.locustTicks | 0) - 1;
  b.locustAcc = (b.locustAcc | 0) + 1;
  if ((b.locustAcc | 0) >= LOCUST_DOT_PERIOD) {
    b.locustAcc = 0;
    const stacks = Math.max(1, b.locustStacks | 0);
    const raw = LOCUST_DOT_DAMAGE * stacks;
    applyDamageBuilding(
      w,
      field,
      bi,
      scaleFarmHazardDamage(b.type, raw, FARM_LOCUST_DAMAGE_MUL),
    );
  }
  if ((b.locustTicks | 0) <= 0) {
    b.locustTicks = 0;
    b.locustStacks = 0;
    b.locustAcc = 0;
    b.locustSource = -1;
    b.locustHops = 0;
  }
}

/** Pulse DoTs and expire frost. Call once per tick after projectiles. */
export function tickCombatStatus(w, field) {
  if (w.dotTicks && w.frostTicks) {
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i]) {
        if (w.dotTicks[i] > 0) {
          w.dotTicks[i] = 0;
          w.dotAcc[i] = 0;
        }
        if (w.frostTicks[i] > 0) w.frostTicks[i] = 0;
        if (w.locustTicks?.[i] > 0) clearLocust(w, i);
        continue;
      }

      if (w.frostTicks[i] > 0) {
        w.frostTicks[i]--;
      }

      if (w.dotTicks[i] > 0) {
        w.dotTicks[i]--;
        w.dotAcc[i]++;
        const period = Math.max(1, w.dotPeriod[i] | 0);
        if (w.dotAcc[i] >= period) {
          w.dotAcc[i] = 0;
          applyDamage(w, i, w.dotDamage[i], w.dotSource[i]);
        }
        if (w.dotTicks[i] <= 0) {
          w.dotTicks[i] = 0;
          w.dotAcc[i] = 0;
        }
      }

      if (w.locustTicks) tickLocustOnEntity(w, i);
    }
  }

  const buildings = w.buildings;
  if (buildings?.length) {
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (!isBuildingAlive(b)) {
        if ((b.locustTicks | 0) > 0) {
          b.locustTicks = 0;
          b.locustStacks = 0;
          b.locustAcc = 0;
          b.locustSource = -1;
          b.locustHops = 0;
        }
        continue;
      }
      tickLocustOnBuilding(w, field, bi, b);
    }
  }
}

export function mixCombatStatusChecksum(mix, w) {
  if (!w.dotTicks || !w.frostTicks) return;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    mix(w.dotTicks[i]);
    mix(w.dotDamage[i]);
    mix(w.dotPeriod[i]);
    mix(w.dotAcc[i]);
    mix(w.dotSource[i]);
    mix(w.frostTicks[i]);
    if (w.locustTicks) {
      mix(w.locustTicks[i]);
      mix(w.locustStacks[i]);
      mix(w.locustAcc[i]);
      mix(w.locustSource[i]);
      if (w.locustHops) mix(w.locustHops[i]);
    }
  }
}
