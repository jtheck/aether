// A garden unit with a name is a hero: bigger body, more health, harder hits.

export const NAMED_UNIT_SCALE = 1.29;

export function isNamedUnit(name) {
  return String(name || '').trim().length > 0;
}

/** 1 for a normal unit, NAMED_UNIT_SCALE for a hero. */
export function namedScaleOf(world, index) {
  return world?.named?.[index] ? NAMED_UNIT_SCALE : 1;
}

export function namedUnitHp(hp) {
  const n = Number(hp) || 0;
  if (n <= 0) return 0;
  return Math.max(1, Math.round(n * NAMED_UNIT_SCALE));
}

/**
 * Attack (or ability) damage. `mul` is the ability coefficient applied once,
 * after the hero bump, so the result is only rounded at the end.
 */
export function namedUnitDamage(damage, hero = false, mul = 1) {
  const base = Number(damage) || 0;
  const hit = (hero ? base * NAMED_UNIT_SCALE : base) * mul;
  if (hit <= 0) return 0;
  return Math.max(1, Math.round(hit));
}

export function unitMaxHp(world, index, baseHp) {
  const hp = baseHp | 0;
  return world?.named?.[index] ? namedUnitHp(hp) : hp;
}

export function unitAttackDamage(world, index, baseDamage, mul = 1) {
  return namedUnitDamage(baseDamage, !!world?.named?.[index], mul);
}
