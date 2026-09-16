import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { CAMPAIGN_CHAPTERS, CHAPTER_CATALOG, EPISODES, campaignGardenUrl } from './campaign.js';
import { buildChapterGarden } from './campaignBuild.js';
import { isTerminalObjective } from './objectives.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('campaign manifest', () => {
  it('is 5 episodes and 19 chapters with unique ids', () => {
    assert.equal(EPISODES.length, 5);
    assert.equal(CAMPAIGN_CHAPTERS.length, 19);
    const ids = CAMPAIGN_CHAPTERS.map((c) => c.id);
    assert.equal(new Set(ids).size, 19);
  });

  it('chains each chapter to the next and ends the campaign clean', () => {
    for (let i = 0; i < CAMPAIGN_CHAPTERS.length; i++) {
      const c = CAMPAIGN_CHAPTERS[i];
      const expected = i + 1 < CAMPAIGN_CHAPTERS.length
        ? campaignGardenUrl(CAMPAIGN_CHAPTERS[i + 1].id)
        : '';
      assert.equal(c.nextUrl, expected);
    }
  });

  it('exposes a menu catalog labelled by episode', () => {
    assert.equal(CHAPTER_CATALOG.length, 19);
    assert.match(CHAPTER_CATALOG[0].name, /^E1·1 /);
    assert.equal(CHAPTER_CATALOG[0].garden, '/maps/e1c1.garden');
  });
});

describe('campaign chapter build', () => {
  it('builds a garden with four heroes, two reels, and a terminal objective', () => {
    const first = CAMPAIGN_CHAPTERS[0];
    const json = buildChapterGarden(first.def, first.nextUrl);
    const g = decodeGarden(json);
    const heroes = g.units.filter((u) => u.name);
    assert.equal(heroes.length, 4);
    assert.deepEqual(heroes.map((u) => u.name), ['Stumpey', 'Goblin', 'Lady', 'Doc']);
    assert.equal(g.story.reels.length, 2);
    assert.ok(g.objectives.some(isTerminalObjective));
    const terminal = g.objectives.find(isTerminalObjective);
    assert.equal(terminal.next, first.nextUrl);
  });

  it('varies board size across the campaign (not all one shape)', () => {
    const widths = new Set(EPISODES.flatMap((ep) => ep.chapters.map((d) => d.chunksX ?? d.chunks)));
    assert.ok(widths.size >= 3, 'expected a mix of board sizes');
  });

  it('spreads a variety of objective kinds', () => {
    const kinds = new Set();
    for (const ep of EPISODES) {
      for (const d of ep.chapters) {
        for (const o of d.objectives) kinds.add(o.kind);
      }
    }
    assert.ok(kinds.size >= 8, `expected a broad objective mix, got ${kinds.size}`);
  });

  it('carries preserved params through a v4 garden roundtrip', () => {
    const race = CAMPAIGN_CHAPTERS.find((c) => c.def.objectives.some((o) => o.params));
    assert.ok(race, 'a chapter should author objective params');
    const json = buildChapterGarden(race.def, race.nextUrl);
    const g = decodeGarden(json);
    assert.ok(g.objectives.some((o) => o.params && Object.keys(o.params).length > 0));
  });
});

describe('generated garden files match the builder', () => {
  it('every maps/<id>.garden decodes with the expected name and heroes', () => {
    for (const c of CAMPAIGN_CHAPTERS) {
      const data = JSON.parse(readFileSync(join(here, '../../maps', `${c.id}.garden`), 'utf8'));
      const g = decodeGarden(data);
      assert.equal(g.name, c.def.name, `${c.id} name`);
      assert.equal(g.units.filter((u) => u.name).length, 4, `${c.id} heroes`);
      assert.equal(g.story.reels.length, 2, `${c.id} reels`);
      assert.ok(g.objectives.some(isTerminalObjective), `${c.id} terminal`);
    }
  });
});
