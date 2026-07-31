// Deterministic unit abilities. Input issues CMD.CAST; sim applies here.

import { getUnitDef, UNIT } from './unitTypes.js';
import { PROJECTILE } from './projectileTypes.js';
import { spawnProjectile } from './projectiles.js';
import { clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';

export const ABILITY = {
  WARLOCK_FIREBALL: 'warlock_fireball',
  HOLY_ARMOR: 'holy_armor',
  SPORE_BLOOM: 'spore_bloom',
  FROG_SWARM: 'frog_swarm',
};

const FIREBALL_COOLDOWN = 95;

/**
 * Attempt a primary (or named) ability for one unit.
 * @returns {boolean} true if the cast succeeded
 */
export function tryCast(w, i, abilityId, aimX, aimY) {
  if (i < 0 || i >= w.count || !w.alive[i]) return false;
  if (w.abilityCd[i] > 0) return false;

  const def = getUnitDef(w.type[i]);
  const id = abilityId || def.primaryAbility;
  if (!id) return false;

  switch (id) {
    case ABILITY.WARLOCK_FIREBALL:
      return castWarlockFireball(w, i, aimX, aimY);
    case ABILITY.HOLY_ARMOR:
    case ABILITY.SPORE_BLOOM:
    case ABILITY.FROG_SWARM:
      // Stubs — gesture procs; effect later.
      return false;
    default:
      return false;
  }
}

function castWarlockFireball(w, i, aimX, aimY) {
  if (w.type[i] !== UNIT.WARLOCK) return false;
  const def = getUnitDef(UNIT.WARLOCK);
  const damage = Math.max(1, Math.round(def.attackDamage * 1.35));

  const slot = spawnProjectile(w, {
    type: PROJECTILE.FIREBALL,
    owner: w.owner[i],
    source: i,
    target: -1,
    x: w.px[i],
    y: w.py[i],
    aimX,
    aimY,
    damage,
  });
  if (slot < 0) return false;

  w.abilityCd[i] = FIREBALL_COOLDOWN;
  // Brief cast lock — stop walking this tick.
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
  clearEngagement(w, i);
  w.order[i] = ORDER.IDLE;
  w.targetEntity[i] = -1;
  w.hasTarget[i] = 0;
  return true;
}
