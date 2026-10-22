// Forge helpers for adventure wave spawners (objective params.waves / route)
// and the trigger fields the match already reads off a zone.
// Fractional hops must invert waveSpawner.worldFromFrac: tx = round(frac * (w-1)).

import { OBJ_KINDS, TERMINAL_KINDS } from '../story/objectives.js';

export const WAVE_ROUTE_MAX = 3;
export const WAVE_DEFAULT_COUNT = 3;

/** Adventure attack rosters. Index matches the sim era. */
export const WAVE_ERAS = [
  { id: 1, label: '1 - warriors and archers' },
  { id: 2, label: '2 - warlocks from the second group' },
  { id: 3, label: '3 - wizards from the second group' },
  { id: 4, label: '4 - monks, warlocks from the first group' },
  { id: 5, label: '5 - monks plus warlocks, wizards, and shamans' },
];

export function waveHopName(index) {
  return (index | 0) === 0 ? 'Form up' : `Stop ${index | 0}`;
}

export function tileToWaveFrac(tx, tz, width, height) {
  const mw = Math.max(1, (width | 0) - 1);
  const mh = Math.max(1, (height | 0) - 1);
  return [(tx | 0) / mw, (tz | 0) / mh];
}

export function waveFracToTile(fxFrac, fzFrac, width, height) {
  const mw = Math.max(1, (width | 0) - 1);
  const mh = Math.max(1, (height | 0) - 1);
  const maxX = Math.max(0, (width | 0) - 1);
  const maxZ = Math.max(0, (height | 0) - 1);
  return {
    tx: Math.max(0, Math.min(maxX, Math.round((Number(fxFrac) || 0) * mw))),
    tz: Math.max(0, Math.min(maxZ, Math.round((Number(fzFrac) || 0) * mh))),
  };
}

export function collectWaveParams({ waves = 0, era = 0, route = [] } = {}) {
  const hops = (Array.isArray(route) ? route : [])
    .filter((wp) => Array.isArray(wp) && wp.length >= 2)
    .slice(0, WAVE_ROUTE_MAX);
  const count = (waves | 0) > 0 ? (waves | 0) : (hops.length ? WAVE_DEFAULT_COUNT : 0);
  if (count <= 0) return null;
  const params = { waves: count };
  if ((era | 0) > 0) params.era = era | 0;
  if (hops.length) params.route = hops;
  return params;
}

/** Latest wave-armed zone, else the last zone - hops belong to that target. */
export function waveTargetObjective(objectives) {
  const list = objectives || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i]?.params?.waves | 0) > 0) return list[i];
  }
  return list.length ? list[list.length - 1] : null;
}

export function appendWaveHop(obj, hop, { waves = 0, era = 0 } = {}) {
  if (!obj || !Array.isArray(hop) || hop.length < 2) return false;
  if (!obj.params) obj.params = {};
  if (!(obj.params.waves | 0)) {
    obj.params.waves = (waves | 0) > 0 ? (waves | 0) : WAVE_DEFAULT_COUNT;
    if ((era | 0) > 0) obj.params.era = era | 0;
  }
  const route = Array.isArray(obj.params.route) ? obj.params.route : [];
  if (route.length >= WAVE_ROUTE_MAX) return false;
  obj.params.route = [...route, hop];
  return true;
}

export function replaceWaveHop(obj, index, hop) {
  const route = obj?.params?.route;
  const i = index | 0;
  if (!Array.isArray(route) || i < 0 || i >= route.length) return false;
  if (!Array.isArray(hop) || hop.length < 2) return false;
  route[i] = hop;
  return true;
}

export function removeWaveHopAt(obj, index) {
  const route = obj?.params?.route;
  const i = index | 0;
  if (!Array.isArray(route) || i < 0 || i >= route.length) return false;
  route.splice(i, 1);
  if (!route.length) delete obj.params.route;
  return true;
}

export function setZoneWaves(obj, waves) {
  if (!obj) return;
  const n = Math.max(0, waves | 0);
  if (!obj.params) obj.params = {};
  if (n <= 0) delete obj.params.waves;
  else obj.params.waves = n;
}

export function setZoneEra(obj, era) {
  if (!obj) return;
  const n = Math.max(0, Math.min(5, era | 0));
  if (!obj.params) obj.params = {};
  if (n <= 0) delete obj.params.era;
  else obj.params.era = n;
}

export function popWaveHop(obj) {
  const route = obj?.params?.route;
  if (!Array.isArray(route) || !route.length) return false;
  route.pop();
  if (!route.length) delete obj.params.route;
  return true;
}

function pruneZoneParams(obj) {
  if (!obj?.params) return;
  for (const key of Object.keys(obj.params)) {
    const value = obj.params[key];
    if (value == null || value === '') delete obj.params[key];
  }
  if (!Object.keys(obj.params).length) delete obj.params;
}

