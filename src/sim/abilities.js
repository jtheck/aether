// Deterministic unit abilities. Input issues CMD.CAST; sim applies here.

import { getUnitDef, UNIT } from './unitTypes.js';
import { PROJECTILE } from './projectileTypes.js';
import { spawnProjectile } from './projectiles.js';
import { FROG_PLAGUE_COOLDOWN, spawnFrogPlague } from './frogs.js';
import {
  LIGHTNING_COOLDOWN,
  LIGHTNING_HIT,
  LIGHTNING_STRIKE_RADIUS,
  pushLightningFx,
  resolveLightningStrike,
} from './lightning.js';
import {
  HOLY_ARMOR_COOLDOWN,
  HOLY_ARMOR_RADIUS,
  applyAreaHolyArmor,
  holyArmorShieldAmount,
  pushHolyArmorFx,
} from './holyArmor.js';
import {
  SPORE_BLOOM_COOLDOWN,
  castSporeBloom,
} from './sporeBloom.js';
import { applyDamage } from './damage.js';
import { clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';

export const ABILITY = {
  WARLOCK_FIREBALL: 'warlock_fireball',
  HOLY_ARMOR: 'holy_armor',
  SPORE_BLOOM: 'spore_bloom',
  PLAGUE_OF_FROGS: 'plague_of_frogs',
  WIZARD_LIGHTNING: 'wizard_lightning',
};

const FIREBALL_COOLDOWN = 95;

/**
 * Attempt a primary (or named) ability for one unit.
 * @returns {boolean} true if the cast succeeded
 */
export function tryCast(w, i, abilityId, aimX, aimY, field = null) {
  if (i < 0 || i >= w.count || !w.alive[i]) return false;
  if (w.abilityCd[i] > 0) return false;

  const def = getUnitDef(w.type[i]);
  const id = abilityId || def.primaryAbility;
  if (!id) return false;

  switch (id) {
    case ABILITY.WARLOCK_FIREBALL:
      return castWarlockFireball(w, i, aimX, aimY);
    case ABILITY.PLAGUE_OF_FROGS:
      return castPlagueOfFrogs(w, i, aimX, aimY);
    case ABILITY.WIZARD_LIGHTNING:
      return castWizardLightning(w, i, aimX, aimY, field);
    case ABILITY.HOLY_ARMOR:
      return castHolyArmor(w, i);
    case ABILITY.SPORE_BLOOM:
      return castMycoSporeBloom(w, i, aimX, aimY, field);
    default:
      return false;
  }
}

function lockCaster(w, i, cooldown) {
  w.abilityCd[i] = cooldown;
  w.vx[i] = 0;
  w.vy[i] = 0;
  clearPath(w, i);
  clearEngagement(w, i);
  w.order[i] = ORDER.IDLE;
  w.targetEntity[i] = -1;
  w.hasTarget[i] = 0;
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

  lockCaster(w, i, FIREBALL_COOLDOWN);
  return true;
}

function castPlagueOfFrogs(w, i, aimX, aimY) {
  if (w.type[i] !== UNIT.SHAMAN) return false;
  const def = getUnitDef(UNIT.SHAMAN);
  const damage = Math.max(1, Math.round(def.attackDamage * 1.1));

  const spawned = spawnFrogPlague(w, {
    owner: w.owner[i],
    source: i,
    x: w.px[i],
    y: w.py[i],
    aimX,
    aimY,
    damage,
  });
  if (spawned <= 0) return false;

  lockCaster(w, i, FROG_PLAGUE_COOLDOWN);
  return true;
}

function castWizardLightning(w, i, aimX, aimY, field) {
  if (w.type[i] !== UNIT.WIZARD) return false;
  if (!field) return false;

  const def = getUnitDef(UNIT.WIZARD);
  const damage = Math.max(1, Math.round(def.attackDamage * 4.5));
  const hit = resolveLightningStrike(
    w,
    field,
    w.owner[i],
    aimX,
    aimY,
    LIGHTNING_STRIKE_RADIUS,
  );

  if (hit.kind === LIGHTNING_HIT.UNIT && hit.target >= 0) {
    applyDamage(w, hit.target, damage, i);
  }

  pushLightningFx(w, hit.x, hit.y, hit.kind);
  lockCaster(w, i, LIGHTNING_COOLDOWN);
  return true;
}

/** Self-centered AoE absorb on friendlies (aim point ignored). */
function castHolyArmor(w, i) {
  if (w.type[i] !== UNIT.PRIEST) return false;
  const amount = holyArmorShieldAmount(UNIT.PRIEST);
  const applied = applyAreaHolyArmor(w, w.owner[i], w.px[i], w.py[i], {
    radius: HOLY_ARMOR_RADIUS,
    amount,
  });
  if (applied <= 0) return false;

  pushHolyArmorFx(w, w.px[i], w.py[i], HOLY_ARMOR_RADIUS);
  lockCaster(w, i, HOLY_ARMOR_COOLDOWN);
  return true;
}

function castMycoSporeBloom(w, i, aimX, aimY, field) {
  if (!castSporeBloom(w, field, i, aimX, aimY)) return false;
  lockCaster(w, i, SPORE_BLOOM_COOLDOWN);
  return true;
}
