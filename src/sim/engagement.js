// Deterministic individual engagement claims and stand-off geometry.

import * as fx from './fixed.js';
import { ATTACK_DELIVERY, getUnitDef } from './unitTypes.js';

export const ENGAGEMENT_SLOTS = 16;

// Q16.16 unit-circle directions, hardcoded to avoid runtime trig in the sim.
const DIR_X = new Int32Array([
  65536, 60547, 46341, 25080, 0, -25080, -46341, -60547,
  -65536, -60547, -46341, -25080, 0, 25080, 46341, 60547,
]);
const DIR_Y = new Int32Array([
  0, 25080, 46341, 60547, 65536, 60547, 46341, 25080,
  0, -25080, -46341, -60547, -65536, -60547, -46341, -25080,
]);

export function clearEngagement(w, i) {
  w.engagementTarget[i] = -1;
  w.engagementSlot[i] = -1;
}

function chooseFreeSlot(mask, start) {
  for (let offset = 0; offset < ENGAGEMENT_SLOTS; offset++) {
    const slot = (start + offset) & (ENGAGEMENT_SLOTS - 1);
    if ((mask & (1 << slot)) === 0) return slot;
  }
  return start;
}

export function claimEngagement(w, attacker, target) {
  const def = getUnitDef(w.type[attacker]);
  w.targetLoad[target]++;
  if (def.attackDelivery !== ATTACK_DELIVERY.MELEE) {
    clearEngagement(w, attacker);
    return -1;
  }
  const oldSlot =
    w.engagementTarget[attacker] === target ? w.engagementSlot[attacker] : -1;
  const mask = w.engagementMask[target];
  let slot = oldSlot;
  if (slot < 0 || (mask & (1 << slot)) !== 0) {
    const start = (Math.imul(attacker, 13) + Math.imul(target, 7)) & 15;
    slot = chooseFreeSlot(mask, start);
  }
  w.engagementTarget[attacker] = target;
  w.engagementSlot[attacker] = slot;
  w.engagementMask[target] |= 1 << slot;
  return slot;
}

export function rebuildEngagementClaims(w) {
  w.targetLoad.fill(0, 0, w.count);
  w.engagementMask.fill(0, 0, w.count);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || w.order[i] !== w.ORDER.ATTACK) {
      clearEngagement(w, i);
      continue;
    }
    const target = w.targetEntity[i];
    if (target < 0 || !w.alive[target]) {
      clearEngagement(w, i);
      continue;
    }
    claimEngagement(w, i, target);
  }
}

export function effectiveAttackRange(w, attacker, target) {
  const def = getUnitDef(w.type[attacker]);
  if (def.attackDelivery !== ATTACK_DELIVERY.MELEE) return def.attackRange;
  const targetDef = getUnitDef(w.type[target]);
  const bodyClearance = fx.fromFloat((def.size + targetDef.size) * 0.35);
  return def.attackRange + bodyClearance;
}

export function engagementPoint(w, attacker, target) {
  const def = getUnitDef(w.type[attacker]);
  let slot = w.engagementSlot[attacker];
  if (slot < 0) slot = (Math.imul(attacker, 13) + Math.imul(target, 7)) & 15;

  if (def.attackDelivery === ATTACK_DELIVERY.MELEE) {
    const radius = fx.mul(effectiveAttackRange(w, attacker, target), fx.fromFloat(0.88));
    return {
      x: w.px[target] + fx.mul(DIR_X[slot], radius),
      y: w.py[target] + fx.mul(DIR_Y[slot], radius),
    };
  }

  const dx = w.px[attacker] - w.px[target];
  const dy = w.py[attacker] - w.py[target];
  const dist = fx.len(dx, dy);
  const nx = dist > 0 ? fx.div(dx, dist) : DIR_X[slot];
  const ny = dist > 0 ? fx.div(dy, dist) : DIR_Y[slot];
  return {
    x: w.px[target] + fx.mul(nx, def.preferredRange),
    y: w.py[target] + fx.mul(ny, def.preferredRange),
  };
}