function fracPair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const a = Number(value[0]);
  const b = Number(value[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

/** Escape and advance always end the chapter. Other kinds end it only when flagged. */
export function setZoneTerminal(obj, on) {
  if (!obj) return;
  if (TERMINAL_KINDS.includes(obj.kind)) {
    obj.terminal = true;
    return;
  }
  if (on) obj.terminal = true;
  else delete obj.terminal;
}

const KEPT_ZONE_PARAMS = new Set(['waves', 'era', 'route', 'allies']);

export function setZoneKind(obj, kind) {
  if (!obj) return;
  const next = String(kind || '').trim().toLowerCase();
  if (!OBJ_KINDS.includes(next) || next === obj.kind) return;
  const wasLocked = TERMINAL_KINDS.includes(obj.kind);
  obj.kind = next;
  if (TERMINAL_KINDS.includes(next)) obj.terminal = true;
  else if (wasLocked) delete obj.terminal;
  if (obj.params) {
    for (const key of Object.keys(obj.params)) {
      if (!KEPT_ZONE_PARAMS.has(key)) delete obj.params[key];
    }
    pruneZoneParams(obj);
  }
}

/** Write one trigger param. Null or '' removes it so the match default applies. */
export function setZoneParam(obj, key, value) {
  if (!obj || !key) return;
  if (!obj.params) obj.params = {};
  if (value == null || value === '') delete obj.params[key];
  else obj.params[key] = value;
  pruneZoneParams(obj);
}

/**
 * One friendly reinforcement on this zone.
 * `ally` is `{ from, to, waves, count, delay, interval }` in the shape waveSpawner reads.
 * A missing ally, or waves below 1, clears reinforcements.
 */
export function setZoneAllies(obj, ally) {
  if (!obj) return;
  const from = fracPair(ally?.from);
  const to = fracPair(ally?.to);
  const waves = ally?.waves | 0;
  if (!from || !to || waves < 1) {
    if (obj.params) delete obj.params.allies;
    pruneZoneParams(obj);
    return;
  }
  if (!obj.params) obj.params = {};
  obj.params.allies = [{
    from,
    to,
    waves,
    count: Math.max(1, (ally.count | 0) || 3),
    delay: Math.max(0, Number(ally.delay) || 0),
    interval: Math.max(1, (ally.interval | 0) || 14),
  }];
}

const numField = (id, label, param, placeholder) => ({ id, label, param, placeholder, kind: 'number' });
const textField = (id, label, param, placeholder) => ({ id, label, param, placeholder, kind: 'text' });

const ZONE_TRIGGERS = {
  reach: { hint: 'A party unit walks in.', fields: [] },
  escape: { hint: 'A party unit walks in and the chapter ends.', fields: [] },
  advance: { hint: 'A party unit walks in, the chapter ends, and Next loads.', fields: [] },
  destroy: { hint: 'Every hostile standing in the zone when it arms has to die.', fields: [] },
  capture: { hint: 'A party unit stands here with no enemy left in the zone.', fields: [] },
  hold: { hint: 'A party unit stays here for the whole hold.', fields: [numField('hold', 'Hold seconds', 'hold', '15')] },
  control: { hint: 'Hold the zone. An enemy inside resets the clock.', fields: [numField('hold', 'Hold seconds', 'hold', '15')] },
  gather: { hint: 'Stay in the zone for the hold.', fields: [numField('hold', 'Hold seconds', 'hold', '15')] },
  build: { hint: 'Stay in the zone for the hold.', fields: [numField('hold', 'Hold seconds', 'hold', '15')] },
  infiltrate: { hint: 'Reach the zone with no enemy inside the detect radius.', fields: [numField('detect', 'Detect radius', 'detect', 'radius + 8')] },
  escort: {
    hint: 'The named unit must reach the zone. If it dies after it is seen, the chapter fails.',
    fields: [
      textField('escort', 'Escort name', 'escort', 'Escort'),
      textField('fail', 'Fail line', 'failMessage', ''),
    ],
  },
  defend: { hint: 'Stay alive for the seconds, or 12 seconds for each enemy group.', fields: [numField('seconds', 'Seconds', 'seconds', '20, or 12 × groups')] },
  survive: { hint: 'Stay alive for the seconds, or 12 seconds for each enemy group.', fields: [numField('seconds', 'Seconds', 'seconds', '20, or 12 × groups')] },
  choice: {
    hint: 'Walking in records this branch and finishes the other choice zones.',
    fields: [textField('branch', 'Branch', 'branch', '')],
  },
  race: {
    hint: 'Reach the zone before the clock runs out, or the chapter fails.',
    fields: [
      numField('seconds', 'Seconds', 'seconds', '60'),
      textField('fail', 'Fail line', 'failMessage', 'Out of time'),
    ],
  },
};

/** Hint and extra inputs for a zone kind. The match already evaluates these params. */
export function zoneTriggerSpec(kind) {
  return ZONE_TRIGGERS[kind] || ZONE_TRIGGERS.reach;
}

export function listWaveHops(objectives, pending) {
  const out = [];
  for (const obj of objectives || []) {
    const route = obj?.params?.route;
    if (!Array.isArray(route)) continue;
    for (const wp of route) {
      if (Array.isArray(wp) && wp.length >= 2) out.push(wp);
    }
  }
  for (const wp of pending || []) {
    if (Array.isArray(wp) && wp.length >= 2) out.push(wp);
  }
  return out;
}
