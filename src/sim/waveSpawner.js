// Deterministic reinforcement waves for the adventure campaign.
//
// Two roles, one code path:
//   • Enemy waves — from `survive`/`defend` objectives (params.waves). Hostile
//     owner-4 attackers that muster near the point (ring) or march an authored
//     route, escalating in size, drawn from a per-era roster.
//   • Allied waves — from any objective's `params.allies`. Friendly team-0
//     reinforcements that spawn on your side and attack-rally across the map.
//
// Everything reads only world.tick and world.rng, so all lockstep clients spawn
// identical units at identical ticks. Objective completion still lives client-side.

import * as fx from './fixed.js';
import { ORDER, spawn, MAX_ENTITIES } from './world.js';
import { queuePath } from './path.js';
import { snapToPassable, TILE_SIZE_F } from './field.js';
import { rngFrac, rngRange } from './rng.js';
import { UNIT } from './unitTypes.js';

/** Owner id for campaign hostiles (outside the 4-seat ally table). */
export const WAVE_ENEMY_OWNER = 4;
/** Team-0 slot used for scripted allied reinforcements (visible + friendly). */
export const WAVE_ALLY_OWNER = 2;
/** Grace before the first wave (ticks @ 20 Hz) — clears the intro cinematic. */
export const WAVE_FIRST_DELAY_TICKS = 160;
/** Cadence between waves (ticks @ 20 Hz) — matches the client hold-out timer (12s). */
export const WAVE_INTERVAL_TICKS = 240;
export const WAVE_BASE_COUNT = 3;
export const WAVE_MAX_COUNT = 8;

const WAVE_KINDS = new Set(['survive', 'defend']);
const { WARRIOR, ARCHER, WARLOCK, WIZARD, SHAMAN, MONK } = UNIT;

/**
 * Per-episode enemy rosters. Casters ramp in from mid-campaign and stay a
 * minority; early episodes are steel-and-bows only.
 */
const ROSTERS = {
  1: { base: [WARRIOR, ARCHER], caster: [], casterPct: 0, casterWave: 99 },
  2: { base: [WARRIOR, ARCHER], caster: [WARLOCK], casterPct: 15, casterWave: 2 },
  3: { base: [WARRIOR, ARCHER], caster: [WIZARD], casterPct: 15, casterWave: 2 },
  4: { base: [WARRIOR, ARCHER, MONK], caster: [WARLOCK], casterPct: 20, casterWave: 1 },
  5: { base: [WARRIOR, ARCHER, MONK], caster: [WARLOCK, WIZARD, SHAMAN], casterPct: 30, casterWave: 0 },
};
const DEFAULT_ROSTER = { base: [WARRIOR, ARCHER], caster: [WARLOCK], casterPct: 15, casterWave: 1 };
const ALLY_ROSTER = { base: [WARRIOR, ARCHER], caster: [], casterPct: 0, casterWave: 99 };

function rosterForEra(era) {
  return ROSTERS[era | 0] || DEFAULT_ROSTER;
}

/** Eight compass approach vectors — no trig, so positions stay engine-stable. */
const DIRS = [
  [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
];

function worldHalfF(field) {
  return field?.worldHalfF ?? (field.width * TILE_SIZE_F) / 2;
}

function objectiveCenterF(obj, field) {
  const half = worldHalfF(field);
  return {
    cx: fx.fromFloat(((obj.tx | 0) + 0.5) * TILE_SIZE_F - half),
    cz: fx.fromFloat(((obj.tz | 0) + 0.5) * TILE_SIZE_F - half),
  };
}

/** Fractional board coord (0..1) → Q16.16 world point. */
function worldFromFrac(fxFrac, fzFrac, field) {
  const half = worldHalfF(field);
  const tx = Math.max(0, Math.min(field.width - 1, Math.round((Number(fxFrac) || 0) * (field.width - 1))));
  const tz = Math.max(0, Math.min(field.height - 1, Math.round((Number(fzFrac) || 0) * (field.height - 1))));
  return {
    x: fx.fromFloat((tx + 0.5) * TILE_SIZE_F - half),
    z: fx.fromFloat((tz + 0.5) * TILE_SIZE_F - half),
  };
}

/**
 * Authored approach waypoints (fractional) → Q16.16. route[0] is the staging
 * point where the wave forms up; the rest chain as rally hops toward the target.
 * Capped at 3 (staging + 2 dests), matching the engine's two-hop rally limit.
 */
function resolveRoute(raw, field) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const wp of list.slice(0, 3)) {
    if (Array.isArray(wp) && wp.length >= 2) out.push(worldFromFrac(wp[0], wp[1], field));
  }
  return out;
}

/**
 * Build world.waveSpawners from a garden's objectives. Call once, at world init,
 * after placements. No-op (world.waveSpawners = null) when nothing spawns.
 */
