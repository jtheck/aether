// Match AI scripts — timed / board-state patches on a baseline aiPlayers entry.
// Evaluated in the sim worker each tick (deterministic). Same commands a human
// could issue; script only retunes resolveAiStrategy fields.

import { agoraCaptureScore, agoraForOwner } from './agora.js';
import { getUnitDef } from './unitTypes.js';
import { AI_STANCE, resolveAiStrategy, shownHostiles } from './aiStrategy.js';
import { mergeDesireIds } from './aiDesire.js';

/** @typedef {{ when: object, patch: object, once?: boolean, cooldownTicks?: number }} AiScriptRule */

/** Ticks @ 20 Hz */
const MIN = 60 * 20;

/**
 * Freeplay wait skirm: passive opener, then reacts to time and pad pressure.
 * @type {AiScriptRule[]}
 */
export const FREEPLAY_SKIRM_SCRIPT = [
  {
    when: { tickGte: MIN },
    once: true,
    patch: { difficulty: 'casual', desiresAdd: ['myco_spirit'] },
  },
  {
    when: { homeScoreGte: 0.04 },
    cooldownTicks: MIN / 3,
    patch: { guardAt: 0.28 },
  },
  {
    when: { homeThreat: true },
    cooldownTicks: MIN / 2,
    patch: {
      stance: AI_STANCE.DEFEND,
      guardAt: 0.22,
      heat: 1,
      defendRangeF: 70,
      desiresAdd: ['monk_ward'],
    },
  },
  {
    when: { yardRaid: true },
    cooldownTicks: MIN / 3,
    patch: {
      stance: AI_STANCE.DEFEND,
      heat: 2,
      guardAt: 0.16,
      reactInterval: 28,
      difficulty: 'normal',
      desiresAdd: ['warrior_line', 'archer_line', 'priest_ward'],
    },
  },
  {
    when: { homeThreat: true, homeScoreGte: 0.18 },
    cooldownTicks: MIN,
    patch: { heat: 2, guardAt: 0.12 },
  },
  {
    when: { homeQuiet: true },
    cooldownTicks: MIN / 2,
    patch: { stance: AI_STANCE.HOLD, heat: 0, guardAt: 9, path: 'eco' },
  },
  {
    when: { tickGte: MIN * 6 },
    once: true,
    patch: { difficulty: 'normal', reactInterval: 34 },
  },
  {
    when: { winIntent: true },
    cooldownTicks: MIN * 2,
    patch: {
      heat: 3,
      guardAt: 0.08,
      stance: AI_STANCE.DEFEND,
      reactInterval: 24,
      desiresAdd: ['warlock_burst', 'wizard_break', 'shaman_disrupt'],
    },
  },
];

const PROFILE_PATCH_KEYS = [
  'temperament',
  'economy',
  'stance',
  'path',
  'difficulty',
  'vision',
  'heat',
  'guardAt',
  'reactInterval',
  'defendRangeF',
  'castChance',
  'castCap',
];

/**
 * @param {object} target
 * @param {object} patch
 */
export function mergeAiPatch(target, patch) {
  if (!patch || typeof patch !== 'object') return;
  for (let i = 0; i < PROFILE_PATCH_KEYS.length; i++) {
    const key = PROFILE_PATCH_KEYS[i];
    if (patch[key] != null) target[key] = patch[key];
  }
}

/**
 * @param {object} w
 * @param {number} owner
 */
function militaryCount(w, owner) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || (w.owner[i] | 0) !== (owner | 0)) continue;
    if (getUnitDef(w.type[i]).category === 'military') n++;
  }
  return n;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {object} when
 */
/**
 * @param {object} [field]
 * @param {object} [entry]
 */
