// Deterministic unit abilities. Input issues CMD.CAST; sim applies here.
// Multi-caster selections of the same ability compound up to CAST_COMPOUND_CAP.

import * as fx from './fixed.js';
import { getUnitDef, UNIT } from './unitTypes.js';
import { PROJECTILE, getProjectileDef } from './projectileTypes.js';
import { spawnProjectile } from './projectiles.js';
import { FROG_COUNT, FROG_PLAGUE_COOLDOWN, spawnFrogPlague } from './frogs.js';
import {
  LIGHTNING_COOLDOWN,
  LIGHTNING_FOLLOWUP_GAP,
  LIGHTNING_STRIKE_RADIUS,
  deliverLightningStrike,
  queueLightningStrike,
} from './lightning.js';
import {
  HOLY_ARMOR_COOLDOWN,
  applyAreaHolyArmor,
  holyArmorRadius,
  holyArmorShieldAmount,
  pushHolyArmorFx,
} from './holyArmor.js';
import {
  SPORE_BLOOM_COOLDOWN,
  castSporeBloom,
} from './sporeBloom.js';
import { clearPath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';
import { isCarried } from './transport.js';

export const ABILITY = {
  WARLOCK_FIREBALL: 'warlock_fireball',
  HOLY_ARMOR: 'holy_armor',
  SPORE_BLOOM: 'spore_bloom',
  PLAGUE_OF_FROGS: 'plague_of_frogs',
  WIZARD_LIGHTNING: 'wizard_lightning',
};

export const CAST_COMPOUND_CAP = 4;

const FIREBALL_COOLDOWN = 95;

/** Rank 1–4 fly-speed scale (authoring). Higher rank = slower, heavier balls. */
const FIREBALL_SPEED_MUL = [
  fx.ONE,
  fx.fromFloat(0.70),
  fx.fromFloat(0.48),
  fx.fromFloat(0.32),
];
const FIREBALL_EXTRA_LATERAL = [
  fx.fromFloat(7),
  fx.fromFloat(-10),
  fx.fromFloat(13),
];
/** Ticks the first ball sits at the caster while fire gathers (20Hz). */
export const FIREBALL_WINDUP = 16;
/** Ticks between staggered throws — short so the volley still reads as one burst. */
export const FIREBALL_STAGGER = 2;
const FROG_RANGE_MUL = [
  fx.ONE,
  fx.fromFloat(1.08),
  fx.fromFloat(1.14),
  fx.fromFloat(1.20),
];
const FROG_EXTRA_EACH = 5;
/** Multi-shaman plague only fires if aim is this close to the group. */
export const SHAMAN_COMPOUND_RANGE = fx.fromFloat(26);
const STORM_SPREAD = [
  0,
  fx.fromFloat(16),
  fx.fromFloat(28),
  fx.fromFloat(42),
];
const STORM_RADIUS_ADD = [
  0,
  fx.fromFloat(8),
  fx.fromFloat(16),
  fx.fromFloat(26),
];
const STORM_DIR_X = [
  fx.ONE,
  0,
  fx.fromFloat(-1),
  0,
];
const STORM_DIR_Y = [
  0,
  fx.ONE,
  0,
  fx.fromFloat(-1),
];

/**
 * Attempt a primary (or named) ability for one unit.
 * @returns {boolean} true if the cast succeeded
 */
export function tryCast(w, i, abilityId, aimX, aimY, field = null) {
  return tryCastGroup(w, field, abilityId, [i], aimX, aimY);
}

/**
 * Point-cast for a command's entity list. Same-ability casters compound
 * in deterministic id order, in chunks of CAST_COMPOUND_CAP.
 */
export function applyCasts(w, field, ids, abilityId, tx, ty) {
  if (!ids || ids.length === 0) return;
  const sharedAim = typeof tx === 'number' && typeof ty === 'number';
  /** @type {Record<string, { casters: number[], aimX: number, aimY: number }>} */
  const groups = Object.create(null);

  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    if (i < 0 || i >= w.count || !w.alive[i]) continue;
    if (isCarried(w, i)) continue;
    if (w.abilityCd[i] > 0) continue;
    const aimX = sharedAim ? tx : tx?.[k];
    const aimY = sharedAim ? ty : ty?.[k];
    if (aimX == null || aimY == null) continue;
    const def = getUnitDef(w.type[i]);
    const id = abilityId || def.primaryAbility;
    if (!id) continue;
    let g = groups[id];
    if (!g) {
      g = { casters: [], aimX, aimY };
      groups[id] = g;
    }
    g.casters.push(i);
  }

  const keys = Object.keys(groups).sort();
  for (let k = 0; k < keys.length; k++) {
    const id = keys[k];
    const g = groups[id];
    g.casters.sort((a, b) => a - b);
    for (let off = 0; off < g.casters.length; off += CAST_COMPOUND_CAP) {
      const chunk = g.casters.slice(off, off + CAST_COMPOUND_CAP);
      tryCastGroup(w, field, id, chunk, g.aimX, g.aimY);
    }
  }
}

