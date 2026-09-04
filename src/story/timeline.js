// Seekable cinematic reel — clips on a timeline. sample(t) is the source of truth.

export const CLIP_CAMERA = 'camera';
export const CLIP_LINE = 'line';
export const CLIP_HOLD = 'hold';

export const LINE_STYLES = Object.freeze([
  'normal',
  'shout',
  'whisper',
  'think',
  'command',
  'scared',
]);

/** Newest-at-bottom chat cap. Extra live lines are forced out. */
export const CHAT_KEEP = 5;

/** Seconds on screen from text length (same envelope as v1). */
export function lineDuration(text) {
  const len = String(text || '').length;
  return Math.max(2.5, Math.min(len * 0.055, 8));
}

export function newClipId() {
  return `c${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyReel(id = 'intro') {
  return { id, when: 'start', clips: [], duration: 0 };
}

export function emptyStory() {
  return { reels: [emptyReel('intro')] };
}

export function normalizeClip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind;
  if (kind !== CLIP_CAMERA && kind !== CLIP_LINE && kind !== CLIP_HOLD) return null;
  const t = Math.max(0, Number(raw.t) || 0);
  const fallbackDur = kind === CLIP_LINE ? lineDuration(raw.text) : 1;
  const dur = Math.max(0.05, Number(raw.dur) || fallbackDur);
  const id = String(raw.id || newClipId());
  if (kind === CLIP_CAMERA) {
    const nested = raw.from && typeof raw.from === 'object' ? raw.from : null;
    const fromTx = raw.fromTx ?? nested?.tx;
    const clip = {
      id,
      kind,
      t,
      dur,
      tx: Number(raw.tx) || 0,
      tz: Number(raw.tz) || 0,
      radius: Number.isFinite(Number(raw.radius)) ? Number(raw.radius) : 80,
      alpha: Number.isFinite(Number(raw.alpha)) ? Number(raw.alpha) : 0,
    };
    if (Number.isFinite(Number(fromTx))) {
      const fromRadius = raw.fromRadius ?? nested?.radius;
      const fromAlpha = raw.fromAlpha ?? nested?.alpha;
      clip.fromTx = Number(fromTx) || 0;
      clip.fromTz = Number(raw.fromTz ?? nested?.tz) || 0;
      clip.fromRadius = Number.isFinite(Number(fromRadius)) ? Number(fromRadius) : clip.radius;
      clip.fromAlpha = Number.isFinite(Number(fromAlpha)) ? Number(fromAlpha) : clip.alpha;
    }
    const char = String(raw.char || '').trim();
    if (char) clip.char = char;
    return clip;
  }
  if (kind === CLIP_LINE) {
    const style = LINE_STYLES.includes(raw.style) ? raw.style : 'normal';
    return {
      id,
      kind,
      t,
      dur,
      speaker: String(raw.speaker || ''),
      text: String(raw.text || ''),
      style,
    };
  }
  return { id, kind, t, dur };
}

export function normalizeReel(raw) {
  const clips = [];
  const list = Array.isArray(raw?.clips) ? raw.clips : [];
  for (const item of list) {
    const clip = normalizeClip(item);
    if (clip) clips.push(clip);
  }
  clips.sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
  let derived = 0;
  for (const clip of clips) derived = Math.max(derived, clip.t + clip.dur);
  const authored = Number(raw?.duration);
  const duration = Math.max(derived, Number.isFinite(authored) ? authored : 0);
  const when = raw?.when === 'win' ? 'win' : 'start';
  return {
    id: String(raw?.id || 'intro'),
    when,
    clips,
    duration,
  };
}

export function normalizeStory(raw) {
  const reels = [];
  const list = Array.isArray(raw?.reels) ? raw.reels : [];
  for (const item of list) reels.push(normalizeReel(item));
  if (!reels.length) reels.push(emptyReel('intro'));
  return { reels };
}

export function encodeStory(story) {
  const normalized = normalizeStory(story);
  const reels = [];
  for (const reel of normalized.reels) {
    if (!reel.clips.length) continue;
    reels.push({
      id: reel.id,
      when: reel.when,
      duration: reel.duration || undefined,
      clips: reel.clips.map((clip) => {
        if (clip.kind === CLIP_CAMERA) {
          const packed = {
            id: clip.id,
            kind: clip.kind,
            t: clip.t,
            dur: clip.dur,
            tx: clip.tx,
            tz: clip.tz,
            radius: clip.radius,
            alpha: clip.alpha,
          };
          if (Number.isFinite(clip.fromTx)) {
            packed.fromTx = clip.fromTx;
            packed.fromTz = clip.fromTz;
            packed.fromRadius = clip.fromRadius;
            packed.fromAlpha = clip.fromAlpha;
          }
          if (clip.char) packed.char = clip.char;
          return packed;
        }
        if (clip.kind === CLIP_LINE) {
          return {
            id: clip.id,
            kind: clip.kind,
            t: clip.t,
            dur: clip.dur,
            speaker: clip.speaker || undefined,
            text: clip.text,
            style: clip.style !== 'normal' ? clip.style : undefined,
          };
        }
        return { id: clip.id, kind: clip.kind, t: clip.t, dur: clip.dur };
      }),
    });
  }
  if (!reels.length) return undefined;
  return { reels };
}

export function reelDuration(reel) {
  return normalizeReel(reel).duration;
}

function ease(u) {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function lerpAngle(a, b, u) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

function mixPose(from, to, u) {
  return {
    tx: lerp(from.tx, to.tx, u),
    tz: lerp(from.tz, to.tz, u),
    radius: lerp(from.radius, to.radius, u),
    alpha: lerpAngle(from.alpha, to.alpha, u),
  };
}

export function cameraEndPose(clip) {
  return { tx: clip.tx, tz: clip.tz, radius: clip.radius, alpha: clip.alpha };
}

export function cameraStartPose(clip) {
  if (!clip || !Number.isFinite(clip.fromTx)) return null;
  return {
    tx: clip.fromTx,
    tz: clip.fromTz,
    radius: clip.fromRadius,
    alpha: clip.fromAlpha,
  };
}

function lineView(clip) {
  return {
    id: clip.id,
    speaker: clip.speaker,
    text: clip.text,
    style: clip.style,
    t: clip.t,
    dur: clip.dur,
  };
}

function lineClips(reel) {
  return (reel?.clips || []).filter((c) => c.kind === CLIP_LINE);
}

/** Lines whose authored window covers `time` (then they hide). */
export function coveringLines(reel, time) {
  const t = Number(time) || 0;
  const out = [];
  for (const clip of lineClips(reel)) {
    if (clip.t > t) break;
    if (t < clip.t + clip.dur) out.push(lineView(clip));
  }
  return out;
}

/** Lines whose window overlaps `[a, b]` — used so a skip step cannot miss a beat. */
export function linesOverlappingRange(reel, a, b) {
  const lo = Math.min(Number(a) || 0, Number(b) || 0);
  const hi = Math.max(Number(a) || 0, Number(b) || 0);
  const out = [];
  for (const clip of lineClips(reel)) {
    if (clip.t > hi) break;
    if (clip.t + clip.dur > lo) out.push(lineView(clip));
  }
  return out;
}

/**
 * Reconstruct camera + line at time `time` (seconds). Seeking through this
 * never depends on what last played — only on the reel and t.
 */
export function sample(reel, time) {
  const r = reel?.clips ? normalizeReel(reel) : normalizeReel({ clips: [] });
  const duration = r.duration;
  const t = Math.max(0, Math.min(duration, Number(time) || 0));

  const cameras = r.clips.filter((c) => c.kind === CLIP_CAMERA);
  let camera = null;
  if (cameras.length) {
    let prev = cameraEndPose(cameras[0]);
    camera = { ...(cameraStartPose(cameras[0]) || prev) };
    for (const clip of cameras) {
      if (clip.t > t) break;
      const from = cameraStartPose(clip) || prev;
      const to = cameraEndPose(clip);
      const end = clip.t + clip.dur;
      if (t < end) {
        const u = clip.dur > 0 ? ease((t - clip.t) / clip.dur) : 1;
        camera = mixPose(from, to, u);
        if (clip.char) camera.char = clip.char;
      } else {
        camera = { ...to };
      }
      camera.id = clip.id;
      prev = to;
    }
  }

  const lines = coveringLines(r, t);
  const line = lines.length ? lines[lines.length - 1] : null;

  return { t, duration, camera, line, lines };
}

/** Latest clip start at or before `time` — a dialogue / camera beat. */
export function clipBeatTime(reel, time) {
  const t = Number(time) || 0;
  let beat = 0;
  for (const start of clipStartTimes(reel)) {
    if (start <= t + 1e-4) beat = start;
    else break;
  }
  return beat;
}

export function clipStartTimes(reel) {
  const r = normalizeReel(reel);
  const starts = [];
  for (const clip of r.clips) {
    if (!starts.includes(clip.t)) starts.push(clip.t);
  }
  starts.sort((a, b) => a - b);
  return starts;
}

export function prevClipTime(reel, time) {
  const t = Number(time) || 0;
  const starts = clipStartTimes(reel);
  let prev = 0;
  for (const start of starts) {
    if (start < t - 1e-4) prev = start;
  }
  return prev;
}

export function nextClipTime(reel, time) {
  const r = normalizeReel(reel);
  const t = Number(time) || 0;
  for (const start of clipStartTimes(r)) {
    if (start > t + 1e-4) return start;
  }
  return r.duration;
}

export function activeReel(story, id = 'intro') {
  const s = normalizeStory(story);
  return s.reels.find((r) => r.id === id) || s.reels[0] || emptyReel(id);
}

export function replaceReel(story, reel) {
  const s = normalizeStory(story);
  const next = normalizeReel(reel);
  const idx = s.reels.findIndex((r) => r.id === next.id);
  if (idx >= 0) s.reels[idx] = next;
  else s.reels.push(next);
  return s;
}
