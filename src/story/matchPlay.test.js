import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_CAMERA, CLIP_LINE } from './timeline.js';
import { createMatchStory } from './matchPlay.js';

describe('createMatchStory', () => {
  it('drives the camera along the start reel and releases on skip', () => {
    const poses = [];
    const cam = {
      setPose(pose) { poses.push({ ...pose }); },
      stopFollow() {},
    };
    const field = { worldHalfF: 160, width: 80 };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => field,
    });
    const started = story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [
          { id: 'c', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 10, tz: 20, radius: 80, alpha: 0.5 },
          { id: 'l', kind: CLIP_LINE, t: 0, dur: 2, speaker: 'Doc', text: 'Go.' },
        ],
      }],
    });
    assert.equal(started, true);
    assert.equal(story.driving(), true);
    assert.ok(poses.length >= 1);
    assert.equal(poses[0].radius, 80);
    story.skip();
    assert.equal(story.driving(), false);
    assert.equal(poses.at(-1).radius, 80);
  });

  it('aims a char camera at the live speaker', () => {
    const poses = [];
    const cam = {
      setPose(pose) { poses.push({ ...pose }); },
      stopFollow() {},
    };
    const field = { worldHalfF: 160, width: 80 };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => field,
      getSpeakerPos: (name) => (name === 'Stumpey' ? { x: 12, y: 2, z: 34 } : null),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [
          { id: 'c', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 10, tz: 20, radius: 40, alpha: 0.2, char: 'Stumpey' },
        ],
      }],
    });
    assert.equal(poses[0].x, 12);
    assert.equal(poses[0].z, 34);
    story.skip();
  });

  it('ignores a story with no start clips', () => {
    const story = createMatchStory({ getCamera: () => null, getField: () => null });
    assert.equal(story.playIntro({ reels: [] }), false);
    assert.equal(story.driving(), false);
  });
});
