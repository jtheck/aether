// Match AI strategy — what to spend on, and how the standing army behaves.
//
// Unit sim stays the last mile (aggro, combat, pathing). This layer only
// issues the same group commands a human could: gather, place, train,
// research, and the occasional army attack-move.
//
// Temperament names stay as labels on these forks.

import * as fx from './fixed.js';
import { agoraCaptureScore, agoraForOwner, AGORA_OCCUPATION_RADIUS } from './agora.js';
import { isHostile } from './teams.js';
import { getUnitDef } from './unitTypes.js';

export const AI_STANCE = {
  /** No army orders — unit sim aggro is the only fight. */
  HOLD: 'hold',
  /** Intercept hostiles in the agora yard. Never F2 the map. */
  DEFEND: 'defend',
  /** Push the army at the enemy centroid (opt-in; stress FFA). */
  ATTACK: 'attack',
};

export const AI_PATH = {
  /** Village / farm-ring / camp / mine / silo. The skirmish partner. */
  ECO: 'eco',
  /** Eco baseline, then barracks / tavern and a little training. */
  ARMY: 'army',
  /** Eco baseline, then lab / moonwell and a tech. */
  TECH: 'tech',
};

/** How often army stance reconsiders (ticks). Phased per owner. */
export const ARMY_DECIDE_INTERVAL = 40;

/**
 * User-facing competence (how well they play the bank). Heat stays
 * personality — how loud they answer a fight. Defaults ride together
 * until a menu splits them.
 */
export const AI_DIFFICULTY = {
  EASY: 0,
  CASUAL: 1,
  NORMAL: 2,
  HARD: 3,
  EXPERT: 4,
};

const DIFFICULTY_BY_NAME = {
  easy: AI_DIFFICULTY.EASY,
  casual: AI_DIFFICULTY.CASUAL,
  normal: AI_DIFFICULTY.NORMAL,
  medium: AI_DIFFICULTY.NORMAL,
  hard: AI_DIFFICULTY.HARD,
  expert: AI_DIFFICULTY.EXPERT,
  brutal: AI_DIFFICULTY.EXPERT,
};

/** @param {unknown} raw @param {number} [fallback] */
export function parseAiDifficulty(raw, fallback = AI_DIFFICULTY.NORMAL) {
  if (raw == null) return fallback | 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(4, raw | 0));
  }
  const named = DIFFICULTY_BY_NAME[String(raw).toLowerCase()];
  return named != null ? named : fallback | 0;
}

/**
 * @typedef {{
 *   economy: boolean,
 *   path: string,
 *   stance: string,
 *   heat: number,
 *   difficulty: number,
 *   guardAt: number,
 *   reactInterval: number,
 *   defendRangeF: number,
 *   castChance: number,
 *   castCap: number,
 * }} AiStrategyDef
 */

/** @type {Record<string, AiStrategyDef>} */
export const AI_STRATEGIES = {
  // Opening-skirmish partner: farm art, ignores the capture bar.
  passive: {
    economy: true,
    path: AI_PATH.ECO,
    stance: AI_STANCE.HOLD,
    heat: 0,
    difficulty: AI_DIFFICULTY.EASY,
    guardAt: 9,
    reactInterval: 40,
    defendRangeF: 0,
    castChance: 0,
    castCap: 0,
  },
  // Protects home once the lock bar is obviously filling. No raid on theirs.
  cautious: {
    economy: true,
    path: AI_PATH.TECH,
    stance: AI_STANCE.DEFEND,
    heat: 1,
    difficulty: AI_DIFFICULTY.CASUAL,
    guardAt: 0.35,
    reactInterval: 40,
    defendRangeF: 70,
    castChance: 12,
    castCap: 3,
  },
  // Home pad is sacred; trains extra if it's ringing. Still won't march to theirs.
  steady: {
    economy: true,
    path: AI_PATH.ARMY,
    stance: AI_STANCE.DEFEND,
    heat: 2,
    difficulty: AI_DIFFICULTY.NORMAL,
    guardAt: 0.08,
    reactInterval: 32,
    defendRangeF: 90,
    castChance: 20,
    castCap: 5,
  },
  // Guards immediately; piles onto an enemy pad that's already being taken.
  aggressive: {
    economy: true,
    path: AI_PATH.ARMY,
    stance: AI_STANCE.DEFEND,
    heat: 3,
    difficulty: AI_DIFFICULTY.HARD,
    guardAt: 0.01,
    reactInterval: 20,
    defendRangeF: 120,
    castChance: 28,
    castCap: 6,
  },
  // Angryboi — same facts, louder reply. Still only answers what was shown.
  reckless: {
    economy: true,
    path: AI_PATH.ARMY,
    stance: AI_STANCE.DEFEND,
    heat: 4,
    difficulty: AI_DIFFICULTY.EXPERT,
    guardAt: 0,
    reactInterval: 16,
    defendRangeF: 140,
    castChance: 36,
    castCap: 7,
  },
};

/**
 * @param {number | { owner?: number, temperament?: string, economy?: boolean, stance?: string, path?: string, difficulty?: number | string }} entry
 * @returns {{ owner: number, temperament: string } & AiStrategyDef}
 */
