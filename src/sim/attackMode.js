// Ranged units with an authored melee reach (priest smite vs staff).

import * as fx from './fixed.js';
import { namedScaleOf } from './namedUnit.js';
import { ATTACK_DELIVERY, getUnitDef, isFlyer } from './unitTypes.js';

export function unitMeleeRange(def) {
  return def.meleeRange ?? 0;
}

/** Sword, staff, ram, and fist. A shot that travels can still reach a flyer. */
export function meleeMissesAir(attackerType, targetType) {
  if (!isFlyer(targetType)) return false;
  return getUnitDef(attackerType).attackDelivery === ATTACK_DELIVERY.MELEE;
}

export function hybridBuildingMelee(def) {
  return unitMeleeRange(def) > 0 && def.attackDelivery === ATTACK_DELIVERY.PROJECTILE;
}

export function effectiveMeleeRange(w, attacker, target) {
  const def = getUnitDef(w.type[attacker]);
  const mr = unitMeleeRange(def);
  if (!(mr > 0)) return 0;
  if (target < 0 || !w.alive[target]) return mr;
  const targetDef = getUnitDef(w.type[target]);
  const attackerSize = def.size * namedScaleOf(w, attacker);
  const targetSize = targetDef.size * namedScaleOf(w, target);
  const bodyClearance = fx.fromFloat((attackerSize + targetSize) * 0.35);
  return mr + bodyClearance;
}

export function inMeleeReach(w, attacker, tx, ty, target = -1) {
  const def = getUnitDef(w.type[attacker]);
  const mr = unitMeleeRange(def);
  if (!(mr > 0)) return false;
  if (target >= 0 && isFlyer(w.type[target])) return false;
  const range = target >= 0 && w.alive[target]
    ? effectiveMeleeRange(w, attacker, target)
    : mr;
  const range2 = fx.mul(range, range);
  return fx.dist2(w.px[attacker], w.py[attacker], tx, ty) <= range2;
}

function insideProjectileDeadZone(w, attacker, target, def) {
  if (!(def.minRange > 0)) return false;
  const min2 = fx.mul(def.minRange, def.minRange);
  return fx.dist2(w.px[attacker], w.py[attacker], w.px[target], w.py[target]) < min2;
}

/** Chase / stand geometry: close for staff, otherwise ranged stand-off. */
export function prefersMeleeStand(w, attacker, target, def = getUnitDef(w.type[attacker])) {
  if (target >= 0 && isFlyer(w.type[target])) return false;
  if (def.attackDelivery === ATTACK_DELIVERY.MELEE) return true;
  if (!(unitMeleeRange(def) > 0)) return false;
  return (
    inMeleeReach(w, attacker, w.px[target], w.py[target], target) ||
    insideProjectileDeadZone(w, attacker, target, def)
  );
}

/** Combat strike this tick: staff, holy slash, or pure melee. */
export function usesMeleeStrike(w, attacker, def = getUnitDef(w.type[attacker])) {
  if (def.attackDelivery === ATTACK_DELIVERY.MELEE) return true;
  if (!(unitMeleeRange(def) > 0)) return false;
  const t = w.targetEntity[attacker];
  if (t >= 0) return inMeleeReach(w, attacker, w.px[t], w.py[t], t);
  const bi = w.targetBuilding?.[attacker] ?? -1;
  if (bi >= 0) {
    const b = w.buildings?.[bi];
    if (b) return inMeleeReach(w, attacker, b.x, b.z);
  }
  const di = w.targetDoor?.[attacker] ?? -1;
  if (di >= 0) {
    const door = w.doors?.[di];
    if (door) return inMeleeReach(w, attacker, door.x, door.z);
  }
  return false;
}

export function strikeDamage(w, attacker, def = getUnitDef(w.type[attacker])) {
  const amount = usesMeleeStrike(w, attacker, def)
    ? (def.meleeDamage ?? def.attackDamage)
    : def.attackDamage;
  return amount | 0;
}