export function setupWaveSpawners(world, field, objectives) {
  const spawners = [];
  for (const obj of objectives || []) {
    const p = obj?.params || {};
    // Enemy waves — tied to a survive/defend objective's location.
    const waves = p.waves | 0;
    if (WAVE_KINDS.has(obj?.kind) && waves > 0) {
      const { cx, cz } = objectiveCenterF(obj, field);
      const ringTiles = Math.max(6, (obj.r | 0) + 6);
      spawners.push({
        owner: WAVE_ENEMY_OWNER,
        cx,
        cz,
        ringF: fx.fromFloat(ringTiles * TILE_SIZE_F),
        waves,
        count: WAVE_BASE_COUNT,
        interval: WAVE_INTERVAL_TICKS,
        spawned: 0,
        nextTick: WAVE_FIRST_DELAY_TICKS,
        baseDir: ((obj.tx | 0) + (obj.tz | 0)) & 7,
        route: resolveRoute(p.route, field),
        roster: rosterForEra(p.era),
      });
    }
    // Allied reinforcements — spawn on our side, attack-rally across the map.
    for (const ally of Array.isArray(p.allies) ? p.allies : []) {
      if (!Array.isArray(ally?.from) || !Array.isArray(ally?.to)) continue;
      const target = worldFromFrac(ally.to[0], ally.to[1], field);
      spawners.push({
        owner: (ally.owner ?? WAVE_ALLY_OWNER) | 0,
        cx: target.x,
        cz: target.z,
        ringF: fx.fromFloat(6 * TILE_SIZE_F),
        waves: Math.max(1, ally.waves | 0),
        count: Math.max(1, ally.count | 0) || WAVE_BASE_COUNT,
        interval: (ally.interval | 0) > 0 ? (ally.interval | 0) * 20 : WAVE_INTERVAL_TICKS,
        spawned: 0,
        nextTick: (ally.delay | 0) > 0 ? (ally.delay | 0) * 20 : WAVE_FIRST_DELAY_TICKS,
        baseDir: 0,
        route: resolveRoute([ally.from], field),
        roster: ALLY_ROSTER,
      });
    }
  }
  world.waveSpawners = spawners.length ? spawners : null;
  return world;
}

function waveUnitType(world, waveIndex, roster) {
  const r = roster || DEFAULT_ROSTER;
  if (r.caster.length && waveIndex >= r.casterWave && rngRange(world.rng, 0, 100) < r.casterPct) {
    return r.caster[rngRange(world.rng, 0, r.caster.length)];
  }
  return r.base[rngRange(world.rng, 0, r.base.length)];
}

function spawnWave(world, field, s) {
  const waveIndex = s.spawned;
  const count = Math.min(WAVE_MAX_COUNT, (s.count || WAVE_BASE_COUNT) + waveIndex);
  const target = { x: s.cx, z: s.cz };

  // Staging point + remaining stop chain. With a route the wave forms up at
  // route[0] and marches route[1..] → target; otherwise it musters on a
  // rotating ring around the target and charges straight in.
  let stageX;
  let stageZ;
  let stops;
  if (s.route && s.route.length) {
    stageX = fx.toFloat(s.route[0].x);
    stageZ = fx.toFloat(s.route[0].z);
    stops = [...s.route.slice(1), target];
  } else {
    const dir = DIRS[(s.baseDir + waveIndex) % DIRS.length];
    const ring = fx.toFloat(s.ringF);
    stageX = fx.toFloat(s.cx) + dir[0] * ring;
    stageZ = fx.toFloat(s.cz) + dir[1] * ring;
    stops = [target];
  }

  let hx = fx.toFloat(stops[0].x) - stageX;
  let hz = fx.toFloat(stops[0].z) - stageZ;
  const hlen = Math.hypot(hx, hz) || 1;
  hx /= hlen;
  hz /= hlen;
  const perpX = -hz;
  const perpZ = hx;
  const spacing = 2.5 * TILE_SIZE_F;

  for (let k = 0; k < count; k++) {
    if (world.count >= MAX_ENTITIES - 1) break;
    const lane = (k - (count - 1) / 2) * spacing;
    const jitter = ((rngFrac(world.rng) / 65536) - 0.5) * spacing;
    let px = fx.fromFloat(stageX + perpX * lane + hx * jitter);
    let py = fx.fromFloat(stageZ + perpZ * lane + hz * jitter);
    if (field) {
      const snapped = snapToPassable(field, px, py);
      if (snapped) {
        px = snapped.x;
        py = snapped.y;
      }
    }
    const type = waveUnitType(world, waveIndex, s.roster);
    const i = spawn(world, { x: px, y: py, type, owner: s.owner });
    routeUnit(world, field, i, stops);
  }
}

/**
 * Attack-move to the first stop, then chain the rest as rally hops (max two).
 * One stop = a single attack-move onto the target.
 */
function routeUnit(world, field, i, stops) {
  const first = stops[0];
  world.order[i] = ORDER.ATTACK_MOVE;
  world.tx[i] = first.x;
  world.ty[i] = first.z;
  world.hasTarget[i] = 1;
  if (field) queuePath(world, i, first.x, first.z, null);

  const hops = stops.slice(1, 3);
  if (!world.rallyHopCount) return;
  world.rallyHopCount[i] = hops.length;
  if (hops[0]) {
    world.rallyHop1X[i] = hops[0].x;
    world.rallyHop1Y[i] = hops[0].z;
    world.rallyHop1Order[i] = ORDER.ATTACK_MOVE;
  }
  if (hops[1]) {
    world.rallyHop2X[i] = hops[1].x;
    world.rallyHop2Y[i] = hops[1].z;
    world.rallyHop2Order[i] = ORDER.ATTACK_MOVE;
  }
}

/** Per-tick system: release due waves. Cheap no-op when no spawners are armed. */
export function waveSpawnerSystem(world, field) {
  const spawners = world.waveSpawners;
  if (!spawners || !spawners.length) return;
  for (const s of spawners) {
    if (s.spawned >= s.waves) continue;
    if (world.tick < s.nextTick) continue;
    spawnWave(world, field, s);
    s.spawned += 1;
    s.nextTick = world.tick + (s.interval || WAVE_INTERVAL_TICKS);
  }
}
