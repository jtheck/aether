// Campaign objective triggers — real, deterministic completion logic.
//
// All kinds beyond reach/escape/advance are evaluated here from deterministic
// sim state (entity/building death, positions, sim tick), so every lockstep
// client resolves them identically. The host supplies a context object; this
// module imports only pure helpers so it stays easy to unit test.
//
//   destroy    — every hostile target captured in the zone is dead
//   survive    — hold out for a duration (party still alive)
//   defend     — hold out for a duration (party still alive)
//   hold       — keep a party unit in the zone for a duration
//   control    — hold the zone uncontested (resets while an enemy stands on it)
//   gather     — remain in the zone (harvest) for a duration
//   build      — remain in the zone (raise) for a duration
//   capture    — stand in the zone with no enemy left on it
//   infiltrate — reach the zone with no enemy within the detection radius
//   choice     — reach either branch zone (records the pick)
//   race       — reach the zone; FAILS the chapter if the clock runs out
//   escort     — get the named escort unit to the zone; FAILS if it dies

import {
  OBJ_BUILD,
  OBJ_CAPTURE,
  OBJ_CHOICE,
  OBJ_CONTROL,
  OBJ_DEFEND,
  OBJ_DESTROY,
  OBJ_ESCORT,
  OBJ_GATHER,
  OBJ_HOLD,
  OBJ_INFILTRATE,
  OBJ_RACE,
  OBJ_SURVIVE,
  zoneContains,
} from './objectives.js';

/** Seconds of hold-out per authored wave when an objective gives `{ waves }`. */
export const SURVIVE_SECONDS_PER_WAVE = 12;
export const DEFAULT_SURVIVE_SECONDS = 20;
/** Default seconds to stand on a hold/control/gather/build point. */
export const DEFAULT_HOLD_SECONDS = 15;
export const DEFAULT_RACE_SECONDS = 60;

const TIMER_KINDS = new Set([OBJ_SURVIVE, OBJ_DEFEND]);
const HOLD_KINDS = new Set([OBJ_HOLD, OBJ_CONTROL, OBJ_GATHER, OBJ_BUILD]);

export function isTimerObjective(obj) {
  return TIMER_KINDS.has(obj?.kind);
}
export function isDestroyObjective(obj) {
  return obj?.kind === OBJ_DESTROY;
}

export function surviveSeconds(obj) {
  const p = obj?.params || {};
  if (Number.isFinite(p.seconds)) return Math.max(1, p.seconds);
  if (Number.isFinite(p.waves)) return Math.max(1, p.waves * SURVIVE_SECONDS_PER_WAVE);
  return DEFAULT_SURVIVE_SECONDS;
}

function holdSeconds(obj) {
  const p = obj?.params || {};
  if (Number.isFinite(p.hold)) return Math.max(1, p.hold);
  if (Number.isFinite(p.seconds)) return Math.max(1, p.seconds);
  return DEFAULT_HOLD_SECONDS;
}

function raceSeconds(obj) {
  const p = obj?.params || {};
  if (Number.isFinite(p.seconds)) return Math.max(1, p.seconds);
  return DEFAULT_RACE_SECONDS;
}

function anyInZone(points, obj, field) {
  return (points || []).some((p) => zoneContains(obj, p.x, p.z, field));
}

/** Test a custom radius (tiles) around the objective centre. */
function anyNear(points, obj, tiles, field) {
  const probe = { tx: obj.tx, tz: obj.tz, r: Math.max(0.5, tiles) };
  return anyInZone(points, probe, field);
}

/**
 * Capture per-objective trigger state once, when objectives arm.
 * @param {object[]} objectives live objective list (mutated)
 * @param {object} ctx { tick, tickHz, targetsInZone }
 */
export function armCampaignTriggers(objectives, ctx) {
  for (const obj of objectives || []) {
    if (obj._armed) continue;
    if (isDestroyObjective(obj)) {
      obj._targets = ctx.targetsInZone(obj) || [];
    } else if (isTimerObjective(obj)) {
      obj._endTick = (ctx.tick | 0) + Math.max(1, Math.round(surviveSeconds(obj) * ctx.tickHz));
    } else if (obj.kind === OBJ_RACE) {
      obj._raceEnd = (ctx.tick | 0) + Math.max(1, Math.round(raceSeconds(obj) * ctx.tickHz));
    }
    obj._armed = true;
  }
}

/**
 * Complete armed trigger objectives whose condition now holds; flag failures.
 * @returns {object[]} objectives completed this step (for status lines)
 */
