// Tiny Chapter 3 — last beat of the grove road.

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

export const CHAPTER3_CAST = [
  { name: 'Stumpey', type: UNIT.MYCO, tx: 48, tz: 42 },
  { name: 'Goblin', type: UNIT.WARLOCK, tx: 45, tz: 42 },
  { name: 'Lady', type: UNIT.PRIEST, tx: 48, tz: 40 },
  { name: 'Doc', type: UNIT.SHAMAN, tx: 51, tz: 40 },
];

export const CHAPTER3_GARDEN_NAME = 'Chapter 3';
export const CHAPTER3_GARDEN_URL = '/maps/chapter3.garden';
export const CHAPTER3_SEED = 58331;

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

export function chapter3IntroReel() {
  return reelFromSteps('intro', 'start', [
    { kind: CLIP_CAMERA, tx: 48, tz: 22, radius: 150, alpha: -1.6, dur: 0.05 },
    { kind: CLIP_HOLD, dur: 1.1 },
    {
      kind: CLIP_LINE,
      text: 'The ridge drops into a last hollow. The road ends in open dirt.',
    },
    { kind: CLIP_CAMERA, tx: 48, tz: 41, radius: 48, alpha: 0.35, dur: 3.6, char: 'Stumpey' },
    { kind: CLIP_LINE, speaker: 'Goblin', text: 'That bright patch. That is the door.', style: 'shout' },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: 'Then we walk it. No more looking back.', style: 'command' },
    { kind: CLIP_HOLD, dur: 1.6 },
  ]);
}

export function chapter3WinReel() {
  return reelFromSteps('ending', 'win', [
    { kind: CLIP_CAMERA, tx: 48, tz: 18, radius: 80, alpha: 0.2, dur: 0.05 },
    { kind: CLIP_LINE, speaker: 'Lady', text: 'The blight cannot reach us here.' },
    { kind: CLIP_HOLD, dur: 1.6 },
    { kind: CLIP_LINE, text: 'The party stands on clean ground. This road is done.' },
    { kind: CLIP_HOLD, dur: 2 },
  ]);
}

export function chapter3Story() {
  return normalizeStory({
    reels: [chapter3IntroReel(), chapter3WinReel()],
  });
}

export function chapter3Objectives() {
  return [{
    id: 'hollow',
    kind: 'escape',
    tx: 48,
    tz: 18,
    r: 6,
    label: 'Reach the clean hollow (EXIT)',
    message: 'The road is done.',
  }];
}

export function buildChapter3Garden() {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    const field = buildField(CHAPTER3_SEED, { width: TINY_MAP_W, height: TINY_MAP_H });
    applyTableSilhouette(field, {
      cellSize: TABLE_CHUNK_TILES,
      cellMask: createFullCellMask(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES),
      cellRadius: createFullCellRadius(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES, 0),
    });
    markChapterExit(field, 48, 41, chapter3Objectives()[0]);
    return encodeGarden(field, {
      name: CHAPTER3_GARDEN_NAME,
      story: chapter3Story(),
      objectives: chapter3Objectives(),
      units: unitsFromCast(CHAPTER3_CAST),
    });
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}
