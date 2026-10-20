// Player cameras saved with a replay. Same pose the live view stream sends.
// Sparse: a sample is kept only when the quantized pose changes.

function quant(n, step) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const q = Math.round(v / step) * step;
  return Math.abs(q) < 1e-6 ? 0 : q;
}

function angleLerp(from, to, u) {
  let d = (Number(to) || 0) - (Number(from) || 0);
  const turn = Math.PI * 2;
  while (d > Math.PI) d -= turn;
  while (d < -Math.PI) d += turn;
  return (Number(from) || 0) + d * u;
}

/** @param {object | number[] | null | undefined} raw */
export function readReplayCam(raw) {
  if (Array.isArray(raw)) {
    if (raw.length < 6) return null;
    return {
      tick: raw[0] | 0,
      pid: raw[1] | 0,
      x: Number(raw[2]) || 0,
      z: Number(raw[3]) || 0,
      r: Number(raw[4]) || 0,
      a: Number(raw[5]) || 0,
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.tick == null || raw.pid == null) return null;
  return {
    tick: raw.tick | 0,
    pid: raw.pid | 0,
    x: Number(raw.x) || 0,
    z: Number(raw.z) || 0,
    r: Number(raw.r ?? raw.radius) || 0,
    a: Number(raw.a ?? raw.alpha) || 0,
  };
}

/**
 * Append a camera sample. Identical poses are dropped. Same tick replaces.
 * @param {object[]} list
 * @param {{ tick?: number, pid?: number, x?: number, z?: number, r?: number, radius?: number, a?: number, alpha?: number }} sample
 */
export function noteReplayCam(list, sample) {
  if (!Array.isArray(list) || sample?.tick == null || sample?.pid == null) return;
  const pid = sample.pid | 0;
  if (pid < 0) return;
  const row = {
    tick: sample.tick | 0,
    pid,
    x: quant(sample.x, 0.25),
    z: quant(sample.z, 0.25),
    r: quant(sample.r ?? sample.radius, 0.5),
    a: quant(sample.a ?? sample.alpha, 0.02),
  };
  let last = null;
  let lastAt = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i]?.pid | 0) !== pid) continue;
    last = list[i];
    lastAt = i;
    break;
  }
  if (
    last
    && row.tick >= (last.tick | 0)
    && last.x === row.x
    && last.z === row.z
    && last.r === row.r
    && last.a === row.a
  ) return;
  if (last && (last.tick | 0) === row.tick) {
    list[lastAt] = row;
    return;
  }
  let at = list.length;
  for (let i = 0; i < list.length; i++) {
    const tick = list[i]?.tick | 0;
    const owner = list[i]?.pid | 0;
    if (tick > row.tick || (tick === row.tick && owner > pid)) {
      at = i;
      break;
    }
  }
  list.splice(at, 0, row);
}

/** Compact tape for the replay file. Rows are `[tick, pid, x, z, r, a]`. */
export function packReplayCams(list) {
  const out = [];
  for (let i = 0; i < (list?.length ?? 0); i++) {
    const row = readReplayCam(list[i]);
    if (!row || row.pid < 0) continue;
    out.push([row.tick, row.pid, row.x, row.z, row.r, row.a]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

/**
 * Pose at a sim tick (fractional ticks ease between samples).
 * Holds the latest sample once the tape runs out. Nothing before the first.
 * @param {Array<object | number[]> | null | undefined} cams
 * @param {number} pid
 * @param {number} tick
 * @returns {{ x: number, z: number, radius: number, alpha: number } | null}
 */
export function replayCamPose(cams, pid, tick) {
  const owner = pid | 0;
  const t = Number(tick);
  if (!Number.isFinite(t) || !cams?.length || owner < 0) return null;
  let prev = null;
  let next = null;
  for (let i = 0; i < cams.length; i++) {
    const row = readReplayCam(cams[i]);
    if (!row || row.pid !== owner) continue;
    if (row.tick <= t) prev = row;
    else {
      next = row;
      break;
    }
  }
  if (!prev) return null;
  if (!next || next.tick <= prev.tick) {
    return { x: prev.x, z: prev.z, radius: prev.r, alpha: prev.a };
  }
  const u = Math.max(0, Math.min(1, (t - prev.tick) / (next.tick - prev.tick)));
  return {
    x: prev.x + (next.x - prev.x) * u,
    z: prev.z + (next.z - prev.z) * u,
    radius: prev.r + (next.r - prev.r) * u,
    alpha: angleLerp(prev.a, next.a, u),
  };
}
