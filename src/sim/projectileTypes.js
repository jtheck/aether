// Stable projectile archetypes shared by deterministic simulation and rendering.

import * as fx from './fixed.js';

export const PROJECTILE = {
  ARROW: 0,
  BOLT: 1,
  ORB: 2,
  ROCK: 3,
  FIREBALL: 4,
};

export const PROJECTILE_MESH = {
  ARROW: 0,
  ORB: 1,
  ROCK: 2,
};

/** Gameplay fields are fixed-point/tick based; render fields are cosmetic only. */
export const PROJECTILE_DEFS = [
  {
    id: PROJECTILE.ARROW,
    name: 'Arrow',
    speed: fx.fromFloat(3),
    maxTicks: 32,
    hitRadius: fx.fromFloat(1.5),
    homing: 1,
    blockedByTerrain: 0,
    pierce: 1,
    splashRadius: 0,
    mesh: PROJECTILE_MESH.ARROW,
    scale: [0.18, 0.18, 1.8],
    color: [0.58, 0.34, 0.12],
    // Bow shot: loft then drop into the target (not a ground-hugging skim).
    lob: 1,
    launchHeight: 3.8,
    impactHeight: 2.3,
    arcHeight: 5,
    lobRangeFactor: 0.2,
    renderCapacity: 32768,
  },
  {
    id: PROJECTILE.BOLT,
    name: 'Bolt',
    speed: fx.fromFloat(8),
    maxTicks: 22,
    hitRadius: fx.fromFloat(1.3),
    homing: 0,
    blockedByTerrain: 0,
    pierce: 1,
    splashRadius: 0,
    mesh: PROJECTILE_MESH.ARROW,
    scale: [0.22, 0.22, 1.35],
    color: [0.38, 0.28, 0.18],
    launchHeight: 3.2,
    arcHeight: 0.35,
    renderCapacity: 8192,
  },
  {
    id: PROJECTILE.ORB,
    name: 'Orb',
    speed: fx.fromFloat(4.5),
    maxTicks: 36,
    hitRadius: fx.fromFloat(2),
    homing: 1,
    blockedByTerrain: 0,
    pierce: 1,
    splashRadius: 0,
    mesh: PROJECTILE_MESH.ORB,
    scale: [0.8, 0.8, 0.8],
    color: [0.25, 0.62, 1],
    launchHeight: 3.5,
    arcHeight: 0.8,
    renderCapacity: 8192,
  },
  {
    id: PROJECTILE.ROCK,
    name: 'Rock',
    speed: fx.fromFloat(3.5),
    maxTicks: 48,
    hitRadius: fx.fromFloat(2.5),
    homing: 0,
    blockedByTerrain: 1,
    pierce: 1,
    splashRadius: fx.fromFloat(5),
    mesh: PROJECTILE_MESH.ROCK,
    scale: [1.1, 1.1, 1.1],
    color: [0.3, 0.27, 0.24],
    launchHeight: 4,
    arcHeight: 5,
    renderCapacity: 4096,
  },
  {
    id: PROJECTILE.FIREBALL,
    name: 'Fireball',
    // Slower than bolts so the lob reads in flight.
    speed: fx.fromFloat(5),
    // Long throws need room for a full arc lifetime (render loft scales with this).
    maxTicks: 96,
    hitRadius: fx.fromFloat(2),
    homing: 0,
    blockedByTerrain: 0,
    pierce: 1,
    // v1 ≈ 1.25 tiles × 4 world units.
    splashRadius: fx.fromFloat(5),
    friendlyFireMultiplier: 0.25,
    ignitesTrees: 1,
    // Aim drift as a fraction of throw range (longer shots wander more).
    aimScatter: fx.fromFloat(0.12),
    mesh: PROJECTILE_MESH.ORB,
    scale: [0.95, 0.95, 0.95],
    color: [1, 0.42, 0.06],
    // Thrown from the hand, crashes into the ground (not a dolphin hop).
    lob: 1,
    launchHeight: 4.2,
    // Ball center near the dirt so the splash reads as a ground hit.
    impactHeight: 0.35,
    arcHeight: 11,
    renderCapacity: 4096,
  },
];

export function getProjectileDef(typeId) {
  return PROJECTILE_DEFS[typeId] ?? PROJECTILE_DEFS[PROJECTILE.ARROW];
}
