// Shared reel authoring — turn a compact list of beat steps into a seekable reel.
// Same envelope the hand-written chapter1/2/3 reels use, centralized so the
// campaign manifest can broad-stroke intros/wins without repeating the loop.

import { CLIP_CAMERA, CLIP_HOLD, CLIP_LINE, LINE_STYLES, lineDuration } from './timeline.js';

function styleOf(raw) {
  return LINE_STYLES.includes(raw) ? raw : 'normal';
}

/**
 * @param {string} id reel id (e.g. 'intro')
 * @param {'start'|'win'} when
 * @param {Array<object>} steps beat steps from cam()/line()/narrate()/hold()
 */
export function reelFromSteps(id, when, steps) {
  const clips = [];
  let t = 0;
  let n = 0;
  for (const step of steps || []) {
    if (!step) continue;
    if (step.kind === CLIP_CAMERA) {
      const dur = Math.max(0.05, Number(step.dur) || 1);
      const clip = {
        id: `${id}-cam-${n++}`,
        kind: CLIP_CAMERA,
        t,
        dur,
        tx: step.tx | 0,
        tz: step.tz | 0,
        radius: Number.isFinite(step.radius) ? step.radius : 80,
        alpha: Number.isFinite(step.alpha) ? step.alpha : 0,
      };
      if (step.char) clip.char = String(step.char);
      clips.push(clip);
      t += dur;
    } else if (step.kind === CLIP_HOLD) {
      const dur = Math.max(0.05, Number(step.dur) || 0.05);
      clips.push({ id: `${id}-hold-${n++}`, kind: CLIP_HOLD, t, dur });
      t += dur;
    } else if (step.kind === CLIP_LINE) {
      const dur = Number(step.dur) || lineDuration(step.text);
      clips.push({
        id: `${id}-line-${n++}`,
        kind: CLIP_LINE,
        t,
        dur,
        speaker: step.speaker || '',
        text: step.text,
        style: styleOf(step.style),
      });
      t += dur;
    }
  }
  return { id, when, clips, duration: t };
}

// Compact authoring helpers. Camera coords are fractions of the board (0..1);
// the campaign builder resolves them to tiles before reelFromSteps runs.
export function cam(fx, fz, radius, alpha, dur, char) {
  return { kind: CLIP_CAMERA, fx, fz, radius, alpha, dur, char };
}

export function line(speaker, text, style) {
  return { kind: CLIP_LINE, speaker, text, style };
}

export function narrate(text) {
  return { kind: CLIP_LINE, speaker: '', text };
}

export function hold(dur) {
  return { kind: CLIP_HOLD, dur };
}
