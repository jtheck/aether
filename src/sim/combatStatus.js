// Lightweight combat statuses: warlock DoT + wizard frost slow.
// Not a full buff framework — mirror holy armor / fire-zone patterns.

import * as fx from './fixed.js';
import { applyDamage } from './damage.js';

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

/** Pulse DoTs and expire frost. Call once per tick after projectiles. */
export function tickCombatStatus(w) {
  if (!w.dotTicks || !w.frostTicks) return;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) {
      if (w.dotTicks[i] > 0) {
        w.dotTicks[i] = 0;
        w.dotAcc[i] = 0;
      }
      if (w.frostTicks[i] > 0) w.frostTicks[i] = 0;
      continue;
    }

    if (w.frostTicks[i] > 0) {
      w.frostTicks[i]--;
    }

    if (w.dotTicks[i] <= 0) continue;
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
  }
}
