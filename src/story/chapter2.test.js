import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { CLIP_LINE } from './timeline.js';
import { setupWaveSpawners } from '../sim/waveSpawner.js';
import { createWorld } from '../sim/world.js';
import {
  CHAPTER2_GARDEN_NAME,
  CHAPTER2_NEXT_URL,
  CHAPTER2_NEUTRAL_TEAMS,
  CHAPTER2_SEED,
  CHAPTER2_TOWER_OWNER,
  CHAPTER2_WAVE_OWNER,
  CHAPTER2_WAVE_ROUTE,
  CHAPTER2_WAVES,
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
    assert.deepEqual(g.units.filter((u) => u.name).map((u) => u.name), ['Stumpey', 'Goblin', 'Lady', 'Doc']);
    assert.ok(g.units.some((u) => u.owner === CHAPTER2_TOWER_OWNER && !u.name));
    const towers = g.buildings.filter((b) => b.owner === CHAPTER2_TOWER_OWNER && b.type === 'tower');
    assert.equal(towers.length, 2);
    assert.deepEqual(g.neutralTeams, CHAPTER2_NEUTRAL_TEAMS);
    assert.equal(g.objectives[0].params.owner, CHAPTER2_WAVE_OWNER);
    assert.equal(g.objectives.length, 1);
    assert.equal(g.objectives[0].kind, 'escape');
    assert.equal(g.objectives[0].next, CHAPTER2_NEXT_URL);
    assert.equal(g.objectives[0].params.waves, CHAPTER2_WAVES);
    assert.deepEqual(g.objectives[0].params.route, CHAPTER2_WAVE_ROUTE);
    const world = createWorld(CHAPTER2_SEED);
    setupWaveSpawners(world, { width: json.w, height: json.h, worldHalfF: json.w * 2 }, g.objectives);
    assert.equal(world.waveSpawners?.length, 1);
    assert.equal(world.waveSpawners[0].waves, CHAPTER2_WAVES);
    assert.equal(world.waveSpawners[0].owner, CHAPTER2_WAVE_OWNER);
    const onDisk = JSON.parse(readFileSync(join(here, '../../maps/chapter2.garden'), 'utf8'));
    assert.deepEqual(onDisk.nr, json.nr);
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
