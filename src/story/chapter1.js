// Chapter 1 cinematic beats. Map tiles stay yours to author; this is the reel.
// Garden file: repo-root maps/chapter1.garden (served as /maps/chapter1.garden).
// Legacy v1 adventure maps stay in maps/adventure/.

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

/** v1 party: Myco / Warlock / Priest / Shaman around the grove. */
export const CHAPTER1_CAST = [
  { name: 'Stumpey', type: UNIT.MYCO, tx: 30, tz: 44 },
  { name: 'Goblin', type: UNIT.WARLOCK, tx: 27, tz: 44 },
  { name: 'Lady', type: UNIT.PRIEST, tx: 30, tz: 42 },
  { name: 'Doc', type: UNIT.SHAMAN, tx: 33, tz: 42 },
];

export const CHAPTER1_GARDEN_NAME = 'Chapter 1';
export const CHAPTER1_GARDEN_URL = '/maps/chapter1.garden';
export const CHAPTER1_NEXT_URL = '/maps/chapter2.garden';
export const CHAPTER1_SEED = 22049;

/** Walk north off the grove to load Chapter 2. */
export function chapter1Objectives() {
  return [{
    id: 'road',
    kind: 'escape',
    tx: 30,
    tz: 34,
    r: 6,
    label: 'Reach the old road (north)',
    message: 'The old road. Nobody\'s used it in ages.',
    next: CHAPTER1_NEXT_URL,
  }];
}

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

/** Opening take: wide grove, then a medium group hold while they talk north. */
export function chapter1IntroReel() {
  return reelFromSteps('intro', 'start', [
    { kind: CLIP_CAMERA, tx: 30, tz: 28, radius: 160, alpha: -2.2, dur: 1.4 },
    {
      kind: CLIP_LINE,
      text: 'The ancient grove shudders. A darkness creeps through the roots, twisting all it touches.',
    },
    { kind: CLIP_CAMERA, tx: 30, tz: 42, radius: 95, alpha: 0.35, dur: 2.2 },
    { kind: CLIP_HOLD, dur: 0.4 },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: 'Big problems... we oughtta get outta here.', style: 'scared' },
    { kind: CLIP_LINE, speaker: 'Lady', text: 'What is happening to the forest? I can feel it dying.', style: 'whisper' },
    { kind: CLIP_LINE, speaker: 'Doc', text: 'Something has poisoned the heartwood. There is no curing this from here.', style: 'think' },
    { kind: CLIP_LINE, speaker: 'Goblin', text: 'Less talking, more running! North, through the old pass!', style: 'shout' },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: 'Right. Stay close everyone. Move!', style: 'command' },
  ]);
}

/** Victory take. Two looks — the party, then the road north. */
export function chapter1WinReel() {
  return reelFromSteps('ending', 'win', [
    { kind: CLIP_CAMERA, tx: 30, tz: 40, radius: 100, alpha: 0.3, dur: 1.2 },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: 'We made it...', style: 'whisper' },
    { kind: CLIP_LINE, speaker: 'Lady', text: 'But look behind us...', style: 'scared' },
    { kind: CLIP_CAMERA, tx: 30, tz: 24, radius: 145, alpha: -2.15, dur: 2.6 },
    { kind: CLIP_LINE, speaker: 'Doc', text: 'All those towers... everything we built. Gone.', style: 'think' },
    { kind: CLIP_HOLD, dur: 0.8 },
    { kind: CLIP_LINE, speaker: 'Goblin', text: "No use cryin' about it. What's ahead?" },
    { kind: CLIP_LINE, speaker: 'Stumpey', text: "The old road. Nobody's used it in ages." },
    { kind: CLIP_LINE, text: 'The party turns north, leaving the corrupted grove behind.' },
    { kind: CLIP_HOLD, dur: 1.8 },
  ]);
}

export function chapter1Story() {
  return normalizeStory({
    reels: [chapter1IntroReel(), chapter1WinReel()],
  });
}

/**
 * Tiny v4 board + Chapter 1 reels. Terrain is a seeded placeholder — paint the real map in Forge.
 * Write with: node --input-type=module -e "import { writeFileSync } from 'fs'; import { buildChapter1Garden } from './story/chapter1.js'; const j=JSON.stringify(buildChapter1Garden()); writeFileSync('../maps/chapter1.garden', j); writeFileSync('maps/chapter1.garden', j);"
 */
export function buildChapter1Garden() {
  const prevW = activeMapW();
  const prevH = activeMapH();
  try {
    const field = buildField(CHAPTER1_SEED, { width: TINY_MAP_W, height: TINY_MAP_H });
    applyTableSilhouette(field, {
      cellSize: TABLE_CHUNK_TILES,
      cellMask: createFullCellMask(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES),
      cellRadius: createFullCellRadius(TINY_MAP_W, TINY_MAP_H, TABLE_CHUNK_TILES, 0),
    });
    markChapterExit(field, 30, 43, chapter1Objectives()[0]);
    return encodeGarden(field, {
      name: CHAPTER1_GARDEN_NAME,
      story: chapter1Story(),
      objectives: chapter1Objectives(),
      units: unitsFromCast(CHAPTER1_CAST),
    });
  } finally {
    setActiveMapSize(prevW, prevH);
  }
}
