// Match AI "desire wave" — what it wants to afford next (casters, line units).
// Scripts add desire ids over time; economy trains/places only when banks allow.

/** @typedef {{ id: string, unitKey: string, building: string, minHeat: number, trainCap: number, castBoost: number, castCapBoost: number, role: string, note: string }} AiDesireDef */

/** Transport / not shipping — never queue from match AI. */
export const AI_DESIRE_SKIP_UNITS = new Set([
  'wagon',
  'siege_wagon',
  'apc',
  'dirigible',
  'engineer',
]);

/**
 * Caster roles (for scripts / tuning). Each must be earned: building → train → cast.
 * @type {Record<string, AiDesireDef>}
 */
export const AI_DESIRES = {
  monk_ward: {
    id: 'monk_ward',
    unitKey: 'monk',
    building: 'village',
    minHeat: 1,
    trainCap: 2,
    castBoost: 0,
    castCapBoost: 0,
    role: 'pad',
    note: 'Village melee peel — kicks and body on the pad.',
  },
  myco_spirit: {
    id: 'myco_spirit',
    unitKey: 'myco',
    building: 'camp',
    minHeat: 1,
    trainCap: 1,
    castBoost: 10,
    castCapBoost: 1,
    role: 'support',
    note: 'Spore bloom when camp is up; spirit radius for casters.',
  },
  warrior_line: {
    id: 'warrior_line',
    unitKey: 'warrior',
    building: 'barracks',
    minHeat: 2,
    trainCap: 6,
    castBoost: 0,
    castCapBoost: 0,
    role: 'line',
    note: 'Core pad defense once barracks is paid for.',
  },
  archer_line: {
    id: 'archer_line',
    unitKey: 'archer',
    building: 'barracks',
    minHeat: 2,
    trainCap: 4,
    castBoost: 0,
    castCapBoost: 0,
    role: 'line',
    note: 'Reach behind warriors.',
  },
  priest_ward: {
    id: 'priest_ward',
    unitKey: 'priest',
    building: 'church',
    minHeat: 2,
    trainCap: 2,
    castBoost: 18,
    castCapBoost: 2,
    role: 'sustain',
    note: 'Holy armor on contested pads / yard fights.',
  },
  warlock_burst: {
    id: 'warlock_burst',
    unitKey: 'warlock',
    building: 'tavern',
    minHeat: 3,
    trainCap: 2,
    castBoost: 24,
    castCapBoost: 2,
    role: 'burst',
    note: 'Fireball when pad contest is visible.',
  },
  wizard_break: {
    id: 'wizard_break',
    unitKey: 'wizard',
    building: 'tower',
    minHeat: 3,
    trainCap: 1,
    castBoost: 22,
    castCapBoost: 2,
    role: 'siege',
    note: 'Lightning on clumped threats (needs camp + tower).',
  },
  shaman_disrupt: {
    id: 'shaman_disrupt',
    unitKey: 'shaman',
    building: 'grove',
    minHeat: 3,
    trainCap: 1,
    castBoost: 20,
    castCapBoost: 2,
    role: 'disrupt',
    note: 'Frog plague disruption — afford grove then shaman.',
  },
};

/**
 * @param {string[] | undefined} ids
 * @param {number} heat
 * @returns {AiDesireDef[]}
 */
export function activeDesires(ids, heat = 0) {
  const out = [];
  const seen = new Set();
  for (const raw of ids ?? []) {
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    const d = AI_DESIRES[id];
    if (!d) continue;
    if ((d.minHeat | 0) > (heat | 0)) continue;
    out.push(d);
  }
  return out;
}

/**
 * @param {string[] | undefined} ids
 */
export function desireCastBonus(ids) {
  let chance = 0;
  let cap = 0;
  for (const d of activeDesires(ids, 99)) {
    chance += d.castBoost | 0;
    cap += d.castCapBoost | 0;
  }
  return { castChance: Math.min(80, chance), castCap: Math.min(8, cap) };
}

/**
 * @param {string[] | undefined} ids
 * @param {number} heat
 * @returns {string[]}
 */
export function desireTrainOrder(ids, heat = 0) {
  const keys = [];
  const seen = new Set();
  for (const d of activeDesires(ids, heat)) {
    const key = d.unitKey;
    if (!key || AI_DESIRE_SKIP_UNITS.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * @param {string[] | undefined} ids
 * @param {number} heat
 * @returns {AiDesireDef[]}
 */
export function desireBuildOrder(ids, heat = 0) {
  const out = [];
  const seen = new Set();
  for (const d of activeDesires(ids, heat)) {
    const b = d.building;
    if (!b || seen.has(b)) continue;
    seen.add(b);
    out.push(d);
  }
  return out;
}

/**
 * @param {string[]} target
 * @param {string[] | undefined} add
 */
/**
 * @param {string[] | undefined} ids
 * @param {string} unitKey
 * @returns {AiDesireDef | null}
 */
export function desireForUnit(ids, unitKey) {
  for (const d of activeDesires(ids, 99)) {
    if (d.unitKey === unitKey) return d;
  }
  return null;
}

/**
 * @param {string[]} target
 * @param {string[] | undefined} add
 */
export function mergeDesireIds(target, add) {
  if (!Array.isArray(add) || !add.length) return target ?? [];
  const out = Array.isArray(target) ? [...target] : [];
  const seen = new Set(out);
  for (const raw of add) {
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
