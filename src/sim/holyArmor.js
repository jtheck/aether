// Holy Armor — priest AoE absorb shields + cast FX publish.

import * as fx from './fixed.js';
import { TILE_SIZE_F } from './field.js';
import { getUnitDef, UNIT } from './unitTypes.js';

/** Friendly buff radius (~3 tiles). */
export const HOLY_ARMOR_RADIUS = fx.fromFloat(TILE_SIZE_F * 3);
/** Ticks before another cast (~5.75s at 20Hz). */
export const HOLY_ARMOR_COOLDOWN = 115;
/** Absorb duration on buffed units (~7s at 20Hz). */
export const HOLY_ARMOR_DURATION = 140;

export function createHolyArmorFxStore() {
  return {
    count: 0,
    x: [],
    y: [],
    radius: [],
  };
}

export function pushHolyArmorFx(w, x, y, radius) {
  const store = w.holyArmorFx;
  if (!store) return;
  store.x.push(fx.toFloat(x));
  store.y.push(fx.toFloat(y));
  store.radius.push(fx.toFloat(radius));
  store.count++;
}

/** Drain cast pulses for worker → main publish (render-only). */
export function takeHolyArmorUpdates(w) {
  const store = w.holyArmorFx;
  if (!store || store.count === 0) return null;
  const n = store.count;
  const patch = {
    count: n,
    x: store.x.slice(0, n),
    y: store.y.slice(0, n),
    radius: store.radius.slice(0, n),
  };
  store.x.length = 0;
  store.y.length = 0;
  store.radius.length = 0;
  store.count = 0;
  return patch;
}

/** Shield HP from caster attack damage (matches v1 scaling). */
export function holyArmorShieldAmount(casterType = UNIT.PRIEST) {
  const def = getUnitDef(casterType);
  return Math.max(8, Math.round(def.attackDamage * 1.8));
}

/**
 * Apply / refresh absorb shields on living friendlies in radius of (cx, cy).
 * @returns {number} how many units received a shield
 */
export function applyAreaHolyArmor(w, owner, cx, cy, {
  radius = HOLY_ARMOR_RADIUS,
  amount,
  duration = HOLY_ARMOR_DURATION,
} = {}) {
  const shield = amount ?? holyArmorShieldAmount(UNIT.PRIEST);
  if (!(shield > 0) || !(duration > 0)) return 0;
  const radius2 = fx.mul(radius, radius);
  let applied = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (w.owner[i] !== owner) continue;
    if (fx.dist2(cx, cy, w.px[i], w.py[i]) > radius2) continue;
    w.shieldHp[i] = shield;
    w.shieldTicks[i] = duration;
    applied++;
  }
  return applied;
}

/** Expire absorb shields whose duration ran out. */
export function tickHolyArmorShields(w) {
  for (let i = 0; i < w.count; i++) {
    if (w.shieldTicks[i] <= 0) continue;
    w.shieldTicks[i]--;
    if (w.shieldTicks[i] <= 0) {
      w.shieldTicks[i] = 0;
      w.shieldHp[i] = 0;
    }
  }
}

export function mixHolyArmorChecksum(mix, w) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    mix(w.shieldHp[i]);
    mix(w.shieldTicks[i]);
  }
}
