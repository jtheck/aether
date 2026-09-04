import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_KEEP, CLIP_CAMERA, CLIP_LINE } from './timeline.js';
import { RATE_SKIP, RATES, createStoryPlayer, stepStoryRate } from './player.js';

const reel = {
  id: 'intro',
  clips: [
    { id: 'a', kind: CLIP_CAMERA, t: 0, dur: 2, tx: 0, tz: 0, radius: 100, alpha: 0 },
    { id: 'b', kind: CLIP_LINE, t: 1, dur: 2, speaker: 'Doc', text: 'Go.' },
    { id: 'c', kind: CLIP_CAMERA, t: 2, dur: 2, tx: 8, tz: 4, radius: 40, alpha: 1 },
  ],
};

describe('createStoryPlayer', () => {
  it('seeks and ticks without depending on play order', () => {
    const seen = [];
    const player = createStoryPlayer({
      reel,
      onSample: (s) => seen.push(s.t),
    });
    player.seek(3);
    assert.equal(player.sample().camera.tx > 0, true);
    player.seek(0);
    assert.equal(player.sample().camera.tx, 0);
    assert.equal(player.sample().line, null);
    player.play();
    player.tick(50);
    assert.ok(Math.abs(player.time() - 0.05) < 1e-6);
    player.tick(5000);
    assert.ok(player.time() < 0.12);
    player.seek(player.duration());
    assert.equal(player.time(), 4);
    player.prevClip();
    assert.equal(player.time(), 2);
  });

  it('<< and >> step every listed speed including pause and 1×', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((i) => {
        let r = 0;
        for (let n = 0; n < i; n++) r = stepStoryRate(r, 1);
        return r;
      }),
      [0, 1, 2, 4, 4],
    );
    assert.equal(stepStoryRate(1, -1), 0);
    assert.equal(stepStoryRate(0, -1), -2);
    assert.equal(stepStoryRate(-2, -1), -2);
    assert.equal(stepStoryRate(4, 1), 4);
    assert.equal(stepStoryRate(RATE_SKIP, -1), 4);
    assert.equal(stepStoryRate(RATE_SKIP, 1), 4);
    const player = createStoryPlayer({ reel });
    const seen = [];
    for (let i = 0; i < RATES.length; i++) {
      player.fastForward();
      seen.push(player.rate());
    }
    assert.deepEqual(seen, [1, 2, 4, 4, 4]);
  });

  it('>| sprints instead of jumping to the end', () => {
    const player = createStoryPlayer({ reel });
    player.skipForward();
    assert.equal(player.rate(), RATE_SKIP);
    player.tick(50);
    assert.ok(Math.abs(player.time() - 0.05 * RATE_SKIP) < 1e-6);
    assert.equal(player.sample().lines.length, 1);
    player.seek(player.duration());
    player.skipForward();
    assert.equal(player.rate(), 0);
    assert.equal(player.time(), 4);
  });

  it('keeps skipped lines for their authored duration, then drops them', () => {
    let wall = 0;
    const player = createStoryPlayer({
      reel,
      now: () => wall,
    });
    player.skipForward();
    player.tick(50);
    assert.ok(player.sample().lines.some((l) => l.speaker === 'Doc'));
    player.tick(50);
    player.tick(50);
    assert.ok(player.time() >= 3);
    assert.ok(player.sample().lines.some((l) => l.speaker === 'Doc'));
    wall = 10_000;
    player.tick(0);
    assert.equal(player.sample().lines.some((l) => l.speaker === 'Doc'), false);
  });

  it('forces the oldest line out when the chat queue is full', () => {
    const many = {
      id: 'intro',
      clips: Array.from({ length: CHAT_KEEP + 2 }, (_, i) => ({
        id: `l${i}`,
        kind: CLIP_LINE,
        t: i * 0.2,
        dur: 8,
        speaker: `S${i}`,
        text: `Line ${i}`,
      })),
    };
    const player = createStoryPlayer({ reel: many });
    player.skipForward();
    player.tick(50);
    player.tick(50);
    const speakers = player.sample().lines.map((l) => l.speaker);
    assert.ok(speakers.length <= CHAT_KEEP);
    assert.equal(speakers.includes('S0'), false);
  });
});
