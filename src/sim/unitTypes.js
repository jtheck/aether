// Unit type definitions — single source of truth for sim stats.
// Render reads size + color from here; gameplay systems read hp/speed/combat.

import * as fx from './fixed.js';
import { PROJECTILE } from './projectileTypes.js';

export const UNIT = {
  VILLAGER: 0,
  WARRIOR: 1,
  ARCHER: 2,
};

export const ATTACK_DELIVERY = {
  MELEE: 0,
  PROJECTILE: 1,
};

/** @type {ReadonlyArray<{ id: number, name: string, category: string, hp: number, speed: number, size: number, pickRadius: number, pickHeight: number, color: [number, number, number], attackDamage: number, attackRange: number, attackCooldown: number, aggroRange: number, attackDelivery: number, projectileType: number, minRange: number, preferredRange: number }>} */
export const UNIT_DEFS = [
  {
    id: UNIT.VILLAGER,
    name: 'Villager',
    category: 'civilian',
    hp: 50,
    speed: fx.fromFloat(2.0),
    size: 4.5,
    pickRadius: 1.4,
    pickHeight: 0.95,
    color: [0.82, 0.74, 0.42],
    attackDamage: 3,
    attackRange: fx.fromFloat(2.0),
    attackCooldown: 40,
    aggroRange: fx.fromFloat(0),
    attackDelivery: ATTACK_DELIVERY.MELEE,
    projectileType: -1,
    minRange: 0,
    preferredRange: fx.fromFloat(2),
  },
  {
    id: UNIT.WARRIOR,
    name: 'Warrior',
    category: 'military',
    hp: 120,
    speed: fx.fromFloat(2.4),
    size: 7.5,
    pickRadius: 1.8,
    pickHeight: 1.1,
    color: [0.82, 0.22, 0.18],
    attackDamage: 10,
    attackRange: fx.fromFloat(2.5),
    attackCooldown: 28,
    // Must reach archer stand-off (~57) so melee can auto-acquire / chase.
    aggroRange: fx.fromFloat(55),
    attackDelivery: ATTACK_DELIVERY.MELEE,
    projectileType: -1,
    minRange: 0,
    preferredRange: fx.fromFloat(2.5),
  },
  {
    id: UNIT.ARCHER,
    name: 'Archer',
    category: 'military',
    hp: 65,
    speed: fx.fromFloat(2.8),
    size: 5.5,
    pickRadius: 1.6,
    pickHeight: 1.05,
    color: [0.28, 0.62, 0.32],
    attackDamage: 8,
    attackRange: fx.fromFloat(70),
    attackCooldown: 40,
    aggroRange: fx.fromFloat(60),
    attackDelivery: ATTACK_DELIVERY.PROJECTILE,
    projectileType: PROJECTILE.ARROW,
    minRange: fx.fromFloat(5),
    preferredRange: fx.fromFloat(57.5),
  },
];

export function getUnitDef(typeId) {
  return UNIT_DEFS[typeId] ?? UNIT_DEFS[UNIT.VILLAGER];
}

export function isMilitary(typeId) {
  return getUnitDef(typeId).category === 'military';
}

