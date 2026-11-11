// Match / stress AI - roster helpers plus army-stance commands.
//
// Economy and spend paths live in aiEconomy.js. This file only issues army
// orders (hold / defend yard / opt-in attack). Unit sim does the rest.
// Same command objects as input.

import * as fx from './fixed.js';
import { CMD } from './commands.js';
import { getUnitDef } from './unitTypes.js';
import { isHostile } from './teams.js';
import { rngU32 } from './rng.js';
import { ABILITY } from './abilities.js';
import { canCastAbility } from './mana.js';
import { agoraForOwner } from './agora.js';
import { matchAiPlayer } from './aiScript.js';

import {
  AI_STANCE,
  ARMY_DECIDE_INTERVAL,
  captureIntent,
  replyCount,
  resolveAiStrategy,
} from './aiStrategy.js';
import { aiUsesFairVision, entitySeenByOwner, worldPointSeenByOwner } from './matchVision.js';

export {
  AI_DIFFICULTY,
  AI_PATH,
  AI_STANCE,
  AI_STRATEGIES,
  ARMY_DECIDE_INTERVAL,
  captureIntent,
  parseAiDifficulty,
  replyCount,
  shownHostiles,
  resolveAiStrategy,
} from './aiStrategy.js';

/** 1vAI pool - strategy labels, not a-move cadences. */
export const MATCH_AI_TEMPERAMENTS = ['passive', 'cautious', 'steady', 'aggressive', 'reckless'];

/**
 * Same count as the player's pads. Membership is not saved: slot 0 is the
 * oldest `size` military units, slot 1 the next band, and so on. A death
 * promotes the next veteran, so a group stays filled without a second list.
 * Only the first AI_ROAM_GROUP_SLOTS bands are ordered. The rest are the garrison.
 */
export const AI_CONTROL_GROUP_COUNT = 6;
/** One roaming band for now. Raise this, up to AI_CONTROL_GROUP_COUNT, for more. */
export const AI_ROAM_GROUP_SLOTS = 1;

const ROAM_HEADINGS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Stress FFA still pushes (no eco). Match AI does not inherit this. */
export const STRESS_AI_PROFILES = [
  { owner: 1, temperament: 'cautious', economy: false, stance: AI_STANCE.ATTACK },
  { owner: 2, temperament: 'steady', economy: false, stance: AI_STANCE.ATTACK },
  { owner: 3, temperament: 'aggressive', economy: false, stance: AI_STANCE.ATTACK },
  { owner: 4, temperament: 'reckless', economy: false, stance: AI_STANCE.ATTACK },
];

/** Deterministic pick from a match seed (or any u32). */
export function pickMatchAiTemperament(u32 = 0) {
  const i = (u32 >>> 0) % MATCH_AI_TEMPERAMENTS.length;
  return MATCH_AI_TEMPERAMENTS[i];
}

/** Fog overlay only - combat stays FFA. Skip the turtle so its base stays dark. */
export function stressShareVisionOwners() {
  const out = [];
  for (let i = 0; i < STRESS_AI_PROFILES.length; i++) {
    const p = STRESS_AI_PROFILES[i];
    if (p.temperament === 'passive' || p.temperament === 'cautious') continue;
    out.push(p.owner | 0);
  }
  return out;
}

/** Owner id for an aiPlayers entry (number or `{ owner }`). */
export function aiOwnerOf(entry) {
  if (typeof entry === 'number') return entry | 0;
  if (entry && typeof entry === 'object') return entry.owner | 0;
  return -1;
}

/**
 * Drop AI entries that would puppet a human lockstep slot.
 * Slot 1 is both the loading-screen AI_OWNER and the first KOTH joiner.
 * @param {Array<number | { owner: number }>} [aiPlayers]
 * @param {number[]} [humanPlayers]
 */
export function excludeHumanAiPlayers(aiPlayers, humanPlayers) {
  const humans = new Set((humanPlayers ?? []).map((id) => id | 0));
  const out = [];
  for (const entry of aiPlayers ?? []) {
    const owner = aiOwnerOf(entry);
    if (owner < 0 || humans.has(owner)) continue;
    out.push(entry);
  }
  return out;
}

/** Lobby seats win when the same owner is also painted in the garden. */
export function mergeAiPlayers(primary, extra) {
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    const owner = aiOwnerOf(entry);
    if (owner < 0 || seen.has(owner)) return;
    seen.add(owner);
    out.push(entry);
  };
  for (const entry of primary ?? []) add(entry);
  for (const entry of extra ?? []) add(entry);
  return out;
}

/**
 * Garden `ap` rows: [owner, temperament]. Stand (no row) stays semi-reactive.
 * No freeplay script, so the personality is the one the map asked for.
 * @param {unknown} rows
 */
