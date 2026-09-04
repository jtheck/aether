import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_CAMERA,
  CLIP_LINE,
  encodeStory,
  lineDuration,
  nextClipTime,
  normalizeStory,
  clipBeatTime,
  prevClipTime,
  sample,
} from './timeline.js';

function reel() {
  return {
    id: 'intro',
    clips: [
      { id: 'cam-a', kind: CLIP_CAMERA, t: 0, dur: 4, tx: 0, tz: 0, radius: 200, alpha: 0 },
      { id: 'line-a', kind: CLIP_LINE, t: 0.2, dur: 3, speaker: 'Stumpey', text: 'Big problems.', style: 'scared' },
      { id: 'cam-b', kind: CLIP_CAMERA, t: 4, dur: 4, tx: 10, tz: 20, radius: 45, alpha: 1 },
      { id: 'line-b', kind: CLIP_LINE, t: 5, dur: 2, speaker: 'Lady', text: 'This way.', style: 'whisper' },
    ],
  };
}

describe('lineDuration', () => {
  it('clamps short and long copy', () => {
    assert.equal(lineDuration(''), 2.5);
    assert.ok(lineDuration('Hi') >= 2.5);
    assert.equal(lineDuration('x'.repeat(400)), 8);
  });
});

describe('sample', () => {
  it('holds the first camera pose before the first move finishes at t=0', () => {
    const s = sample(reel(), 0);
    assert.equal(s.camera.tx, 0);
    assert.equal(s.camera.tz, 0);
    assert.equal(s.camera.radius, 200);
    assert.equal(s.line, null);
    assert.deepEqual(s.lines, []);
  });

  it('lerps camera mid-clip and shows the covering line', () => {
    const duringLine = sample(reel(), 2);
    assert.equal(duringLine.camera.tx, 0);
    assert.equal(duringLine.line.speaker, 'Stumpey');
    assert.equal(duringLine.line.text, 'Big problems.');
    const midMove = sample(reel(), 6);
    assert.ok(midMove.camera.tx > 0 && midMove.camera.tx < 10);
    assert.ok(midMove.camera.radius < 200 && midMove.camera.radius > 45);
    assert.equal(midMove.line.speaker, 'Lady');
    assert.equal(midMove.lines.length, 1);
    assert.equal(midMove.lines[0].speaker, 'Lady');
  });

  it('names the current clip-start beat', () => {
    assert.equal(clipBeatTime(reel(), 0), 0);
    assert.equal(clipBeatTime(reel(), 0.2), 0.2);
    assert.equal(clipBeatTime(reel(), 3.9), 0.2);
    assert.equal(clipBeatTime(reel(), 4), 4);
    assert.equal(clipBeatTime(reel(), 6), 5);
  });

  it('hides a line after its authored duration', () => {
    const s = sample(reel(), 3.5);
    assert.equal(s.line, null);
    assert.deepEqual(s.lines, []);
    assert.equal(s.camera.tx, 0);
    assert.equal(s.camera.radius, 200);
  });

  it('seeks past the end to the final pose with expired lines gone', () => {
    const s = sample(reel(), 99);
    assert.equal(s.t, 8);
    assert.equal(s.duration, 8);
    assert.equal(s.camera.tx, 10);
    assert.equal(s.camera.tz, 20);
    assert.equal(s.camera.radius, 45);
    assert.equal(s.line, null);
    assert.deepEqual(s.lines, []);
  });

  it('only keeps lines whose window still covers the playhead', () => {
    const late = sample(reel(), 6);
    assert.equal(late.lines.length, 1);
    assert.equal(late.lines[0].speaker, 'Lady');
    const early = sample(reel(), 2);
    assert.equal(early.lines.length, 1);
    assert.equal(early.lines[0].speaker, 'Stumpey');
  });

  it('attaches char only while the aimed camera clip covers the playhead', () => {
    const r = {
      id: 'intro',
      clips: [
        { id: 'cam-a', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 0, tz: 0, radius: 80, alpha: 0 },
        { id: 'cam-b', kind: CLIP_CAMERA, t: 2, dur: 2, tx: 10, tz: 20, radius: 40, alpha: 1, char: 'Stumpey' },
      ],
    };
    assert.equal(sample(r, 1).camera.char, undefined);
    assert.equal(sample(r, 3).camera.char, 'Stumpey');
    assert.equal(sample(r, 4).camera.char, undefined);
    assert.equal(sample(r, 99).camera.char, undefined);
  });

  it('seek to 0 is the first pose, not leftover state', () => {
    sample(reel(), 7);
    const s = sample(reel(), 0);
    assert.equal(s.camera.tx, 0);
    assert.equal(s.camera.radius, 200);
    assert.equal(s.line, null);
  });

  it('holds an authored start pose at the first clip when from is set', () => {
    const r = {
      clips: [{
        id: 'a',
        kind: CLIP_CAMERA,
        t: 0,
        dur: 2,
        fromTx: 5,
        fromTz: 7,
        fromRadius: 180,
        fromAlpha: 0.2,
        tx: 10,
        tz: 20,
        radius: 40,
        alpha: 1,
      }],
    };
    const s = sample(r, 0);
    assert.equal(s.camera.tx, 5);
    assert.equal(s.camera.tz, 7);
    assert.equal(s.camera.radius, 180);
  });

  it('lerps an explicit start pose instead of the previous shot', () => {
    const r = {
      clips: [
        { id: 'a', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 0, tz: 0, radius: 100, alpha: 0 },
        {
          id: 'b',
          kind: CLIP_CAMERA,
          t: 2,
          dur: 2,
          fromTx: 20,
          fromTz: 0,
          fromRadius: 80,
          fromAlpha: 0,
          tx: 40,
          tz: 0,
          radius: 40,
          alpha: 0,
        },
      ],
    };
    const start = sample(r, 2);
    assert.equal(start.camera.tx, 20);
    assert.equal(start.camera.radius, 80);
    const mid = sample(r, 3);
    assert.equal(mid.camera.tx, 30);
    assert.equal(mid.camera.radius, 60);
  });

  it('accepts a nested from pose', () => {
    const s = sample({
      clips: [{
        id: 'a',
        kind: CLIP_CAMERA,
        t: 0,
        dur: 2,
        tx: 8,
        tz: 9,
        radius: 40,
        alpha: 0,
        from: { tx: 1, tz: 2, radius: 70, alpha: 0 },
      }],
    }, 0);
    assert.equal(s.camera.tx, 1);
    assert.equal(s.camera.tz, 2);
    assert.equal(s.camera.radius, 70);
  });
});

