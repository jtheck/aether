import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { createStoryPlayer } from './player.js';
import {
  CLIP_CAMERA,
  CLIP_LINE,
  nextClipTime,
  prevClipTime,
  sample,
} from './timeline.js';
import {
  CHAPTER1_GARDEN_NAME,
  CHAPTER1_SEED,
  buildChapter1Garden,
  chapter1IntroReel,
  chapter1Story,
  chapter1WinReel,
} from './chapter1.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('chapter 1 story', () => {
  it('lays intro cameras and lines on a seekable reel', () => {
    const reel = chapter1IntroReel();
    const cameras = reel.clips.filter((c) => c.kind === CLIP_CAMERA);
    const lines = reel.clips.filter((c) => c.kind === CLIP_LINE);
    assert.equal(cameras.length, 2);
    assert.equal(lines.length, 6);
    assert.equal(cameras[0].tx, 30);
    assert.equal(cameras[0].tz, 18);
    assert.equal(cameras[1].tz, 43);
    assert.equal(cameras[1].char, 'Stumpey');
    assert.equal(lines[1].speaker, 'Stumpey');
    assert.equal(lines[lines.length - 1].style, 'command');
  });

  it('reconstructs the opening pose and grove line without leftover state', () => {
    const reel = chapter1IntroReel();
    const grove = reel.clips.find((c) => c.kind === CLIP_LINE);
    const atStart = sample(reel, 0);
    assert.equal(atStart.camera.tx, 30);
    assert.equal(atStart.camera.tz, 18);
    assert.equal(atStart.camera.radius, 200);
    assert.equal(atStart.line, null);

    const duringGrove = sample(reel, grove.t + 0.1);
    assert.ok(duringGrove.line.text.startsWith('The ancient grove'));
    assert.equal(duringGrove.lines.length, 1);

    sample(reel, reel.duration);
    const back = sample(reel, 0);
    assert.equal(back.camera.tz, 18);
    assert.equal(back.line, null);
  });

  it('lerps the push-in and times out lines after their duration', () => {
    const reel = chapter1IntroReel();
    const move = reel.clips.find((c) => c.kind === CLIP_CAMERA && c.tz === 43);
    const mid = sample(reel, move.t + move.dur / 2);
    assert.equal(mid.camera.tx, 30);
    assert.ok(mid.camera.tz > 18 && mid.camera.tz < 43);
    assert.ok(mid.camera.radius < 200 && mid.camera.radius > 45);

    const last = reel.clips.filter((c) => c.kind === CLIP_LINE).at(-1);
    const duringLast = sample(reel, last.t + 0.1);
    assert.equal(duringLast.line.speaker, last.speaker);
    assert.equal(duringLast.line.text, last.text);
    const past = sample(reel, 99);
    assert.equal(past.t, reel.duration);
    assert.equal(past.camera.tz, 43);
    assert.equal(past.camera.radius, 45);
    assert.equal(past.line, null);
    assert.deepEqual(past.lines, []);
  });

  it('steps prev/next across intro clip starts', () => {
    const reel = chapter1IntroReel();
    const move = reel.clips.find((c) => c.kind === CLIP_CAMERA && c.tz === 43);
    assert.equal(prevClipTime(reel, move.t + 0.2), move.t);
    assert.ok(nextClipTime(reel, move.t) > move.t);
  });

  it('plays and seeks the intro without depending on play order', () => {
    const reel = chapter1IntroReel();
    const player = createStoryPlayer({ reel });
    const last = reel.clips.filter((c) => c.kind === 'line').at(-1);
    player.seek(last.t + 0.1);
    assert.equal(player.sample().line.speaker, 'Stumpey');
    player.toStart();
    assert.equal(player.sample().camera.tz, 18);
    player.play();
    player.tick(50);
    assert.ok(player.time() > 0 && player.time() < 0.2);
    player.tick(8000);
    assert.ok(player.time() < 0.2);
  });

  it('keeps a separate win reel', () => {
    const win = chapter1WinReel();
    assert.equal(win.when, 'win');
    const s = sample(win, 0);
    assert.equal(s.camera.tz, 11);
    const last = win.clips.filter((c) => c.kind === 'line').at(-1);
    const end = sample(win, last.t + 0.1);
    assert.match(end.line.text, /corrupted grove/);
    const story = chapter1Story();
    assert.equal(story.reels.length, 2);
    assert.equal(story.reels[1].id, 'ending');
  });

  it('roundtrips through a v4 garden and matches maps/chapter1.garden', () => {
    const json = buildChapter1Garden();
    assert.equal(json.n, CHAPTER1_GARDEN_NAME);
    assert.equal(json.s, CHAPTER1_SEED);
    assert.equal(json.story.reels.length, 2);
    const g = decodeGarden(json);
    assert.equal(g.story.reels[0].clips.filter((c) => c.kind === CLIP_LINE).length, 6);
    assert.equal(g.agoras.length, 1);
    assert.equal(g.units.length, 4);
    assert.deepEqual(g.units.map((u) => u.name), ['Stumpey', 'Goblin', 'Lady', 'Doc']);
    assert.equal(g.units[0].type, 5);
    assert.equal(g.units[1].type, 3);
    assert.equal(g.units[2].type, 4);
    assert.equal(g.units[3].type, 6);

    const onDisk = JSON.parse(readFileSync(join(here, '../../maps/chapter1.garden'), 'utf8'));
    assert.deepEqual(onDisk.story, JSON.parse(JSON.stringify(json.story)));
    assert.equal(onDisk.n, json.n);
    assert.equal(onDisk.w, json.w);
    assert.deepEqual(onDisk.u, json.u);
  });
});
