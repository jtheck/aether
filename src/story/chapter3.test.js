import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { TERRAIN } from '../sim/field.js';
import { CLIP_LINE } from './timeline.js';
import {
  CHAPTER3_GARDEN_NAME,
  CHAPTER3_SEED,
  buildChapter3Garden,
  chapter3IntroReel,
} from './chapter3.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('chapter 3 story', () => {
  it('opens on a hollow exit and matches maps/chapter3.garden', () => {
    const reel = chapter3IntroReel();
    assert.ok(reel.clips.filter((c) => c.kind === CLIP_LINE).length >= 2);
    const json = buildChapter3Garden();
    assert.equal(json.n, CHAPTER3_GARDEN_NAME);
    assert.equal(json.s, CHAPTER3_SEED);
    const g = decodeGarden(json);
    assert.equal(g.agoras.length, 0);
    assert.equal(json.g, undefined);
    assert.deepEqual(g.units.filter((u) => u.name).map((u) => u.name), ['Stumpey', 'Goblin', 'Lady', 'Doc']);
    assert.ok(g.units.some((u) => u.owner === 4 && !u.name));
    assert.ok(g.buildings.some((b) => b.owner === 4 && b.type === 'camp'));
    assert.equal(g.objectives.length, 1);
    assert.equal(g.objectives[0].kind, 'escape');
    assert.equal(g.objectives[0].next, '');
    assert.equal(g.terrainTypes[18 * g.width + 48], TERRAIN.DIRT);
    const onDisk = JSON.parse(readFileSync(join(here, '../../maps/chapter3.garden'), 'utf8'));
    assert.deepEqual(onDisk.story, JSON.parse(JSON.stringify(json.story)));
    assert.deepEqual(onDisk.obj, json.obj);
    assert.deepEqual(onDisk.u, json.u);
    assert.equal(onDisk.g, undefined);
    assert.equal(json.ncb, 1);
    assert.equal(onDisk.ncb, 1);
    assert.ok(json.sc);
    assert.ok(g.sceneryType.some((v) => v === 1));
    assert.deepEqual(onDisk.sc, json.sc);
  });
});