export function aiPlayersFromOwnerIntents(rows) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const owner = row[0] | 0;
    const temperament = String(row[1] ?? '');
    if (owner < 0 || owner > 15 || seen.has(owner)) continue;
    if (!MATCH_AI_TEMPERAMENTS.includes(temperament)) continue;
    seen.add(owner);
    out.push(matchAiPlayer(owner, { temperament, script: null }));
  }
  return out;
}

/**
 * Resolve the AI list for a session (re)start.
 * Live P2P KOTH defaults to no AI so the loading-screen passive opponent
 * cannot survive into the match and drive the first joiner (owner 1).
 * @param {{ mode?: string, localSolo?: boolean, aiPlayers?: Array|undefined, humanPlayers?: number[] }} [cfg]
 * @param {Array} [current]
 */
export function resolveSessionAiPlayers(cfg = {}, current = []) {
  let list;
  if (cfg.aiPlayers !== undefined) list = cfg.aiPlayers ?? [];
  else if (cfg.mode === 'koth' && !cfg.localSolo) list = [];
  else list = current ?? [];
  return excludeHumanAiPlayers(list, cfg.humanPlayers);
}

/**
 * @param {object} world
 * @param {number | { owner: number, temperament?: string, stance?: string }} aiConfig
 * @param {number | { temperament?: string }} [opts] - legacy 3rd arg was playerOwner (ignored)
 * @returns {import('./commands.js').Command[]}
 */
/**
 * @param {object} world
 * @param {number | object} aiConfig
 * @param {object | null} [field]
 * @param {object} [opts]
 */
export function generateAiCommands(world, aiConfig, field = null, opts = {}) {
  if (aiConfig == null) return [];
  let entry = aiConfig;
  if (typeof aiConfig === 'number' && opts && typeof opts === 'object' && opts.temperament) {
    entry = { owner: aiConfig, temperament: opts.temperament };
  }
  const strategy = resolveAiStrategy(entry);
  const aiOwner = strategy.owner;
  if (aiOwner < 0) return [];
  const capture = captureIntent(world, strategy, field);
  if (strategy.stance === AI_STANCE.HOLD && !capture.guard) return [];

  const interval = capture.urgent ? strategy.reactInterval : ARMY_DECIDE_INTERVAL;
  const phase = (aiOwner * 7) % interval;
  if (world.tick % interval !== phase) return [];

  const army = militaryCentroid(world, aiOwner);
  if (!army) return [];

  const threat = pickArmyAim(world, aiOwner, strategy, army, capture, field);
  if (!threat) return [];

  /** @type {import('./commands.js').Command[]} */
  const cmds = [];
  if (threat.ambition) {
    const size = roamGroupSize(strategy.heat);
    const slots = AI_ROAM_GROUP_SLOTS;
    for (let slot = 0; slot < slots; slot++) {
      const ids = aiControlGroup(world, aiOwner, slot, size);
      if (!ids.length || groupEngaged(world, ids)) continue;
      const dest = threat.wander ? wanderDest(world, ids, threat.roll, slot) : threat;
      if (dest) pushAttackMove(cmds, world, ids, dest);
    }
  } else {
    const want = strategy.stance === AI_STANCE.ATTACK
      ? 0x7fffffff
      : replyCount(Math.max(capture.shown, 1), 0x7fffffff, strategy.heat);
    const ids = pickReplyIds(world, aiOwner, threat, want, capture.reissue);
    if (ids.length) pushAttackMove(cmds, world, ids, threat);
  }

  const casts = collectCasts(world, aiOwner, strategy);
  for (let c = 0; c < casts.length; c++) cmds.push(casts[c]);
  return cmds;
}

function homePoint(world, owner) {
  const a = agoraForOwner(world.agoras, owner);
  return a ? { x: a.x, y: a.z } : null;
}

function pickArmyAim(world, aiOwner, strategy, army, capture, field) {
  if (capture.guard && capture.home) {
    return hostileCentroid(world, aiOwner, capture.home, 22, field, strategy)
      ?? { x: capture.home.x, y: capture.home.z };
  }
  if (capture.contest) {
    return hostileCentroid(world, aiOwner, capture.contest, 22, field, strategy)
      ?? { x: capture.contest.x, y: capture.contest.z };
  }
  if (strategy.stance === AI_STANCE.ATTACK) {
    return hostileCentroid(world, aiOwner, null, 0, field, strategy);
  }
  if (strategy.stance === AI_STANCE.HOLD) return null;
  const near = hostileCentroid(
    world,
    aiOwner,
    homePoint(world, aiOwner) ?? army,
    strategy.defendRangeF,
    field,
    strategy,
  );
  if (near) return near;
  return ambitionSeek(world, aiOwner, strategy, field);
}

