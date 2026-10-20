// Chase rope for fights a unit started itself (idle aggro, attack-move peel,
// retaliation). Measured from where that attack began, not from the target —
// melee never gets "far" from whoever it is hitting.
//
// A clicked attack (attackFocus) is not leashed. Giving up remembers the foe
// so a kiter cannot reset the rope by staying in aggro; the memory drops when
// that foe is a full rope away, or when the unit finishes its return / march.

import * as fx from './fixed.js';
import { getUnitDef } from './unitTypes.js';

/** 5/2 — idle, retaliation, and attack-move share one rope. */
const LEASH_NUM = 5;
const LEASH_DEN = 2;
/**
 * Units with aggroRange 0 still retaliate (APC). A zero rope would cancel
 * that chase on the first step, so they get a short fixed budget instead.
 */
const LEASH_MIN = fx.fromFloat(32);

/** @param {{ aggroRange: number }} def */
export function chaseLeashRadius(def) {
  const aggro = def.aggroRange | 0;
  if (aggro > 0) return fx.div(fx.mul(aggro, fx.fromInt(LEASH_NUM)), fx.fromInt(LEASH_DEN));
  return LEASH_MIN;
}

/** Stamp the post. A retarget during the same attack keeps the original spot. */
export function armChaseLeash(w, i) {
  if (!w.leashActive || w.attackFocus?.[i] || w.leashActive[i]) return;
  w.leashActive[i] = 1;
  w.leashX[i] = w.px[i];
  w.leashY[i] = w.py[i];
}

export function clearChaseLeash(w, i) {
  if (w.leashActive) w.leashActive[i] = 0;
  if (w.leashDrop) w.leashDrop[i] = -1;
}

/** Home arrival / finished march — the ignored foe can be picked up again. */
export function releaseLeashDrop(w, i) {
  if (w.leashDrop) w.leashDrop[i] = -1;
}

export function chaseLeashExceeded(w, i) {
  if (!w.leashActive?.[i] || w.attackFocus?.[i]) return false;
  const limit = chaseLeashRadius(getUnitDef(w.type[i]));
  return fx.dist2(w.px[i], w.py[i], w.leashX[i], w.leashY[i]) > fx.mul(limit, limit);
}

/** Drop the ignore once the foe is a full rope away, dead, or carried off. */
export function refreshLeashDrops(w) {
  if (!w.leashDrop) return;
  for (let i = 0; i < w.count; i++) {
    const drop = w.leashDrop[i];
    if (drop < 0 || !w.alive[i]) continue;
    if (!w.alive[drop] || (w.carriedBy?.[drop] >= 0)) {
      w.leashDrop[i] = -1;
      continue;
    }
    const limit = chaseLeashRadius(getUnitDef(w.type[i]));
    if (fx.dist2(w.px[i], w.py[i], w.px[drop], w.py[drop]) > fx.mul(limit, limit)) {
      w.leashDrop[i] = -1;
    }
  }
}