export function compoundRank(n) {
  return Math.max(1, Math.min(CAST_COMPOUND_CAP, n | 0));
}

export function groupCentroid(w, casters) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let k = 0; k < casters.length; k++) {
    const i = casters[k];
    if (i < 0 || i >= w.count || !w.alive[i]) continue;
    sx += w.px[i];
    sy += w.py[i];
    n++;
  }
  if (n <= 0) return { x: 0, y: 0 };
  const d = fx.fromInt(n);
  return { x: fx.div(sx, d), y: fx.div(sy, d) };
}

function tryCastGroup(w, field, abilityId, casters, aimX, aimY) {
  if (!casters?.length) return false;
  const def0 = getUnitDef(w.type[casters[0]]);
  const id = abilityId || def0.primaryAbility;
  if (!id) return false;

  switch (id) {
    case ABILITY.WARLOCK_FIREBALL:
      return castWarlockFireballGroup(w, casters, aimX, aimY);
    case ABILITY.PLAGUE_OF_FROGS:
      return castPlagueOfFrogsGroup(w, casters, aimX, aimY);
    case ABILITY.WIZARD_LIGHTNING:
      return castWizardLightningGroup(w, field, casters, aimX, aimY);
    case ABILITY.HOLY_ARMOR:
      return castHolyArmorGroup(w, casters);
    case ABILITY.SPORE_BLOOM:
      return castMycoSporeBloomGroup(w, field, casters, aimX, aimY);
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
  if (w.targetBuilding) w.targetBuilding[i] = -1;
  w.hasTarget[i] = 0;
}

function lockGroup(w, casters, cooldown) {
  for (let k = 0; k < casters.length; k++) lockCaster(w, casters[k], cooldown);
}

function filterType(w, casters, typeId) {
  const out = [];
  for (let k = 0; k < casters.length; k++) {
    const i = casters[k];
    if (i < 0 || i >= w.count || !w.alive[i]) continue;
    if (w.abilityCd[i] > 0) continue;
    if (w.type[i] !== typeId) continue;
    out.push(i);
  }
  return out;
}

function aimDir(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = fx.len(dx, dy);
  if (len <= 0) return { x: fx.ONE, y: 0 };
  return { x: fx.div(dx, len), y: fx.div(dy, len) };
}

function parallelAim(w, caster, centroid, aimX, aimY) {
  return {
    aimX: w.px[caster] + (aimX - centroid.x),
    aimY: w.py[caster] + (aimY - centroid.y),
  };
}

function stormBranchAim(aimX, aimY, index, basisX, basisY) {
  const radius = LIGHTNING_STRIKE_RADIUS + (STORM_RADIUS_ADD[index] || 0);
  if (index <= 0) return { x: aimX, y: aimY, radius };
  const spread = STORM_SPREAD[index] || STORM_SPREAD[1];
  const dirI = (index - 1) % STORM_DIR_X.length;
  const lx = fx.mul(STORM_DIR_X[dirI], spread);
  const ly = fx.mul(STORM_DIR_Y[dirI], spread);
  const perpX = -basisY;
  const perpY = basisX;
  return {
    x: aimX + fx.mul(basisX, lx) + fx.mul(perpX, ly),
    y: aimY + fx.mul(basisY, lx) + fx.mul(perpY, ly),
    radius,
  };
}

function fireballSpeedForRank(rank) {
  const def = getProjectileDef(PROJECTILE.FIREBALL);
  return fx.mul(def.speed, FIREBALL_SPEED_MUL[rank - 1]);
}

function castWarlockFireballGroup(w, casters, aimX, aimY) {
  const ready = filterType(w, casters, UNIT.WARLOCK);
  if (!ready.length) return false;
  const rank = compoundRank(ready.length);
  const def = getUnitDef(UNIT.WARLOCK);
  const damage = Math.max(1, Math.round(def.attackDamage * 1.35));
  const speed = fireballSpeedForRank(rank);
  const scatter = rank > 1 ? 0 : undefined;
  const centroid = groupCentroid(w, ready);

  let spawned = 0;
  let throwIndex = 0;
  for (let k = 0; k < ready.length; k++) {
    const i = ready[k];
    const aimed = parallelAim(w, i, centroid, aimX, aimY);
    const slot = spawnProjectile(w, {
      type: PROJECTILE.FIREBALL,
      owner: w.owner[i],
      source: i,
      target: -1,
      x: w.px[i],
      y: w.py[i],
      aimX: aimed.aimX,
      aimY: aimed.aimY,
      damage,
      speed,
      power: rank,
      aimScatter: scatter,
      launchWait: FIREBALL_WINDUP + throwIndex * FIREBALL_STAGGER,
    });
    throwIndex++;
    if (slot >= 0) spawned++;
  }

  const fwd = aimDir(centroid.x, centroid.y, aimX, aimY);
  const perpX = -fwd.y;
  const perpY = fwd.x;
  const extraN = rank - 1;
  for (let e = 0; e < extraN; e++) {
    const i = ready[e % ready.length];
    const aimed = parallelAim(w, i, centroid, aimX, aimY);
    const lateral = FIREBALL_EXTRA_LATERAL[e] ?? FIREBALL_EXTRA_LATERAL[0];
    const slot = spawnProjectile(w, {
      type: PROJECTILE.FIREBALL,
      owner: w.owner[i],
      source: i,
      target: -1,
      x: w.px[i],
      y: w.py[i],
      aimX: aimed.aimX + fx.mul(perpX, lateral),
      aimY: aimed.aimY + fx.mul(perpY, lateral),
      damage,
      speed,
      power: rank,
      aimScatter: 0,
      launchWait: FIREBALL_WINDUP + throwIndex * FIREBALL_STAGGER,
    });
    throwIndex++;
    if (slot >= 0) spawned++;
  }

  if (spawned <= 0) return false;
  lockGroup(w, ready, FIREBALL_COOLDOWN);
  return true;
}

function castPlagueOfFrogsGroup(w, casters, aimX, aimY) {
  const ready = filterType(w, casters, UNIT.SHAMAN);
  if (!ready.length) return false;
  if (ready.length > 1) {
    const mid = groupCentroid(w, ready);
    const range2 = fx.mul(SHAMAN_COMPOUND_RANGE, SHAMAN_COMPOUND_RANGE);
    if (fx.dist2(mid.x, mid.y, aimX, aimY) > range2) return false;
  }
  const rank = compoundRank(ready.length);
  const def = getUnitDef(UNIT.SHAMAN);
  const damage = Math.max(1, Math.round(def.attackDamage * 1.1));
  const total = FROG_COUNT + (rank - 1) * FROG_EXTRA_EACH;
  const rangeScale = FROG_RANGE_MUL[rank - 1];
  let spawned = 0;
  let assigned = 0;
  for (let k = 0; k < ready.length; k++) {
    const i = ready[k];
    const remain = ready.length - k;
    const share = Math.max(1, Math.round((total - assigned) / remain));
    assigned += share;
    spawned += spawnFrogPlague(w, {
      owner: w.owner[i],
      source: i,
      x: w.px[i],
      y: w.py[i],
      aimX,
      aimY,
      damage,
      count: share,
      rangeScale,
    });
  }
  if (spawned <= 0) return false;
  lockGroup(w, ready, FROG_PLAGUE_COOLDOWN);
  return true;
}

function castWizardLightningGroup(w, field, casters, aimX, aimY) {
  const ready = filterType(w, casters, UNIT.WIZARD);
  if (!ready.length || !field) return false;
  const rank = compoundRank(ready.length);
  const def = getUnitDef(UNIT.WIZARD);
  const damage = Math.max(1, Math.round(def.attackDamage * 4.5));
  const owner = w.owner[ready[0]];

  const basis = aimDir(w.px[ready[0]], w.py[ready[0]], aimX, aimY);
  for (let n = 0; n < rank; n++) {
    const branched = stormBranchAim(aimX, aimY, n, basis.x, basis.y);
    if (n === 0) {
      deliverLightningStrike(
        w,
        field,
        owner,
        ready[0],
        branched.x,
        branched.y,
        damage,
        branched.radius,
      );
      continue;
    }
    queueLightningStrike(w, {
      strikeAt: w.tick + n * LIGHTNING_FOLLOWUP_GAP,
      owner,
      source: ready[n % ready.length],
      aimX: branched.x,
      aimY: branched.y,
      damage,
      radius: branched.radius,
    });
  }
  lockGroup(w, ready, LIGHTNING_COOLDOWN);
  return true;
}

function castHolyArmorGroup(w, casters) {
  const ready = filterType(w, casters, UNIT.PRIEST);
  if (!ready.length) return false;
  const rank = compoundRank(ready.length);
  const amount = holyArmorShieldAmount(UNIT.PRIEST);
  const radius = holyArmorRadius(rank);
  let applied = 0;
  for (let k = 0; k < ready.length; k++) {
    const i = ready[k];
    applied += applyAreaHolyArmor(w, w.owner[i], w.px[i], w.py[i], {
      radius,
      amount,
    });
    pushHolyArmorFx(w, w.px[i], w.py[i], radius);
  }
  if (applied <= 0) return false;
  lockGroup(w, ready, HOLY_ARMOR_COOLDOWN);
  return true;
}

function castMycoSporeBloomGroup(w, field, casters, aimX, aimY) {
  const ready = filterType(w, casters, UNIT.MYCO);
  if (!ready.length || !field) return false;
  const rank = compoundRank(ready.length);
  const origin = groupCentroid(w, ready);
  if (!castSporeBloom(w, field, ready[0], aimX, aimY, {
    rank,
    originX: origin.x,
    originY: origin.y,
  })) return false;
  lockGroup(w, ready, SPORE_BLOOM_COOLDOWN);
  return true;
}
