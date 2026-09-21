// Forge helpers for adventure wave spawners (objective params.waves / route).
// Fractional hops must invert waveSpawner.worldFromFrac: tx = round(frac * (w-1)).

export const WAVE_ROUTE_MAX = 3;
export const WAVE_DEFAULT_COUNT = 3;

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

/** Latest wave-armed zone, else the last zone — hops belong to that target. */
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

export function popWaveHop(obj) {
  const route = obj?.params?.route;
  if (!Array.isArray(route) || !route.length) return false;
  route.pop();
  if (!route.length) delete obj.params.route;
  return true;
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
