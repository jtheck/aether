// Tiny Chapter 2 — exists so Chapter 1 can test a map load.

import {
  CLIP_CAMERA,
  CLIP_HOLD,
  CLIP_LINE,
  LINE_STYLES,
  lineDuration,
  normalizeStory,
} from './timeline.js';
import {
  TINY_MAP_H,
  TINY_MAP_W,
  activeMapH,
  activeMapW,
  buildField,
  setActiveMapSize,
  TABLE_CHUNK_TILES,
} from '../sim/field.js';
import {
  applyTableSilhouette,
  createFullCellMask,
  createFullCellRadius,
} from '../sim/tableShape.js';
import { encodeGarden } from '../sim/garden.js';
import { UNIT } from '../sim/unitTypes.js';
import { unitsFromCast } from './cast.js';
import { markChapterExit } from './exits.js';

export const CHAPTER2_CAST = [
  { name: 'Stumpey', type: UNIT.MYCO, tx: 40, tz: 42 },
  { name: 'Goblin', type: UNIT.WARLOCK, tx: 37, tz: 42 },
  { name: 'Lady', type: UNIT.PRIEST, tx: 40, tz: 40 },
  { name: 'Doc', type: UNIT.SHAMAN, tx: 43, tz: 40 },
];

export const CHAPTER2_GARDEN_NAME = 'Chapter 2';
export const CHAPTER2_GARDEN_URL = '/maps/chapter2.garden';
export const CHAPTER2_NEXT_URL = '/maps/chapter3.garden';
export const CHAPTER2_SEED = 44117;

function styleOf(raw) {
  return LINE_STYLES.includes(raw) ? raw : 'normal';
}

function reelFromSteps(id, when, steps) {
  const clips = [];
  let t = 0;
  let n = 0;
  for (const step of steps) {
    if (step.kind === CLIP_CAMERA) {
      const dur = Math.max(0.05, Number(step.dur) || 1);
      clips.push({
        id: `${id}-cam-${n++}`,
        kind: CLIP_CAMERA,
        t,
        dur,
        tx: step.tx,
        tz: step.tz,
        radius: step.radius,
        alpha: Number.isFinite(step.alpha) ? step.alpha : 0,
        char: step.char || undefined,
      });
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

export function chapter2IntroReel() {
  return reelFromSteps('intro', 'start', [
    { kind: CLIP_CAMERA, tx: 40, tz: 20, radius: 160, alpha: -1.8, dur: 0.05 },
    { kind: CLIP_HOLD, dur: 1.2 },
    {
      kind: CLIP_LINE,
      text: 'The old road opens onto another clearing. The blight did not follow — yet.',
    },
    { kind: CLIP_CAMERA, tx: 40, tz: 41, radius: 50, alpha: 0.4, dur: 4, char: 'Stumpey' },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: 'New dirt. Same feet. Keep moving.', style: 'command' },
    { kind: CLIP_HOLD, dur: 1.8 },
  ]);
}

export function chapter2WinReel() {
  return reelFromSteps('ending', 'win', [
    { kind: CLIP_CAMERA, tx: 40, tz: 16, radius: 70, alpha: -0.4, dur: 0.05 },
    { kind: CLIP_LINE, speaker: 'Doc', text: 'Ridge is clear. Something still pulls north.' },
    { kind: CLIP_HOLD, dur: 1.4 },
  ]);
}

export function chapter2Story() {
  return normalizeStory({
    reels: [chapter2IntroReel(), chapter2WinReel()],
  });
}

export function chapter2Objectives() {
  return [{
    id: 'ridge',
    kind: 'escape',
    tx: 40,
    tz: 16,
    r: 5,
    label: 'Take the north ridge (EXIT)',
    message: 'Ridge is clear. Keep north.',
    next: CHAPTER2_NEXT_URL,
  }];
}

export function buildChapter2Garden() {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    const field = buildField(CHAPTER2_SEED, { width: TINY_MAP_W, height: TINY_MAP_H });
    applyTableSilhouette(field, {
      cellSize: TABLE_CHUNK_TILES,
      cellMask: createFullCellMask(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES),
      cellRadius: createFullCellRadius(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES, 0),
    });
    markChapterExit(field, 40, 41, chapter2Objectives()[0]);
    return encodeGarden(field, {
      name: CHAPTER2_GARDEN_NAME,
      story: chapter2Story(),
      objectives: chapter2Objectives(),
      units: unitsFromCast(CHAPTER2_CAST),
    });
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}