export function matchAiWhen(w, owner, when, field = null, entry = null) {
  if (!when || typeof when !== 'object') return true;
  const row = entry && typeof entry === 'object'
    ? { ...entry }
    : { owner: owner | 0, temperament: 'passive', vision: 'fair' };
  if (row._scriptPatch) {
    Object.assign(row, row._scriptPatch);
    delete row._scriptPatch;
  }
  row.owner = owner | 0;
  const strategy = resolveAiStrategy(row);
  const tick = w.tick | 0;
  if (when.tickGte != null && tick < (when.tickGte | 0)) return false;
  if (when.tickLt != null && tick >= (when.tickLt | 0)) return false;
  if (when.militaryGte != null && militaryCount(w, owner) < (when.militaryGte | 0)) return false;
  if (when.militaryLt != null && militaryCount(w, owner) >= (when.militaryLt | 0)) return false;

  const home = agoraForOwner(w.agoras, owner);
  const homeScore = home ? agoraCaptureScore(home) : 0;

  if (when.homeScoreGte != null && homeScore < when.homeScoreGte) return false;

  if (when.homeThreat) {
    const yard = shownHostiles(w, owner, when.defendRangeF ?? 90, field, strategy);
    const need = when.homeScoreGte != null ? when.homeScoreGte : 0.06;
    if (yard.onHomePad <= 0 && homeScore < need) return false;
  }

  if (when.yardRaid) {
    const yard = shownHostiles(w, owner, when.defendRangeF ?? 100, field, strategy);
    const needMil = when.shownGte ?? 1;
    const pressure = (yard.inYard | 0) + (yard.onHomePad | 0);
    if (pressure < needMil) return false;
  }

  if (when.enemyPad) {
    const yard = shownHostiles(w, owner, 0, field, strategy);
    if ((yard.enemyScore | 0) <= 0 && yard.onEnemyPad <= 0) return false;
  }

  if (when.homeQuiet) {
    const yard = shownHostiles(w, owner, 100, field, strategy);
    if (homeScore >= 0.04) return false;
    if (yard.onHomePad > 0 || yard.inYard > 0) return false;
    if ((yard.shown | 0) > 0) return false;
  }

  if (when.winIntent) {
    if (tick < (when.tickGte ?? MIN * 4)) return false;
    if (militaryCount(w, owner) < (when.militaryGte ?? 3)) return false;
    if (homeScore >= 0.15) return false;
    const yard = shownHostiles(w, owner, 90, field, strategy);
    if (yard.onHomePad > 0) return false;
    const seenContest = (yard.enemyScore | 0) > 0 || yard.onEnemyPad > 0;
    const calmHome = homeScore < 0.06 && yard.inYard <= 1;
    if (!seenContest && !calmHome) return false;
  }

  return true;
}

/**
 * @typedef {{ patch: object, desires: string[], fired: number[], lastFire: number[] }} AiScriptRuntime
 */

/**
 * @param {object} w
 * @param {{ owner: number, script?: AiScriptRule[] }} entry
 * @param {AiScriptRuntime} runtime
 */
export function advanceAiScript(w, entry, runtime, field = null) {
  const rules = entry?.script;
  if (!Array.isArray(rules) || !rules.length) return;
  const owner = entry.owner | 0;
  if (!runtime.patch) runtime.patch = {};
  if (!runtime.desires) runtime.desires = [];
  if (!runtime.fired) runtime.fired = [];
  if (!runtime.lastFire) runtime.lastFire = [];

  for (let r = 0; r < rules.length; r++) {
    const rule = rules[r];
    if (!rule?.patch) continue;
    const once = rule.once !== false && rule.cooldownTicks == null;
    if (once && runtime.fired[r]) continue;
    const cd = rule.cooldownTicks | 0;
    if (cd > 0 && (w.tick | 0) - (runtime.lastFire[r] | 0) < cd) continue;
    if (!matchAiWhen(w, owner, rule.when, field, { ...entry, _scriptPatch: runtime.patch })) continue;
    mergeAiPatch(runtime.patch, rule.patch);
    if (rule.patch.desiresAdd) {
      runtime.desires = mergeDesireIds(runtime.desires, rule.patch.desiresAdd);
    }
    if (once) runtime.fired[r] = 1;
    if (cd > 0) runtime.lastFire[r] = w.tick | 0;
  }
}

/**
 * @param {object} w
 * @param {object} entry
 * @param {AiScriptRuntime} runtime
 */
export function effectiveAiEntry(w, entry, runtime, field = null) {
  if (!entry?.script?.length) return entry;
  advanceAiScript(w, entry, runtime, field);
  const { desiresAdd, ...patch } = runtime.patch;
  return { ...entry, ...patch, desires: runtime.desires };
}

/**
 * @param {number} owner
 * @param {{ temperament?: string, difficulty?: number | string, script?: AiScriptRule[] | null }} [opts]
 */
export function matchAiPlayer(owner, opts = {}) {
  const row = {
    owner: owner | 0,
    temperament: opts.temperament ?? 'passive',
    vision: opts.vision ?? 'fair',
  };
  if (opts.difficulty != null) row.difficulty = opts.difficulty;
  if (opts.script !== null) {
    row.script = opts.script ?? FREEPLAY_SKIRM_SCRIPT;
  }
  return row;
}

/** Baseline opponent for the loading / wait skirmish. */
export function freeplaySkirmAiPlayer(owner) {
  return matchAiPlayer(owner, { temperament: 'passive' });
}