export function stepCampaignTriggers(objectives, ctx) {
  const just = [];
  const list = objectives || [];
  for (const obj of list) {
    if (obj.completed || !obj._armed || obj._failed) continue;
    let done = false;
    const tick = ctx.tick | 0;

    if (isDestroyObjective(obj)) {
      const targets = obj._targets || [];
      done = targets.length > 0 && targets.every((t) => !ctx.isTargetAlive(t));
    } else if (isTimerObjective(obj)) {
      done = Number.isFinite(obj._endTick) && tick >= obj._endTick && ctx.partyAlive();
    } else if (HOLD_KINDS.has(obj.kind)) {
      const onPoint = anyInZone(ctx.partyPoints(), obj, ctx.field);
      const contested = obj.kind === OBJ_CONTROL && anyInZone(ctx.enemyPoints(), obj, ctx.field);
      if (onPoint && !contested) {
        if (!Number.isFinite(obj._holdEnd)) {
          obj._holdEnd = tick + Math.max(1, Math.round(holdSeconds(obj) * ctx.tickHz));
        }
        done = tick >= obj._holdEnd;
      } else {
        obj._holdEnd = undefined; // must be continuous
      }
    } else if (obj.kind === OBJ_CAPTURE) {
      done = anyInZone(ctx.partyPoints(), obj, ctx.field) && !anyInZone(ctx.enemyPoints(), obj, ctx.field);
    } else if (obj.kind === OBJ_INFILTRATE) {
      const detect = Number(obj.params?.detect) || ((obj.r | 0) + 8);
      done = anyInZone(ctx.partyPoints(), obj, ctx.field) && !anyNear(ctx.enemyPoints(), obj, detect, ctx.field);
    } else if (obj.kind === OBJ_CHOICE) {
      if (anyInZone(ctx.partyPoints(), obj, ctx.field)) {
        obj._choice = obj.params?.branch || obj.id;
        done = true;
        for (const other of list) {
          if (other === obj || other.kind !== OBJ_CHOICE || other.completed) continue;
          other.completed = true;
          other._choice = obj._choice;
          just.push(other);
        }
      }
    } else if (obj.kind === OBJ_RACE) {
      if (Number.isFinite(obj._raceEnd) && tick > obj._raceEnd) {
        obj._failed = true;
        obj.failMessage = obj.params?.failMessage || 'Out of time';
      } else if (anyInZone(ctx.partyPoints(), obj, ctx.field)) {
        done = true;
      }
    } else if (obj.kind === OBJ_ESCORT) {
      const name = obj.params?.escort || 'Escort';
      const pt = ctx.escortPoint(name);
      if (pt) {
        obj._escortSeen = true;
        if (zoneContains(obj, pt.x, pt.z, ctx.field)) done = true;
      } else if (obj._escortSeen) {
        obj._failed = true;
        obj.failMessage = obj.params?.failMessage || `${name} was lost`;
      }
    }

    if (done) {
      obj.completed = true;
      just.push(obj);
    }
  }
  return just;
}

/** Live progress for the HUD: seconds remaining, targets left, or a hint. */
export function campaignTriggerStatus(obj, ctx) {
  if (!obj?._armed) return null;
  const tick = ctx.tick | 0;
  if (isTimerObjective(obj) && Number.isFinite(obj._endTick)) {
    return { remaining: Math.max(0, Math.ceil((obj._endTick - tick) / ctx.tickHz)) };
  }
  if (obj.kind === OBJ_RACE && Number.isFinite(obj._raceEnd)) {
    return { remaining: Math.max(0, Math.ceil((obj._raceEnd - tick) / ctx.tickHz)) };
  }
  if (HOLD_KINDS.has(obj.kind)) {
    if (Number.isFinite(obj._holdEnd)) {
      return { remaining: Math.max(0, Math.ceil((obj._holdEnd - tick) / ctx.tickHz)) };
    }
    return { hint: 'hold the point' };
  }
  if (isDestroyObjective(obj) && Array.isArray(obj._targets)) {
    const total = obj._targets.length;
    const left = obj._targets.filter((t) => ctx.isTargetAlive(t)).length;
    return { targetsLeft: left, targetsTotal: total };
  }
  return null;
}

/** One-line HUD label with live trigger progress appended. */
export function describeCampaignObjective(obj, ctx) {
  const base = obj.label || obj.message || obj.kind;
  const status = campaignTriggerStatus(obj, ctx);
  if (!status) return base;
  if (status.remaining != null) return `${base} — ${status.remaining}s`;
  if (status.targetsTotal != null) return `${base} — ${status.targetsLeft}/${status.targetsTotal} left`;
  if (status.hint) return `${base} — ${status.hint}`;
  return base;
}
