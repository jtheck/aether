import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_CAMERA, CLIP_LINE } from './timeline.js';
import { createMatchStory } from './matchPlay.js';

describe('createMatchStory', () => {
  it('puts the camera on the playhead with the line, including a move', () => {
    const how = [];
    const radii = [];
    const cam = {
      easePose(pose) { how.push('ease'); radii.push(pose.radius); },
      setPose(pose) { how.push('set'); radii.push(pose.radius); },
      stopFollow() {},
    };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => ({ worldHalfF: 160, width: 80 }),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [
          {
            id: 'a',
            kind: CLIP_CAMERA,
            t: 0,
            dur: 1,
            fromTx: 0,
            fromTz: 0,
            fromRadius: 80,
            fromAlpha: 0,
            tx: 10,
            tz: 0,
            radius: 40,
            alpha: 0,
          },
          { id: 'line', kind: CLIP_LINE, t: 0, dur: 2, speaker: 'Doc', text: 'Go.' },
        ],
      }],
    });
    assert.deepEqual(how, ['set']);
    assert.equal(radii[0], 80);
    for (let i = 0; i < 10; i++) story.tick(50);
    assert.ok(how.every((kind) => kind === 'set'));
    assert.ok(radii.at(-1) < 80 && radii.at(-1) > 40);
    story.skip();
  });

  it('drives the camera along the start reel and releases on skip', () => {
    const poses = [];
    const cam = {
      easePose(pose) { poses.push({ ...pose }); },
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
    const n = poses.length;
    story.tick(200);
    assert.equal(poses.length, n);
    story.skip();
    assert.equal(story.driving(), false);
    assert.equal(poses.at(-1).radius, 80);
  });

  it('aims a char camera at the live speaker', () => {
    const poses = [];
    const cam = {
      easePose(pose) { poses.push({ ...pose }); },
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

  it('plays a win reel when asked', () => {
    const poses = [];
    const cam = {
      easePose(pose) { poses.push({ ...pose }); },
      setPose(pose) { poses.push({ ...pose }); },
      stopFollow() {},
    };
    const field = { worldHalfF: 160, width: 80 };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => field,
    });
    const started = story.playWin({
      reels: [{
        id: 'ending',
        when: 'win',
        clips: [
          { id: 'c', kind: CLIP_CAMERA, t: 0, dur: 1, tx: 4, tz: 5, radius: 60, alpha: 0 },
        ],
      }],
    });
    assert.equal(started, true);
    assert.equal(story.driving(), true);
    assert.equal(poses[0].radius, 60);
    story.skip();
    assert.equal(story.driving(), false);
  });

  it('keeps the player camera when a clip ends after they move it', () => {
    let pose = null;
    let pulled = false;
    const sets = [];
    const cam = {
      setPose(p) {
        pose = { ...p };
        sets.push(pose.radius);
      },
      getPose() {
        if (!pose) return null;
        return pulled ? { ...pose, x: pose.x + 40 } : pose;
      },
      stopFollow() {},
    };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => ({ worldHalfF: 160, width: 80 }),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [{
          id: 'a',
          kind: CLIP_CAMERA,
          t: 0,
          dur: 1,
          fromTx: 0,
          fromTz: 0,
          fromRadius: 80,
          fromAlpha: 0,
          tx: 10,
          tz: 0,
          radius: 40,
          alpha: 0,
        }],
      }],
    });
    for (let i = 0; i < 19; i++) story.tick(50);
    const n = sets.length;
    assert.ok(n > 1);
    assert.ok(sets.at(-1) > 40);
    pulled = true;
    story.tick(50);
    assert.equal(sets.length, n);
    assert.equal(story.driving(), false);
  });

  it('still lands a clip the player did not steer', () => {
    let pose = null;
    const sets = [];
    const cam = {
      setPose(p) {
        pose = { ...p };
        sets.push(pose.radius);
      },
      getPose() { return pose; },
      stopFollow() {},
    };
    const story = createMatchStory({
      getCamera: () => cam,
      getField: () => ({ worldHalfF: 160, width: 80 }),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [{
          id: 'a',
          kind: CLIP_CAMERA,
          t: 0,
          dur: 1,
          fromTx: 0,
          fromTz: 0,
          fromRadius: 80,
          fromAlpha: 0,
          tx: 10,
          tz: 0,
          radius: 40,
          alpha: 0,
        }],
      }],
    });
    for (let i = 0; i < 19; i++) story.tick(50);
    const n = sets.length;
    story.tick(50);
    assert.ok(sets.length > n);
    assert.equal(sets.at(-1), 40);
    story.tick(50);
    assert.equal(sets.at(-1), 40);
  });

  it('ignores a story with no start clips', () => {
    const story = createMatchStory({ getCamera: () => null, getField: () => null });
    assert.equal(story.playIntro({ reels: [] }), false);
    assert.equal(story.driving(), false);
  });

  it('drops live sight when a reel ends and keeps buildings as seen', () => {
    const revealed = [];
    const story = createMatchStory({
      getCamera: () => null,
      getField: () => ({ worldHalfF: 160, width: 80 }),
      onReveal: (spec) => revealed.push(spec ?? null),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        reveal: 'enemy',
        clips: [
          { id: 'c', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 1, tz: 2, radius: 40, alpha: 0 },
        ],
      }],
    });
    assert.equal(revealed.at(-1), 'enemy');
    story.skip();
    assert.equal(revealed.at(-1), null);
  });

  it('notifies when a cinematic arms and when it is skipped', () => {
    const cine = [];
    const story = createMatchStory({
      getCamera: () => null,
      getField: () => ({ worldHalfF: 160, width: 80 }),
      onCinematic: (on) => cine.push(!!on),
    });
    story.playIntro({
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [
          { id: 'c', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 10, tz: 20, radius: 80, alpha: 0 },
        ],
      }],
    });
    assert.deepEqual(cine, [true]);
    story.skip();
    assert.deepEqual(cine, [true, false]);
  });

  it('copies spoken lines and narration into chat once', () => {
    const spoken = [];
    const story = createMatchStory({
      getCamera: () => null,
      getField: () => ({ worldHalfF: 160, width: 80 }),
      onSpeak: (lines) => spoken.push(...lines),
    });
    const reel = {
      reels: [{
        id: 'intro',
        when: 'start',
        clips: [
          { id: 'n', kind: CLIP_LINE, t: 0, dur: 3, text: 'The wood is quiet.' },
          { id: 'l', kind: CLIP_LINE, t: 0, dur: 3, speaker: 'Doc', text: 'Go.', style: 'command' },
          { id: 'l2', kind: CLIP_LINE, t: 0.2, dur: 2, speaker: 'Lady', text: 'Wait.' },
        ],
      }],
    };
    story.playIntro(reel);
    const narr = spoken.find((line) => line.id === 'n');
    const doc = spoken.find((line) => line.id === 'l');
    assert.equal(narr.narration, true);
    assert.equal(narr.name, '');
    assert.equal(narr.text, 'The wood is quiet.');
    assert.equal(doc.name, 'Doc');
    assert.equal(doc.text, 'Go.');
    assert.equal(doc.color, '#ffd933');
    story.tick(50);
    story.tick(50);
    story.tick(50);
    story.tick(50);
    assert.deepEqual(spoken.map((line) => line.id), ['l', 'n', 'l2']);
    story.tick(50);
    assert.equal(spoken.length, 3);
    story.skip();
    story.playIntro(reel);
    assert.deepEqual(spoken.map((line) => line.id), ['l', 'n', 'l2', 'l', 'n']);
  });
});