describe('clip stepping', () => {
  it('steps to the previous and next clip starts', () => {
    assert.equal(prevClipTime(reel(), 5), 4);
    assert.equal(nextClipTime(reel(), 4), 5);
    assert.equal(prevClipTime(reel(), 0), 0);
    assert.equal(nextClipTime(reel(), 7), 8);
  });
});

describe('encodeStory', () => {
  it('omits an empty reel and roundtrips clips', () => {
    assert.equal(encodeStory({ reels: [{ id: 'intro', clips: [] }] }), undefined);
    const packed = encodeStory({ reels: [reel()] });
    const again = normalizeStory(packed);
    assert.equal(again.reels[0].clips.length, 4);
    assert.equal(again.reels[0].clips[1].style, 'scared');
    assert.equal(packed.reels[0].clips[0].fromTx, undefined);
  });

  it('roundtrips an explicit camera start pose', () => {
    const packed = encodeStory({
      reels: [{
        id: 'intro',
        clips: [{
          id: 'a',
          kind: CLIP_CAMERA,
          t: 0,
          dur: 1,
          tx: 3,
          tz: 4,
          radius: 50,
          alpha: 0,
          fromTx: 1,
          fromTz: 2,
          fromRadius: 90,
          fromAlpha: 0.5,
        }],
      }],
    });
    assert.equal(packed.reels[0].clips[0].fromTx, 1);
    assert.equal(packed.reels[0].clips[0].fromRadius, 90);
    const again = normalizeStory(packed);
    assert.equal(again.reels[0].clips[0].fromTx, 1);
    assert.equal(again.reels[0].clips[0].fromTz, 2);
    assert.equal(again.reels[0].clips[0].fromRadius, 90);
    assert.equal(again.reels[0].clips[0].fromAlpha, 0.5);
  });
});
