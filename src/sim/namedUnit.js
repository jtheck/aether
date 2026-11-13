// A placed body can carry a scale. A named hero with no authored scale is still
// 40% bigger, tougher, and harder-hitting. Buildings use the same scale for the
// mesh and hit points. Their footprint stays the plot they were given.

export const NAMED_UNIT_SCALE = 1.4;
export const BODY_SCALE_MIN = 0.5;
export const BODY_SCALE_MAX = 4;
/** Packed scale: 1000 is a normal body. 0 means "not authored". */
export const BODY_SCALE_ONE = 1000;

export function isNamedUnit(name) {
  return String(name || '').trim().length > 0;
}

export function quantizeBodyScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n) || n <= 0) return null;
  const limited = n < BODY_SCALE_MIN ? BODY_SCALE_MIN : n > BODY_SCALE_MAX ? BODY_SCALE_MAX : n;
  return Math.round(limited * 100) / 100;
}

/** 1 when the placement has no scale. */
export function bodyScaleMul(scale) {
  return quantizeBodyScale(scale) ?? 1;
}

export function packBodyScale(scale) {
  const q = quantizeBodyScale(scale);
  if (q == null) return 0;
  return Math.round(q * BODY_SCALE_ONE);
}

const HERO_PACK = packBodyScale(NAMED_UNIT_SCALE);

/**
 * Authored scale wins. A named unit whose packed scale is still the hero
 * default uses the same constant the health and damage helpers use.
 */
export function namedScaleOf(world, index) {
  const packed = world?.bodyScale?.[index] | 0;
  if (packed === HERO_PACK) return NAMED_UNIT_SCALE;
  if (packed > 0) return packed / BODY_SCALE_ONE;
  return world?.named?.[index] ? NAMED_UNIT_SCALE : 1;
}

/** What the army tab should show. An explicit scale replaces the hero default. */
export function authoredUnitScale(unit) {
  const explicit = quantizeBodyScale(unit?.scale);
  if (explicit != null) return explicit;
  return isNamedUnit(unit?.name) ? NAMED_UNIT_SCALE : 1;
}

export function scaledHitPoints(hp, scale) {
  const n = Number(hp) || 0;
  if (n <= 0) return 0;
  const s = scale > 0 ? scale : 1;
  if (s === 1) return Math.round(n);
  return Math.max(1, Math.round(n * s));
}

export function namedUnitHp(hp) {
  return scaledHitPoints(hp, NAMED_UNIT_SCALE);
}

export function scaledDamage(damage, scale, mul = 1) {
  const base = Number(damage) || 0;
  const hit = base * (scale > 0 ? scale : 1) * mul;
  if (hit <= 0) return 0;
  return Math.max(1, Math.round(hit));
}

export function namedUnitDamage(damage, hero = false, mul = 1) {
  return scaledDamage(damage, hero ? NAMED_UNIT_SCALE : 1, mul);
}

export function unitMaxHp(world, index, baseHp) {
  return scaledHitPoints(baseHp, namedScaleOf(world, index));
}

export function unitAttackDamage(world, index, baseDamage, mul = 1) {
  return scaledDamage(baseDamage, namedScaleOf(world, index), mul);
}

/** Non-zero only when a building's scale should change the checksum. */
export function bodyScaleChecksum(scale) {
  const packed = packBodyScale(scale);
  return packed > 0 && packed !== BODY_SCALE_ONE ? packed : 0;
}
