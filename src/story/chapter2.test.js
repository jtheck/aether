import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { CLIP_LINE } from './timeline.js';
import {
  CHAPTER2_GARDEN_NAME,
  CHAPTER2_NEXT_URL,
  CHAPTER2_SEED,
  buildChapter2Garden,
  chapter2IntroReel,
} from './chapter2.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('chapter 2 story', () => {
  it('opens on a short intro and an exit to chapter 3', () => {
    const reel = chapter2IntroReel();
    assert.equal(reel.clips.filter((c) => c.kind === CLIP_LINE).length, 2);
    const json = buildChapter2Garden();
    assert.equal(json.n, CHAPTER2_GARDEN_NAME);
    assert.equal(json.s, CHAPTER2_SEED);
    const g = decodeGarden(json);
    assert.equal(g.agoras.length, 0);
    assert.equal(json.g, undefined);
    assert.equal(g.units.length, 4);
    assert.equal(g.objectives.length, 1);
    assert.equal(g.objectives[0].kind, 'escape');
    assert.equal(g.objectives[0].next, CHAPTER2_NEXT_URL);
    const onDisk = JSON.parse(readFileSync(join(here, '../../maps/chapter2.garden'), 'utf8'));
    assert.deepEqual(onDisk.story, JSON.parse(JSON.stringify(json.story)));
    assert.deepEqual(onDisk.obj, json.obj);
    assert.deepEqual(onDisk.u, json.u);
    assert.equal(onDisk.g, undefined);
  });
});
