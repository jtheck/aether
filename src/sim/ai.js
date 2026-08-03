// Basic AI — generates commands for non-player owners.
//
// Called from the sim worker before step(); produces the same command objects as input.

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';
import { rngU32 } from './rng.js';
import { ABILITY } from './abilities.js';

/** @typedef {{ interval: number, castChance: number, reissue: boolean, engageRangeF: number | null, castCap: number }} AiTemperament */

/** @type {Record<string, AiTemperament>} */
export const AI_TEMPERAMENTS = {
  // Mostly idle until hostiles are nearby; infrequent push + rare casts.
  cautious: { interval: 80, castChance: 12, reissue: false, engageRangeF: 90, castCap: 4 },
  // Current baseline attack-move cadence.
  steady: { interval: 40, castChance: 22, reissue: false, engageRangeF: null, castCap: 6 },
  // Shorter interval; re-issues even if already attack-moving.
  aggressive: { interval: 24, castChance: 35, reissue: true, engageRangeF: null, castCap: 7 },
  // Always pushes; casts more eagerly.
  reckless: { interval: 16, castChance: 50, reissue: true, engageRangeF: null, castCap: 8 },
};

export const STRESS_AI_PROFILES = [
  { owner: 1, temperament: 'cautious' },
  { owner: 2, temperament: 'steady' },
  { owner: 3, temperament: 'aggressive' },
  { owner: 4, temperament: 'reckless' },
];

function resolveTemperament(name) {
  return AI_TEMPERAMENTS[name] || AI_TEMPERAMENTS.steady;
}

/**
 * @param {object} world
 * @param {number | { owner: number, temperament?: string }} aiConfig
 * @param {number | { temperament?: string }} [opts] — legacy 3rd arg was playerOwner (ignored)
 * @returns {import('./commands.js').Command[]}
 */
export function generateAiCommands(world, aiConfig, opts = {}) {
  let aiOwner;
  let temperamentName = 'steady';
  if (typeof aiConfig === 'number') {
    aiOwner = aiConfig;
    if (opts && typeof opts === 'object' && opts.temperament) {
      temperamentName = opts.temperament;
    }
  } else if (aiConfig && typeof aiConfig === 'object') {
    aiOwner = aiConfig.owner;
    temperamentName = aiConfig.temperament || 'steady';
  } else {
    return [];
  }

  const temper = resolveTemperament(temperamentName);
  const interval = temper.interval;
  const phase = (aiOwner * 7) % interval;
  if (world.tick % interval !== phase) return [];

  let ex = 0;
  let ey = 0;
  let ec = 0;
  for (let j = 0; j < world.count; j++) {
    if (!world.alive[j] || !isHostile(aiOwner, world.owner[j])) continue;
    ex += world.px[j];
    ey += world.py[j];
    ec++;
  }
  if (ec === 0) return [];

  const cx = fx.div(ex, fx.fromInt(ec));
  const cy = fx.div(ey, fx.fromInt(ec));

  // Army centroid for proximity / formation offsets.
  let sx = 0;
  let sy = 0;
  let sc = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== aiOwner) continue;
    const def = getUnitDef(world.type[i]);
    if (def.category !== 'military') continue;
    sx += world.px[i];
    sy += world.py[i];
    sc++;
  }
  if (sc === 0) return [];

  const scx = fx.div(sx, fx.fromInt(sc));
  const scy = fx.div(sy, fx.fromInt(sc));

  if (temper.engageRangeF != null) {
    const rangeF = fx.fromFloat(temper.engageRangeF);
    const range2 = fx.mul(rangeF, rangeF);
    // Approximate: distance from army centroid to enemy centroid.
    const adx = scx - cx;
    const ady = scy - cy;
    const aDist2 = fx.mul(adx, adx) + fx.mul(ady, ady);
    if (aDist2 > range2) {
      // Still allow occasional casts if somehow in range unit-wise — skip move.
      return collectCasts(world, aiOwner, temper, cx, cy);
    }
  }

  const ids = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== aiOwner) continue;
    const def = getUnitDef(world.type[i]);
    if (def.category !== 'military') continue;
    if (!temper.reissue) {
      if (world.order[i] === world.ORDER.ATTACK || world.order[i] === world.ORDER.ATTACK_MOVE) {
        continue;
      }
    }
    ids.push(i);
  }

  /** @type {import('./commands.js').Command[]} */
  const cmds = [];

  if (ids.length > 0) {
    const n = ids.length;
    const tx = new Array(n);
    const ty = new Array(n);
    for (let k = 0; k < n; k++) {
      const i = ids[k];
      tx[k] = cx + (world.px[i] - scx);
      ty[k] = cy + (world.py[i] - scy);
    }
    cmds.push({ type: CMD.ATTACK_MOVE, entities: ids, tx, ty });
  }

  const casts = collectCasts(world, aiOwner, temper, cx, cy);
  for (let c = 0; c < casts.length; c++) cmds.push(casts[c]);
  return cmds;
}

/**
 * @param {object} world
 * @param {number} aiOwner
 * @param {AiTemperament} temper
 * @param {number} aimX
 * @param {number} aimY
 * @returns {import('./commands.js').Command[]}
 */
function collectCasts(world, aiOwner, temper, aimX, aimY) {
  /** @type {import('./commands.js').Command[]} */
  const out = [];
  let castCount = 0;
  for (let i = 0; i < world.count; i++) {
    if (castCount >= temper.castCap) break;
    if (!world.alive[i] || world.owner[i] !== aiOwner) continue;
    if (world.abilityCd[i] > 0) continue;
    const def = getUnitDef(world.type[i]);
    if (!def.primaryAbility) continue;
    if (def.category !== 'military') continue;
    if ((rngU32(world.rng) % 100) >= temper.castChance) continue;

    let tx = aimX;
    let ty = aimY;
    if (def.primaryAbility === ABILITY.HOLY_ARMOR) {
      tx = world.px[i];
      ty = world.py[i];
    }
    out.push({
      type: CMD.CAST,
      entities: [i],
      abilityId: def.primaryAbility,
      tx,
      ty,
    });
    castCount++;
  }
  return out;
}
