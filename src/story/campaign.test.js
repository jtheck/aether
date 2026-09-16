import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { TERRAIN } from '../sim/field.js';
import { SCENERY } from '../sim/scenery.js';
import { CAMPAIGN_CHAPTERS, CHAPTER_CATALOG, EPISODES, campaignGardenUrl } from './campaign.js';
import { buildChapterGarden } from './campaignBuild.js';
import { isTerminalObjective } from './objectives.js';
import { normalizeStory } from './timeline.js';

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

  it('names trigger zones in one word, and keeps a few HEREs', () => {
    let heres = 0;
    for (const ep of EPISODES) {
      for (const d of ep.chapters) {
        for (const o of d.objectives) {
          assert.ok(o.label && !/\s/.test(o.label), `${d.id} label "${o.label}" should be one word`);
          if (o.label === 'here') heres += 1;
        }
      }
    }
    assert.ok(heres >= 3, `expected a few HERE zones, got ${heres}`);
  });

  it('authors water, forest, halls, and chunk holes on the set', () => {
    const withWater = EPISODES.flatMap((ep) => ep.chapters).filter((d) => (d.water?.length || d.channel?.length));
    const withWoods = EPISODES.flatMap((ep) => ep.chapters).filter((d) => (d.woods?.length || d.hedge?.length));
    const withHalls = EPISODES.flatMap((ep) => ep.chapters).filter((d) => d.halls?.length);
    const withHoles = EPISODES.flatMap((ep) => ep.chapters).filter((d) => d.hole?.length);
    assert.ok(withWater.length >= 12, `expected water barriers, got ${withWater.length}`);
    assert.ok(withWoods.length >= 12, `expected forest barriers, got ${withWoods.length}`);
    assert.ok(withHalls.length >= 14, `expected set-dressing halls, got ${withHalls.length}`);
    assert.ok(withHoles.length >= 8, `expected chunk holes for giant props, got ${withHoles.length}`);
  });

  it('paints water, forest, and halls onto the board', () => {
    const moat = CAMPAIGN_CHAPTERS.find((c) => c.id === 'e1c4');
    const woods = CAMPAIGN_CHAPTERS.find((c) => c.id === 'e4c1');
    const gMoat = decodeGarden(buildChapterGarden(moat.def, moat.nextUrl));
    const gWoods = decodeGarden(buildChapterGarden(woods.def, woods.nextUrl));
    const water = [...gMoat.terrainTypes].filter((t) => t === TERRAIN.WATER).length;
    const trees = [...gWoods.sceneryType].filter((t) => t === SCENERY.TREE).length;
    assert.ok(water > 80, `moat chapter should be a water barrier, got ${water} water tiles`);
    assert.ok(trees > 200, `muster chapter should be thick woods, got ${trees} trees`);
    assert.ok(gWoods.buildings.length >= 5, 'war camp should place halls');
    assert.ok(gWoods.buildings.some((b) => (b.owner | 0) === 2), 'war camp should include allied halls');
  });

  it('carries preserved params through a v4 garden roundtrip', () => {
    const race = CAMPAIGN_CHAPTERS.find((c) => c.def.objectives.some((o) => o.params));
    assert.ok(race, 'a chapter should author objective params');
    const json = buildChapterGarden(race.def, race.nextUrl);
    const g = decodeGarden(json);
    assert.ok(g.objectives.some((o) => o.params && Object.keys(o.params).length > 0));
  });
});

describe('cinematic vision reveal', () => {
  it('defaults chapter cinematics to reveal the enemy faction', () => {
    const c = CAMPAIGN_CHAPTERS.find((x) => x.id === 'e1c1');
    const g = decodeGarden(buildChapterGarden(c.def, c.nextUrl));
    const s = normalizeStory(g.story);
    const intro = s.reels.find((r) => r.when === 'start');
    assert.deepEqual(intro.reveal, [4]);
  });

  it('honors an explicit full-map reveal override', () => {
    const c = CAMPAIGN_CHAPTERS.find((x) => x.id === 'e5c1');
    assert.equal(c.def.reveal, 'all');
    const g = decodeGarden(buildChapterGarden(c.def, c.nextUrl));
    const s = normalizeStory(g.story);
    const intro = s.reels.find((r) => r.when === 'start');
    assert.equal(intro.reveal, 'all');
  });

  it('roundtrips reveal through the on-disk gardens', () => {
    for (const c of CAMPAIGN_CHAPTERS) {
      const data = JSON.parse(readFileSync(join(here, '../../maps', `${c.id}.garden`), 'utf8'));
      const s = normalizeStory(data.story);
      const intro = s.reels.find((r) => r.when === 'start');
      assert.ok(intro.reveal !== undefined, `${c.id} intro should share cinematic vision`);
    }
  });
});

describe('generated garden files match the builder', () => {
  it('every maps/<id>.garden decodes with the expected name and heroes', () => {
    for (const c of CAMPAIGN_CHAPTERS) {
      const data = JSON.parse(readFileSync(join(here, '../../maps', `${c.id}.garden`), 'utf8'));
      const g = decodeGarden(data);
      assert.equal(g.name, c.def.name, `${c.id} name`);
      // The four heroes are always present; escort chapters add a named escort unit.
      const named = new Set(g.units.filter((u) => u.name).map((u) => u.name));
      for (const hero of ['Stumpey', 'Goblin', 'Lady', 'Doc']) {
        assert.ok(named.has(hero), `${c.id} missing hero ${hero}`);
      }
      assert.equal(g.story.reels.length, 2, `${c.id} reels`);
      assert.ok(g.objectives.some(isTerminalObjective), `${c.id} terminal`);
    }
  });
});