/**
 * Oldest living military units in band `slot`. Slot 0 is control group 1.
 * @param {object} world
 * @param {number} owner
 * @param {number} slot
 * @param {number} size
 * @returns {number[]}
 */
export function aiControlGroup(world, owner, slot, size) {
  const band = slot | 0;
  const n = size | 0;
  if (band < 0 || band >= AI_CONTROL_GROUP_COUNT || n <= 0) return [];
  const ids = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== (owner | 0)) continue;
    if (getUnitDef(world.type[i]).category !== 'military') continue;
    ids.push(i);
  }
  const start = band * n;
  if (start >= ids.length) return [];
  return ids.slice(start, start + n);
}

function roamGroupSize(heat) {
  return (heat | 0) >= 4 ? 6 : 4;
}

function groupEngaged(world, ids) {
  const attack = world.ORDER.ATTACK;
  for (let k = 0; k < ids.length; k++) {
    if (world.order[ids[k]] === attack) return true;
  }
  return false;
}

function pushAttackMove(cmds, world, ids, dest) {
  const aim = militaryCentroidOf(world, ids);
  if (!aim) return;
  const n = ids.length;
  const tx = new Array(n);
  const ty = new Array(n);
  for (let k = 0; k < n; k++) {
    const i = ids[k];
    tx[k] = dest.x + (world.px[i] - aim.x);
    ty[k] = dest.y + (world.py[i] - aim.y);
  }
  cmds.push({ type: CMD.ATTACK_MOVE, entities: ids, tx, ty });
}

/** A short step from where the band already is. Slot salts the heading. */
function wanderDest(world, ids, roll, slot) {
  const c = militaryCentroidOf(world, ids);
  if (!c) return null;
  const mixed = (roll ^ Math.imul((slot | 0) + 1, 0x9e3779b1)) >>> 0;
  const dir = ROAM_HEADINGS[(mixed >>> 8) & 7];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const dist = 36 + ((mixed >>> 12) & 31);
  return {
    x: c.x + fx.fromFloat((dir[0] / len) * dist),
    y: c.y + fx.fromFloat((dir[1] / len) * dist),
  };
}

/**
 * Heat 3 and 4 only. One draw from the shared sim rng on a quiet decide tick.
 * Reckless seeks on 4/8 and wanders on 2/8. Aggressive seeks on 2/8 and wanders
 * on 1/8. The order goes to the roaming control group, not the garrison.
 * Home guard and a live pad still win, and they use the whole army.
 * Armies and buildings have to be seen. Agoras are public, same as the map.
 * @returns {{ x?: number, y?: number, ambition: true, wander?: boolean, roll: number } | null}
 */
function ambitionSeek(world, aiOwner, strategy, field) {
  const heat = strategy.heat | 0;
  if (heat < 3) return null;
  const roll = rngU32(world.rng);
  const bucket = roll % 8;
  let seek = false;
  let wander = false;
  if (heat >= 4) {
    seek = bucket < 4;
    wander = bucket >= 4 && bucket < 6;
  } else {
    seek = bucket < 2;
    wander = bucket === 2;
  }
  if (!seek && !wander) return null;
  if (seek) {
    const found = militaryObjective(world, aiOwner, strategy, field);
    if (found) return { x: found.x, y: found.y, ambition: true, roll };
  }
  return { ambition: true, wander: true, roll };
}

function militaryObjective(world, aiOwner, strategy, field) {
  const fair = aiUsesFairVision(strategy) && field;
  const home = homePoint(world, aiOwner);
  const ox = home ? home.x : 0;
  const oy = home ? home.y : 0;
  let bestX = 0;
  let bestY = 0;
  let bestD = 0;
  let found = false;
  const take = (x, y) => {
    const dx = x - ox;
    const dy = y - oy;
    const d = fx.mul(dx, dx) + fx.mul(dy, dy);
    if (!found || d < bestD) {
      found = true;
      bestD = d;
      bestX = x;
      bestY = y;
    }
  };
  for (let j = 0; j < world.count; j++) {
    if (!world.alive[j] || !isHostile(aiOwner, world.owner[j])) continue;
    if (getUnitDef(world.type[j]).category !== 'military') continue;
    if (fair && !entitySeenByOwner(world, field, aiOwner, j)) continue;
    take(world.px[j], world.py[j]);
  }
  if (found) return { x: bestX, y: bestY, ambition: true };
  const buildings = world.buildings;
  if (buildings) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || (b.hp ?? 1) <= 0) continue;
      if (!isHostile(aiOwner, b.owner | 0)) continue;
      if (fair && !worldPointSeenByOwner(world, field, aiOwner, b.x, b.z)) continue;
      take(b.x, b.z);
    }
  }
  if (found) return { x: bestX, y: bestY, ambition: true };
  const agoras = world.agoras;
  if (agoras) {
    for (let i = 0; i < agoras.length; i++) {
      const g = agoras[i];
      if (!g || !isHostile(aiOwner, g.owner | 0)) continue;
      take(g.x, g.z);
    }
  }
  if (!found) return null;
  return { x: bestX, y: bestY, ambition: true };
}