export function resolveAiStrategy(entry) {
  let owner = -1;
  let temperament = 'steady';
  /** @type {boolean | undefined} */
  let economyOverride;
  /** @type {string | undefined} */
  let stanceOverride;
  /** @type {string | undefined} */
  let pathOverride;
  /** @type {number | string | undefined} */
  let difficultyOverride;
  if (typeof entry === 'number') {
    owner = entry | 0;
  } else if (entry && typeof entry === 'object') {
    owner = entry.owner | 0;
    if (entry.temperament) temperament = String(entry.temperament);
    if (entry.economy != null) economyOverride = !!entry.economy;
    if (entry.stance) stanceOverride = String(entry.stance);
    if (entry.path) pathOverride = String(entry.path);
    if (entry.difficulty != null) difficultyOverride = entry.difficulty;
  }
  const base = AI_STRATEGIES[temperament] || AI_STRATEGIES.steady;
  return {
    owner,
    temperament,
    economy: economyOverride != null ? economyOverride : base.economy,
    path: pathOverride || base.path,
    stance: stanceOverride || base.stance,
    heat: base.heat,
    difficulty: parseAiDifficulty(
      difficultyOverride,
      base.difficulty ?? base.heat,
    ),
    guardAt: base.guardAt,
    reactInterval: base.reactInterval,
    defendRangeF: base.defendRangeF,
    castChance: base.castChance,
    castCap: base.castCap,
  };
}

/**
 * What hostiles have put on the table this tick — pads and the yard.
 * No memory: they only know what is showing. Sitting on a quiet enemy
 * pad is not a show (that pad's bar is dark).
 */
export function shownHostiles(w, owner, defendRangeF = 0) {
  const home = agoraForOwner(w.agoras, owner);
  const pad2 = fx.mul(AGORA_OCCUPATION_RADIUS, AGORA_OCCUPATION_RADIUS);
  const yardR = defendRangeF > 0 ? fx.fromFloat(defendRangeF) : 0;
  const yard2 = yardR ? fx.mul(yardR, yardR) : 0;
  let onHomePad = 0;
  let inYard = 0;
  let onEnemyPad = 0;
  let enemyScore = 0;
  const liveEnemy = [];
  const agoras = w.agoras;
  if (agoras) {
    for (let i = 0; i < agoras.length; i++) {
      const a = agoras[i];
      if ((a.owner | 0) === owner || (a.founder | 0) === owner) continue;
      const s = agoraCaptureScore(a);
      if (s > enemyScore) enemyScore = s;
      if (s > 0) liveEnemy.push(a);
    }
  }
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || !isHostile(owner, w.owner[i])) continue;
    const military = getUnitDef(w.type[i]).category === 'military';
    if (home) {
      const d = fx.dist2(w.px[i], w.py[i], home.x, home.z);
      if (d <= pad2) onHomePad++;
      if (military && yard2 && d <= yard2) inYard++;
    }
    if (!liveEnemy.length) continue;
    for (let p = 0; p < liveEnemy.length; p++) {
      const a = liveEnemy[p];
      if (fx.dist2(w.px[i], w.py[i], a.x, a.z) <= pad2) {
        onEnemyPad++;
        break;
      }
    }
  }
  const homeScore = agoraCaptureScore(home);
  return {
    onHomePad,
    inYard,
    onEnemyPad,
    shown: Math.max(onHomePad, inYard, onEnemyPad),
    enemyScore,
    padPlay: onHomePad > 0 || homeScore > 0 || enemyScore > 0,
  };
}

/** How many of ours answer `shown` hostiles. Heat is the overpay. */
export function replyCount(shown, have, heat) {
  const h = heat | 0;
  const s = shown | 0;
  if (h <= 0 || have <= 0 || s <= 0) return 0;
  const mul = h <= 1 ? 1 : h === 2 ? 1.25 : h === 3 ? 1.75 : 3;
  return Math.min(have, Math.max(1, Math.ceil(s * mul)));
}

/**
 * Capture + raid read. Answers only what is on the board; heat is the overpay.
 * @param {object} w
 * @param {{ owner: number, heat: number, guardAt: number, defendRangeF?: number }} strategy
 */
export function captureIntent(w, strategy) {
  const owner = strategy.owner | 0;
  const home = agoraForOwner(w.agoras, owner);
  const homeScore = agoraCaptureScore(home);
  const shown = shownHostiles(w, owner, strategy.defendRangeF ?? 0);
  // Quiet pad scores 0 — never treat "any agora exists" as a show.
  const guard = homeScore > 0 && homeScore >= (strategy.guardAt ?? 9);
  const occupyEnds = (w.agoraOccupyEndsMatch ?? 1) !== 0;
  const contest = pickContestAgora(w, owner, strategy.heat, occupyEnds, homeScore, shown);
  return {
    home,
    homeScore,
    shown: shown.shown,
    padPlay: shown.padPlay,
    guard,
    contest,
    urgent: guard || !!contest,
    reissue: guard || !!contest,
  };
}

function pickContestAgora(w, owner, heat, occupyEnds, homeScore, shown) {
  if (heat < 3) return null;
  if (!shown.padPlay) return null;
  if (!occupyEnds && heat < 4) return null;
  if (homeScore >= 1 && heat < 4) return null;
  const agoras = w.agoras;
  if (!agoras) return null;
  let best = null;
  let bestScore = 0;
  for (let i = 0; i < agoras.length; i++) {
    const a = agoras[i];
    if ((a.owner | 0) === owner || (a.founder | 0) === owner) continue;
    if ((a.captured | 0)) continue;
    const score = agoraCaptureScore(a);
    if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}
