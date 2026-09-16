// Campaign objective triggers — the first real, non-zone completion logic.
//
// Two kinds are wired here today:
//   • destroy  — complete when every hostile target captured inside the zone is dead.
//   • survive / defend — hold out for a deterministic duration (sim ticks).
//
// These read only deterministic sim state (entity/building death, sim tick), so
// every lockstep client resolves them the same way. The host wires a context
// object; this module stays free of sim imports so it is easy to unit test.

import { OBJ_DEFEND, OBJ_DESTROY, OBJ_SURVIVE } from './objectives.js';

/** Seconds of hold-out per authored wave when an objective gives `{ waves }`. */
export const SURVIVE_SECONDS_PER_WAVE = 12;
/** Fallback hold-out when neither seconds nor waves are authored. */
export const DEFAULT_SURVIVE_SECONDS = 20;

export function isTimerObjective(obj) {
  return obj?.kind === OBJ_SURVIVE || obj?.kind === OBJ_DEFEND;
}

export function isDestroyObjective(obj) {
  return obj?.kind === OBJ_DESTROY;
}

/** Hold-out duration in seconds from an objective's params. */
export function surviveSeconds(obj) {
  const p = obj?.params || {};
  if (Number.isFinite(p.seconds)) return Math.max(1, p.seconds);
  if (Number.isFinite(p.waves)) return Math.max(1, p.waves * SURVIVE_SECONDS_PER_WAVE);
  return DEFAULT_SURVIVE_SECONDS;
}

/**
 * Capture per-objective trigger state once, when objectives arm.
 * @param {object[]} objectives live objective list (mutated)
 * @param {{ tick: number, tickHz: number, targetsInZone: (o: object) => object[] }} ctx
 */
export function armCampaignTriggers(objectives, ctx) {
  for (const obj of objectives || []) {
    if (obj._armed) continue;
    if (isDestroyObjective(obj)) {
      obj._targets = ctx.targetsInZone(obj) || [];
    } else if (isTimerObjective(obj)) {
      obj._endTick = (ctx.tick | 0) + Math.max(1, Math.round(surviveSeconds(obj) * ctx.tickHz));
    }
    obj._armed = true;
  }
}

/**
 * Complete armed trigger objectives whose condition now holds.
 * @returns {object[]} objectives completed this step (for status lines)
 */
export function stepCampaignTriggers(objectives, ctx) {
  const just = [];
  for (const obj of objectives || []) {
    if (obj.completed || !obj._armed) continue;
    let done = false;
    if (isDestroyObjective(obj)) {
      const targets = obj._targets || [];
      done = targets.length > 0 && targets.every((t) => !ctx.isTargetAlive(t));
    } else if (isTimerObjective(obj)) {
      done = Number.isFinite(obj._endTick) && (ctx.tick | 0) >= obj._endTick && ctx.partyAlive();
    }
    if (done) {
      obj.completed = true;
      just.push(obj);
    }
  }
  return just;
}

/** Live progress for the HUD: seconds remaining, or targets left. */
export function campaignTriggerStatus(obj, ctx) {
  if (!obj?._armed) return null;
  if (isTimerObjective(obj) && Number.isFinite(obj._endTick)) {
    const remaining = Math.max(0, Math.ceil(((obj._endTick - (ctx.tick | 0)) / ctx.tickHz)));
    return { remaining };
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
  return base;
}