function pickReplyIds(world, owner, aim, want, reissue) {
  const pool = [];
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== owner) continue;
    if (getUnitDef(world.type[i]).category !== 'military') continue;
    if (
      !reissue
      && (world.order[i] === world.ORDER.ATTACK || world.order[i] === world.ORDER.ATTACK_MOVE)
    ) {
      continue;
    }
    pool.push(i);
  }
  if (pool.length <= want) return pool;
  pool.sort((a, b) => {
    const da = fx.dist2(world.px[a], world.py[a], aim.x, aim.y);
    const db = fx.dist2(world.px[b], world.py[b], aim.x, aim.y);
    return da !== db ? da - db : a - b;
  });
  return pool.slice(0, want);
}

function militaryCentroidOf(world, ids) {
  if (!ids.length) return null;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    sx += world.px[i];
    sy += world.py[i];
  }
  return { x: fx.div(sx, fx.fromInt(ids.length)), y: fx.div(sy, fx.fromInt(ids.length)) };
}

function militaryCount(world, owner) {
  let n = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== owner) continue;
    if (getUnitDef(world.type[i]).category !== 'military') continue;
    n++;
  }
  return n;
}

function militaryCentroid(world, owner) {
  let sx = 0;
  let sy = 0;
  let sc = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i] || world.owner[i] !== owner) continue;
    const def = getUnitDef(world.type[i]);
    if (def.category !== 'military') continue;
    sx += world.px[i];
    sy += world.py[i];
    sc++;
  }
  if (sc === 0) return null;
  return { x: fx.div(sx, fx.fromInt(sc)), y: fx.div(sy, fx.fromInt(sc)) };
}

/**
 * @param {object} world
 * @param {number} aiOwner
 * @param {{ x: number, y: number } | null} origin
 * @param {number} rangeF
 */
function hostileCentroid(world, aiOwner, origin, rangeF, field = null, strategy = null) {
  const fair = aiUsesFairVision(strategy) && field;
  const range2 = rangeF > 0 ? fx.mul(fx.fromFloat(rangeF), fx.fromFloat(rangeF)) : 0;
  let ex = 0;
  let ey = 0;
  let ec = 0;
  for (let j = 0; j < world.count; j++) {
    if (!world.alive[j] || !isHostile(aiOwner, world.owner[j])) continue;
    if (fair && !entitySeenByOwner(world, field, aiOwner, j)) continue;
    if (origin && rangeF > 0) {
      const dx = world.px[j] - origin.x;
      const dy = world.py[j] - origin.y;
      if (fx.mul(dx, dx) + fx.mul(dy, dy) > range2) continue;
    }
    ex += world.px[j];
    ey += world.py[j];
    ec++;
  }
  if (ec === 0) return null;
  return { x: fx.div(ex, fx.fromInt(ec)), y: fx.div(ey, fx.fromInt(ec)) };
}

/**
 * Aim point for an offensive cast - current combat target only.
 * Skipping the FFA enemy centroid avoids every caster dumping on map-middle.
 * @returns {{ x: number, y: number } | null}
 */
function castAimPoint(world, caster, aiOwner) {
  const t = world.targetEntity[caster];
  if (
    t < 0 ||
    t >= world.count ||
    !world.alive[t] ||
    !isHostile(aiOwner, world.owner[t])
  ) {
    return null;
  }
  return { x: world.px[t], y: world.py[t] };
}

/**
 * @param {object} world
 * @param {number} aiOwner
 * @param {{ castChance: number, castCap: number }} temper
 * @returns {import('./commands.js').Command[]}
 */
function collectCasts(world, aiOwner, temper) {
  /** @type {import('./commands.js').Command[]} */
  const out = [];
  let castCount = 0;
  for (let i = 0; i < world.count; i++) {
    if (castCount >= temper.castCap) break;
    if (!world.alive[i] || world.owner[i] !== aiOwner) continue;
    if (!canCastAbility(world, i)) continue;
    const def = getUnitDef(world.type[i]);
    if (!def.primaryAbility) continue;
    if (def.category !== 'military') continue;
    if ((rngU32(world.rng) % 100) >= temper.castChance) continue;

    let tx;
    let ty;
    if (def.primaryAbility === ABILITY.HOLY_ARMOR) {
      tx = world.px[i];
      ty = world.py[i];
    } else {
      const aim = castAimPoint(world, i, aiOwner);
      if (!aim) continue;
      tx = aim.x;
      ty = aim.y;
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
