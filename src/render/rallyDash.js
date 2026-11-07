function rallyMarkerFlagKey(m) {
  return `${m.x},${m.z}|${m.attackMove ? 1 : 0}|${m.owner | 0}`;
}

function rallyMarkerLineKey(m) {
  let key = `${m.attackMove ? 1 : 0}|${m.owner | 0}`;
  const pts = m.points;
  if (!pts || pts.length < 2) {
    return `${key}|${m.fromX},${m.fromZ}|${m.x},${m.z}`;
  }
  for (let i = 0; i < pts.length; i++) {
    key += `|${pts[i].x},${pts[i].z}`;
  }
  return key;
}

/**
 * Multi-selected buildings that share a rally drop one flag, not a stack.
 * Each building keeps its own path into that point. A later hop that is the
 * same segment for every building is drawn once.
 * @param {object[]} markers
 */
export function coalesceSharedRallyMarkers(markers) {
  const flagKeys = new Set();
  const lineKeys = new Set();
  const out = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const seenFlag = flagKeys.has(rallyMarkerFlagKey(m));
    const seenLine = lineKeys.has(rallyMarkerLineKey(m));
    if (seenFlag && seenLine) continue;
    flagKeys.add(rallyMarkerFlagKey(m));
    lineKeys.add(rallyMarkerLineKey(m));
    if (!seenFlag && !seenLine) {
      out.push(m);
      continue;
    }
    const copy = { ...m };
    if (seenFlag) copy.noFlag = true;
    if (seenLine) copy.noLine = true;
    out.push(copy);
  }
  return out;
}

/** Positive remainder in [0, period). */
export function wrapPeriod(v, period) {
  if (!(period > 0)) return 0;
  return ((v % period) + period) % period;
}

/**
 * Dash spans along a path of length `pathLen`.
 * Increasing `offset` shifts dashes toward +s (building → flag).
 *
 * @param {number} pathLen
 * @param {number} offset
 * @param {number} dashLen
 * @param {number} period
 * @param {(a: number, b: number) => void} fn
 */
export function forEachRallyDash(pathLen, offset, dashLen, period, fn) {
  if (!(pathLen > 0) || !(dashLen > 0) || !(period > 0)) return;
  const off = wrapPeriod(offset, period);
  let start = off - period;
  while (start < pathLen) {
    const a = Math.max(0, start);
    const b = Math.min(pathLen, start + dashLen);
    if (b - a > 1e-4) fn(a, b);
    start += period;
  }
}
