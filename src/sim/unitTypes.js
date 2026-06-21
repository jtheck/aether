// Unit type definitions — single source of truth for sim stats.
// Render reads size + color from here; gameplay systems read hp/speed/combat.

import * as fx from './fixed.js';

export const UNIT = {
  VILLAGER: 0,
  WARRIOR: 1,
  ARCHER: 2,
  SPEARMAN: 3,
  SCOUT: 4,
  CAVALRY: 5,
};

/** @type {ReadonlyArray<{ id: number, name: string, category: string, hp: number, speed: number, size: number, color: [number, number, number], attackDamage: number, attackRange: number, attackCooldown: number, aggroRange: number }>} */
export const UNIT_DEFS = [
  {
    id: UNIT.VILLAGER,
    name: 'Villager',
    category: 'civilian',
    hp: 50,
    speed: fx.fromFloat(2.0),
    size: 4.5,
    color: [0.82, 0.74, 0.42],
    attackDamage: 3,
    attackRange: fx.fromFloat(2.0),
    attackCooldown: 40,
    aggroRange: fx.fromFloat(0),
  },
  {
    id: UNIT.WARRIOR,
    name: 'Warrior',
    category: 'military',
    hp: 120,
    speed: fx.fromFloat(2.4),
    size: 7.5,
    color: [0.82, 0.22, 0.18],
    attackDamage: 10,
    attackRange: fx.fromFloat(2.5),
    attackCooldown: 28,
    aggroRange: fx.fromFloat(8),
  },
  {
    id: UNIT.ARCHER,
    name: 'Archer',
    category: 'military',
    hp: 65,
    speed: fx.fromFloat(2.8),
    size: 5.5,
    color: [0.28, 0.62, 0.32],
    attackDamage: 8,
    attackRange: fx.fromFloat(14),
    attackCooldown: 40,
    aggroRange: fx.fromFloat(12),
  },
  {
    id: UNIT.SPEARMAN,
    name: 'Spearman',
    category: 'military',
    hp: 90,
    speed: fx.fromFloat(2.3),
    size: 6.5,
    color: [0.45, 0.55, 0.72],
    attackDamage: 12,
    attackRange: fx.fromFloat(3.0),
    attackCooldown: 30,
    aggroRange: fx.fromFloat(8),
  },
  {
    id: UNIT.SCOUT,
    name: 'Scout',
    category: 'military',
    hp: 55,
    speed: fx.fromFloat(3.4),
    size: 4.0,
    color: [0.95, 0.55, 0.18],
    attackDamage: 5,
    attackRange: fx.fromFloat(2.0),
    attackCooldown: 35,
    aggroRange: fx.fromFloat(10),
  },
  {
    id: UNIT.CAVALRY,
    name: 'Cavalry',
    category: 'military',
    hp: 110,
    speed: fx.fromFloat(3.8),
    size: 8.5,
    color: [0.55, 0.28, 0.72],
    attackDamage: 14,
    attackRange: fx.fromFloat(2.5),
    attackCooldown: 25,
    aggroRange: fx.fromFloat(10),
  },
];

export function getUnitDef(typeId) {
  return UNIT_DEFS[typeId] ?? UNIT_DEFS[UNIT.VILLAGER];
}

export function isMilitary(typeId) {
  return getUnitDef(typeId).category === 'military';
}
